#!/usr/bin/env node
// Typed-voice ComfyUI pane journey on an owned bridge (--no-config, disposable library, free port).
// Default: mock ComfyUI (CI). `--real http://127.0.0.1:PORT`: an already-running owned ComfyUI;
// one small real generation with timing and nvidia-smi samples. Never a mic or real-speech claim.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { startMockComfy } from './helpers/mock-comfyui.mjs';
import { fromV0 } from '../web/src/doc/project.js';

const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const REAL = opt('--real'), repo = path.resolve(new URL('..', import.meta.url).pathname);
const root = await fsp.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-comfy-journey-'));
const out = path.resolve(opt('--out') || process.env.FFS_EVIDENCE || path.join(root, 'evidence')); fs.mkdirSync(out, { recursive: true });
const report = { mode: REAL ? 'real-comfyui' : 'mock-comfyui', started: new Date().toISOString(), steps: [], screenshots: [] };
const assert = (ok, msg) => { if (!ok) throw Error('ASSERT: ' + msg); };
const port = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const config = path.join(os.homedir(), '.config/fframestudio/bridge.json');
const snap = () => { try { const st = fs.statSync(config, { bigint: true }); return st.mtimeNs + ':' + st.size; } catch { return null; } };
const configBefore = snap();
let mock, bridges = [], browser;

