// reuse-checked: perf-frames.mjs traces main-thread cost (tracing itself skews frame pacing); this one runs untraced and
// records what the owner feels: frame times (1% / 0.1% lows), drag input-to-frame latency, tap latency (Event Timing),
// plus the quality evidence score-climb.mjs gates on (backing-store density, dance motion energy, a still frame).
// Phone profile as perf-frames.mjs: 390x844 @3x, touch, 4x CPU throttle.
// Usage: URL=http://127.0.0.1:18967/ OUT=runs/climb/x.json node perf-climb.mjs      (DANCE_MS=12000)
import { chromium } from 'playwright-core'; import fs from 'node:fs'; import os from 'node:os';
const URL = process.env.URL || 'http://127.0.0.1:18967/', OUT = process.env.OUT || 'runs/climb/run.json', DANCE_MS = +(process.env.DANCE_MS || 12000);

const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  try { localStorage.setItem('sa-fs', 'no'); localStorage.setItem('sa-motion', '1'); } catch {}
  // Frame clock: every rAF timestamp while `on`. Drag latency: a move's event time to the end of the first frame
  // after it (rAF callbacks done -> the next task), i.e. when that move's result is committed for display.
  const M = (window.__m = { on: false, ft: [], lat: [], pend: [], ev: [] });
  let last = 0;
  const loop = (t) => { if (M.on && last) M.ft.push(t - last); last = t;
    if (M.pend.length) { const p = M.pend; M.pend = []; const ch = new MessageChannel(); ch.port1.onmessage = () => { const now = performance.now(); for (const ts of p) M.lat.push(now - ts); }; ch.port2.postMessage(0); }
    requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  addEventListener('pointermove', (e) => { if (M.on && e.pointerType === 'touch') M.pend.push(e.timeStamp); }, { capture: true, passive: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (M.on && e.interactionId) M.ev.push([e.interactionId, e.name, e.duration]); }).observe({ type: 'event', durationThreshold: 16, buffered: false });
});
const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL); await p.waitForFunction(() => window.__sa?.all.length > 0, null, { timeout: 60000 }); await p.waitForTimeout(4000);
const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl'), d = c?.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'none'; });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const window_ = async (fn) => { await p.evaluate(() => { const M = __m; M.ft = []; M.lat = []; M.pend = []; M.ev = []; M.on = true; }); await fn(); return p.evaluate(() => { const M = __m; M.on = false; return { ft: M.ft.map((x) => +x.toFixed(2)), lat: M.lat.map((x) => +x.toFixed(2)), ev: M.ev }; }); };
const play = async () => {
  await p.evaluate((id) => { if (!__sa.state.sel) __sa.select(id || __sa.all.find((t) => t.audio && !/^https?:/.test(t.audio))?.id); __sa.A.fitAll(); }, process.env.PLAY);
  await p.waitForTimeout(800); await p.evaluate(() => __sa.audio.paused && document.querySelector('#pp')?.click());
  await p.waitForFunction(() => !__sa.audio.paused && __sa.audio.currentTime > 0.3, null, { timeout: 15000 }); await p.waitForTimeout(1500);
};
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
// The map's free region (above the player sheet): drags and taps land there.
const mapBox = await p.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(), s = document.querySelector('#player')?.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, (s?.top ?? r.bottom) - r.y) }; });
const at = (fx, fy) => [mapBox.x + mapBox.w * fx, mapBox.y + mapBox.h * fy];

// Quality evidence: CSS-scale screenshots of the map's free region as RGB (390 x ~600). Density is checked apart (dens).
const grid = async () => { const png = (await p.screenshot({ scale: 'css', clip: { x: mapBox.x, y: mapBox.y, width: mapBox.w, height: mapBox.h } })).toString('base64');
  return p.evaluate(async (b64) => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()), w = bm.width, h = bm.height;
    const c = new OffscreenCanvas(w, h).getContext('2d'); c.drawImage(bm, 0, 0); return { w, h, px: Array.from(c.getImageData(0, 0, w, h).data.filter((_, i) => i % 4 !== 3)) }; }, png); };
// Motion: the share of pixels that visibly changed (any channel > 16) between two frames; thin edges count like dots.
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.px.length; i += 3) if (Math.abs(a.px[i] - b.px[i]) > 16 || Math.abs(a.px[i + 1] - b.px[i + 1]) > 16 || Math.abs(a.px[i + 2] - b.px[i + 2]) > 16) n++; return (100 * n * 3) / a.px.length; };

