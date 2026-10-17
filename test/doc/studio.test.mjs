import test from "node:test";
import assert from "node:assert/strict";
import {
  colourSlot,
  clipKind,
  timecode,
  escapeHTML,
  advanceFrame,
  tempoOf,
} from "../../web/src/studio.js";
import { analyse } from "../../web/src/wave-worker.js";

test("film palette is stable by kind, with five meanings and deterministic unknown kinds", () => {
  assert.equal(new Set(["S", "H", "N", "DROP", "A"].map(colourSlot)).size, 5);
  assert.equal(colourSlot("custom chapter"), colourSlot("custom chapter"));
  assert.equal(
    clipKind({ metadata: { type: "N" }, styleId: "default", name: "Number" }),
    "N",
  );
  assert.equal(
    clipKind({ metadata: { chapter: "Act II" }, name: "Other" }),
    "Act II",
  );
  assert.equal(clipKind({ styleId: "default", name: "Hook" }), "Hook");
  for (const value of ["arbitrary", "", null, "custom chapter"])
    assert.ok(colourSlot(value) >= 0 && colourSlot(value) < 5);
});
test("beat frames provide tempo only when source BPM is absent", () => {
  assert.equal(tempoOf([0, 15, 30, 45], 30), 120);
  assert.equal(tempoOf([0, 15, 30], 30, 117), 117);
  assert.equal(tempoOf([], 30), null);
});
test("film timecode preserves frame positions and project text is escaped", () => {
  assert.equal(timecode(1859, 30), "1:01:29");
  assert.equal(timecode(7986, 60), "2:13:06");
  assert.equal(
    escapeHTML('<img onerror="x">&\''),
    "&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;",
  );
});
test("fractional playback crosses film and shot loop boundaries without sticking at the last frame", () => {
  assert.equal(advanceFrame(359, 0.5, 360, [0, 360]), 359.5);
  assert.equal(advanceFrame(359.5, 0.5, 360, [0, 360]), 0);
  assert.equal(advanceFrame(89.5, 0.5, 360, [0, 90]), 0);
  assert.equal(advanceFrame(90, -0.5, 360, [90, 180]), 179);
  assert.equal(advanceFrame(359, 0.5, 360), 359);
  assert.equal(advanceFrame(0, -0.5, 360), 0);
});
test("waveform worker reduces real PCM to bounded peak and RMS bins, including silence", () => {
  const signal = new Float32Array([0, 1, -1, 0, 0.5, 0.5, -0.5, -0.5]);
  const { peaks, energy } = analyse(signal, 2);
  assert.deepEqual([...peaks], [1, 0.5]);
  assert.ok(Math.abs(energy[0] - Math.sqrt(0.5)) < 0.00001);
  assert.equal(energy[1], 0.5);
  const silent = analyse(new Float32Array(10));
  assert.equal(silent.peaks.length, 1400);
  assert.ok([...silent.peaks, ...silent.energy].every((v) => v === 0));
});
