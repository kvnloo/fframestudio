// Where a map tap's time goes: CPU profile (self time, top functions) over N taps while a track plays, phone
// profile + 4x throttle as perf-climb.mjs. Usage: URL=http://127.0.0.1:18967/ node profile-tap.mjs
import { chromium } from 'playwright-core';
const URL = process.env.URL || 'http://127.0.0.1:18967/';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('sa-fs', 'no'); localStorage.setItem('sa-motion', '1'); } catch {} });
const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
await p.goto(URL); await p.waitForFunction(() => window.__sa?.all.length > 0, null, { timeout: 60000 }); await p.waitForTimeout(4000);
await p.evaluate(() => { __sa.select(__sa.all.find((t) => t.audio && !/^https?:/.test(t.audio))?.id); __sa.A.fitAll(); }); await p.waitForTimeout(800);
await p.evaluate(() => __sa.audio.paused && document.querySelector('#pp')?.click()); await p.waitForTimeout(2000);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const box = await p.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(), s = document.querySelector('#player').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: s.top - r.y }; });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.4], [0.65, 0.6], [0.5, 0.3], [0.4, 0.7], [0.6, 0.45]]) {
  const x = box.x + box.w * fx, y = box.y + box.h * fy;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await p.waitForTimeout(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(700);
}
const prof = (await cdp.send('Profiler.stop')).profile;
const dt = new Map(), byId = new Map(prof.nodes.map((x) => [x.id, x]));
prof.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (prof.timeDeltas[i] || 0)));
const agg = {}; for (const [id, us] of dt) { const c = byId.get(id).callFrame; const k = `${c.functionName || '(anon)'} ${c.url.split('/').pop()}:${c.lineNumber + 1}`; agg[k] = (agg[k] || 0) + us / 1000; }
// inclusive time per function too: walk parents
const parent = new Map(); for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const inc = {}; for (const [id, us] of dt) { const seen = new Set(); for (let n = id; n; n = parent.get(n)) { const c = byId.get(n).callFrame; const k = `${c.functionName || '(anon)'} ${c.url.split('/').pop()}:${c.lineNumber + 1}`; if (seen.has(k)) continue; seen.add(k); inc[k] = (inc[k] || 0) + us / 1000; } }
console.log('SELF'); for (const [k, ms] of Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(ms.toFixed(0).padStart(6), k);
// LINES=fn1,fn2: self-time by source line inside those functions (positionTicks), to find the hot statement.
for (const fn of (process.env.LINES || '').split(',').filter(Boolean)) { const by = {}; let tot = 0;
  for (const n of prof.nodes) if (n.callFrame.functionName === fn) for (const t of n.positionTicks || []) { by[t.line] = (by[t.line] || 0) + t.ticks; tot += t.ticks; }
  console.log('LINES', fn, tot, 'ticks'); for (const [l, t] of Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log('  ', String(t).padStart(5), 'line', l); }
console.log('INCLUSIVE (app)'); for (const [k, ms] of Object.entries(inc).filter(([k]) => /\.js:/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(ms.toFixed(0).padStart(6), k);
await b.close();
