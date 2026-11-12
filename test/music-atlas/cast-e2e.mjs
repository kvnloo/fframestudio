// End-to-end: the phone casts to a TV view through the real /api/social relay.
// Usage: node test/music-atlas/cast-e2e.mjs <base-url> [shots-dir]   (serve with tools/sound-atlas-serve.mjs)
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
// The pairing QR is drawn by the map's own dots; a phone camera (zbar here) must read the pairing link from it.
await until(() => tv.evaluate(() => window.__sa?.A.formation), 15000, "dots form the pairing QR");
await wait(3500); // the dots pour in, then settle
const qrPng = join(shots ?? mkdtempSync(join(tmpdir(), "tvqr-")), "tv-qr.png");
await tv.screenshot({ path: qrPng });
const decoded = spawnSync("zbarimg", ["-q", "--raw", "-Stest-inverted", qrPng], { encoding: "utf8" }).stdout.trim();
assert.match(decoded, new RegExp(`#tvpair=${room}~192\\.0\\.2\\.1~TEST\\.app~Samsung(%20| )TV$`), "the dot QR decodes to the pairing link: " + decoded);
await tv.keyboard.press("ArrowRight"); // any remote key lets the map go
await until(() => tv.evaluate(() => !window.__sa.A.formation && document.querySelector("#tvcode.mini.on .qr svg") && window.__sa.audio.paused), 5000, "first key dismisses the code only");
await wait(1500); if (shots) await tv.screenshot({ path: `${shots}/tv-waiting.png` });

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
// Scanning a fresh TV's dot QR connects on its own: the phone casts and the TV lets the map go, with no Cast tap.
const room2 = Array.from({ length: 6 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
const tv2 = await tvCtx.newPage(); tv2.on("pageerror", (e) => errs.push("tv2: " + e.message));
await tv2.goto(`${base}?tv=samsung&name=Den%20TV&ip=192.0.2.1&app=TEST.app#room=${room2}`);
await until(() => tv2.evaluate(() => window.__sa?.A.formation), 30000, "second TV forms its QR");
await wait(3500);
const qr2 = join(shots ?? mkdtempSync(join(tmpdir(), "tvqr-")), "tv-qr2.png"); await tv2.screenshot({ path: qr2 });
const link2 = spawnSync("zbarimg", ["-q", "--raw", "-Stest-inverted", qr2], { encoding: "utf8" }).stdout.trim();
assert.match(link2, new RegExp(`#tvpair=${room2}~`), "second QR decodes: " + link2);
const sc = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }), scan = await sc.newPage();
scan.on("pageerror", (e) => errs.push("scan: " + e.message));
await scan.goto(base + link2.slice(link2.indexOf("#")));
await until(() => scan.evaluate(() => document.querySelector("#pc")?.classList.contains("on")), 20000, "the scan alone starts casting");
await until(() => tv2.evaluate(() => !window.__sa.A.formation && !document.querySelector("#tvcode").classList.contains("on")), 8000, "the TV lets go of the QR once the phone is on");
assert.equal(JSON.parse(await scan.evaluate(() => localStorage.getItem("sa-tv"))).room, room2);
assert.ok(!(await scan.evaluate(() => location.hash.includes("tvpair"))), "the pairing link drops out of the URL");

assert.deepEqual(errs, []);
console.log("cast e2e ok · room", room);
await browser.close();
