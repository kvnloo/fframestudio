// End-to-end: import a real playlist from another app and play it in the tiny YouTube tile, on a phone viewport.
// Paste a Spotify link -> the songs land as "Your music" and the playlist starts; the 96×54 tile finds and plays
// the first song; tapping the tile pauses it; press-and-hold and a hard pen press both grow it (and it takes
// touches); a tap outside shrinks it; ⏭ moves to the next song; the import survives a reload.
// Usage: node test/music-atlas/import-e2e.mjs <base-url> [shots-dir] [playlist-link]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://127.0.0.1:8874/", shots = "", link = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
// A consistent phone profile. YouTube's bot check answers "This video is unavailable" to a desktop UA
// with an emulated high DPR (3/3 failed at DPR 2 vs 3/3 played as a Pixel 7 at 2.625 and S9+ at 4.5).
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage(), errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); };
const yt = () => page.evaluate(() => { const y = window.__sa.yt?.yt; return y && { ...y }; });

await page.goto(base); await page.waitForFunction(() => window.__sa?.all?.length > 100, null, { timeout: 30000 });
await page.evaluate(() => window.__sa.importMenu());
await page.fill(".shm.imp textarea", link); await page.click(".shm.imp [data-go]");
await page.waitForFunction(() => window.__sa.state.plist?.id?.startsWith("mine:im-"), null, { timeout: 20000 });
const pl = await page.evaluate(() => ({ name: window.__sa.state.plist.name, n: window.__sa.state.plist.ids.length, sel: window.__sa.state.sel }));
ok(pl.n >= 20 && pl.sel?.startsWith("yt-"), `imported “${pl.name}”: ${pl.n} songs, playing ${pl.sel}`);

await page.waitForFunction(() => { const y = window.__sa.yt?.yt; return y && !y.paused && y.time > 1; }, null, { timeout: 45000 })
  .catch(async (e) => {
    // YouTube sometimes refuses every video to a whole automated session ("This video is unavailable"). The
    // app must then give up cleanly (no endless spinner/skip loop); report it apart from a real failure.
    const why = (await Promise.all(page.frames().filter((f) => /youtube/.test(f.url())).map((f) => f.evaluate(() => document.body.innerText).catch(() => "")))).join(" ");
    if (/unavailable/i.test(why)) {
      ok(await page.locator(".ytmini.busy").count() === 0 && (await yt()).paused, "YouTube refused this session; the tile gave up cleanly (no spinner, paused)");
      console.log("import e2e INCONCLUSIVE: YouTube flagged this automated session; re-run"); await browser.close(); process.exit(3);
    }
    console.log("state:", JSON.stringify(await yt())); throw e; });
let s = await yt(); ok(true, `tile plays YouTube ${s.id} · ${s.time.toFixed(1)} s of ${Math.round(s.dur)} s`);
const box = await page.locator(".ytmini").boundingBox(), pb = await page.locator("#player").boundingBox();
const covers = await page.evaluate(([x, y, w, h]) => [".rail .railrow", "#sheet .search", "#player", ".top"].filter((s) => {
  const r = document.querySelector(s)?.getBoundingClientRect(); return r && r.height && x < r.right && x + w > r.left && y < r.bottom && y + h > r.top; }), [box.x, box.y, box.width, box.height]);
ok(box.width <= 100 && box.height <= 60 && !covers.length, `tile is ${box.width}×${box.height} px over the map, covering no chips, search, player or header` + (covers.length ? ` (covers ${covers})` : ""));
const ppPlaying = await page.locator("#pp").innerHTML();
await shot("1-tile");

let cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.click(cx, cy); await page.waitForTimeout(700);
ok((await yt()).paused, "tap the tile: paused");
ok((await page.locator("#pp").innerHTML()) !== ppPlaying, "the bar's button follows the tile (pause icon while playing, play icon now)");
await page.locator("#pp").click(); await page.waitForFunction(() => !window.__sa.yt.yt.paused, null, { timeout: 10000 });
ok(true, "the bar's ▶ resumes it");

({ x: cx, y: cy } = await page.locator(".ytmini").boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })));
await page.mouse.move(cx, cy); await page.mouse.down(); await page.waitForTimeout(600);
await page.mouse.up(); await page.waitForTimeout(600);
const big = await page.locator(".ytmini").boundingBox();
ok(await page.locator(".ytmini.big").count() === 1 && big.width >= 300, `press and hold: grows to ${Math.round(big.width)}×${Math.round(big.height)}`);
ok(await page.evaluate(() => getComputedStyle(document.querySelector(".ytmini .ytc")).display === "none"), "grown, the video itself takes touches");
await shot("2-grown");
await page.mouse.click(30, 200); await page.waitForTimeout(450);
ok(await page.locator(".ytmini.big").count() === 0, "tap outside: back to a tile");

const cdp = await ctx.newCDPSession(page), pen = (type, force) => cdp.send("Input.dispatchMouseEvent", { type, x: cx, y: cy, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, pointerType: "pen", force });
await pen("mousePressed", 0.1); await page.waitForTimeout(60); await pen("mouseMoved", 0.7); await page.waitForTimeout(120);
ok(await page.locator(".ytmini.big").count() === 1, "a hard pen press grows it in 180 ms (before the hold timer)");
await pen("mouseReleased", 0); await page.locator(".ytmini .ytx").click(); await page.waitForTimeout(400);
ok(await page.locator(".ytmini.big").count() === 0, "⤡ shrinks it");

const id0 = (await yt()).id;
await page.locator("#pn").click();
await page.waitForFunction((a) => { const y = window.__sa.yt.yt; return y.id && y.id !== a && !y.paused && y.time > 0.5; }, id0, { timeout: 45000 });
s = await yt(); ok(true, `⏭ next song: ${s.id} playing (${await page.evaluate(() => window.__sa.state.sel)})`);
await shot("3-next");

await page.reload(); await page.waitForFunction(() => window.__sa?.mine?.plists?.some((p) => p.id.startsWith("im-")), null, { timeout: 30000 });
ok(true, "the imported playlist is still there after a reload");
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
console.log("import e2e ok"); await browser.close();
