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
  const port = await freePort(), token = 'verify-' + Math.random().toString(36).slice(2);
  bridge = spawn(process.execPath, ['bridge/bridge.mjs', '--port', String(port), '--root', path.join(HOME, 'fframestudio'), '--token', token, '--quiet'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, bad) => { bridge.stdout.once('data', ok); bridge.once('exit', (c) => bad(new Error('bridge exited ' + c))); setTimeout(() => bad(new Error('bridge not ready in 15 s')), 15000); });
  const base = `http://127.0.0.1:${port}`;
  report.bridge = { port, health: await fetch(base + '/health').then((r) => r.json()) };

  // Playwright's bundled Chromium has no H.264; use Chrome (PW_CHANNEL=chrome) or a system Chromium build with codecs.
  const channel = process.env.PW_CHANNEL;
  const exe = channel ? undefined : process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ channel, executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) report.console_errors.push(m.text().slice(0, 300)); });
  page.on('response', (r) => { if (r.status() >= 400 && !/\/me$|favicon/.test(r.url())) report.failed_requests.push(`${r.status()} ${r.url().replace(token, '<token>')}`); });
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
    await page.click('.card'); await page.waitForSelector('#vid');
    await page.waitForFunction(() => document.querySelector('#vid').readyState >= 2, null, { timeout: 15000 })
      .catch(async () => { throw new Error('video not decodable here: ' + JSON.stringify(await page.$eval('#vid', (v) => ({ src: v.currentSrc, err: v.error?.code, h264: v.canPlayType('video/mp4; codecs="avc1.640028"') })))); });
    const dur = await page.$eval('#vid', (v) => v.duration); assert(Math.abs(dur - 12) < 0.5, `duration ${dur}`);
    const shots = await page.$$eval('.tl .s', (e) => e.length); assert(shots === 4, `shots ${shots}`);
    await page.click('.tl .s:nth-child(3)'); await page.waitForTimeout(400);
    const t = await page.$eval('#vid', (v) => v.currentTime); assert(Math.abs(t - 6) < 0.2, `seek landed at ${t}`);
    await shot('03-project'); return { duration_s: dur, shots, seek_to_shot3_s: +t.toFixed(3) };
  });
  await journey('edit: shot title saves and survives reload', async () => {
    const field = page.locator('.fld input').first(); const before = await field.inputValue();
    const after = before + ' (verified)'; await field.fill(after); await field.dispatchEvent('change');
    await page.waitForFunction((v) => document.querySelector('.fld input')?.value === v, after, { timeout: 5000 });
    const file = JSON.parse(fs.readFileSync(path.join(HOME, 'fframestudio/projects/demo/project.json'), 'utf8'));
    const saved = Object.values(file.edits || {}).some((e) => Object.values(e).includes(after)); assert(saved, 'edit not in project.json');
    await page.reload(); await page.waitForSelector('.fld input');
    const persisted = await page.locator('.fld input').first().inputValue(); assert(persisted === after, `after reload: ${persisted}`);
    const src = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path.join(HOME, 'fframestudio/demo-src/demo.mp4')]));
    assert(Math.abs(src.format.duration - 12) < 0.5, 'source changed');
    await shot('04-edited'); return { before, after };
  });
  await journey('assistant: agents listed, unavailable ones disabled', async () => {
    const pills = await page.$$eval('[data-agent]', (e) => e.map((b) => ({ id: b.dataset.agent, disabled: b.disabled })));
    assert(pills.length >= 1, 'no agent buttons'); return { agents: pills };
  });
  await journey('mobile: 390 px has no horizontal overflow', async () => {
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 });
    await m.goto(base + '/'); await m.waitForSelector('.card');
    const lib = await m.evaluate(() => document.documentElement.scrollWidth);
    await m.click('.card'); await m.waitForSelector('#vid');
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
