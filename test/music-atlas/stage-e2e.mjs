// End-to-end: the Stage on a real song with real stems, sung into by a fake mic (Chrome plays a WAV as the microphone).
// Opens from the player's mic, sings a lead (a C-major tune), writes two harmonies, loops a bass take, checks the
// replaced song layers go ghost, survives a reload, and exports a non-silent WAV.
// Usage: node test/music-atlas/stage-e2e.mjs <base-url-of-web/> [shots-dir]   e.g. python3 -m http.server -d web
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wav } from "../../web/src/music-atlas/studio.js";

const base = process.argv[2] ?? "http://127.0.0.1:8893/", shots = process.argv[3];
const ID = process.env.SA_TRACK ?? "inc-USUAN2200003"; // has a vocal stem
const dir = mkdtempSync(join(tmpdir(), "stage-")), SR = 48000;
// The "singer": C D E G E D C, 0.3 s each with a breath between, then a rest; Chrome loops the file.
const notes = [60, 62, 64, 67, 64, 62, 60], pcm = new Float32Array(SR * 3.4); let p = Math.round(SR * 0.4);
for (const m of notes) { const f = 440 * 2 ** ((m - 69) / 12), n = Math.round(SR * 0.3); for (let i = 0; i < n; i++) { const t = i / SR, env = Math.min(1, i / 400, (n - i) / 400); pcm[p + i] = 0.35 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t)); } p += n + Math.round(SR * 0.05); }
writeFileSync(join(dir, "voice.wav"), Buffer.from(wav(pcm, SR)));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(dir, "voice.wav")}`] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ["microphone"], acceptDownloads: true });
const pg = await ctx.newPage(), errs = [];
pg.on("pageerror", (e) => errs.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) { for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if (await f()) return; throw new Error("timed out: " + what + " " + JSON.stringify(await probe())); }
const probe = () => pg.evaluate(() => import("/src/music-atlas/stage.js").then((m) => m.probe()));
const shot = (n) => shots && pg.screenshot({ path: `${shots}/${n}.png` });

await pg.goto(`${base}labs/sound-atlas.html?catalog=https://glide-music-picker.vercel.app/`);
await until(() => pg.evaluate(() => window.__sa?.all.length > 0), 40000, "app boots");
await pg.evaluate((id) => window.__sa.select(id, { play: true }), ID);
await pg.evaluate(() => window.__sa.sheetTo("half")); await wait(800);
await shot("1-player");
await pg.click("#pk");
await pg.waitForSelector("#stage");
await until(async () => (await probe())?.layers.length > 1 && (await probe()).layers.every((l) => l.ok), 90000, "song layers decode");
let s = await probe();
assert.ok(s.layers.find((l) => l.k === "vocals").ghost, "the song's own voice starts as a quiet guide (karaoke)");
assert.ok(!s.layers.find((l) => l.k === "bass").ghost);
await pg.click('[data-a="bars"][data-n="4"]');
await until(async () => (await probe()).bars === 4 && (await probe()).layers.every((l) => l.ok), 60000, "4-bar section");
await shot("2-stage");

// Lead: one pass of the section through the mic.
await pg.click(".st-rec");
await wait(2500); await shot("3-singing");
await until(async () => (await probe()).voices.lead, 40000, "lead take lands");
s = await probe();
assert.ok(s.voices.lead.len > 1, "lead holds the take");
assert.ok(s.key, "a key is known (from the song or heard)");
assert.equal(s.sel, "hi", "Sing walks on to the next empty part");

// Magic: two harmonies written from the lead.
await pg.click('[data-a="harm"]');
await until(async () => (await probe()).voices.hi?.auto && (await probe()).voices.mid?.auto, 20000, "harmonies");
s = await probe();
for (const k of ["vocals", "other", "piano"]) if (s.layers.find((l) => l.k === k)) assert.ok(s.layers.find((l) => l.k === k).ghost, k + " goes ghost once replaced");

// Bass: a short take loops across the section.
await pg.click('[data-role="bass"] .st-pick'); await pg.click(".st-rec");
await until(async () => (await probe()).voices.bass, 40000, "bass take lands");
s = await probe();
assert.ok(s.voices.bass.loop > 0, "bass is a loop");
assert.ok(s.layers.find((l) => l.k === "bass").ghost, "bass layer ghosts");
await pg.click('[data-role="lead"] [data-a="tune"]');
await until(async () => (await probe()).voices.lead.tuned, 10000, "tune toggles");
await wait(1500); await shot("4-arranged");

// Save
const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click('[data-a="export"]')]);
const out = join(dir, "mix.wav"); await dl.saveAs(out);
s = await probe(); assert.ok(s.exportPeak > 0.01, "the mix has sound");
console.log("exported", dl.suggestedFilename(), out);

// Back returns to Listen; the arrangement survives a reload.
await pg.click('[data-a="close"]'); await wait(600);
assert.equal(await pg.$("#stage"), null);
await pg.reload(); await until(() => pg.evaluate(() => window.__sa?.all.length > 0), 40000, "reboot");
await pg.evaluate((id) => window.__sa.select(id), ID); await pg.evaluate(() => window.__sa.sheetTo("half")); await wait(500);
await pg.click("#pk"); await pg.waitForSelector("#stage");
await until(async () => (await probe())?.voices.lead && (await probe()).voices.bass, 15000, "arrangement restored");
assert.deepEqual(errs, [], "no page errors");
console.log(JSON.stringify(await probe()));
await browser.close();
console.log("stage e2e: ok");
