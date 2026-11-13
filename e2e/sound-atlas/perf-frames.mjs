// reuse-checked: no Sound Atlas perf harness existed (app tests are node:test unit + *-e2e.mjs journeys) -- web-frame-budget-gating recipe, wired as `npm run perf`.
// Main-thread work per scenario on a phone profile (390x844 @3x, 4x CPU throttle, real GPU path), from a CDP trace.
// Usage: URL=http://127.0.0.1:18943/ OUT=runs/perf/frames.json REPS=3 node perf-frames.mjs
import { chromium } from 'playwright-core'; import fs from 'node:fs'; import os from 'node:os';
const URL = process.env.URL || 'http://127.0.0.1:18941/', OUT = process.env.OUT || 'runs/perf/frames.json', REPS = +(process.env.REPS || 3);
const ONLY = process.env.ONLY?.split(','), PROFILE = !!process.env.PROFILE; // PROFILE=1: also a CPU profile per scenario, top self-time functions in `top`; INVAL=1: style invalidations by element in `invalTop`
function topSelf(prof, n = 12) {
  const dt = new Map(), byId = new Map(prof.nodes.map((x) => [x.id, x]));
  prof.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (prof.timeDeltas[i] || 0)));
  const agg = {}; for (const [id, us] of dt) { const c = byId.get(id).callFrame; const k = `${c.functionName || '(anon)'} ${c.url.split('/').pop()}:${c.lineNumber + 1}`; agg[k] = (agg[k] || 0) + us / 1000; }
  return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => `${ms.toFixed(0)}ms ${k}`);
}
const INVAL = !!process.env.INVAL; // INVAL=1: count style invalidations by selector/attribute (which rule or write drives UpdateLayoutTree)
const CATS = [...(process.env.INVAL ? ['disabled-by-default-devtools.timeline.invalidationTracking'] : []), 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink.user_timing', 'loading'];

function summarize(label, events) {
  const tasksBy = new Map();
  for (const e of events) if (e.ph === 'X' && e.name === 'RunTask') { const k = e.pid + ':' + e.tid; tasksBy.set(k, (tasksBy.get(k) || 0) + e.dur); }
  // The UI thread by name, not "busiest thread": once search embeds in a Web Worker, the worker can out-work it.
  const names = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [e.pid + ':' + e.tid, e.args?.name]));
  const busiest = (want) => [...tasksBy].filter(([k]) => want(names.get(k))).sort((a, b) => b[1] - a[1])[0] || [];
  const [main] = busiest((n) => n === 'CrRendererMain').length ? busiest((n) => n === 'CrRendererMain') : busiest(() => true);
  const workerMs = Math.round([...tasksBy].filter(([k]) => /Worker/i.test(names.get(k) ?? '')).reduce((s, [, d]) => s + d, 0) / 1000);
  const on = events.filter((e) => e.ph === 'X' && e.pid + ':' + e.tid === main);
  const tasks = on.filter((e) => e.name === 'RunTask');
  const t0 = Math.min(...tasks.map((e) => e.ts)), t1 = Math.max(...tasks.map((e) => e.ts + e.dur)), span = Math.max(1, t1 - t0);
  const sum = (n) => +(on.filter((e) => e.name === n).reduce((s, e) => s + e.dur, 0) / 1000).toFixed(1);
  const raf = on.filter((e) => e.name === 'FireAnimationFrame').map((e) => e.dur / 1000).sort((a, b) => a - b);
  const q = (a, k) => (a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * k))].toFixed(2) : 0);
  // A Layout/style pass with a JS stack ran synchronously inside script: a forced layout.
  const forced = on.filter((e) => (e.name === 'Layout' || e.name === 'UpdateLayoutTree') && e.args?.beginData?.stackTrace);
  const forcedAt = {}; for (const e of forced) { const f = e.args.beginData.stackTrace[0]; const k = `${(f.url || '').split('/').pop()}:${f.lineNumber + 1} ${f.functionName || '?'}`; forcedAt[k] = (forcedAt[k] || 0) + 1; }
  const inval = {};
  if (INVAL) for (const e of events) {
    const d = e.args?.data; if (!d) continue;
    if (e.name === 'StyleInvalidatorInvalidationTracking') for (const s of d.selectors || []) inval['sel ' + s.selector] = (inval['sel ' + s.selector] || 0) + 1;
    if (e.name === 'ScheduleStyleInvalidationTracking') { const k = 'set ' + (d.changedClass ? '.' + d.changedClass : d.changedAttribute ? '[' + d.changedAttribute + ']' : d.changedPseudo ? ':' + d.changedPseudo : d.changedId ? '#' + d.changedId : '?') + ' on ' + (d.nodeName || '?'); inval[k] = (inval[k] || 0) + 1; }
    if (e.name === 'StyleRecalcInvalidationTracking') { const k = 'recalc ' + (d.reason || '?') + ' ' + (d.nodeName || '?'); inval[k] = (inval[k] || 0) + 1; }
  }
  const styles = on.filter((e) => e.name === 'UpdateLayoutTree'), styleN = styles.length;
  const styleTop = styles.sort((a, b) => b.dur - a.dur).slice(0, 6).map((e) => `${(e.dur / 1000).toFixed(1)}ms/${e.args?.elementCount ?? '?'}el`);
  const invalTop = Object.entries(inval).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => n + ' ' + k);
  return { ...(INVAL ? { invalTop } : {}), styleN, styleTop, workerMs, label, secs: +(span / 1e6).toFixed(1), busyPct: +(tasks.reduce((s, e) => s + e.dur, 0) / span * 100).toFixed(1),
    rafN: raf.length, rafP50: q(raf, 0.5), rafP95: q(raf, 0.95), rafMax: q(raf, 1),
    longTasks: tasks.filter((e) => e.dur > 50000).length, maxTaskMs: +(Math.max(0, ...tasks.map((e) => e.dur)) / 1000).toFixed(1),
    scriptMs: sum('FunctionCall'), styleMs: sum('UpdateLayoutTree'), layoutMs: sum('Layout'), paintMs: sum('Paint'), forced: forced.length, forcedAt };
}

