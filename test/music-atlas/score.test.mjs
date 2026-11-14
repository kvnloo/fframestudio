// Score: transcribed notes map onto the stem lanes, read back as sheet music (ABC) and MIDI.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.location = { href: "https://example.test/labs/" };
const { laneOf, lanesIn, windowOf, abcPitch, toABC, toMidi } = await import("../../web/src/music-atlas/score.js");
const { STEMS } = await import("../../web/src/music-atlas/layers.js");

// 120 bpm: an eighth is 0.25 s.
const S = { inst: ["acoustic_piano", "electric_bass", "drums"], n: [[0, 0.5, 60, 0], [0, 0.5, 64, 0], [0, 1, 36, 1], [0, 0.01, 36, 2], [0.5, 0.25, 67, 0], [1, 1.5, 72, 0]] };

test("instruments land in the stem that carries them", () => {
  assert.deepEqual(["acoustic_piano", "electric_bass", "drums", "clean_guitar", "choir", "strings"].map(laneOf), ["piano", "bass", "drums", "guitar", "vocals", "other"]);
  assert.deepEqual(lanesIn(S, Object.keys(STEMS)), [{ k: "drums", n: 1 }, { k: "bass", n: 1 }, { k: "piano", n: 4 }]);
});

test("window keeps notes still sounding from before it starts", () => {
  assert.deepEqual(windowOf(S.n, 0.6, 1.6).map((x) => x[2]), [36, 67, 72]);
});

test("pitches spell in ABC octaves", () => {
  assert.deepEqual([48, 60, 61, 72, 84, 36].map(abcPitch), ["C,", "C", "^C", "c", "c'", "C,,"]);
});

test("one layer becomes a bar of sheet music: chord, note, rest, tie over the bar line", () => {
  const abc = toABC(S, "piano", { beat: 0.5, meter: [3, 4] });
  assert.match(abc, /M:3\/4/); assert.match(abc, /Q:1\/4=120/);
  // C+E for 2 eighths, G, a rest, then c held 6 eighths: 2 fit the bar, the tie carries 4 into the next
  assert.match(abc, /^\[CE\]2 G z c2- \| c4 z2 \|\]$/m);
  assert.match(toABC(S, "bass", { beat: 0.5 }), /clef=bass/);
});

test("MIDI file has a header, tempo, drums on channel 10 and balanced notes", () => {
  const m = toMidi(S, 120), str = String.fromCharCode(...m.slice(0, 4));
  assert.equal(str, "MThd");
  const ons = [], offs = [];
  for (let i = 22; i < m.length - 2; i++) { if ((m[i] & 0xf0) === 0x90 && m[i + 2] === 96) ons.push(m[i] & 15); if ((m[i] & 0xf0) === 0x80 && m[i + 2] === 0) offs.push(m[i] & 15); }
  assert.equal(ons.length, S.n.length); assert.equal(offs.length, S.n.length);
  assert.ok(ons.includes(9), "drums on channel 10");
});
