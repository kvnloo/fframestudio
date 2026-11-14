// Voices: plugins that turn a lane's notes back into sound. A kit is data only — which smplr
// factory and preset to load, which lanes it fits, and its licence — so anyone can add one by
// registering a manifest. The scheduler is pure (notes + clock window in, hits out) and follows
// the <audio> element's clock, the same one the score and mixer use.

export const SMPLR = "https://esm.sh/smplr@1.2.0";

// Licences checked 2026-11-14 against each sample set's own README (smplr code itself is MIT).
export const KITS = [
  { id: "kit.splendid-grand", kind: "voice", title: "Grand piano", engine: "smplr", factory: "SplendidGrandPiano", options: {}, lanes: ["piano", "other", "guitar", "vocals"], license: "Public domain (Splendid Grand Piano samples)" },
  { id: "kit.tr808", kind: "voice", title: "TR-808", engine: "smplr", factory: "DrumMachine", options: { instrument: "TR-808" }, lanes: ["drums"], drums: true, license: "Free sample set by Michael Fischer, Technopolis (1994)" },
  { id: "kit.upright-bass", kind: "voice", title: "Upright bass", engine: "smplr", factory: "Smolken", options: { instrument: "Pizzicato" }, lanes: ["bass"], license: "CC0 (Smolken double bass)" },
  { id: "kit.marimba", kind: "voice", title: "Marimba", engine: "smplr", factory: "Soundfont", options: { instrument: "marimba" }, lanes: ["piano", "other", "guitar", "vocals", "bass"], license: "CC BY 3.0 (FluidR3 GM via gleitz/midi-js-soundfonts)" },
];

export const kitsFor = (k, kits = KITS) => kits.filter((x) => x.lanes.includes(k));

// General MIDI percussion -> TR-808 group names.
const GM808 = { 35: "kick", 36: "kick", 37: "rimshot", 38: "snare", 40: "snare", 39: "clap", 41: "tom-low", 43: "tom-low", 45: "mid-tom", 47: "mid-tom", 48: "tom-hi", 50: "tom-hi", 42: "hihat-close", 44: "hihat-close", 46: "hihat-open", 49: "cymbal", 52: "cymbal", 55: "cymbal", 57: "cymbal", 51: "cymbal", 53: "cymbal", 59: "cymbal", 56: "cowbell", 75: "clave", 70: "maraca", 62: "conga-hi", 63: "conga-mid", 64: "conga-low" };
export const drumHit = (pitch) => GM808[pitch] ?? null;

// Notes of one lane, sorted by onset: [[onset, dur, pitch], ...].
export function laneNotes(score, k, laneOf) {
  return score.n.filter((x) => laneOf(score.inst[x[3]]) === k).map(([o, d, p]) => [o, d, p]).sort((a, b) => a[0] - b[0]);
}
// Index of the first note with onset >= t (binary search).
export function seekIndex(notes, t) { let lo = 0, hi = notes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m][0] < t) lo = m + 1; else hi = m; } return lo; }
// Notes starting in [from, to): the next window of a lookahead scheduler.
export function due(notes, from, to) { const out = []; for (let i = seekIndex(notes, from); i < notes.length && notes[i][0] < to; i++) out.push(notes[i]); return out; }

// Plays voiced lanes against a media element's clock. lanes: Map k -> { notes, inst, kit }.
export function createVoicer(media, ctxOf, load) {
  const lanes = new Map(); let timer = 0, cursor = 0;
  const AHEAD = 0.2, TICK = 50;
  function tick() {
    const ac = ctxOf(), now = media.currentTime, to = now + AHEAD;
    if (cursor > to || cursor < now - 0.5) cursor = now; // after a jump
    for (const L of lanes.values()) {
      if (!L.inst) continue;
      for (const [o, d, p] of due(L.notes, cursor, to)) {
        const when = ac.currentTime + Math.max(0, (o - now) / (media.playbackRate || 1));
        if (L.kit.drums) { const n = drumHit(p); if (n) L.inst.start({ note: n, time: when }); }
        else L.inst.start({ note: p, time: when, duration: Math.min(Math.max(d, 0.08), 4), velocity: 90 });
      }
    }
    cursor = to;
  }
  const hush = () => { for (const L of lanes.values()) L.inst?.stop(); };
  function run() { clearInterval(timer); timer = 0; if (!media.paused && lanes.size) { cursor = media.currentTime; ctxOf().resume?.(); tick(); timer = setInterval(tick, TICK); } }
  for (const ev of ["play", "playing", "seeked", "ratechange"]) media.addEventListener(ev, () => { hush(); run(); });
  for (const ev of ["pause", "emptied", "seeking"]) media.addEventListener(ev, () => { clearInterval(timer); timer = 0; hush(); });
  return {
    // Give lane k a voice (kit) or take it back (null). Resolves when samples are ready.
    async set(k, kit, notes) {
      const old = lanes.get(k); old?.inst?.stop(); lanes.delete(k);
      if (!kit) return run();
      const L = { notes, kit, inst: null }; lanes.set(k, L);
      const inst = await load(kit); if (lanes.get(k) !== L) return;
      L.inst = inst; run();
    },
    voiceOf: (k) => lanes.get(k)?.kit ?? null,
    get size() { return lanes.size; },
    clear() { hush(); lanes.clear(); run(); },
    // Audition one note now (tap a note on the paper).
    async play(kit, p, d = 0.5) { const i = await load(kit); const ac = ctxOf(); ac.resume?.(); i.start(kit.drums ? { note: drumHit(p) ?? "kick" } : { note: p, duration: d, velocity: 90 }); },
  };
}

// smplr loader with a per-kit cache; the AudioContext is created lazily on the first user tap.
export function smplrLoader(ctxOf, url = SMPLR) {
  const cache = new Map(); let mod;
  return async (kit) => {
    if (cache.has(kit.id)) return cache.get(kit.id);
    const p = (async () => { mod ??= await import(url); const inst = mod[kit.factory](ctxOf(), kit.options); await (inst.ready ?? inst.load); return inst; })();
    cache.set(kit.id, p); p.catch(() => cache.delete(kit.id));
    return p;
  };
}
