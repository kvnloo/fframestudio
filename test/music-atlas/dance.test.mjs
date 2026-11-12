import { test } from "node:test";
import assert from "node:assert/strict";
import { pose, tempoPerBar, wheel, zoomDamp, REST } from "../../web/src/music-atlas/dance.js";
import { FEELS } from "../../web/src/music-atlas/taxonomy.js";

// Sample one bar at 1/64 notes; count onsets (rises of the radial pulse) and the peak displacement.
const bar = (lens, gid, gi, tune, start = 0) => {
  const xs = Array.from({ length: 64 }, (_, j) => pose(lens, gid, gi, start + j / 16, tune));
  const k = xs.map((p) => p.k - 1);
  let onsets = 0; for (let j = 0; j < k.length; j++) if (k[j] - k[(j + 63) % 64] > 0.004) onsets++;
  return { xs, onsets, peak: Math.max(...xs.map((p) => Math.abs(p.k - 1) + Math.abs(p.da) + Math.abs(p.spread))) };
};
const sig = (xs) => xs.map((p) => [p.k, p.da, p.spread, p.hop, p.jit, p.tw].map((v) => v.toFixed(3)).join()).join("|");

test("every sort keeps every group near rest and finite", () => {
  const groups = { feel: FEELS.map((F) => F.id), key: Array.from({ length: 12 }, (_, i) => String(i + 1)), tempo: ["slow", "mid", "up", "fast", "rush"], bright: [0, 1, 2, 3, 4], busy: [0, 1, 2, 3, 4], width: [0, 1, 2, 3, 4] };
  for (const [lens, ids] of Object.entries(groups)) for (const [gi, gid] of ids.entries()) for (let p = 0; p < 8; p += 0.13) {
    const q = pose(lens, String(gid), gi, p, { bpm: 128, key: 8 });
    for (const v of Object.values(q)) assert.ok(Number.isFinite(v), `${lens}/${gid} finite`);
    assert.ok(Math.abs(q.k - 1) < 0.08 && Math.abs(q.da) < 0.05 && Math.abs(q.spread) < 0.4, `${lens}/${gid} stays near rest`);
  }
  assert.deepEqual(pose("tempo", "none", 5, 1.2, { bpm: 128 }), REST);
});

test("each emotion moves differently", () => {
  const seen = new Set(FEELS.map((F) => sig(bar("feel", F.id, 0, {}).xs)));
  assert.equal(seen.size, FEELS.length);
  assert.ok(bar("feel", "drive", 0, {}).peak > bar("feel", "calm", 0, {}).peak, "fired up hits harder than at peace");
  assert.ok(bar("feel", "sad", 0, {}).xs.every((p) => p.k <= 1), "sad only ever sinks");
  assert.ok(bar("feel", "shadow", 0, {}).xs.every((p) => p.jit > 0), "tense always trembles");
  const crest = (id, at) => pose("feel", id, 0, at, {}).k - 1;
  assert.ok(crest("lift", 1) > crest("lift", 1.5), "joyful crests on the beat");
  assert.ok(crest("play", 1.5) > crest("play", 1), "playful crests off the beat");
  const sad = bar("feel", "sad", 0, {}).xs.map((p) => 1 - p.k);
  assert.ok(sad[1] < sad[3], "sad sighs in gradually, not a flinch");
});

test("tempo bands pulse at their own speed, the tune's band on the beat", () => {
  assert.equal(tempoPerBar("up", 128), 4);
  assert.ok(tempoPerBar("slow", 128) < tempoPerBar("mid", 128));
  assert.ok(tempoPerBar("mid", 128) < tempoPerBar("rush", 128));
  assert.equal(bar("tempo", "up", 2, { bpm: 128 }).onsets, 4);
  assert.equal(bar("tempo", "slow", 0, { bpm: 128 }).onsets, tempoPerBar("slow", 128));
  for (const bpm of [70, 96, 128, 150, 175]) for (const g of ["slow", "mid", "up", "fast", "rush"]) {
    const own = tempoPerBar(g, bpm) === 4;
    assert.equal(own, bar("tempo", g, 0, { bpm }).xs.length && pose("tempo", g, 0, 0, { bpm }).k > 1.04, `${g}@${bpm}: only the tune's band rides the beat`);
  }
});

test("keys that mix with the tune dance hardest", () => {
  assert.equal(wheel(12, 1), 1);
  const t = { bpm: 120, key: 8 }, pk = (g) => bar("key", String(g), 0, t).peak;
  assert.ok(pk(8) > pk(9) && pk(9) > pk(10) && pk(10) > pk(2));
});

test("density sets how often a band pulses, soundstage how wide it opens", () => {
  const n = [0, 1, 2, 3, 4].map((gi) => bar("busy", "x", gi, {}, 0).onsets);
  for (let i = 1; i < n.length; i++) assert.ok(n[i] > n[i - 1], `busy ${n}`);
  const w = (gi) => Math.max(...bar("width", "x", gi, {}).xs.map((p) => p.spread));
  assert.ok(w(4) > w(2) && w(2) > w(0));
  for (const gi of [0, 1]) assert.ok(Math.min(...bar("width", "x", gi, {}).xs.map((p) => p.spread)) < 0, "mono and intimate pinch in");
});

test("the dance settles as you zoom in", () => {
  const fit = 0.12;
  assert.equal(zoomDamp(0.1, fit), 1);
  assert.equal(zoomDamp(2.6, fit), 0);
  assert.equal(zoomDamp(9, fit), 0);
  // offsets are world px, so on-screen motion is s * damp: it must shrink as you zoom in
  for (let s = fit; s < 3; s += 0.02) assert.ok((s + 0.02) * zoomDamp(s + 0.02, fit) < s * zoomDamp(s, fit) + 1e-9, `screen motion grows at ${s}`);
});
