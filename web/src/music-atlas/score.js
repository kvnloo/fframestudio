// Score: a track transcribed offline by tools/sound-atlas-score.py (MuScriptor: audio -> notes per
// instrument; SheetSage2: an optional lead sheet in ABC). It sits under Layers and speaks the same
// lanes: each instrument maps onto the stem it lives in, so a soloed layer is also the notes you
// see, and every layer can be read as sheet music or dragged out as MIDI.
import { STEM_HUB } from "./layers.js";

let doc = null, root = STEM_HUB;
const cache = new Map();
const get = (u, as = "json") => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r[as]() : null)).catch(() => null);
export async function loadScores(base) {
  doc = await get(STEM_HUB + "scores.json");
  if (!doc) { const local = new URL(base, location.href); doc = await get(new URL("scores.json", local)); if (doc) root = local.href; }
  return doc;
}
export const scoreOf = (id) => doc?.tracks?.[id] ?? null;
export const scoreCount = () => (doc ? Object.keys(doc.tracks).length : 0);
export function fetchScore(id) {
  const e = scoreOf(id); if (!e) return Promise.resolve(null);
  if (!cache.has(id)) cache.set(id, Promise.all([get(new URL(e.f, root)), e.abc ? get(new URL(e.abc, root), "text") : null]).then(([s, abc]) => s && { ...s, abc }));
  return cache.get(id);
}

// MuScriptor instrument -> the Demucs stem that carries it (STEMS keys in layers.js).
export function laneOf(inst) {
  if (/drum|perc/.test(inst)) return "drums";
  if (/bass/.test(inst)) return "bass";
  if (/guitar/.test(inst)) return "guitar";
  if (/piano|keys|organ|harpsi|celest|marimba|vibra|clav/.test(inst)) return "piano";
  if (/voice|vocal|choir|sing/.test(inst)) return "vocals";
  return "other";
}
// The lanes a score fills, in stem order, with note counts: [{ k, n }].
export function lanesIn(s, order) {
  const n = {}; for (const x of s.n) { const k = laneOf(s.inst[x[3]]); n[k] = (n[k] ?? 0) + 1; }
  return order.filter((k) => n[k]).map((k) => ({ k, n: n[k] }));
}
// Notes sounding in [t0, t1): onsets are sorted, so skip ahead by binary search, then scan back a few
// seconds for long notes that started earlier.
export function windowOf(notes, t0, t1) {
  let lo = 0, hi = notes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m][0] < t0 - 8) lo = m + 1; else hi = m; }
  const out = []; for (let i = lo; i < notes.length && notes[i][0] < t1; i++) if (notes[i][0] + notes[i][1] > t0) out.push(notes[i]);
  return out;
}