async function bridge(extra) {
  const p = await port(), token = 'journey' + Math.random().toString(36).slice(2);
  const child = spawn(process.execPath, ['bridge/bridge.mjs', '--root', root, '--port', String(p), '--token', token, '--quiet', '--no-config', '--theme-home', root, ...extra], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  bridges.push(child);
  const base = 'http://127.0.0.1:' + p;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/health')).ok) return { base, token, child, log: () => log }; } catch {} if (child.exitCode !== null) break; await new Promise(r => setTimeout(r, 50)); }
  throw Error('bridge did not start: ' + log);
}
function gpu() { try { const [used, total] = execFileSync('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 4000 }).split(',').map(Number); return { usedMiB: used, totalMiB: total }; } catch { return null; } }

try {
  const id = 'comfy-demo';
  await fsp.mkdir(path.join(root, 'projects', id), { recursive: true });
  const shots = [0, 1, 2].map(i => ({ id: `s${i}`, name: `Shot ${i + 1}`, t0: i * 3, t1: i * 3 + 3, text: { title: `Story ${i + 1}` } }));
  await fsp.writeFile(path.join(root, 'projects', id, 'project.json'), JSON.stringify(fromV0({ schema: 'fframestudio.project/0', id, title: 'ComfyUI voice pane', kind: 'fframes', canvas: { fps: 30 }, shots })));
  await fsp.writeFile(path.join(root, 'projects/library.json'), JSON.stringify({ projects: [{ id, title: 'ComfyUI voice pane' }] }));
  const url = REAL || (mock = await startMockComfy({ stepMs: 60 })).url;
  const b = await bridge(['--comfy-url', url]);
  const exe = process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('response', r => { if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto(`${b.base}/open?token=${b.token}&to=${encodeURIComponent('#/p/' + id)}`);
  await page.waitForFunction(() => window.ffs?.doc && !window.ffs.loading, null, { timeout: 30000 });
  assert(await page.locator('[data-action="comfy"]').count() === 1, 'ComfyUI toolbar entry visible when configured');
  await page.keyboard.press('Control+k'); await page.locator('#command-search').fill('comfy');
  const palette = await page.locator('#command-list .palette-row').allInnerTexts();
  assert(palette.some(t => t.includes('comfy run')) && palette.some(t => t.includes('comfy set prompt')), 'palette lists typed comfy actions: ' + palette.join('|'));
  await page.keyboard.press('Escape');
  report.steps.push({ step: 'toolbar+palette', palette: palette.map(t => t.split('\n')[0]) });

  // Typed voice input through the real VoiceControl → parseIntent → typed action → ComfyDesk path.
  await page.locator('[data-action="voice"]').click();
  await page.waitForSelector('.voice-desk:not([hidden])');
  const say = async text => {
    await page.locator('#voice-transcript').fill(text);
    await page.locator('#voice-form button').click();
    await page.waitForFunction(() => document.querySelector('#voice-preview')?.textContent, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(150);
    const heard = await page.locator('#comfy-heard').textContent().catch(() => null), preview = await page.locator('#voice-preview').textContent();
    report.steps.push({ said: text, voicePreview: preview.slice(0, 160), comfyReceipt: heard });
    return heard;
  };
  const prompt = REAL ? 'a lighthouse on a cliff at dusk, volumetric fog, cinematic film still' : 'a lighthouse on a cliff at dusk, volumetric fog';
  await say(`comfy, set prompt to ${prompt}`);
  await page.waitForSelector('#comfy-desk:not([hidden])');
  assert(await page.locator('[data-comfy-param="prompt"]').inputValue() === prompt, 'voice set the prompt field');
  await page.waitForFunction(() => document.querySelector('#comfy-status')?.textContent.startsWith('Connected'), null, { timeout: 30000 });
  report.status = await page.locator('#comfy-status').textContent();
  const template = await page.locator('#comfy-template').inputValue(); report.template = template;
  assert(template === 'flux2-klein-4b-t2i', 'Flux.2 Klein template ready by default, got ' + template + ' · ' + await page.locator('#comfy-template-note').textContent());
  if (REAL) { await say('comfy width 512'); await say('comfy height 512'); await say('comfy steps 20'); if (opt('--seed')) await say('comfy seed ' + opt('--seed')); }
  else await say('comfy steps twelve');
  assert(await page.locator('[data-comfy-param="steps"]').inputValue() === (REAL ? '20' : '12'), 'voice set steps');
  const badSteps = await say('comfy steps 900'); report.steps.at(-1).expectedRejection = true;
  assert(/between/.test(await page.locator('#voice-preview').textContent()) || /between/.test(badSteps || ''), 'out-of-range step count is refused, not clamped');
  const gpuBefore = gpu(), samples = []; const sampler = REAL ? setInterval(() => { const g = gpu(); if (g) samples.push({ t: Date.now(), ...g }); }, 500) : null;
  const t0 = Date.now();
  await say('comfy run');
  await page.waitForSelector('.comfy-card[data-state="done"] img', { timeout: REAL ? 600000 : 30000 });
  const wall = Date.now() - t0; if (sampler) clearInterval(sampler);
  await page.waitForFunction(() => [...document.querySelectorAll('.comfy-card[data-state="done"] img')].every(i => i.complete && i.naturalWidth > 0));
  let jobs = await fetch(`${b.base}/comfy/jobs?projectId=${id}`, { headers: { Authorization: 'Bearer ' + b.token } }).then(r => r.json()).then(d => d.jobs);
  const first = jobs.find(j => j.state === 'done');
  report.firstRun = { clickToImageMs: wall, startedToFinishedMs: Date.parse(first.finishedAt) - Date.parse(first.startedAt), params: first.params, vramFromComfy: first.vram, output: first.outputs[0],
    nvidiaSmi: REAL ? { beforeUsedMiB: gpuBefore?.usedMiB, peakUsedMiB: Math.max(...samples.map(s => s.usedMiB)), totalMiB: gpuBefore?.totalMiB, samples: samples.length, intervalMs: 500, scope: 'device-wide' } : null };
  await page.locator('.comfy-card[data-state="done"]').first().scrollIntoViewIfNeeded();
  await page.locator('#comfy-desk').screenshot({ path: path.join(out, `comfy-desk-first-${report.mode}.png`) }); report.screenshots.push(`comfy-desk-first-${report.mode}.png`);
  if (!REAL) {
    await say('give me two more variations');
    await page.waitForFunction(() => document.querySelectorAll('.comfy-card[data-state="done"] img').length === 3, null, { timeout: 30000 });
    jobs = await fetch(`${b.base}/comfy/jobs?projectId=${id}`, { headers: { Authorization: 'Bearer ' + b.token } }).then(r => r.json()).then(d => d.jobs);
    const seeds = jobs.map(j => j.params.seed).sort((a, c) => a - c);
    assert(new Set(seeds).size === 3 && seeds[2] - seeds[0] === 2, 'variations advance the seed: ' + seeds);
    assert(new Set(jobs.map(j => j.outputs[0].sha256)).size === 3, 'variations produced distinct images');
    report.variations = { seeds, distinctImages: 3 };
    await say('comfy, set prompt to [mock:slow] a very long take'); await say('comfy run');
    await page.waitForSelector('.comfy-card[data-state="running"]', { timeout: 10000 });
    await say('comfy cancel');
    await page.waitForSelector('.comfy-card[data-state="cancelled"]', { timeout: 10000 });
    assert(mock.state.interrupts.length === 1 && mock.state.clears === 0, 'cancel = one targeted interrupt, never a queue clear');
    assert(mock.state.prompts.every(p => Object.values(p.prompt).filter(n => n.class_type === 'SaveImage').every(n => n.inputs.filename_prefix.startsWith('fframestudio/'))), 'bridge owns output prefix');
    report.cancel = { interrupts: mock.state.interrupts.length, clears: mock.state.clears };
    const unknown = await say('comfy frobnicate'); report.steps.at(-1).expectedClarification = true;
    assert(/ComfyUI: say/.test(await page.locator('#voice-preview').textContent()), 'unsupported comfy phrase asks for clarification');
  }
  await page.locator('.voice-desk #voice-close').click();
  await page.screenshot({ path: path.join(out, `comfy-desktop-${report.mode}.png`) }); report.screenshots.push(`comfy-desktop-${report.mode}.png`);
  const overlap = await page.evaluate(() => { const d = document.querySelector('#comfy-desk').getBoundingClientRect(), c = document.querySelector('#canvas')?.getBoundingClientRect(); return c ? { desk: [d.x, d.y, d.width, d.height].map(Math.round), canvas: [c.x, c.y, c.width, c.height].map(Math.round) } : null; });
  report.layout = overlap;
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'no horizontal overflow at 390 px');
  await page.screenshot({ path: path.join(out, `comfy-phone-${report.mode}.png`) }); report.screenshots.push(`comfy-phone-${report.mode}.png`);
  report.consoleErrors = consoleErrors;
  await ctx.close();

  if (!REAL) {
    // Flag off: no pane, no palette entries, voice grammar answers honestly, routes absent.
    const off = await bridge([]);
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } }), p2 = await c2.newPage();
    await p2.goto(`${off.base}/open?token=${off.token}&to=${encodeURIComponent('#/p/' + id)}`);
    await p2.waitForFunction(() => window.ffs?.doc && !window.ffs.loading, null, { timeout: 30000 });
    assert(await p2.locator('[data-action="comfy"]').count() === 0, 'no ComfyUI button when not configured');
    await p2.keyboard.press('Control+k'); await p2.locator('#command-search').fill('comfy');
    assert(await p2.locator('#command-list .palette-row').count() === 0, 'no comfy palette rows when not configured');
    await p2.keyboard.press('Escape');
    await p2.locator('[data-action="voice"]').click(); await p2.locator('#voice-transcript').fill('comfy run'); await p2.locator('#voice-form button').click();
    await p2.waitForFunction(() => /not configured/.test(document.querySelector('#voice-preview').textContent));
    const status = await fetch(`${off.base}/comfy/status`, { headers: { Authorization: 'Bearer ' + off.token } }).then(r => r.status);
    const providers = await fetch(`${off.base}/generation/providers`, { headers: { Authorization: 'Bearer ' + off.token } }).then(r => r.json());
    assert(!providers.providers.some(p => p.id.startsWith('comfy-')), 'dormant comfy providers hidden from Generate tab');
    report.flagOff = { button: false, paletteRows: 0, voice: 'ComfyUI is not configured on this bridge.', comfyStatusHttp: status, generateProviders: providers.providers.map(p => p.id) };
    await c2.close();
  }
  report.configUnchanged = snap() === configBefore; assert(report.configUnchanged, 'shared bridge discovery config changed');
  report.result = 'pass';
} catch (e) { report.result = 'fail'; report.error = e.message; process.exitCode = 1; }
finally {
  await browser?.close().catch(() => {});
  for (const c of bridges) if (c.exitCode === null && c.signalCode === null) { c.kill('SIGTERM'); await once(c, 'exit'); }
  await mock?.close();
  report.finished = new Date().toISOString();
  fs.writeFileSync(path.join(out, `report-${report.mode}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, error: report.error, evidence: out, firstRun: report.firstRun && { clickToImageMs: report.firstRun.clickToImageMs, startedToFinishedMs: report.firstRun.startedToFinishedMs } }, null, 1));
}
