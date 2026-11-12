// End-to-end: bring your own music from files (the phone path: a file picker kept in IndexedDB).
// Real tagged MP3s plus a VLC .m3u go in; they must land on the map, play, form a playlist and survive a reload.
// Usage: node test/music-atlas/byom-e2e.mjs <base-url> [shots-dir]
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:8873/", shots = process.argv[3];
const dir = mkdtempSync(join(tmpdir(), "byom-"));
const songs = [["Calm Harbour Lights", "Tide Room", "Ambient", 220], ["Neon Rush Hour", "Grid Kids", "Synthwave", 330]];
const files = songs.map(([title, artist, genre, hz], i) => {
  const f = join(dir, `0${i + 1} ${title}.mp3`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=40`, "-metadata", `title=${title}`, "-metadata", `artist=${artist}`, "-metadata", `genre=${genre}`, "-id3v2_version", "3", f]);
  return f;
});
const m3u = join(dir, "Evening.m3u");
writeFileSync(m3u, `#EXTM3U\nC:\\Users\\me\\Music\\02 ${songs[1][0]}.mp3\n01 ${songs[0][0]}.mp3\n`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) { for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if (await f()) return; throw new Error("timed out: " + what); }
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { delete window.showDirectoryPicker; }); // Android Chrome has no folder handles: the file-picker path
const page = await ctx.newPage();
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(base);
await until(() => page.evaluate(() => window.__sa?.all.length > 0), 30000, "catalogue");
const n0 = await page.evaluate(() => window.__sa.all.length);

await page.evaluate(() => window.__sa.sheetTo("full"));
await page.click(".minecta");
const chooser = page.waitForEvent("filechooser");
await page.click('.castmenu [data-m="files"]');
await (await chooser).setFiles([...files, m3u]);
await until(() => page.evaluate(() => window.__sa.all.filter((t) => t.src === "mine").length === 2), 20000, "two of your tracks on the map");
const mine = await page.evaluate(() => window.__sa.all.filter((t) => t.src === "mine").map(({ title, author, family, feel, audio }) => ({ title, author, family, feel, blob: audio.startsWith("blob:") })));
assert.deepEqual(mine.map((t) => [t.title, t.author]).sort(), songs.map(([t, a]) => [t, a]).sort(), "titles and artists come from the ID3 tags");
assert.ok(mine.every((t) => t.blob && t.family && t.feel));
assert.equal(await page.evaluate(() => window.__sa.all.length), n0 + 2);

// The playlist chip plays the VLC playlist in its own order.
await until(() => page.locator('[data-mpl^="pl-"]').count(), 5000, "playlist chip");
assert.match(await page.textContent('[data-mpl^="pl-"]'), /Evening\s*2/);
await page.click('[data-mpl^="pl-"]');
await until(() => page.evaluate(() => window.__sa.audio.currentTime > 0.5 && !window.__sa.audio.paused), 10000, "your file plays");
assert.equal(await page.evaluate(() => window.__sa.all.find((t) => t.id === window.__sa.state.sel).title), songs[1][0], "playlist order kept");
if (shots) await page.screenshot({ path: join(shots, "byom-phone.png") });

// Search finds your own music.
await page.fill("#q", "harbour"); await wait(600);
assert.ok(await page.evaluate(() => window.__sa.result.hits.some((h) => h.t.src === "mine")), "search finds your track");

// A reload brings the library back from IndexedDB.
await page.goto(base);
await until(() => page.evaluate(() => window.__sa?.all.filter((t) => t.src === "mine").length === 2), 30000, "library restored after reload");
await page.evaluate(() => window.__sa.sheetTo("full"));
await until(() => page.locator('[data-mpl^="pl-"]').count(), 5000, "playlist restored");
if (shots) await page.screenshot({ path: join(shots, "byom-restored.png") });

// Desktop Chrome: a folder handle (nothing copied). The picker is stood in by an origin-private folder holding
// the same files in subfolders, so the real walk, tag read, playlist match and handle persistence all run.
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } }), dp = await desk.newPage();
dp.on("pageerror", (e) => errs.push("desktop: " + e.message));
const payload = [...files, m3u].map((f, i) => [i < 2 ? "Artist " + i + "/" + f.split("/").pop() : f.split("/").pop(), readFileSync(f).toString("base64")]);
await dp.goto(base);
await until(() => dp.evaluate(() => window.__sa?.all.length > 0), 30000, "desktop catalogue");
await dp.evaluate(async (items) => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("Music", { create: true });
  for (const [path, b64] of items) {
    let d = root; const parts = path.split("/"); for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable(); await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close();
  }
  window.showDirectoryPicker = async () => root;
}, payload);
await dp.click(".minecta"); await dp.click('.castmenu [data-m="files"]');
await until(() => dp.evaluate(() => window.__sa.all.filter((t) => t.src === "mine").length === 2), 20000, "desktop folder tracks");
await until(() => dp.locator('[data-mpl^="pl-"]').count(), 5000, "desktop playlist from the folder");
await dp.reload();
await until(() => dp.evaluate(() => window.__sa?.all.filter((t) => t.src === "mine").length === 2), 30000, "folder rescanned after reload");
if (shots) await dp.screenshot({ path: join(shots, "byom-desktop.png") });

