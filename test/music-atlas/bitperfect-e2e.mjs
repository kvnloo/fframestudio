// Bit-perfect, the page's side (native.js) against a stub aural-local on 127.0.0.1:4317:
// auto turns on when the system output is the DAC itself, the page goes silent and hands the song (absolute URL,
// position, play state) to the native player, follows the player's clock, hands over pause/seek/song changes,
// steps aside for the in-page chain, and Off gives the sound back to the browser.
// Usage: node test/music-atlas/bitperfect-e2e.mjs <base-url> [shots-dir]
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const base = process.argv[2] ?? "http://127.0.0.1:8871/", shots = process.argv[3];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) { for (const end = Date.now() + ms; Date.now() < end; await wait(200)) if (await f()) return; throw new Error("timed out: " + what); }

// stub aural-local: a native player that plays at real speed from where it was told
const st = { auto: true, calls: [], url: null, pos0: 0, t0: 0, playing: false };
const pos = () => (st.playing ? st.pos0 + (Date.now() - st.t0) / 1000 : st.pos0);
const nowJ = () => ({ running: !!st.url, url: st.url, pos: st.url ? pos() : null, playing: st.playing, params: st.url ? { samplerate: 44100, format: "floatp" } : null, out: st.url ? { samplerate: 44100, format: "s32" } : null,
  hw: st.url ? { rate: 44100, format: "S32_LE" } : null, target: "Topping DX5 (Bit-Perfect)", auto: st.auto, others: 0, why: st.url ? [] : ["player not running"], bitperfect: !!st.url });
const srv = createServer((req, res) => {
  const h = { "content-type": "application/json", "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-private-network": "true", "access-control-allow-headers": "content-type" };
  if (req.method === "OPTIONS") { res.writeHead(204, h); return res.end(); }
  const p = new URL(req.url, "http://x").pathname; let b = "";
  req.on("data", (d) => (b += d)).on("end", () => {
    const j = b ? JSON.parse(b) : {}; if (p.startsWith("/native/play") || p.startsWith("/native/stop")) st.calls.push({ p, ...j });
    if (p === "/native/play") { st.pos0 = j.pos; st.t0 = Date.now(); st.playing = j.playing; st.url = j.url; }
    if (p === "/native/stop") { st.url = null; st.playing = false; }
    res.writeHead(200, h);
    res.end(JSON.stringify(p === "/health" ? { ok: true, name: "aural-local", caps: { os: "linux", native: true, pipewire: true } } : p === "/state" ? { sinks: [{ name: "alsa_output.usb-Topping_DX5-00.HiFi__Headphones__sink", desc: "Topping DX5", default: true }], scapes: [], camilla: false, evolve: null } : p.startsWith("/native/") ? nowJ() : {}));
  });
}).listen(4317, "127.0.0.1");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: new URL(base).protocol === "https:" ? ["local-network-access"] : [] });
await ctx.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("sa-aural", JSON.stringify({ server: true })); } });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base); await page.waitForFunction(() => window.__sa?.all?.length > 100, null, { timeout: 30000 });
const [a, b] = await page.evaluate(() => window.__sa.all.filter((t) => t.audio?.startsWith("tracks/") || t.audio?.startsWith("https://incompetech.com/")).slice(0, 2).map((t) => t.id));

await page.evaluate((id) => window.__sa.select(id, { play: true }), a);
await until(() => page.evaluate(() => window.__sa.audio.muted), 12000, "auto: the page goes silent");
await until(() => st.calls.some((c) => c.p === "/native/play" && c.playing), 8000, "the native player is told to play");
const first = st.calls.find((c) => c.p === "/native/play");
assert.match(first.url, /^https?:\/\//, "the player gets an absolute URL");

// the player is the clock: jump it ahead and the silent page follows
st.pos0 = pos() + 12; st.t0 = Date.now();
await until(async () => Math.abs((await page.evaluate(() => window.__sa.audio.currentTime)) - pos()) < 0.6, 6000, "the page follows the player's clock").catch(async (e) => { console.log(JSON.stringify({ stub: nowJ(), page: await page.evaluate(async () => ({ t: window.__sa.audio.currentTime, paused: window.__sa.audio.paused, src: window.__sa.audio.currentSrc, dur: window.__sa.audio.duration, bp: (await import("./src/music-atlas/native.js")).bp })) })); throw e; });

// pause / seek / next song go to the player
st.calls.length = 0;
await page.evaluate(() => window.__sa.audio.pause());
await until(() => st.calls.some((c) => c.p === "/native/play" && c.playing === false), 5000, "pause reaches the player");
await page.evaluate(() => window.__sa.audio.play());
await until(() => st.playing, 5000, "play reaches the player");
await page.evaluate((id) => window.__sa.select(id, { play: true }), b);
await until(() => st.url && st.calls.some((c) => c.p === "/native/play" && c.url !== first.url), 8000, "a new song reaches the player");

// the pane shows it
await page.keyboard.press("Escape"); await page.evaluate(() => { location.hash = "#aural"; });
await page.waitForSelector("aside.aural.open"); await page.click('aside.aural [data-tab="pc"]');
await page.waitForSelector("aside.aural [data-bpstat]", { timeout: 10000 });
await until(() => page.evaluate(() => /Bit-perfect · 44\.1 kHz · S32_LE → Topping DX5/.test(document.querySelector("[data-bpstat]")?.textContent ?? "")), 6000, "pane: bit-perfect line");
if (shots) await page.locator("aside.aural").screenshot({ path: `${shots}/bitperfect-pane.png` });

// the system moves to a DSP sink: auto steps aside and the browser is heard again
st.auto = false; st.calls.length = 0;
await until(() => page.evaluate(() => !window.__sa.audio.muted), 12000, "auto off on a DSP sink: the page is heard");
assert.ok(st.calls.some((c) => c.p === "/native/stop"), "the native player stops");
// Always: on regardless of the system
await page.click('aside.aural [data-bp="on"]');
await until(() => page.evaluate(() => window.__sa.audio.muted) && st.url, 8000, "Always: back to the native player");
// Off
await page.click('aside.aural [data-bp="off"]');
await until(() => page.evaluate(() => !window.__sa.audio.muted) && !st.url, 8000, "Off: the browser plays");
assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("sa-aural"))).bitperfect, "off");

assert.deepEqual(errors, []);
console.log("bitperfect e2e ok");
await browser.close(); srv.close();
