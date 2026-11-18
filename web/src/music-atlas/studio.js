// Studio: the pure half of the Stage (stage.js). Everything here is plain math on Float32Arrays so
// node tests can check it: pitch (YIN), keys and scales, lining a rough take up on the song's grid,
// in-key harmonies and pitch correction (WSOLA stretch + resample), and the mixdown/WAV export.

// --- the five voices of an a cappella group -----------------------------------------------------
// Each part says which of the song's layers it takes over: once you've sung a part, those layers fall
// back to a faint ghost, so the song turns into your voices one part at a time. `loop` = a short take
// repeats across the section (groove parts), otherwise it plays once where you sang it.
export const ROLES = [
  { id: "lead", name: "Lead", hue: "#ffb35c", replaces: ["vocals"], loop: false },
  { id: "hi", name: "High harmony", hue: "#ff86b8", replaces: ["other", "guitar"], loop: false },
  { id: "mid", name: "Low harmony", hue: "#b49cff", replaces: ["piano"], loop: false },
  { id: "bass", name: "Bass", hue: "#5fd3dc", replaces: ["bass"], loop: true },
  { id: "beat", name: "Beatbox", hue: "#4fd69a", replaces: ["drums"], loop: true },
];
export const roleById = Object.fromEntries(ROLES.map((r) => [r.id, r]));
export const GHOST = 0.12; // a replaced layer stays faintly audible as a guide

// --- pitch -------------------------------------------------------------------------------------------
// YIN (de Cheveigné & Kawahara 2002) on one frame. Returns Hz, or 0 when the frame is unvoiced/quiet.
export function yin(x, sr, { lo = 60, hi = 1100, thr = 0.12, gate = 0.01 } = {}) {
  const n = x.length, W = n >> 1, tMin = Math.max(2, Math.floor(sr / hi)), tMax = Math.min(W - 1, Math.ceil(sr / lo));
  let e = 0; for (let i = 0; i < n; i++) e += x[i] * x[i];
  if (Math.sqrt(e / n) < gate) return 0;
  const d = new Float32Array(tMax + 2);
  for (let t = 1; t <= tMax + 1; t++) { let s = 0; for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; s += v * v; } d[t] = s; }
  let run = 0, best = -1;
  for (let t = 1; t <= tMax + 1; t++) { run += d[t]; d[t] = run ? (d[t] * t) / run : 1; }
  for (let t = tMin; t <= tMax; t++) if (d[t] < thr) { while (t + 1 <= tMax && d[t + 1] < d[t]) t++; best = t; break; }
  if (best < 0) return 0;
  const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c; // parabolic refine
  return sr / (best + (den ? (0.5 * (a - c)) / den : 0));
}
export const midiOf = (hz) => (hz > 0 ? 69 + 12 * Math.log2(hz / 440) : NaN);
export const hzOf = (m) => 440 * 2 ** ((m - 69) / 12);
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

// Pitch track: one value (MIDI, NaN = silence) every `hop` seconds.
// Analysed at ~16 kHz (box-averaged down): YIN costs window x lag, so this is ~9x cheaper at 48 kHz.
export function contour(pcm, sr, hop = 0.025) {
  const d = Math.max(1, Math.floor(sr / 16000)), r = sr / d, x = d > 1 ? new Float32Array(Math.floor(pcm.length / d)) : pcm;
  if (d > 1) for (let i = 0; i < x.length; i++) { let s = 0; for (let j = 0; j < d; j++) s += pcm[i * d + j]; x[i] = s / d; }
  const win = 1024, out = [];
  for (let i = 0; i * hop * r + win <= x.length; i++) { const a = Math.round(i * hop * r); out.push(midiOf(yin(x.subarray(a, a + win), r))); }
  return out;
}

