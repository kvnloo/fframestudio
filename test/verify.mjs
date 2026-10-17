#!/usr/bin/env node
// Drive the real app the way a user does and save evidence.
//   node test/verify.mjs [--out DIR] [--keep]
// Builds an isolated world (temp HOME with a demo film), starts its own bridge on a free port,
// drives Chromium through the user journeys in .agents/skills/verify-fframestudio/features/,
// writes report.json + screenshots to DIR (default verify-out/<timestamp>), then tears down
// only what it started. Exit code 1 if any journey fails.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const OUT = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(ROOT, 'verify-out', new Date().toISOString().replace(/[:.]/g, '-')));
const KEEP = argv.includes('--keep');
fs.mkdirSync(OUT, { recursive: true });

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-verify-'));
const env = { ...process.env, HOME, FFS_SOURCES: path.join(ROOT, 'projects/sources.example.json') };
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8' }); if (r.status) throw new Error(`${cmd} ${args.join(' ')} failed\n${r.stderr.slice(-800)}`); return r.stdout; };
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

const report = { started: new Date().toISOString(), out: OUT, journeys: [], console_errors: [], failed_requests: [] };
const journey = async (name, fn) => {
  const t0 = Date.now();
  try { const detail = await fn(); report.journeys.push({ name, ok: true, ms: Date.now() - t0, ...detail }); console.error(`ok   ${name}`); }
  catch (e) { report.journeys.push({ name, ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 600) }); console.error(`FAIL ${name}: ${e.message}`); }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

