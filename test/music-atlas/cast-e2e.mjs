// End-to-end: the phone casts to a TV view through the real /api/social relay.
// Usage: node test/music-atlas/cast-e2e.mjs <base-url> [shots-dir]   (serve with tools/sound-atlas-serve.mjs)
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:8871/", shots = process.argv[3];
const room = Array.from({ length: 6 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) { for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if (await f()) return; throw new Error("timed out: " + what); }
const errs = [];

const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }), tv = await tvCtx.newPage();
tv.on("pageerror", (e) => errs.push("tv: " + e.message));
await tv.goto(`${base}?tv=samsung&name=Samsung%20TV&ip=192.0.2.1&app=TEST.app#room=${room}`);
await until(() => tv.evaluate(() => document.querySelector("#tvcode.on code")?.textContent), 30000, "TV shows its code");
assert.equal(await tv.textContent("#tvcode code"), room.toUpperCase());
await until(() => tv.evaluate(() => !!document.querySelector("#tvcode .qr svg")), 15000, "pairing QR");
if (shots) await tv.screenshot({ path: `${shots}/tv-waiting.png` });

const phCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), ph = await phCtx.newPage();
ph.on("pageerror", (e) => errs.push("phone: " + e.message));
ph.on("dialog", (d) => d.accept(room.toUpperCase()));
await ph.goto(base);
await until(() => ph.evaluate(() => window.__sa?.all.length > 0), 30000, "phone boots");
const [a, b] = await ph.evaluate(() => window.__sa.result.hits.slice(0, 2).map((h) => h.t.id));
await ph.evaluate((id) => window.__sa.select(id, { play: true }), a);
await ph.click("#pc");
await ph.waitForSelector(".castmenu.on");
if (shots) await ph.screenshot({ path: `${shots}/phone-menu.png` });
await ph.click('.castmenu button[data-c="samsung"]');
await until(() => tv.evaluate((id) => window.__sa.state.sel === id && !window.__sa.audio.paused, a), 20000, "TV plays the phone's song").catch(async (e) => { console.log(JSON.stringify({ tv: await tv.evaluate(() => ({ sel: window.__sa.state.sel, paused: window.__sa.audio.paused, src: window.__sa.audio.src, err: window.__sa.audio.error?.code, toast: document.querySelector("#toast").textContent })), ph: await ph.evaluate(() => ({ sel: window.__sa.state.sel, toast: document.querySelector("#toast").textContent, paused: window.__sa.audio.paused, err: window.__sa.audio.error?.code, tv: localStorage.getItem("sa-tv") })), errs })); throw e; });
await until(() => ph.evaluate(() => document.querySelector("#pc").classList.contains("on") && window.__sa.audio.muted), 10000, "phone shows casting, muted");
await until(() => tv.evaluate(() => !document.querySelector("#tvcode").classList.contains("on")), 5000, "code hides once linked");
assert.equal(JSON.parse(await ph.evaluate(() => localStorage.getItem("sa-tv"))).room, room, "phone remembers the TV");
await wait(1500); if (shots) { await tv.screenshot({ path: `${shots}/tv-playing.png` }); await ph.screenshot({ path: `${shots}/phone-casting.png` }); }

await ph.evaluate(() => window.__sa.audio.pause());
await until(() => tv.evaluate(() => window.__sa.audio.paused), 8000, "phone pause reaches the TV");
await ph.evaluate((id) => window.__sa.select(id, { play: true }), b);
await until(() => tv.evaluate((id) => window.__sa.state.sel === id && !window.__sa.audio.paused, b), 8000, "phone next song reaches the TV");
await wait(7000); // past the phone's own-command window
await tv.evaluate((id) => window.__sa.select(id, { play: true }), a); // the TV moves on by itself (song ended / remote)
await until(() => ph.evaluate((id) => window.__sa.state.sel === id, a), 12000, "phone follows the TV");

await ph.click("#pc"); // tap while casting = stop
await until(() => tv.evaluate(() => window.__sa.audio.paused), 8000, "stop pauses the TV");
assert.equal(await ph.evaluate(() => window.__sa.audio.muted), false, "phone unmuted after stop");
assert.deepEqual(errs, []);
console.log("cast e2e ok · room", room);
await browser.close();