// --- keys and scales ---------------------------------------------------------------------------------
const MODES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
// "G major" / "C# minor" / "Bb minor" -> { root: pitch class, mode, steps }
export function parseKey(s) {
  const m = /^([A-G])([#b]?)\s*(major|minor|maj|min|m)?/i.exec(String(s ?? "").trim()); if (!m) return null;
  const root = (NAMES.indexOf(m[1].toUpperCase()) + (m[2] === "#" ? 1 : m[2] === "b" ? 11 : 0)) % 12;
  const mode = /^m(in(or)?)?$/i.test(m[3] ?? "") ? "minor" : "major";
  return { root, mode, steps: MODES[mode], name: `${NAMES[root]} ${mode}` };
}
export const inKey = (key, m) => key.steps.includes((((Math.round(m) - key.root) % 12) + 12) % 12);
// Nearest in-key note to a (fractional) MIDI pitch.
export function snapNote(key, m) {
  let best = m, bd = Infinity;
  for (let o = -1; o <= 1; o++) for (const s of key.steps) { const c = 12 * (Math.floor((m - key.root) / 12) + o) + key.root + s, d = Math.abs(c - m); if (d < bd) { bd = d; best = c; } }
  return best;
}
// Move a note `steps` scale degrees up (+) or down (-) inside the key: a third above = +2.
export function diatonic(key, m, steps) {
  const n = snapNote(key, m), rel = n - key.root, oct = Math.floor(rel / 12), deg = key.steps.indexOf(((rel % 12) + 12) % 12);
  const k = deg + steps, o = Math.floor(k / 7);
  return key.root + 12 * (oct + o) + key.steps[((k % 7) + 7) % 7];
}
// Key from sung notes (Krumhansl-Kessler profiles over a duration-weighted pitch-class histogram).
const KK = { major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] };
export function estimateKey(midis) {
  const h = new Array(12).fill(0); for (const m of midis) if (isFinite(m)) h[((Math.round(m) % 12) + 12) % 12]++;
  if (!h.some(Boolean)) return null;
  let best = null;
  for (const mode of ["major", "minor"]) for (let r = 0; r < 12; r++) {
    const p = KK[mode].map((_, i) => KK[mode][(i - r + 12) % 12]), corr = pearson(h, p);
    if (!best || corr > best.corr) best = { corr, key: parseKey(`${NAMES[r]} ${mode}`) };
  }
  return best.key;
}
function pearson(a, b) { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return num / Math.sqrt(da * db || 1); }

// --- lining a rough take up ----------------------------------------------------------------------------
// Where the singing starts: the first 10 ms block above 15% of the take's peak (and a noise floor),
// backed off 15 ms so the consonant survives.
export function onsetOf(pcm, sr) {
  const B = Math.round(sr * 0.01); let peak = 0; const rms = [];
  for (let i = 0; i + B <= pcm.length; i += B) { let s = 0; for (let j = i; j < i + B; j++) s += pcm[j] * pcm[j]; const r = Math.sqrt(s / B); rms.push(r); if (r > peak) peak = r; }
  const thr = Math.max(0.015, peak * 0.15), k = rms.findIndex((r) => r > thr);
  return k < 0 ? -1 : Math.max(0, k * B - Math.round(sr * 0.015));
}
// A take recorded at section time `at` (s), already latency-corrected: drop the silence before the
// singing, then nudge it onto the nearest 1/8 note so rough timing lands in the pocket. A groove part
// is cut to whole bars from that point so it can loop.
export function placeTake(pcm, sr, at, grid, { loop = false } = {}) {
  const on = onsetOf(pcm, sr); if (on < 0) return null;
  const start = at + on / sr, eighth = grid.beat / 2;
  const snapped = grid.down + Math.round((start - grid.down) / eighth) * eighth;
  let clip = pcm.slice(on), loopLen = 0;
  if (loop) {
    const bar = grid.beat * 4; loopLen = Math.max(1, Math.round(clip.length / sr / bar)) * bar;
    const n = Math.round(loopLen * sr), c = new Float32Array(n); c.set(clip.subarray(0, n)); fade(c, sr, 0.004); clip = c;
  }
  return { pcm: clip, at: Math.max(0, snapped), nudge: snapped - start, loopLen };
}
function fade(c, sr, s) { const n = Math.min(c.length >> 1, Math.round(sr * s)); for (let i = 0; i < n; i++) { const g = i / n; c[i] *= g; c[c.length - 1 - i] *= g; } }
// One lane as a section-long buffer: the clip once, or tiled from its start to the end of the section.
export function renderClip(clip, len, sr) {
  const out = new Float32Array(len); if (!clip) return out;
  const at = Math.round(clip.at * sr), step = clip.loopLen ? Math.round(clip.loopLen * sr) : 0;
  const first = step ? at - Math.ceil(at / step) * step : at; // a loop also fills the bars before where it was sung
  for (let p = first; p < len; p += step || len) {
    const s = Math.max(0, -p), e = Math.min(clip.pcm.length, len - p); if (e > s) out.set(clip.pcm.subarray(s, e), p + s);
    if (!step) break;
  }
  return out;
}

// --- pitch shifting (WSOLA time-stretch, then resample) --------------------------------------------------
export function stretch(x, r, sr) {
  const N = 1 << Math.round(Math.log2(sr * 0.04)), Hs = N >> 1, tol = N >> 3, win = hann(N);
  const outLen = Math.round(x.length * r), y = new Float32Array(outLen + N), w = new Float32Array(outLen + N);
  let prev = 0;
  for (let o = 0, k = 0; o < outLen; o += Hs, k++) {
    const nominal = Math.round(o / r); let best = nominal;
    if (k) { // pick the input offset whose start best continues the previous frame's tail
      const nat = prev + Hs; let bc = -Infinity;
      for (let d = -tol; d <= tol; d += 2) { const s = nominal + d; if (s < 0 || s + Hs >= x.length) continue; let c = 0; for (let i = 0; i < Hs; i += 4) c += x[s + i] * (x[nat + i] ?? 0); if (c > bc) { bc = c; best = s; } }
    }
    for (let i = 0; i < N; i++) { const v = x[best + i] ?? 0; y[o + i] += v * win[i]; w[o + i] += win[i]; }
    prev = best;
  }
  for (let i = 0; i < outLen; i++) y[i] = w[i] > 1e-3 ? y[i] / w[i] : 0;
  return y.subarray(0, outLen);
}
function hann(N) { const w = new Float32Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); return w; }
function resample(x, f, len) { const y = new Float32Array(len); for (let i = 0; i < len; i++) { const p = i * f, j = Math.floor(p), a = p - j; y[i] = (x[j] ?? 0) * (1 - a) + (x[j + 1] ?? 0) * a; } return y; }
export function pitchShift(x, semis, sr) {
  if (!semis) return x.slice();
  const f = 2 ** (semis / 12); return resample(stretch(x, f, sr), f, x.length);
}
// Shift a take by a pitch-dependent amount: the take is cut where the wanted shift changes, each piece
// shifted on its own, and the pieces cross-faded back together (10 ms). `want(midi)` -> semitones.
export function shiftBy(pcm, sr, want, hop = 0.025) {
  const c = contour(pcm, sr, hop), H = Math.round(hop * sr), segs = [];
  let last = 0;
  for (let i = 0; i < c.length; i++) {
    const s = isFinite(c[i]) ? Math.round(want(c[i]) * 4) / 4 : last; // quarter-tone steps stop chatter
    if (!segs.length || segs[segs.length - 1].s !== s) segs.push({ s, a: i * H }); last = s;
  }
  if (!segs.length) return pcm.slice();
  const out = new Float32Array(pcm.length), X = Math.round(sr * 0.01);
  segs.forEach((g, i) => {
    const a = Math.max(0, g.a - X), b = Math.min(pcm.length, (segs[i + 1]?.a ?? pcm.length) + X), piece = pitchShift(pcm.subarray(a, b), g.s, sr);
    for (let j = 0; j < piece.length; j++) { const ramp = Math.min(1, (j + 1) / X, (piece.length - j) / X); out[a + j] += piece[j] * (i === 0 && j < X ? 1 : i === segs.length - 1 && j > piece.length - X ? 1 : ramp); }
  });
  return out;
}
// A harmony `steps` scale degrees from what was sung (in key), and gentle pitch correction to the key.
export const harmonize = (pcm, sr, key, steps) => shiftBy(pcm, sr, (m) => diatonic(key, m, steps) - m);
export const tune = (pcm, sr, key, amount = 0.8) => shiftBy(pcm, sr, (m) => (snapNote(key, m) - m) * amount);

// --- mixdown + WAV --------------------------------------------------------------------------------------
export function mixdown(lanes, len) {
  const out = new Float32Array(len);
  for (const { pcm, gain } of lanes) if (pcm && gain > 0) for (let i = 0; i < len && i < pcm.length; i++) out[i] += pcm[i] * gain;
  let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.89) { const g = 0.89 / peak; for (let i = 0; i < len; i++) out[i] *= g; } // -1 dBFS ceiling
  return out;
}
export function wav(pcm, sr) {
  const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b), str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return b;
}
