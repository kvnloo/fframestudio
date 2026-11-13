import { test } from "node:test";
import assert from "node:assert/strict";
import { keyRelation, mixesWith, bpmOf, neighbours, loadSound, LENSES, profileHTML, organise, beatAt, parseBeats, curveAt } from "../../web/src/music-atlas/sound.js";

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

test("a lens regroups tracks into its own rings; unmeasured tracks get their own group", async () => {
  const { FEELS, familyById } = await import("../../web/src/music-atlas/taxonomy.js");
  const a = { id: "a", feel: "calm", family: "electronic", bpm: 92, f: { camelot: "8A", key: "A minor" }, p: { bright: 0.93 } };
  const b = { id: "b", feel: "drive", family: "rock", bpm: 170 };
  const key = organise("key", FEELS, familyById);
  assert.equal(key.of(a), "8"); assert.equal(key.of(b), "none");
  assert.deepEqual(key.path(a).map((x) => x[0]), ["A", "calm"]);
  assert.equal(organise("tempo", FEELS, familyById).of(b), "rush");
  assert.equal(organise("bright", FEELS, familyById).of(a), "airy");
  assert.equal(organise("feel", FEELS, familyById), null);
  for (const L of LENSES.slice(1)) { const o = organise(L.id, FEELS, familyById); for (const G of o.groups) assert.match(G.night, /^(#|rgb|hsl)/); }
});

test("beat phase locks to the measured downbeat and ranks accents like a metre", () => {
  const tr = { bpm: 120, f: { beat: { bpm: 120, down: 0.25 } } }; // 0.5 s beats, bar starts at 0.25 s
  const at = (t) => beatAt(t, tr);
  assert.equal(at(0.25).ph, 0); assert.equal(at(0.25).acc, 1);   // phrase start
  assert.equal(at(2.25).acc, 0.7);                               // next bar's downbeat
  assert.equal(at(1.25).acc, 0.45); assert.equal(at(0.75).acc, 0.28);
  assert.ok(Math.abs(at(0.5).ph - 0.5) < 1e-9);
  assert.equal(at(0.0).acc, 0.28);                               // before the first downbeat wraps to beat 16
  assert.equal(beatAt(1, { bpm: 60 }).ph, 0);                    // unmeasured: BPM from t=0
});

// The same bytes tools/music-beats.py writes: "SAB1", u16 beats, u16 frames, u8 fps, u8 channels, u16 0, beats, conf, curve.
function sab(beats, downs, frames = [], fps = 20) {
  const nb = beats.length, ch = 4, buf = new ArrayBuffer(12 + 5 * nb + frames.length * ch), v = new DataView(buf);
  [0x53, 0x41, 0x42, 0x31].forEach((c, i) => v.setUint8(i, c));
  v.setUint16(4, nb, true); v.setUint16(6, frames.length, true); v.setUint8(8, fps); v.setUint8(9, ch);
  beats.forEach((t, i) => v.setUint32(12 + 4 * i, (Math.round(t * 1000) | (downs.includes(t) ? 0x80000000 : 0)) >>> 0, true));
  beats.forEach((_, i) => v.setUint8(12 + 4 * nb + i, 200));
  frames.forEach((f, i) => f.forEach((x, c) => v.setUint8(12 + 5 * nb + i * ch + c, x)));
  return buf;
}

test("measured beats (Beat This!) follow tempo changes and real bars instead of one grid", () => {
  // 4 beats at 0.5 s, then the music speeds up to 0.4 s beats; bars start at 0.5 and 2.4.
  const beats = [0.5, 1.0, 1.5, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0, 4.4, 4.8, 5.2, 5.6, 6.0, 6.4, 6.8, 7.2, 7.6, 8.0];
  const downs = [0.5, 2.4, 4.0, 5.6, 7.2];
  const tr = { bpm: 120, f: { beat: { bpm: 120, down: 0 } }, bt: parseBeats(sab(beats, downs, [[0, 0, 0, 0], [255, 10, 20, 30]])) };
  const at = (t) => beatAt(t, tr);
  assert.ok(Math.abs(at(1.25).ph - 0.5) < 1e-9); assert.ok(Math.abs(at(1.25).len - 0.5) < 1e-9);
  assert.ok(Math.abs(at(2.6).ph - 0.5) < 1e-9); assert.ok(Math.abs(at(2.6).len - 0.4) < 1e-9); // the grid would sit at ph 0.2
  assert.equal(at(0.5).acc, 1);    // first bar: phrase start
  assert.equal(at(2.4).acc, 0.7);  // a bar downbeat
  assert.equal(at(1.5).acc, 0.45); // beat 3
  assert.equal(at(1.0).acc, 0.28);
  assert.equal(at(5.6).acc, 0.7);  // bars 0-3 start at 0.5, 2.4, 4.0, 5.6; 7.2 is bar 4, the next phrase
  assert.equal(at(7.2).acc, 1);
  assert.ok(at(3.0).i > at(2.9).i - 1 && at(3.0).i >= at(2.0).i); // index only moves forward with time
  assert.equal(at(1.0).i, 1); assert.equal(at(0.25).i, -1); assert.ok(Math.abs(at(0.25).ph - 0.5) < 1e-9); // before the first beat
  assert.equal(at(0.0).e, 0); assert.equal(at(0.05).e, 1); // loudness curve at 20 Hz
  assert.equal(curveAt(tr, 0.05, 3), 30 / 255);
  assert.ok(Math.abs(at(9.0).ph - 0.5) < 1e-9); assert.equal(at(9.0).i, 20); // after the last beat: keeps the last tempo
  assert.equal(beatAt(0.9, tr).i, 0); // random access (a seek back) still finds the right beat
});

test("too few or too slow measured beats fall back to the grid", () => {
  assert.equal(parseBeats(sab([1, 2, 3], [1])), null);
  assert.equal(parseBeats(sab([0, 2, 4, 6, 8, 10, 12, 14, 16], [0])), null); // 30 bpm: no pulse to dance to
  assert.equal(parseBeats(new ArrayBuffer(4)), null);
  const tr = { bpm: 60, bt: null };
  assert.equal(beatAt(1, tr).ph, 0); // grid
});
