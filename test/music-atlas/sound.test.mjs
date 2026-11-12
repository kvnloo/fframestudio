import { test } from "node:test";
import assert from "node:assert/strict";
import { keyRelation, mixesWith, bpmOf, neighbours, loadSound, LENSES, profileHTML } from "../../web/src/music-atlas/sound.js";

test("Camelot relations follow the DJ mixing rule", () => {
  assert.equal(keyRelation("8A", "8A"), "same key");
  assert.equal(keyRelation("8A", "9A"), "next on the wheel");
  assert.equal(keyRelation("12B", "1B"), "next on the wheel"); // the wheel wraps
  assert.equal(keyRelation("8A", "8B"), "relative major");
  assert.equal(keyRelation("8A", "3B"), null);
  assert.equal(keyRelation(null, "8A"), null);
  assert.deepEqual(mixesWith("1A"), ["12A", "2A", "1B"]);
});

test("a listed BPM wins over the measured one; measured fills gaps", () => {
  assert.equal(bpmOf({ bpm: 128, f: { tempo: 64.2 } }), 128);
  assert.equal(bpmOf({ bpm: null, f: { tempo: 121.6 } }), 122);
  assert.equal(bpmOf({}), null);
});

const mk = (id, f, bpm = null) => ({ id, title: id, bpm, hay: { meta: "" }, f: { camelot: "8A", key: "A minor", keyConf: 0.8, tempoConf: 0.8, clarity: 20, width: 0.3, corr: 0.8, busy: 4, lra: 6, crest: 12, low: 0.3, bright: 1500, ...f } });

test("neighbours rank by tempo, key and texture, folding half/double time", async () => {
  const seed = mk("seed", { tempo: 120 });
  const pool = [
    seed,
    mk("twin", { tempo: 121 }),
    mk("half", { tempo: 60.5 }),
    mk("clash", { tempo: 97, camelot: "3B", bright: 6000, busy: 14, width: 0.9, clarity: 40 }),
    { id: "nofeat", title: "x", hay: { meta: "" } },
  ];
  globalThis.fetch = async (u) => ({ ok: String(u).endsWith("sound.json"), json: async () => ({ ids: pool.filter((t) => t.f).map((t) => t.id), dims: 0, features: Object.fromEntries(pool.filter((t) => t.f).map((t) => [t.id, t.f])) }) });
  assert.equal(await loadSound("./", pool), true);
  const n = neighbours(seed, pool, 5).map((r) => r.t.id);
  assert.deepEqual(n, ["twin", "half", "clash"]); // never itself, never featureless tracks
  const why = neighbours(seed, pool, 3).find((r) => r.t.id === "half").why;
  assert.match(why, /half\/double time 61/);
  assert.match(seed.hay.meta, /a minor/); // measured words become searchable
});

test("lens colours and the profile render for measured tracks only", () => {
  const t = mk("solo", { tempo: 100, inst: [["piano", 1.2]], timbre: "warm and soft", bands: [-10, 0, -3, -6, -9, -12, -18, -24, -30, -40], busyBands: { low: 2, mid: 3, high: 1 } });
  t.p = { tempo: 0.5, bright: 0.2, clarity: 0.7, width: 0.4, busy: 0.9, lra: 0.5, low: 0.3 };
  for (const L of LENSES.filter((x) => x.color)) assert.match(L.color(t), /^(rgb|hsl)\(/, L.id);
  for (const L of LENSES.filter((x) => x.color)) assert.equal(L.color({ id: "bare" }), null, L.id);
  const html = profileHTML(t);
  assert.match(html, /8A/); assert.match(html, /piano/); assert.match(html, /90th pct/);
  assert.equal(profileHTML({ id: "bare" }), "");
});