const SCENARIOS = {
  idle: (p) => p.waitForTimeout(4000),
  'type-search': async (p) => { await p.tap('#q'); for (const ch of 'rainy night piano') { await p.keyboard.type(ch); await p.waitForTimeout(90); } await p.waitForTimeout(800); await p.fill('#q', ''); await p.waitForTimeout(800); },
  'play-dance': async (p) => { await p.evaluate(() => __sa.audio.paused && document.querySelector('#pp')?.click()); await p.waitForTimeout(6000); },
  'pan-playing': async (p) => { for (let i = 0; i < 4; i++) { await p.mouse.move(120, 420); await p.mouse.down(); for (let k = 0; k < 20; k++) await p.mouse.move(120 + k * 8, 420 - k * 6); await p.mouse.up(); await p.waitForTimeout(150); } },
  'paused-idle': async (p) => { await p.evaluate(() => __sa.audio.pause()); await p.waitForTimeout(4000); },
};

const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const out = { url: URL, throttle: 4, host: { load: os.loadavg()[0], cpus: os.cpus().length }, reps: [] };
for (let rep = 0; rep < REPS; rep++) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('sa-fs', 'no'); localStorage.setItem('sa-motion', '1'); } catch {} });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL); await p.waitForFunction(() => window.__sa?.all.length > 0, null, { timeout: 60000 }); await p.waitForTimeout(5000); // settle: startup work stays out of the window
  out.gl ??= await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl'), d = c?.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'none'; });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const runs = [];
  for (const [label, fn] of Object.entries(SCENARIOS)) {
    if (ONLY && !ONLY.includes(label) && !(label === 'play-dance' && ONLY.includes('paused-idle'))) continue;
    const events = [], onData = (d) => events.push(...d.value);
    if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    cdp.on('Tracing.dataCollected', onData);
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: CATS }, transferMode: 'ReportEvents' });
    await fn(p);
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await done; cdp.off('Tracing.dataCollected', onData);
    const r = summarize(label, events); if (PROFILE) r.top = topSelf((await cdp.send('Profiler.stop')).profile); runs.push(r); console.log(rep, JSON.stringify(r));
  }
  out.reps.push({ runs, errs, load: os.loadavg()[0] });
  await ctx.close();
}
await b.close();
fs.mkdirSync(OUT.replace(/[^/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('GL', out.gl, '->', OUT);
