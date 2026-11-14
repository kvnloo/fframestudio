// Browser journey for the music studio (docs/music-studio.md): plugin actions voice lanes from their
// notes, the voiced stem goes quiet, samples actually start, and the paper skin draws the staff.
// Usage: node test/music-studio-journey.mjs <atlas-bundle-url> [track-id] [shots-dir]
// The bundle needs scores.json (tools/sound-atlas-score.py) for the track; samples load from smplr's CDN.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const [url = "http://127.0.0.1:8791/", id = "inc-USUAN2100020", shots] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, hasTouch: true });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("sa-fs", "no"); window.__starts = 0;
  const o = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { window.__starts++; return o.apply(this, a); };
});
try {
  await p.goto(url, { waitUntil: "load" });
  await p.waitForFunction(() => window.__sa?.all?.length > 0, null, { timeout: 30000 });
  await p.evaluate((x) => { __sa.select(x); }, id); await p.waitForTimeout(800); await p.evaluate(() => __sa.setView("track"));
  await p.waitForSelector(".score canvas.roll", { timeout: 20000 });

  const kinds = await p.evaluate(() => [...new Set(__sa.studio.list().map((x) => x.kind))].sort());
  assert.deepEqual(kinds, ["analyze", "export", "skin", "source", "voice"]);
  const ids = await p.evaluate(() => __sa.studio.actionManifest().map((a) => a.id));
  for (const a of ["kit.tr808/voice", "kit.upright-bass/voice", "voice.original/voice", "skin.paper/apply", "export.midi/download"]) assert.ok(ids.includes(a), a);
  assert.equal((await p.evaluate(() => __sa.studio.run({ id: "kit.tr808/voice", params: { lane: "piano" } }))).ok, false, "schema rejects a drum kit on piano");

  const r = await p.evaluate(() => __sa.studio.apply({ commands: [{ id: "kit.tr808/voice", params: { lane: "drums" } }, { id: "kit.upright-bass/voice", params: { lane: "bass" } }] }));
  assert.deepEqual(r.map((x) => x.ok), [true, true], JSON.stringify(r));
  await p.evaluate(() => { __sa.audio.currentTime = 20; return __sa.audio.play(); });
  const s0 = await p.evaluate(() => window.__starts); await p.waitForTimeout(3000);
  const live = await p.evaluate(() => ({ starts: window.__starts, playing: !__sa.audio.paused, drumsVoiced: __sa.mixer.voiced("drums"), labels: [...document.querySelectorAll(".lane b em")].map((e) => e.textContent) }));
  assert.ok(live.playing && live.drumsVoiced, JSON.stringify(live));
  assert.ok(live.starts - s0 >= 10, `kit samples started: ${live.starts - s0}`);
  assert.ok(live.labels.includes("played by TR-808") && live.labels.includes("played by Upright bass"), JSON.stringify(live.labels));

  assert.equal((await p.evaluate(() => __sa.studio.run({ id: "skin.paper/apply" }))).ok, true);
  await p.waitForTimeout(1200);
  const paper = await p.evaluate(() => { const c = document.querySelector(".score canvas.roll"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) ink++; return { skin: document.documentElement.dataset.skin, bg: getComputedStyle(document.body).backgroundColor, ink, png: c.toDataURL("image/png") }; });
  assert.equal(paper.skin, "paper"); assert.equal(paper.bg, "rgb(244, 240, 230)"); assert.ok(paper.ink > 5000, `staff drawn: ${paper.ink}px`);
  if (shots) { fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(`${shots}/paper-roll.png`, Buffer.from(paper.png.split(",")[1], "base64")); await p.locator(".layers").screenshot({ path: `${shots}/layers.png` }); }

  assert.deepEqual((await p.evaluate(() => __sa.studio.run({ id: "voice.original/voice", params: { lane: "drums" } }))).ok, true);
  assert.equal(await p.evaluate(() => __sa.mixer.voiced("drums")), false);
  assert.deepEqual(errs, []);
  console.log(`music studio journey ok: ${live.starts - s0} samples in 3 s, paper ink ${paper.ink}px`);
} finally { await b.close(); }