await play();
const dance = await window_(() => p.waitForTimeout(DANCE_MS));
// Motion energy: mean per-pixel change between frames 180 ms apart while dancing (a frozen arm or a dot pass that stops moving drops it).
// Unthrottled while shooting: decoding a screenshot at 4x throttle took longer than the dance it samples.
// Where it moves: 4x4 px cells that changed between any two consecutive shots. Total motion can hold while a part of
// the dance freezes (?gpu=1 kept the dots dancing but stilled the arms and bands); the score compares these masks.
const shoot = async () => { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const shots = []; for (let i = 0; i < 10; i++) { shots.push(await grid()); await p.waitForTimeout(150); }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const motion = shots.slice(1).map((s, i) => +diff(shots[i], s).toFixed(3)); // % of map pixels
  const C = 4, cw = Math.ceil(shots[0].w / C), ch = Math.ceil(shots[0].h / C), mask = new Uint8Array(cw * ch);
  for (let k = 1; k < shots.length; k++) { const a = shots[k - 1].px, b = shots[k].px;
    for (let i = 0, j = 0; i < a.length; i += 3, j++) if (Math.abs(a[i] - b[i]) > 16 || Math.abs(a[i + 1] - b[i + 1]) > 16 || Math.abs(a[i + 2] - b[i + 2]) > 16) { const x = j % shots[0].w, y = (j / shots[0].w) | 0; mask[((y / C) | 0) * cw + ((x / C) | 0)] = 1; } }
  return { motion, mask: { w: cw, h: ch, b: Buffer.from(mask).toString('base64') } }; };
const { motion, mask } = await shoot();
// v3: the same evidence zoomed onto the playing track. At the whole-map phone view only ~1.5% of cells move, so a
// frozen skeleton (?gpu=1 poses only level-4 nodes) hid inside A/A noise; here the arms around the track fill the frame.
await p.evaluate(() => __sa.A.focus(__sa.state.sel, 600)); await p.waitForTimeout(1800);
const zoom = await shoot();
await p.evaluate(() => __sa.A.fitAll(600)); await p.waitForTimeout(1200);
const drag = await window_(async () => { for (let k = 0; k < 4; k++) { const [x0, y0] = at(0.3, 0.6); await touch('touchStart', x0, y0); for (let i = 1; i <= 24; i++) { await touch('touchMove', x0 + i * 6, y0 - i * 5); await p.waitForTimeout(16); } await touch('touchEnd'); await p.waitForTimeout(400); } });
// The still frame: whole map framed, paused, the dance settled.
await p.evaluate(() => { __sa.A.fitAll(); __sa.audio.pause(); }); await p.waitForTimeout(2500);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); const still = await grid(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); const dens = await p.evaluate(() => [...document.querySelectorAll('canvas')].filter((c) => c.clientWidth > 100).map((c) => +(c.width / c.clientWidth).toFixed(3)));
await p.evaluate(() => __sa.audio.play()); await p.waitForTimeout(1500);
const taps = await window_(async () => { for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.4], [0.65, 0.6], [0.5, 0.3], [0.4, 0.7], [0.6, 0.45]]) { const [x, y] = at(fx, fy); await touch('touchStart', x, y); await p.waitForTimeout(60); await touch('touchEnd'); await p.waitForTimeout(700); } });
const inter = {}; for (const [id, , d] of taps.ev) inter[id] = Math.max(inter[id] || 0, d);
const out = { url: URL, gl, host: { load: os.loadavg()[0], cpus: os.cpus().length }, errs,
  dance: { ft: dance.ft }, drag: { ft: drag.ft, lat: drag.lat }, tap: { dur: Object.values(inter) }, vis: { dens, motion, mask, zoom, still: { w: still.w, h: still.h, px: Buffer.from(still.px).toString('base64') } } };
fs.mkdirSync(OUT.replace(/[^/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out));
const q = (a, k) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : NaN; };
console.log(JSON.stringify({ gl, errs: errs.length, danceN: dance.ft.length, danceP99: q(dance.ft, 0.99), dragLatP95: q(drag.lat, 0.95), taps: Object.values(inter), dens, motion }));
await b.close();
