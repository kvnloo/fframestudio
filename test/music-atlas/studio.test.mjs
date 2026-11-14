import test from "node:test";
import assert from "node:assert/strict";
import { createStudio, laneDoc, KINDS } from "../../web/src/music-atlas/studio.js";
import { KITS, kitsFor, drumHit, laneNotes, seekIndex, due } from "../../web/src/music-atlas/voices.js";

test("registry rejects malformed plugins and duplicate actions", () => {
  const s = createStudio();
  assert.throws(() => s.register({ id: "x", kind: "synth", title: "X", license: "MIT" }), /kind must be/);
  assert.throws(() => s.register({ id: "x", kind: "voice", title: "X" }), /license/);
  s.register({ id: "a", kind: "export", title: "A", license: "MIT", actions: [{ id: "go", title: "Go", apply: () => 1 }] });
  assert.throws(() => s.register({ id: "a", kind: "export", title: "A", license: "MIT" }), /already/);
  assert.deepEqual(s.list("export").map((p) => p.id), ["a"]);
  assert.deepEqual(KINDS, ["source", "analyze", "voice", "skin", "export"]);
});

test("manifest is data only; run validates before apply; proposals stop at first failure", async () => {
  const seen = [], s = createStudio({ seen });
  s.register({ id: "kit.x", kind: "voice", title: "X", license: "CC0", actions: [
    { id: "voice", title: "Voice a lane", synonyms: ["make the"], schema: { lane: { type: "lane" }, on: { type: "boolean", optional: true } }, apply: (ctx, p) => { ctx.seen.push(p.lane); return p.lane; } },
  ] });
  const m = s.actionManifest();
  assert.equal(m[0].id, "kit.x/voice"); assert.equal(JSON.stringify(m).includes("apply"), false);
  assert.deepEqual(await s.run({ id: "kit.x/voice", params: { lane: 3 } }), { ok: false, id: "kit.x/voice", error: "lane must be lane" });
  assert.equal((await s.run({ id: "kit.x/voice", params: { lane: "bass", nope: 1 } })).error, "unknown nope");
  assert.equal((await s.run({ id: "nope" })).ok, false);
  const r = await s.apply({ commands: [{ id: "kit.x/voice", params: { lane: "bass" } }, { id: "kit.x/voice", params: {} }, { id: "kit.x/voice", params: { lane: "drums" } }] });
  assert.deepEqual(r.map((x) => x.ok), [true, false]); assert.deepEqual(seen, ["bass"]);
});

test("laneDoc joins stems and notes per lane", () => {
  const d = laneDoc({ id: "t", title: "T", license: "CC0" }, { stems: { stems: [{ k: "bass", f: "b.webm" }, { k: "drums", f: "d.webm" }] }, score: { lanes: [{ k: "bass", n: 9 }, { k: "piano", n: 4 }] }, voices: { bass: "kit.upright-bass" } });
  assert.deepEqual(d.lanes, [{ k: "bass", sound: "b.webm", notes: 9, voice: "kit.upright-bass" }, { k: "drums", sound: "d.webm", notes: 0, voice: null }, { k: "piano", sound: null, notes: 4, voice: null }]);
});

test("kits declare licences and lanes; drums map GM to 808 groups", () => {
  for (const k of KITS) { assert.ok(k.license && k.factory && k.lanes.length, k.id); assert.equal(k.kind, "voice"); }
  assert.deepEqual(kitsFor("drums").map((k) => k.id), ["kit.tr808"]);
  assert.ok(kitsFor("bass").some((k) => k.id === "kit.upright-bass"));
  assert.equal(drumHit(36), "kick"); assert.equal(drumHit(42), "hihat-close"); assert.equal(drumHit(38), "snare"); assert.equal(drumHit(1), null);
});

test("scheduler window: lane notes sorted, due() returns [from, to)", () => {
  const score = { inst: ["acoustic_piano", "drums"], n: [[2, 1, 60, 0], [0.5, 1, 36, 1], [1, 0.5, 64, 0], [3, 1, 67, 0]] };
  const laneOf = (n) => (n === "drums" ? "drums" : "piano");
  const ns = laneNotes(score, "piano", laneOf);
  assert.deepEqual(ns.map((x) => x[2]), [64, 60, 67]);
  assert.equal(seekIndex(ns, 1.5), 1); assert.equal(seekIndex(ns, 0), 0); assert.equal(seekIndex(ns, 9), 3);
  assert.deepEqual(due(ns, 1, 3).map((x) => x[2]), [64, 60]);
  assert.deepEqual(due(ns, 3.01, 9), []);
});
