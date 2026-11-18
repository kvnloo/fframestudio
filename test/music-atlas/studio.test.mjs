// Studio math: pitch, keys, take placement, harmonies and mixdown on synthetic voices.
import test from "node:test";
import assert from "node:assert/strict";
import { yin, midiOf, hzOf, contour, parseKey, snapNote, diatonic, inKey, estimateKey, onsetOf, placeTake, renderClip, pitchShift, harmonize, tune, mixdown, wav, ROLES } from "../../web/src/music-atlas/studio.js";

const SR = 48000;
// A sung-ish note: fundamental + two harmonics, so YIN has to find the period, not the loudest partial.
const note = (hz, s, amp = 0.4) => { const x = new Float32Array(Math.round(s * SR)); for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = amp * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t) + 0.25 * Math.sin(6 * Math.PI * hz * t)) / 1.75; } return x; };
const cat = (...xs) => { const o = new Float32Array(xs.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
const median = (a) => { const b = a.filter(isFinite).sort((x, y) => x - y); return b[b.length >> 1]; };
const cents = (a, b) => 1200 * Math.log2(a / b);

test("yin finds the fundamental of voiced frames across the singing range, and nothing in silence", () => {
  for (const hz of [82.4, 110, 220, 330, 523.3, 880]) assert.ok(Math.abs(cents(yin(note(hz, 0.05).subarray(0, 2048), SR), hz)) < 15, `${hz} Hz`);
  assert.equal(yin(new Float32Array(2048), SR), 0);
});

test("keys parse, snap and move by scale degree", () => {
  const G = parseKey("G major"), Am = parseKey("A minor"), Bb = parseKey("Bb minor");
  assert.equal(G.root, 7); assert.equal(Am.mode, "minor"); assert.equal(Bb.root, 10);
  assert.equal(snapNote(G, 65.2), 66); // F -> F# in G major
  assert.equal(diatonic(G, 67, 2), 71); // G up a third = B
  assert.equal(diatonic(G, 71, 2), 74); // B up a third = D (minor third)
  assert.equal(diatonic(Am, 69, -2), 65); // A down a third = F
  assert.ok(inKey(G, 66) && !inKey(G, 65));
});

test("estimateKey reads the key from a sung scale", () => {
  const D = [62, 64, 66, 67, 69, 71, 73, 74, 62, 66, 69, 62]; // D major, tonic-heavy
  assert.equal(estimateKey(D).name, "D major");
  assert.equal(estimateKey([]), null);
});

test("a rough take loses its lead-in silence and lands on the nearest eighth note", () => {
  const grid = { beat: 0.5, down: 0 }, take = cat(new Float32Array(Math.round(0.3 * SR)), note(220, 1));
  assert.ok(Math.abs(onsetOf(take, SR) / SR - 0.285) < 0.02);
  const p = placeTake(take, SR, 1.0, grid); // singing starts ~1.29 s -> eighth grid (0.25) -> 1.25
  assert.equal(p.at, 1.25);
  assert.ok(Math.abs(p.nudge + 0.035) < 0.02);
  assert.equal(placeTake(new Float32Array(SR), SR, 0, grid), null); // silence is no take
});

test("a groove take is cut to whole bars and tiles the whole section, before and after where it was sung", () => {
  const grid = { beat: 0.5, down: 0 }, p = placeTake(note(110, 2.3), SR, 2.0, grid, { loop: true });
  assert.equal(p.loopLen, 2); // 2.3 s at 2 s bars -> 1 bar
  const lane = renderClip(p, 8 * SR, SR);
  for (const s of [0.5, 1.5, 3.5, 6.5]) assert.ok(Math.abs(lane[Math.round(s * SR)]) > 0 || Math.abs(lane[Math.round(s * SR) + 7]) > 0, `audio at ${s}s`);
  const once = renderClip({ ...p, loopLen: 0 }, 8 * SR, SR);
  assert.equal(once[Math.round(0.5 * SR)], 0); // a one-shot part stays where it was sung
});

test("pitchShift moves pitch without changing length", () => {
  const x = note(220, 0.6), y = pitchShift(x, 4, SR);
  assert.equal(y.length, x.length);
  assert.ok(Math.abs(cents(hzOf(median(contour(y, SR))), 220 * 2 ** (4 / 12))) < 25);
});

test("harmonize sings a third above in key: G -> B (major third), B -> D (minor third)", () => {
  const G = parseKey("G major"), x = cat(note(hzOf(67), 0.5), note(hzOf(71), 0.5)), h = harmonize(x, SR, G, 2), c = contour(h, SR);
  const first = median(c.slice(4, 16)), second = median(c.slice(24, 36));
  assert.ok(Math.abs(first - 71) < 0.3, `first ${first}`);
  assert.ok(Math.abs(second - 74) < 0.3, `second ${second}`);
});

test("tune pulls a flat note most of the way onto the key", () => {
  const x = note(hzOf(66.6), 0.5), y = tune(x, SR, parseKey("G major"), 1);
  assert.ok(Math.abs(median(contour(y, SR)) - 67) < 0.2);
});

test("mixdown sums gains under a -1 dBFS ceiling, and wav() writes a valid 16-bit mono header", () => {
  const a = new Float32Array(100).fill(0.8), m = mixdown([{ pcm: a, gain: 1 }, { pcm: a, gain: 1 }, { pcm: a, gain: 0 }], 100);
  assert.ok(Math.abs(m[0] - 0.89) < 1e-6);
  const v = new DataView(wav(m, SR));
  assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), "RIFF");
  assert.equal(v.getUint32(24, true), SR); assert.equal(v.getUint32(40, true), 200);
});

test("the five parts each take over different song layers", () => {
  const taken = ROLES.flatMap((r) => r.replaces);
  assert.equal(new Set(taken).size, taken.length);
  assert.deepEqual(ROLES.map((r) => r.id), ["lead", "hi", "mid", "bass", "beat"]);
});
