// Drives the node-graph lab like the reference recording and saves frame strips + a video.
// Usage: node tools/node-graph-journey.mjs <outDir>
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] || 'scratch-node-graph'); await mkdir(out, { recursive: true });
const web = resolve('web'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/app\//, '');
  try { const body = await readFile(join(web, p)); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/app/labs/node-graph.html`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 560 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 1100, height: 560 } } });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto(base); await page.waitForFunction(() => window.ng);
const at = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const shots = []; let n = 0;
const snap = async (label, clip) => { const f = join(out, `f${String(n++).padStart(3, '0')}-${label}.png`); await page.screenshot({ path: f, clip }); shots.push(f); };
const sleep = ms => page.waitForTimeout(ms);
const glide = async (a, b, steps, ms, label, clip, every = 1) => { for (let i = 1; i <= steps; i++) { const t = i / steps, e = t * t * (3 - 2 * t); await page.mouse.move(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e); await sleep(ms); if (i % every === 0) await snap(label, clip); } };
const clip = { x: 470, y: 150, width: 360, height: 200 };
// 1) Aphex Twin audio out → Mixer audio in (reference 0:01–0:03)
const aOut = await at('[data-node=aphex] .ng-port[data-dir=out]'), mixA = await at('[data-node=mixer] .ng-port[data-port=a]');
await page.mouse.move(aOut.x, aOut.y); await sleep(150); await snap('hover', { x: aOut.x - 60, y: aOut.y - 40, width: 120, height: 80 });
await page.mouse.down();
await glide(aOut, { x: mixA.x - 90, y: mixA.y + 4 }, 20, 20, 'approach', clip, 5);
await glide({ x: mixA.x - 90, y: mixA.y + 4 }, { x: mixA.x - 12, y: mixA.y + 2 }, 18, 33, 'magnet', clip);
const dimmed = await page.$$eval('.ng-dim', e => e.map(x => x.dataset.node));
await sleep(120); await snap('held', clip);
await page.mouse.up();
for (let i = 0; i < 16; i++) { await sleep(33); await snap('snap', clip); }
const afterConnect = await page.evaluate(() => window.ngState);
// 2) Tug the Glow Head cable out of Mixer video in and release inside the tether (reference 0:15–0:17)
const mixV = await at('[data-node=mixer] .ng-port[data-port=v]');
await page.mouse.move(mixV.x, mixV.y); await page.mouse.down(); await sleep(60);
await glide(mixV, { x: mixV.x - 46, y: mixV.y + 6 }, 14, 33, 'tug', clip);
await page.mouse.up();
for (let i = 0; i < 14; i++) { await sleep(33); await snap('snapback', clip); }
const afterTug = await page.evaluate(() => window.ngState);
// 3) Tear it off and drop on empty canvas: the link is removed and the cable reels back.
await page.mouse.move(mixV.x, mixV.y); await page.mouse.down();
await glide(mixV, { x: mixV.x - 160, y: mixV.y + 120 }, 20, 25, 'tear', clip, 4);
await page.mouse.up(); for (let i = 0; i < 6; i++) { await sleep(40); await snap('retract', clip); }
const afterTear = await page.evaluate(() => window.ngState);
// 4) Incompatible: drag Mapping control out over Mixer video in — no halo, no link.
const mapOut = await at('[data-node=mapping] .ng-port[data-dir=out]');
await page.mouse.move(mixV.x, mixV.y); // ensure no stray hover
const before4 = await page.evaluate(() => window.ng.links.length);
await page.mouse.move(mapOut.x, mapOut.y); await page.mouse.down();
await glide(mapOut, mixV, 16, 20, 'wrongtype', clip, 8); await sleep(120);
const haloOnWrong = await page.evaluate(() => document.querySelector('.ng-halo path')?.getAttribute('d') || '');
await page.mouse.up(); await sleep(400);
const after4 = await page.evaluate(() => window.ng.links.length);
await page.screenshot({ path: join(out, 'final.png') });
await ctx.close(); await browser.close(); server.close();
console.log(JSON.stringify({ errors, dimmed, afterConnect, afterTug, afterTear, wrongType: { haloOnWrong: haloOnWrong.slice(0, 40), before4, after4 }, frames: shots.length }, null, 1));
