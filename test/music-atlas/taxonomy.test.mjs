// Sound Atlas taxonomy invariants: every input lands on a real feel → family → style node,
// and search stays inside the licence allow-list (CC0 / CC BY only).
import test from "node:test";
import assert from "node:assert/strict";
import { classify, FEELS, FAMILIES, INCOMPETECH_GENRE, bpmBand, BPM_BANDS, expand, FAMILY_TINT, shade } from "../../web/src/music-atlas/taxonomy.js";
import { search, creditLine } from "../../web/src/music-atlas/search.js";

const feelIds = new Set(FEELS.map((f) => f.id));
const placed = (c) => feelIds.has(c.feel) && FAMILIES.find((f) => f.id === c.family)?.styles.some((s) => s[0] === c.style);

test("classify always returns a placeable node", () => {
  const texts = ["", "zzzz qqq", "1973", "upbeat chiptune boss fight", "dark cinematic horror drone", "lofi jazz hop", "orchestral epic trailer"];
  for (const t of texts) assert.ok(placed(classify(t)), `unplaced: ${JSON.stringify(t)} → ${JSON.stringify(classify(t))}`);
  for (const genre of Object.values(INCOMPETECH_GENRE)) assert.ok(placed(classify("", { genre })), `unplaced genre ${genre}`);
});

test("bpm bands tile the tempo range", () => {
  assert.equal(bpmBand(0), null);
  for (const bpm of [40, 90, 120, 128, 174, 220]) assert.ok(BPM_BANDS.some((b) => b.id === bpmBand(bpm)), `no band for ${bpm}`);
});

test("search ranks lexical matches and never needs the model", () => {
  const mk = (id, title, extra = {}) => ({ id, title, author: "A", license: "CC BY 4.0", src: "test", ...classify(title), hay: { title: title.toLowerCase(), author: "a", meta: "", desc: "" }, ...extra });
  const tracks = [mk("a", "Bright Energy Run", { bpm: 140 }), mk("b", "Slow Rain Piano", { bpm: 70 })];
  const hits = search(tracks, { q: expand("energy") });
  assert.equal(hits.ranked, true);
  assert.deepEqual(hits.hits.map((h) => h.t.id), ["a"]);
  assert.match(creditLine(tracks[0]), /"Bright Energy Run" by A, CC BY 4\.0/);
});

test("every family has a distinct tint, and tinting keeps the feel's hue family readable", () => {
  for (const f of FAMILIES) assert.ok(FAMILY_TINT[f.id], `tint for ${f.id}`);
  const shadow = FEELS.find((f) => f.id === "shadow");
  const shades = FAMILIES.map((f) => shade(shadow.night, FAMILY_TINT[f.id]));
  assert.equal(new Set(shades).size, FAMILIES.length);
  for (const c of shades) { const [, h, , l] = /^hsl\((\d+),(\d+)%,(\d+)%\)$/.exec(c).map(Number); assert.ok(l >= 18 && l <= 88); assert.ok(h >= 0 && h < 360); }
  assert.equal(shade("#ff0000", [0, 0]), "hsl(0,100%,50%)");
  assert.equal(shade("rgb(0,0,255)", [120, 0]), "hsl(0,100%,50%)");
});