// --- sheet music: one layer's notes as ABC on an eighth-note grid ------------------------------
const NAMES = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];
export function abcPitch(p) {
  const o = Math.floor(p / 12) - 1, n = NAMES[p % 12];
  if (o >= 5) return n.replace(/[A-G]/, (c) => c.toLowerCase()) + "'".repeat(o - 5);
  return n + ",".repeat(4 - o);
}
const len = (e) => (e === 1 ? "" : String(e));
// beat = seconds per quarter, origin = audio time of grid 0, meter = [beats, 4]. Chords are notes that
// start on the same eighth; each lasts until the next onset (capped at its own length, then a rest).
export function toABC(s, k, { beat, origin = 0, meter = [4, 4], title = "" }) {
  const e8 = beat / 2, bar = meter[0] * 2, q = (t) => Math.round((t - origin) / e8);
  const on = new Map();
  for (const x of s.n) if (laneOf(s.inst[x[3]]) === k) { const g = Math.max(0, q(x[0])), d = Math.max(1, Math.round(x[1] / e8)); const c = on.get(g) ?? { p: new Set(), d: 0 }; c.p.add(x[2]); c.d = Math.max(c.d, d); on.set(g, c); }
  const at = [...on.keys()].sort((a, b) => a - b), ev = []; // [{ g, d, p: [pitches] | null }]
  let cur = 0;
  for (let i = 0; i < at.length; i++) {
    const g = at[i], c = on.get(g), next = at[i + 1] ?? g + c.d;
    if (g > cur) ev.push({ g: cur, d: g - cur, p: null });
    const d = Math.min(c.d, next - g); ev.push({ g, d, p: [...c.p].sort((a, b) => a - b) });
    if (next - g > d) ev.push({ g: g + d, d: next - g - d, p: null });
    cur = next;
  }
  const lo = s.n.filter((x) => laneOf(s.inst[x[3]]) === k).reduce((a, x) => a + x[2], 0) / Math.max(1, on.size);
  let body = "", pos = 0;
  for (const x of ev) { // split at bar lines; held notes tie across, rests just restart
    let d = x.d;
    while (d > 0) {
      const room = bar - (pos % bar), take = Math.min(d, room), sym = x.p ? (x.p.length > 1 ? `[${x.p.map(abcPitch).join("")}]` : abcPitch(x.p[0])) : "z";
      body += sym + len(take) + (x.p && d > take ? "-" : "") + " ";
      pos += take; d -= take; if (pos % bar === 0) body += (pos / bar) % 4 === 0 ? "|\n" : "| ";
    }
  }
  if (pos % bar) body += `z${len(bar - (pos % bar))} `;
  body = body.trim().replace(/\|$/, "") + " |]";
  return `X:1\nT:${title}\nM:${meter[0]}/${meter[1]}\nL:1/8\nQ:1/4=${Math.round(60 / beat)}\nK:C${lo < 55 ? " clef=bass" : ""}\n${body}\n`;
}

// --- MIDI: the whole score as a Standard MIDI File (format 0, one channel per instrument) --------
const GM = [[/piano/, 0], [/organ/, 19], [/guitar/, 25], [/bass/, 33], [/string|violin|viola|cello/, 48], [/brass|trumpet/, 61], [/sax/, 65], [/flute/, 73], [/synth|lead/, 81], [/pad/, 89], [/voice|vocal|choir/, 53]];
export function toMidi(s, bpm = 120) {
  const tpq = 480, tick = (t) => Math.round(t * (bpm / 60) * tpq), ev = [];
  const chan = s.inst.map((name, i) => (/drum|perc/.test(name) ? 9 : i >= 9 ? i + 1 : i) & 15);
  s.inst.forEach((name, i) => { if (chan[i] !== 9) ev.push([0, 0, [0xc0 | chan[i], GM.find(([r]) => r.test(name))?.[1] ?? 0]]); });
  for (const [t, d, p, i] of s.n) { ev.push([tick(t), 2, [0x90 | chan[i], p, 96]]); ev.push([tick(t + d), 1, [0x80 | chan[i], p, 0]]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // note-offs before note-ons on the same tick
  const vlq = (v) => { const b = [v & 127]; while ((v >>= 7)) b.unshift((v & 127) | 128); return b; };
  const us = Math.round(60e6 / bpm), trk = [0, 0xff, 0x51, 3, us >> 16, (us >> 8) & 255, us & 255];
  let last = 0; for (const [t, , m] of ev) { trk.push(...vlq(t - last), ...m); last = t; }
  trk.push(0, 0xff, 0x2f, 0);
  const n = trk.length;
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, tpq >> 8, tpq & 255, 0x4d, 0x54, 0x72, 0x6b, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255, ...trk]);
}

// abcjs (MIT) draws the staff; loaded on first open so the atlas boot stays light.
let abcjs = null;
export function loadABCJS() {
  if (globalThis.ABCJS) return Promise.resolve(globalThis.ABCJS);
  return (abcjs ??= new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/abcjs@6.7.2/dist/abcjs-basic-min.js"; s.onload = () => ok(globalThis.ABCJS); s.onerror = no; document.head.append(s); }));
}