// Plex: PIN sign-in on plex.tv, then the server's music section. There is no Plex server on this LAN, so plex.tv
// and the server answer from fixtures shaped like their documented JSON; the app's own requests run unchanged.
const px = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }), pp = await px.newPage();
pp.on("pageerror", (e) => errs.push("plex: " + e.message));
const SV = "https://10-0-0-9.x.plex.direct:32400", cors = { "access-control-allow-origin": "*" }, seen = [];
let polls = 0;
await px.route("https://plex.tv/api/v2/pins**", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 201, json: { id: 7, code: "abcd" }, headers: cors }) : r.fulfill({ json: { authToken: ++polls > 1 ? "ACCT" : null }, headers: cors })));
await px.route("https://plex.tv/api/v2/resources**", (r) => r.fulfill({ json: [{ name: "Den", provides: "server", accessToken: "SRV", connections: [{ protocol: "http", uri: "http://10.0.0.9:32400", local: true }, { protocol: "https", uri: SV, local: true, relay: false }] }], headers: cors }));
await px.route(SV + "/**", (r) => {
  const u = new URL(r.request().url()); seen.push(u.pathname + " " + (r.request().headers()["x-plex-token"] ?? ""));
  const mc = (o) => r.fulfill({ json: { MediaContainer: o }, headers: cors });
  if (u.pathname === "/identity") return mc({});
  if (u.pathname === "/library/sections") return mc({ Directory: [{ key: "3", type: "artist" }, { key: "1", type: "movie" }] });
  if (u.pathname === "/library/sections/3/all") return mc({ totalSize: 1, Metadata: [{ ratingKey: "5", title: "Den Lullaby", grandparentTitle: "Home Band", duration: 90000, Media: [{ Part: [{ key: "/library/parts/5/f.mp3" }] }], Mood: [{ tag: "Calm" }] }] });
  if (u.pathname === "/playlists") return mc({ Metadata: [{ ratingKey: "9", title: "Den mix" }] });
  if (u.pathname === "/playlists/9/items") return mc({ Metadata: [{ ratingKey: "5", title: "Den Lullaby", Media: [{ Part: [{ key: "/library/parts/5/f.mp3" }] }] }] });
  r.fulfill({ status: 404 });
});
const tabUrl = new Promise((ok) => px.on("page", (p) => p.waitForURL(/app\.plex\.tv\/auth/, { timeout: 10000 }).then(() => ok(p.url()), () => ok(null))));
await pp.goto(base);
await until(() => pp.evaluate(() => window.__sa?.all.length > 0), 30000, "plex catalogue");
await pp.evaluate(() => window.__sa.sheetTo("full"));
await pp.click(".minecta"); await pp.click('.castmenu [data-m="plex"]');
assert.match(await tabUrl, /app\.plex\.tv\/auth\/?#\?clientID=[^&]+&code=abcd/, "the Plex sign-in tab opens from the tap");
await until(() => pp.evaluate(() => window.__sa.all.some((t) => t.provider === "plex")), 20000, "Plex track on the map");
const pt = await pp.evaluate(() => { const t = window.__sa.all.find((x) => x.provider === "plex"); return { title: t.title, author: t.author, feel: t.feel, audio: t.audio }; });
assert.deepEqual(pt, { title: "Den Lullaby", author: "Home Band", feel: "calm", audio: SV + "/library/parts/5/f.mp3?X-Plex-Token=SRV" });
assert.ok(seen.every((x) => x.endsWith(" SRV")), "the server only ever sees its own token");
await until(() => pp.locator('[data-mpl="pl-px-9"]').count(), 5000, "Plex playlist chip");

assert.deepEqual(errs, [], "no page errors");
await browser.close();
console.log("byom e2e ok ·", mine.map((t) => `${t.title} → ${t.feel}/${t.family}`).join(" · "));
