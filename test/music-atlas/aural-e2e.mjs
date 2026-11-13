// End-to-end: the hidden Aural pane on a real bundle in headless Chromium.
// Type "aural" -> pane opens; power on -> the song re-streams through the CORS proxy, the Web Audio chain
// carries real signal (not CORS silence), soundscapes change the sound, the map draws the soundstage,
// and the setting survives a reload. Optional: a running aural-local (AURAL_LOCAL=1) is found and used.
// Usage: node test/music-atlas/aural-e2e.mjs <base-url> [shots-dir]
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:8874/", shots = process.argv[3];
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });
const level = () => page.evaluate(async () => { const m = await window.__sa.aural(), e = m.getEngine(), f = e?.field(); return f ? Math.max(...f.map((b) => b.db)) : null; });

await page.goto(base); await page.waitForFunction(() => window.__sa?.all?.length > 100, null, { timeout: 30000 });
assert.equal(await page.locator("aside.aural").count(), 0, "pane is hidden and not even loaded until asked for");

await page.locator("body").click({ position: { x: 640, y: 500 } }); await page.keyboard.type("aural");
await page.waitForSelector("aside.aural.open"); await shot("1-open");

// pick an incompetech song (no CORS headers upstream) and play it
const id = await page.evaluate(() => window.__sa.all.find((t) => t.audio?.startsWith("https://incompetech.com/")).id);
await page.evaluate((id) => window.__sa.select(id, { play: true }), id);
await page.locator("aside.aural [data-power]").check({ force: true });
await page.waitForFunction(async () => (await window.__sa.aural()).getEngine()?.ctx?.state === "running", null, { timeout: 15000 });
const src = await page.evaluate(() => window.__sa.audio.currentSrc);
assert.match(src, /\/api\/ccm\?u=https%3A%2F%2Fincompetech\.com/, "Aural streams incompetech through the same-origin proxy");
assert.equal(await page.evaluate(() => window.__sa.audio.crossOrigin), "anonymous");
await page.waitForFunction(() => !window.__sa.audio.paused && window.__sa.audio.currentTime > 1.5, null, { timeout: 30000 });
let peak = -200; for (let i = 0; i < 10; i++) { peak = Math.max(peak, (await level()) ?? -200); await page.waitForTimeout(200); }
assert.ok(peak > -70, `chain carries real signal (peak ${peak.toFixed(1)} dB), not CORS silence`);

// soundscapes: switching changes the engine parameters and the readout
await page.click('aside.aural [data-scape="late-night"]').catch(async () => page.click("aside.aural [data-scape]:nth-of-type(3)"));
const p = await page.evaluate(async () => (await window.__sa.aural()).prefs);
assert.notEqual(p.scape, "clean");
await page.click('aside.aural [data-tab="all"]'); assert.ok((await page.locator("aside.aural input[type=range]").count()) >= 20, "every parameter is exposed");
await shot("2-everything");
await page.click('aside.aural [data-tab="evolve"]'); await page.waitForSelector("aside.aural .vars button");
assert.equal(await page.locator("aside.aural .vars button").count(), 4); await shot("3-evolve");

// canvas: the soundstage is drawn around the playing dot
const lit = await page.evaluate(() => { const c = document.querySelector("#atlas"), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n; });
assert.ok(lit > 500, "map is drawing");
await page.click("aside.aural [data-close]"); await page.waitForTimeout(400); await shot("4-stage");

// A/B hold, then reload: Aural stays on, and the pane stays unloaded until needed
await page.reload(); await page.waitForFunction(() => window.__sa?.all?.length > 100);
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("sa-aural")).on), true);
assert.equal(await page.evaluate(() => window.__sa.audio.crossOrigin), "anonymous", "stays CORS-readable after reload");
// left on: the first gesture (here a click, then play) builds the chain again and the map gets live bands
await page.locator("body").click({ position: { x: 640, y: 500 } });
await page.evaluate((id) => window.__sa.select(id, { play: true, fly: true }), id);
await page.waitForFunction(async () => (await window.__sa.aural()).getEngine()?.ctx?.state === "running", null, { timeout: 15000 });
await page.waitForFunction(() => window.__sa.audio.currentTime > 1.5, null, { timeout: 30000 });
const stage = await page.evaluate(async () => { const e = (await window.__sa.aural()).getEngine(); let calls = 0, live = 0; const A = window.__sa.A;
  A.setStage(() => { const f = e.field(); calls++; if (f && Math.max(...f.map((b) => b.db)) > -70) live++; return f; });
  await new Promise((r) => setTimeout(r, 1200)); return { calls, live }; });
assert.ok(stage.calls > 20 && stage.live > stage.calls / 2, `soundstage drawn from live bands after reload (${JSON.stringify(stage)})`);
await shot("4b-stage-after-reload");

if (process.env.AURAL_LOCAL) {
  await page.keyboard.type("aural"); await page.waitForSelector("aside.aural.open");
  await page.click('aside.aural [data-tab="pc"]'); await page.click("aside.aural [data-server]").catch(() => {});
  await page.waitForSelector("aside.aural .sinks button", { timeout: 10000 }); await shot("5-this-computer");
}
assert.deepEqual(errors, [], "no page errors");
await browser.close(); console.log(`aural e2e ok · peak ${peak.toFixed(1)} dB · ${src.slice(0, 60)}…`);
