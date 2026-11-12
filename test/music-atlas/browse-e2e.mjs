// End-to-end: browse like a music app. Artists → an artist page → Play queues that page; Genres → a style;
// Recent remembers what played; your own tagged MP3s form an album, in track order, reachable from the card.
// Usage: node test/music-atlas/browse-e2e.mjs <base-url> [shots-dir]
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:8891/", shots = process.argv[3];
const dir = mkdtempSync(join(tmpdir(), "browse-"));
const album = [["Low Tide", 2, 220], ["First Light", 3, 330], ["Undertow", 1, 440]]; // track order is not name order
const files = album.map(([title, n, hz]) => {
  const f = join(dir, `${title}.mp3`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=20`, "-metadata", `title=${title}`, "-metadata", "artist=Tide Room",
    "-metadata", "album=Harbour Lights", "-metadata", `track=${n}/3`, "-metadata", "genre=Ambient", "-id3v2_version", "3", f]);
  return f;
});

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) { for (const end = Date.now() + ms; Date.now() < end; await wait(200)) if (await f()) return; throw new Error("timed out: " + what); }
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { delete window.showDirectoryPicker; });
const page = await ctx.newPage();
page.on("pageerror", (e) => errs.push(e.message));
const shot = (n) => shots && page.screenshot({ path: join(shots, n + ".png") });
await page.goto(base);
await until(() => page.evaluate(() => window.__sa?.all.length > 0), 30000, "catalogue");
await page.evaluate(() => window.__sa.sheetTo("full"));
const sa = (f, a) => page.evaluate(f, a);

// Artists: every credited act, most songs first; Kevin MacLeod leads the free catalogue.
await page.click('[data-browse="artists"]');
const artists = await sa(() => [...document.querySelectorAll(".bi .tt b")].map((b) => b.textContent));
assert.ok(artists.length > 50, "artists listed: " + artists.length);
assert.equal(artists[0], "Kevin MacLeod");
await shot("1-artists");

// An artist page: Play queues exactly that page; next stays inside it.
const second = await sa(() => document.querySelectorAll(".bi")[1].dataset.open);
await page.click(`.bi[data-open="${second}"]`);
const pageIds = await sa(() => [...document.querySelectorAll("[data-blist] .trk")].map((r) => r.dataset.id));
assert.ok(pageIds.length >= 2, "artist page has songs");
const allTheirs = await sa((ids) => ids.every((id) => window.__sa.all.find((t) => t.id === id).author.toLowerCase().includes(document.querySelector(".bhead h2").textContent.toLowerCase())), pageIds);
assert.ok(allTheirs, "artist page holds only that artist");
await shot("2-artist-page");
await page.click('[data-bplay="play"]');
await until(() => sa(() => window.__sa.state.sel), 5000, "play from artist page");
assert.equal(await sa(() => window.__sa.state.sel), pageIds[0]);
assert.equal(await sa(() => window.__sa.state.queue), "playlist");
await page.click("#pn");
assert.equal(await sa(() => window.__sa.state.sel), pageIds[1], "next walks the artist page");
await until(() => sa(() => /bo=a%3A/.test(location.hash)), 2000, "the artist page is in the link");

// Shuffle keeps the same songs.
await page.click('[data-bplay="shuffle"]');
assert.deepEqual((await sa(() => window.__sa.state.plist.ids)).sort(), [...pageIds].sort());

// Back, then Genres → a style page of only that style.
await page.click("[data-back]");
assert.equal(await sa(() => document.querySelectorAll(".bi").length > 50), true, "back returns to the artist list");
await page.click('[data-browse="genres"]');
const g = await sa(() => document.querySelector(".gchips button").dataset.open);
await page.click(`.gchips button[data-open="${g}"]`);
const [fam, style] = g.slice(2).split(".");
assert.ok(await sa(([f, s]) => [...document.querySelectorAll("[data-blist] .trk")].every((r) => { const t = window.__sa.all.find((x) => x.id === r.dataset.id); return t.family === f && t.style === s; }), [fam, style]), "style page holds only that style");
await shot("3-genre-page");

// Recent: what played, newest first, and it survives a reload.
await page.click("[data-back]"); await page.click('[data-browse="recent"]');
const recent = await sa(() => [...document.querySelectorAll("[data-blist] .trk")].map((r) => r.dataset.id));
assert.ok(recent.length >= 2 && recent[0] === (await sa(() => window.__sa.state.sel)), "recent leads with the playing song");

// Albums: the catalogue is singles; your tagged files make one, in track-number order.
await page.click('[data-browse="albums"]');
assert.ok(await sa(() => !!document.querySelector(".empty")), "no catalogue albums: says why");
await page.click(".minecta");
const chooser = page.waitForEvent("filechooser");
await page.click('.castmenu [data-m="files"]');
await (await chooser).setFiles(files);
await until(() => sa(() => document.querySelectorAll(".at").length === 1), 20000, "your album tile");
await shot("4-albums");
await page.click(".at");
assert.equal(await sa(() => document.querySelector(".bhead h2").textContent), "Harbour Lights");
const order = await sa(() => [...document.querySelectorAll("[data-blist] .trk .tt b")].map((b) => b.textContent));
assert.deepEqual(order, ["Undertow", "Low Tide", "First Light"], "album plays in track order");
await shot("5-album-page");
// From a track card, the artist link opens their page, with the album as a section.
await page.click("[data-blist] .trk");
await until(() => sa(() => window.__sa.state.sel?.startsWith("my-")), 5000, "your track selected");
await page.evaluate(() => window.__sa.setView("track"));
await page.click('.card a.aref[data-open^="a:"]');
assert.equal(await sa(() => document.querySelector(".bhead h2").textContent), "Tide Room");
assert.ok(await sa(() => [...document.querySelectorAll(".grp h3")].some((h) => h.textContent.includes("Harbour Lights"))), "artist page shows the album");
await shot("6-artist-from-card");

await wait(400); // the link is written 250 ms after the last change
await page.reload();
await until(() => sa(() => !!document.querySelector(".bhead h2")), 20000, "the open page after reload (your files reload from IndexedDB)");
assert.equal(await sa(() => document.querySelector(".bhead h2")?.textContent), "Tide Room", "the open page comes back from the link");
assert.ok((await sa(() => window.__sa.state.recent.length)) >= 2, "recent survives a reload");

assert.deepEqual(errs, []);
await browser.close();
console.log("browse-e2e ok:", { artists: artists.length, artistPage: pageIds.length, recent: recent.length, album: order });