let bridge, browser;
try {
  run('python3', ['tools/make_demo.py']);
  run('python3', ['tools/import_projects.py']);
  const source = path.join(HOME, 'fframestudio/demo-src/demo.mp4');
  const sourceHash = () => createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const sourceBefore = sourceHash();
  const port = await freePort(), token = 'verify-' + Math.random().toString(36).slice(2);
  bridge = spawn(process.execPath, ['bridge/bridge.mjs', '--port', String(port), '--root', path.join(HOME, 'fframestudio'), '--token', token, '--quiet', '--no-config'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, bad) => { bridge.stdout.once('data', ok); bridge.once('exit', (c) => bad(new Error('bridge exited ' + c))); setTimeout(() => bad(new Error('bridge not ready in 15 s')), 15000); });
  const base = `http://127.0.0.1:${port}`;
  report.bridge = { port, health: await fetch(base + '/health').then((r) => r.json()) };

  // Playwright's bundled Chromium has no H.264; use Chrome (PW_CHANNEL=chrome) or a system Chromium build with codecs.
  const channel = process.env.PW_CHANNEL;
  const exe = channel ? undefined : process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ channel, executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  ctx.on('page', (p) => {
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) report.console_errors.push(m.text().slice(0, 300)); });
    p.on('pageerror', (e) => report.console_errors.push(e.message));
    p.on('response', (r) => { if (r.status() >= 400 && !/\/me$|favicon/.test(r.url())) report.failed_requests.push(`${r.status()} ${r.url().replace(token, '<token>')}`); });
  });
  let page = await ctx.newPage();
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });

  await journey('gate: app refuses without the link', async () => {
    await page.goto(base + '/'); await page.waitForSelector('.gate', { timeout: 10000 });
    const unauth = await fetch(base + '/agents').then((r) => r.status); assert(unauth === 401, `/agents without token returned ${unauth}`);
    await shot('01-gate'); return { agents_without_token: unauth };
  });
  await journey('library: open link, demo project listed', async () => {
    await page.goto(`${base}/open?token=${token}`); await page.waitForSelector('.card', { timeout: 10000 });
    const titles = await page.$$eval('.card .t', (e) => e.map((x) => x.textContent));
    assert(titles.includes('Demo film'), `cards: ${titles.join(', ')}`);
    const posterOk = await page.$eval('.card img', (i) => i.complete && i.naturalWidth > 0);
    assert(posterOk, 'poster image did not load'); await shot('02-library'); return { titles };
  });
  await journey('project: plays and seeks by shot', async () => {
    await page.click('.card'); await page.waitForSelector('#preview-video');
    await page.waitForFunction(() => document.querySelector('#preview-video').readyState >= 2, null, { timeout: 15000 })
      .catch(async () => { throw new Error('video not decodable here: ' + JSON.stringify(await page.$eval('#preview-video', (v) => ({ src: v.currentSrc, err: v.error?.code, h264: v.canPlayType('video/mp4; codecs="avc1.640028"') })))); });
    const dur = await page.$eval('#preview-video', (v) => v.duration); assert(Math.abs(dur - 12) < 0.5, `duration ${dur}`);
    const shots = await page.locator('#timeline .timeline-clip').count(); assert(shots === 4, `shots ${shots}`);
    await page.click('[data-action="play"]');
    await page.waitForFunction(() => document.querySelector('#preview-video').currentTime > 0.2);
    await page.click('[data-action="pause"]');
    await page.locator('#timeline .timeline-clip').nth(2).click(); await page.waitForTimeout(400);
    const t = await page.$eval('#preview-video', (v) => v.currentTime); assert(Math.abs(t - 6) < 0.2, `seek landed at ${t}`);
    await shot('03-project'); return { duration_s: dur, shots, seek_to_shot3_s: +t.toFixed(3) };
  });
  await journey('context menu: native menu replaced, actions work', async () => {
    const clip = page.locator('#timeline .timeline-clip').nth(1);
    const menu = page.getByRole('menu', { name: 'Clip actions' });
    const baseline = await page.evaluate(() => ({ selection: window.ffs.selection, frame: window.ffs.frame, revision: window.ffs.doc.revision }));
    const trace = process.env.FFS_MENU_TRACE ? await ctx.newCDPSession(page) : null;
    const traceEvents = [];
    if (trace) {
      trace.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
      await trace.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' });
    }
    await clip.click({ button: 'right', position: { x: 30, y: 30 } });
    await menu.waitFor({ state: 'visible', timeout: 2000 });
    await page.waitForFunction(() => performance.getEntriesByName('context-menu:open-paint').length);
    const samples = [];
    for (let i = 0; i < 10; i++) {
      if (i) {
        await page.keyboard.press('Escape');
        await clip.click({ button: 'right', position: { x: 30, y: 30 } });
        await page.waitForFunction(() => performance.getEntriesByName('context-menu:open-paint').length);
      }
      samples.push(await page.evaluate(() => ({
        ready_ms: performance.getEntriesByName('context-menu:open-ready').at(-1).duration,
        rendering_opportunity_ms: performance.getEntriesByName('context-menu:open-paint').at(-1).duration,
      })));
    }
    if (trace) {
      const complete = new Promise((resolve) => trace.once('Tracing.tracingComplete', resolve));
      await trace.send('Tracing.end'); await complete;
      fs.writeFileSync(path.join(OUT, 'context-menu-trace.json'), JSON.stringify({ traceEvents }));
      await trace.detach();
    }
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const timing = {
      menu_open_ms: {
        median: median(samples.map((s) => s.rendering_opportunity_ms)),
        worst: Math.max(...samples.map((s) => s.rendering_opportunity_ms)),
      },
      open_ready_median_ms: median(samples.map((s) => s.ready_ms)),
      open_ready_worst_ms: Math.max(...samples.map((s) => s.ready_ms)),
      samples,
    };
    report.context_menu = timing;
    assert(timing.open_ready_worst_ms < 16, `menu open work exceeded 16 ms: ${timing.open_ready_worst_ms}`);
    assert(await page.evaluate((before) => window.ffs.selection === before.selection && window.ffs.frame === before.frame && window.ffs.doc.revision === before.revision, baseline), 'opening a menu changed selection, playhead or document');
    const prevented = await clip.evaluate((node) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 450 });
      node.dispatchEvent(event); return event.defaultPrevented;
    });
    assert(prevented, 'timeline contextmenu default was not prevented');
    await shot('07-context-menu');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Math.abs(document.querySelector('#preview-video').currentTime - 3) < 0.05);
    assert(await menu.isHidden(), 'activation did not close menu');
    await clip.press('Shift+F10'); await menu.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert(await menu.isHidden(), 'Escape did not close menu');
    assert(await clip.evaluate((node) => node === document.activeElement), 'Escape did not restore invoking clip focus');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.ffs.rate === 1);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.ffs.rate === 0);
    await clip.press('ContextMenu');
    await menu.locator('[data-menu-action="seek-start"]').click();
    const nativeInput = await page.locator('input[data-field="title"]').evaluate((node) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      node.dispatchEvent(event); return !event.defaultPrevented;
    });
    assert(nativeInput, 'native input menu was prevented');
    await clip.press('ContextMenu'); await menu.waitFor({ state: 'visible' });
    await page.keyboard.press('End');
    assert(await page.evaluate(() => document.activeElement.dataset.menuAction === 'edit-style'), 'End did not skip disabled history items');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    assert(await page.evaluate(() => document.activeElement.dataset.menuAction === 'select'), 'Home did not focus first item');
    await menu.locator('[data-menu-action="duplicate"]').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.ffs.video.clips.length === 5);
    await clip.press('ContextMenu');
    await menu.locator('[data-menu-action="undo"]').click();
    await page.waitForFunction(() => window.ffs.video.clips.length === 4);
    await clip.press('ContextMenu');
    await menu.locator('[data-menu-action="redo"]').click();
    await page.waitForFunction(() => window.ffs.video.clips.length === 5);
    await clip.press('ContextMenu');
    await menu.locator('[data-menu-action="undo"]').click();
    await page.waitForFunction(() => window.ffs.video.clips.length === 4);

    await clip.press('ContextMenu');
    await menu.locator('[data-menu-action="set-beat-lock"]').click();
    await clip.press('ContextMenu');
    assert(await menu.locator('[data-menu-action="delete"]').isDisabled(), 'beat-locked delete was enabled');
    assert(await menu.locator('[data-menu-action="split"]').isDisabled(), 'beat-locked split was enabled');
    await page.keyboard.press('Escape');
    await page.locator('#seek').evaluate((node) => { node.value = '45'; node.dispatchEvent(new Event('input')); });
    await page.locator('#timeline .timeline-clip').first().press('ContextMenu');
    for (const id of ['delete', 'duplicate', 'in', 'out'])
      assert(await menu.locator(`[data-menu-action="${id}"]`).isDisabled(), `${id} would move a downstream beat-locked clip`);
    await menu.locator('[data-menu-action="undo"]').click();
    await page.waitForFunction(() => !window.ffs.video.clips.some((c) => c.beatLock));
    await clip.press('ContextMenu');
    await menu.locator('[data-menu-action="seek-start"]').click();

    await page.click('[data-action="settings"]');
    await page.locator('[data-binding="duplicate"]').fill('Mod+Shift+u');
    await page.locator('[data-binding="duplicate"]').press('Tab');
    await page.click('[data-action="close-settings"]');
    await clip.press('ContextMenu');
    assert(await menu.locator('[data-menu-action="duplicate"] kbd').textContent() === 'Mod+Shift+u', 'menu ignored custom keybinding');
    await page.keyboard.press('Escape');
    await page.click('[data-action="toggle-inspector"]');
    await page.locator('.story-card').nth(1).press('ContextMenu');
    await menu.locator('[data-menu-action="edit-text"]').click();
    assert(await page.locator('input[data-field="title"]').evaluate((node) => node === document.activeElement), 'Edit title did not reveal and focus Inspector');

    const nativeFields = await page.evaluate(() => {
      const wrapper = document.createElement('div');
      wrapper.contentEditable = 'true'; wrapper.innerHTML = '<span>Editable words</span>';
      document.body.append(wrapper);
      const nodes = [document.querySelector('#ask'), document.querySelector('#seek'), wrapper.firstChild];
      const results = nodes.map((node) => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        node.dispatchEvent(event); return !event.defaultPrevented;
      });
      wrapper.remove(); return results;
    });
    assert(nativeFields.every(Boolean), 'textarea or nested contenteditable menu was prevented');

    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#canvas').press('ContextMenu');
    const canvasMenu = page.getByRole('menu', { name: 'Canvas actions' });
    await canvasMenu.locator('[data-menu-action="nextFrame"]').click();
    assert(await page.evaluate(() => window.ffs.frame === window.ffs.clip.start + 1), 'Next frame did not advance');
    await page.locator('#canvas').press('ContextMenu');
    await canvasMenu.locator('[data-menu-action="previousFrame"]').click();
    await page.locator('#canvas').press('ContextMenu');
    await canvasMenu.locator('[data-menu-action="copy-timecode"]').click();
    await page.waitForFunction(async () => await navigator.clipboard.readText() === '00:00:03:00');
    await page.locator('#canvas').press('ContextMenu');
    await canvasMenu.locator('[data-menu-action="play"]').click();
    await page.waitForFunction(() => window.ffs.rate === 1);
    await page.locator('#canvas').press('ContextMenu');
    await canvasMenu.getByRole('menuitem', { name: 'Pause', exact: false }).click();
    await page.waitForFunction(() => window.ffs.rate === 0);

    for (const theme of ['light', 'contrast', 'dark']) {
      await page.click('[data-action="settings"]');
      await page.selectOption('#theme', theme);
      await page.click('[data-action="close-settings"]');
      await clip.evaluate((node) => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 1, clientY: innerHeight - 1 })));
      const bounds = await menu.boundingBox(), viewport = page.viewportSize();
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, 'menu escaped viewport');
      await shot('07-context-menu-' + theme);
      await page.keyboard.press('Escape');
    }
    await page.locator('.ph-title').click({ button: 'right' });
    const workspace = page.getByRole('menu', { name: 'Workspace actions' });
    await workspace.locator('[data-menu-action="palette"]').click();
    assert(await page.locator('#palette').isVisible(), 'empty-space palette did not open');
    await page.click('[data-action="close-palette"]');
    await page.locator('.ph-title').click({ button: 'right' });
    await workspace.locator('[data-menu-action="settings"]').click();
    assert(await page.locator('#settings').isVisible(), 'empty-space settings did not open');
    // Restore settings and saved state for the existing journeys.
    await page.locator('[data-binding="duplicate"]').fill('Mod+d');
    await page.locator('[data-binding="duplicate"]').press('Tab');
    await page.click('[data-action="close-settings"]');
    await page.click('[data-action="save"]');
    await page.waitForFunction(() => !window.ffs.dirty);
    await page.click('#crumbs a'); await page.waitForSelector('.card');
    await page.locator('.card').press('ContextMenu');
    const projectMenu = page.getByRole('menu', { name: 'Project actions' });
    await projectMenu.locator('[data-menu-action="reveal-path"]').click();
    const sourcePath = JSON.parse(fs.readFileSync(path.join(HOME, 'fframestudio/projects/demo/project.json'), 'utf8')).metadata.source.path;
    await page.waitForFunction(async (expected) => await navigator.clipboard.readText() === expected, sourcePath);
    await page.locator('.card').press('Shift+F10');
    await page.locator('.libhead h1').click();
    assert(await projectMenu.isHidden(), 'outside click did not close menu');
    await page.locator('.card').press('ContextMenu');
    await projectMenu.locator('[data-menu-action="open-project"]').click();
    await page.waitForFunction(() => window.ffs?.doc && !window.ffs.loading && document.querySelector('#preview-video'));
    assert(timing.menu_open_ms.worst < 16, `menu open → first rendering opportunity exceeded 16 ms: ${JSON.stringify(timing)}`);
    return { ...timing, browser_default_prevented: prevented, native_input: nativeInput, seek_s: 3, source_path_copied: sourcePath, undo_redo: true, themes: ['dark', 'light', 'contrast'] };
  });
  await journey('edit: shot title saves and survives reload', async () => {
    await page.locator('#timeline .timeline-clip').first().click();
    const clipId = await page.locator('#timeline .timeline-clip.selected').getAttribute('data-select');
    const field = page.locator('input[data-field="title"]'); const before = await field.inputValue();
    const after = before + ' (verified)'; await field.fill(after); await field.press('Tab');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Unsaved changes');
    await page.click('[data-action="save"]');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved', null, { timeout: 5000 });
    const file = JSON.parse(fs.readFileSync(path.join(HOME, 'fframestudio/projects/demo/project.json'), 'utf8'));
    const saved = file.videos?.flatMap((v) => v.clips).find((c) => c.id === clipId)?.textOverrides.title;
    assert(saved === after, 'edit not in project.json');
    // Deliver a file notification while the reloaded editor's worker is still opening.
    await page.route('**/app/src/doc/worker.js', async (route) => {
      await page.request.put(base + '/fs?path=projects/demo/project.json', { data: JSON.stringify(file) });
      await page.waitForTimeout(100);
      await route.continue();
    }, { times: 1 });
    await page.reload(); await page.waitForSelector('input[data-field="title"]');
    const persisted = await page.locator('input[data-field="title"]').inputValue(); assert(persisted === after, `after reload: ${persisted}`);
    const src = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source]));
    assert(Math.abs(src.format.duration - 12) < 0.5, 'source changed');
    assert(sourceHash() === sourceBefore, 'source mp4 bytes changed');
    await shot('04-edited'); return { before, after, clip_id: clipId, source_sha256: sourceBefore };
  });
  await journey('recovery: unsaved title survives page close, undo and explicit save', async () => {
    const filePath = path.join(HOME, 'fframestudio/projects/demo/project.json');
    const disk = fs.readFileSync(filePath, 'utf8');
    const field = page.locator('input[data-field="title"]');
    const before = await field.inputValue(), recovered = before + ' (recovered)';
    await field.fill(recovered); await field.press('Tab');
    await page.waitForFunction(() => window.ffs?.journal?.persistedVersion === window.ffs.doc.revision);
    await shot('06-recovery-edited');
    const version = await page.evaluate(() => window.ffs.doc.revision);
    assert(fs.readFileSync(filePath, 'utf8') === disk, 'autosave changed project.json');
    await page.close();
    page = await ctx.newPage();
    await page.goto(base + '/#/p/demo');
    await page.waitForSelector('[data-action="recover"]');
    await shot('06-recovery-offer');
    await page.click('[data-action="recover"]');
    await page.waitForFunction((value) => document.querySelector('input[data-field="title"]').value === value, recovered);
    assert(fs.readFileSync(filePath, 'utf8') === disk, 'recovery changed project.json before Save');
    await page.click('[data-action="undo"]');
    assert(await page.locator('input[data-field="title"]').inputValue() === before, 'recovery bypassed undo');
    await page.click('[data-action="redo"]');
    assert(await page.locator('input[data-field="title"]').inputValue() === recovered, 'recovered edit cannot be redone');
    await shot('06-recovery-restored');
    let expected;
    await page.route('**/fs?path=projects%2Fdemo%2Fproject.json', async (route) => {
      if (route.request().method() === 'PUT') expected = route.request().headers()['x-ffs-expected'];
      await route.continue();
    });
    await page.click('[data-action="save"]');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
    assert(expected === createHash('sha256').update(disk).digest('hex'), 'Save omitted expected disk hash');
    assert(JSON.parse(fs.readFileSync(filePath, 'utf8')).videos[0].clips[0].textOverrides.title === recovered, 'explicit Save did not write recovered title');
    await page.reload(); await page.waitForFunction(() => window.ffs?.journal);
    assert(await page.locator('#recovery').isHidden(), 'saved journal offered again');
    return { before, recovered, version, expected_hash: expected, disk_unchanged_before_save: true };
  });
  await journey('recovery: discard keeps disk title and clears the offer', async () => {
    const before = await page.locator('input[data-field="title"]').inputValue();
    await page.locator('input[data-field="title"]').fill('Discard this unsaved title');
    await page.locator('input[data-field="title"]').press('Tab');
    await page.waitForFunction(() => window.ffs?.journal?.persistedVersion === window.ffs.doc.revision);
    await page.close(); page = await ctx.newPage(); await page.goto(base + '/#/p/demo');
    await page.waitForSelector('[data-action="discard-recovery"]');
    await page.click('[data-action="discard-recovery"]');
    await page.waitForFunction(() => !document.querySelector('#recovery').open);
    assert(await page.locator('input[data-field="title"]').inputValue() === before, 'Discard changed saved title');
    await page.reload(); await page.waitForFunction(() => window.ffs?.journal);
    assert(await page.locator('#recovery').isHidden(), 'discarded journal offered again');
    return { saved_title: before };
  });
  await journey('recovery: edits during Save survive its journal checkpoint', async () => {
    const filePath = path.join(HOME, 'fframestudio/projects/demo/project.json');
    const field = page.locator('input[data-field="title"]');
    const savingTitle = 'Captured for Save', laterTitle = 'Committed while Save was pending';
    await field.fill(savingTitle); await field.press('Tab');
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    let captured;
    const intercepted = new Promise((resolve) => { captured = resolve; });
    await page.route('**/fs?path=projects%2Fdemo%2Fproject.json', async (route) => {
      if (route.request().method() === 'PUT') { captured(); await blocked; }
      await route.continue();
    }, { times: 1 });
    await page.click('[data-action="save"]'); await intercepted;
    await field.fill(laterTitle); await field.press('Tab'); release();
    await page.waitForFunction(() => !window.ffs.saving && window.ffs.dirty && window.ffs.journal.persistedVersion === window.ffs.doc.revision);
    assert(JSON.parse(fs.readFileSync(filePath, 'utf8')).videos[0].clips[0].textOverrides.title === savingTitle, 'Save did not use captured document');
    await page.close(); page = await ctx.newPage(); await page.goto(base + '/#/p/demo');
    await page.waitForSelector('[data-action="recover"]'); await page.click('[data-action="recover"]');
    await page.waitForFunction((value) => document.querySelector('input[data-field="title"]').value === value, laterTitle);
    await page.click('[data-action="undo"]');
    assert(await page.locator('input[data-field="title"]').inputValue() === savingTitle, 'checkpoint replay lost undo baseline');
    await page.click('[data-action="redo"]');
    await page.click('[data-action="save"]');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
    return { saved_snapshot: savingTitle, recovered_edit: laterTitle };
  });
  await journey('recovery: undo across Save recovers without prior history', async () => {
    const originalTitle = await page.locator('input[data-field="title"]').inputValue();
    const savedTitle = 'Saved before undo';
    await page.locator('input[data-field="title"]').fill(savedTitle);
    await page.locator('input[data-field="title"]').press('Tab');
    await page.click('[data-action="save"]');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
    const filePath = path.join(HOME, 'fframestudio/projects/demo/project.json'), disk = fs.readFileSync(filePath, 'utf8');
    await page.click('[data-action="undo"]');
    assert(await page.locator('input[data-field="title"]').inputValue() === originalTitle, 'Undo across Save failed');
    await page.waitForFunction(() => window.ffs.journal.persistedVersion === window.ffs.doc.revision);
    await page.close(); page = await ctx.newPage(); await page.goto(base + '/#/p/demo');
    await page.waitForSelector('[data-action="recover"]'); await page.click('[data-action="recover"]');
    await page.waitForFunction((value) => document.querySelector('input[data-field="title"]').value === value, originalTitle);
    assert(fs.readFileSync(filePath, 'utf8') === disk, 'recovering Undo wrote to disk');
    await page.click('[data-action="undo"]');
    assert(await page.locator('input[data-field="title"]').inputValue() === savedTitle, 'recovered Undo is not undoable');
    await page.click('[data-action="save"]');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
    return { saved_title: savedTitle, recovered_undo: originalTitle };
  });
  await journey('recovery: Save on disk before acknowledgement preserves later edits', async () => {
    const filePath = path.join(HOME, 'fframestudio/projects/demo/project.json');
    const savedTitle = 'Saved before acknowledgement', laterTitle = 'Durable edit after captured Save';
    const field = page.locator('input[data-field="title"]');
    await field.fill(savedTitle); await field.press('Tab');
    let releasePut, releaseRead, putStarted, readStarted;
    const holdPut = new Promise((resolve) => { releasePut = resolve; });
    const holdRead = new Promise((resolve) => { releaseRead = resolve; });
    const put = new Promise((resolve) => { putStarted = resolve; });
    const read = new Promise((resolve) => { readStarted = resolve; });
    await page.route('**/fs?path=projects%2Fdemo%2Fproject.json', async (route) => {
      if (route.request().method() === 'PUT') { putStarted(); await holdPut; }
      else { readStarted(); await holdRead; }
      try { await route.continue(); } catch { /* Closing the page cancels the held acknowledgement. */ }
    });
    await page.click('[data-action="save"]'); await put;
    await field.fill(laterTitle); await field.press('Tab');
    await page.waitForFunction(() => window.ffs.journal.persistedVersion === window.ffs.doc.revision);
    releasePut(); await read;
    assert(JSON.parse(fs.readFileSync(filePath, 'utf8')).videos[0].clips[0].textOverrides.title === savedTitle, 'captured Save did not reach disk');
    await page.close(); releaseRead(); page = await ctx.newPage(); await page.goto(base + '/#/p/demo');
    await page.waitForSelector('[data-action="recover"]'); await page.click('[data-action="recover"]');
    await page.waitForFunction((value) => document.querySelector('input[data-field="title"]').value === value, laterTitle);
    assert(JSON.parse(fs.readFileSync(filePath, 'utf8')).videos[0].clips[0].textOverrides.title === savedTitle, 'recovery saved the later edit');
    await page.click('[data-action="save"]');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
    return { saved_snapshot: savedTitle, recovered_edit: laterTitle };
  });
  await journey('recovery: external change preserves the pending recovery choice', async () => {
    const field = page.locator('input[data-field="title"]'), local = 'Pending recovery during external change';
    await field.fill(local); await field.press('Tab');
    await page.waitForFunction(() => window.ffs.journal.persistedVersion === window.ffs.doc.revision);
    await page.close(); page = await ctx.newPage(); await page.goto(base + '/#/p/demo');
    await page.waitForSelector('[data-action="recover"]');
    const filePath = path.join(HOME, 'fframestudio/projects/demo/project.json');
    const external = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    external.title = 'External change while recovery was pending';
    const disk = JSON.stringify(external);
    await page.request.put(base + '/fs?path=projects/demo/project.json', { data: disk });
    await page.waitForFunction(() => window.ffs.conflict);
    await page.click('[data-action="recover"]');
    await page.waitForFunction((value) => document.querySelector('input[data-field="title"]').value === value, local);
    assert(fs.readFileSync(filePath, 'utf8') === disk, 'recover overwrote external file');
    assert(await page.evaluate(() => window.ffs.save()) === false, 'Save ignored external conflict');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-action="reload-external"]');
    await page.waitForFunction(() => !window.ffs.conflict && !window.ffs.loading);
    assert(await page.locator('.ph-title h1').textContent() === external.title, 'could not resolve external recovery conflict');
    return { recovered_title: local, external_title: external.title };
  });
  await journey('assistant: agents listed, unavailable ones disabled', async () => {
    const pills = await page.$$eval('[data-agent]', (e) => e.map((b) => ({ id: b.dataset.agent, disabled: b.disabled })));
    assert(pills.length >= 1, 'no agent buttons'); return { agents: pills };
  });
  await journey('mobile: 390 px has no horizontal overflow', async () => {
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 });
    await m.goto(base + '/'); await m.waitForSelector('.card');
    const lib = await m.evaluate(() => document.documentElement.scrollWidth);
    await m.screenshot({ path: path.join(OUT, '05-mobile-library.png') });
    await m.click('.card'); await m.waitForSelector('#preview-video');
    const proj = await m.evaluate(() => document.documentElement.scrollWidth);
    await m.screenshot({ path: path.join(OUT, '05-mobile.png') }); await m.close();
    assert(lib <= 391 && proj <= 391, `scrollWidth library ${lib}, project ${proj}`); return { library: lib, project: proj };
  });
  await journey('console clean', async () => { assert(!report.console_errors.length && !report.failed_requests.length, JSON.stringify({ e: report.console_errors, r: report.failed_requests })); });
} catch (e) {
  report.journeys.push({ name: 'setup', ok: false, error: String(e.message || e).slice(0, 800) });
} finally {
  await browser?.close();
  if (bridge && bridge.exitCode === null) bridge.kill('SIGTERM');
  if (!KEEP) fs.rmSync(HOME, { recursive: true, force: true }); else report.home = HOME;
  report.finished = new Date().toISOString(); report.ok = report.journeys.every((j) => j.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.error(`${report.ok ? 'PASS' : 'FAIL'}  evidence: ${OUT}`);
  process.exit(report.ok ? 0 : 1);
}
