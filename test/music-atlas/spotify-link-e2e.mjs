// End-to-end: paste a Spotify link into Sound Atlas and hear it from YouTube (byom.js spotifyLink + the spotify-yt bridge).
// Phone-size Chromium with the normal autoplay policy. Paths: the "Paste a Spotify link" box (a real keyboard paste)
// plays song 1 by itself; tapping another row plays that one; a link pasted into the search box loads instead of
// searching; pasted links come back after a reload.
// Usage: node test/music-atlas/spotify-link-e2e.mjs <base-url> [shots-dir] [playlist-link] [album-link]
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:8813/", shots = process.argv[3];
const link = process.argv[4] ?? "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=0e2e";
const album = process.argv[5] ?? "https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) { for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if (await f()) return; throw new Error("timed out: " + what); }
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ args: ["--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin });
const page = await ctx.newPage(), errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(base);
await until(() => page.evaluate(() => window.__sa?.all.length > 0), 30000, "catalogue");
const n0 = await page.evaluate(() => window.__sa.all.length);
log("catalogue", n0);

// 1. Bring your own music -> Paste a Spotify link -> a real paste (clipboard + Cmd/Ctrl+V).
await page.evaluate(() => window.__sa.sheetTo("full"));
await page.tap(".minecta");
await page.tap('.castmenu [data-m="link"]');
await page.waitForSelector(".linkbox input");
await page.evaluate((u) => navigator.clipboard.writeText(u), link);
await page.focus(".linkbox input");
const tPaste = Date.now();
await page.keyboard.press("ControlOrMeta+V");
await until(() => page.evaluate(() => window.__sa.mine.plists.some((p) => p.id.startsWith("pl-sl-"))), 45000, "playlist from the link");
const pl = await page.evaluate(() => { const p = window.__sa.mine.plists.find((p) => p.id.startsWith("pl-sl-")); return { name: p.name, n: p.ids.length, ids: p.ids }; });
log(`loaded "${pl.name}" · ${pl.n} tracks in ${Date.now() - tPaste} ms`);
assert.ok(pl.n >= 5, "a playlist's worth of tracks");

// 2. Song 1 plays by itself, from the bridge, and its clock moves.
await until(() => page.evaluate((id) => window.__sa.state.sel === id && !window.__sa.audio.paused && window.__sa.audio.currentTime > 2, pl.ids[0]), 60000, "song 1 playing");
const s1 = await page.evaluate(() => { const a = window.__sa.audio, t = window.__sa.all.find((x) => x.id === window.__sa.state.sel); return { title: t.title, author: t.author, yt: t.ytId, ytTitle: t.ytTitle, src: a.src, at: a.currentTime }; });
log(`song 1 audible ${Date.now() - tPaste} ms after paste:`, JSON.stringify(s1));
assert.match(s1.src, /\/api\/stream\?id=[\w-]{11}$/);
const at1 = s1.at; await wait(3000);
const at2 = await page.evaluate(() => window.__sa.audio.currentTime);
log(`clock ${at1.toFixed(2)} s -> ${at2.toFixed(2)} s over 3 s`);
assert.ok(at2 - at1 > 2, "audio time advances");
if (shots) await page.screenshot({ path: `${shots}/spotify-link-playing.png` });

// 3. Tap another song's row: that one plays.
const id2 = pl.ids[1];
await page.evaluate(() => window.__sa.sheetTo("full"));
const row = page.locator(`[data-mlist] .trk[data-id="${id2}"]`), how = "row tap";
assert.equal(await page.locator("[data-mlist] .trk").count(), Math.min(pl.n, 200), "the pasted list shows in order");
await row.scrollIntoViewIfNeeded(); await row.tap();
await until(() => page.evaluate((id) => window.__sa.state.sel === id && !window.__sa.audio.paused && window.__sa.audio.currentTime > 2, id2), 60000, "song 2 playing");
const s2 = await page.evaluate(() => { const t = window.__sa.all.find((x) => x.id === window.__sa.state.sel); return { title: t.title, yt: t.ytId, at: window.__sa.audio.currentTime }; });
log(`song 2 via ${how}:`, JSON.stringify(s2));
assert.notEqual(s2.yt, s1.yt);
if (shots) await page.screenshot({ path: `${shots}/spotify-link-song2.png` });

// 4. Reload: the link is remembered; then a link pasted into the search box loads that album.
await page.reload();
await until(() => page.evaluate(() => window.__sa?.mine.plists.some((p) => p.id.startsWith("pl-sl-"))), 60000, "link restored after reload");
log("restored after reload:", await page.evaluate(() => window.__sa.mine.plists.map((p) => p.name).join(", ")));
await page.evaluate(() => window.__sa.sheetTo("full"));
await page.fill("#q", album);
await until(() => page.evaluate(() => window.__sa.mine.plists.filter((p) => p.id.startsWith("pl-sl-")).length >= 2), 45000, "album from the search box");
const q = await page.evaluate(() => ({ q: document.querySelector("#q").value, lists: window.__sa.mine.plists.map((p) => `${p.name} (${p.ids.length})`) }));
log("search-box paste:", JSON.stringify(q));
assert.equal(q.q, "", "the link isn't left as a search");
await until(() => page.evaluate(() => !window.__sa.audio.paused && window.__sa.audio.currentTime > 1), 60000, "album song 1 playing");
log("album song 1:", await page.evaluate(() => window.__sa.all.find((x) => x.id === window.__sa.state.sel).title));
if (shots) await page.screenshot({ path: `${shots}/spotify-link-album.png` });

log("page errors:", errs.length, errs.join(" | "));
assert.equal(errs.length, 0);
await browser.close();
log("PASS");
