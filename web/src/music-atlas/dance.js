// The whole atlas dances to the playing track's beat, and HOW each ring-1 group moves says what the
// current sort means. Pure: pose(...) -> how one group is displaced at beat position `pos`.
//
//   k      radial scale about the hub (1 = rest; >1 punches outward, <1 sinks in)
//   da     rigid sway of the group's wedge, radians
//   spread wedge widens (>0) or narrows (<0) about its own centre angle, as a fraction
//   hop    per-dot radial hop in world px; dots alternate direction by seed parity
//   jit    per-dot jitter in world px, re-rolled every 16th note
//   tw     per-dot twinkle 0..1 (dot radius swells), phased per dot
//
// Emotions: each emotion moves like it feels. Fired up punches on every kick; Joyful bounces;
// Playful skips on the off-beat; Confident swaggers side to side; At peace breathes over two bars;
// Dreamy floats and shimmers; Sad sighs inward on each bar; Tense flinches and trembles on 16ths.
// Tempo: each band pulses at its own speed, as a polyrhythm locked to the tune's bar (slow bands a
// couple of times a bar, fast ones five); the band holding the tune lands exactly on its beat.
// Key: bands that mix with the tune (Camelot same, +-1) dance in step; distant keys barely stir.
// Tonality: warm bands swell on the kick, bright bands sparkle on the hats.
// Density: sparse bands pulse once a bar, congested ones on every 16th.
// Soundstage: each beat widens a band's wedge by how wide its stereo image is; mono pinches in.
export const REST = Object.freeze({ k: 1, da: 0, spread: 0, hop: 0, jit: 0, tw: 0 });

const TAU = Math.PI * 2;
const hit = (x, d) => Math.exp(-x * d); // envelope of an event x (0..1) of the way through its slot
const frac = (x) => x - Math.floor(x);
const TEMPO_MID = { slow: 75, mid: 102, up: 125, fast: 147, rush: 175 };
const TEMPO_LO = { slow: 0, mid: 90, up: 115, fast: 135, rush: 160 }, TEMPO_HI = { slow: 90, mid: 115, up: 135, fast: 160, rush: 999 };

// Camelot wheel distance between two numbers 1..12 (0..6).
export const wheel = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };

// Pulses per bar for a tempo band against the tune: its own speed, quantised so it re-locks each bar.
export function tempoPerBar(gid, bpm) {
  if (!(bpm > 0) || !TEMPO_MID[gid]) return 0;
  if (bpm >= TEMPO_LO[gid] && bpm < TEMPO_HI[gid]) return 4; // the tune's own band: on the beat
  // Only the tune's band may land on the beat: slower bands stay under 4 a bar, faster ones over.
  const slower = TEMPO_HI[gid] <= bpm, n = Math.round((4 * TEMPO_MID[gid]) / bpm);
  return slower ? Math.max(1, Math.min(3, n)) : Math.max(5, Math.min(8, n));
}

// Zoom settle. Dance offsets are in world px, so on screen they grow with the zoom scale s; damping by
// (fit/s)^1.5 makes on-screen motion shrink as you zoom in from the whole-map view (scale `fit`),
// and a final fade from 0.95 (styles legible) leaves it still by 2.6 (the leaf detent), titles readable.
export const zoomDamp = (s, fit = 0.12) => {
  if (s <= fit) return 1;
  const fade = s <= 0.95 ? 1 : Math.max(0, 1 - Math.log(s / 0.95) / Math.log(2.6 / 0.95));
  return (fit / s) ** 1.5 * fade;
};

// lens: sort id ("feel", "key", "tempo", "bright", "busy", "width"); gid: ring-1 group id;
// gi: its band index (0 = low end of the scale); pos: beats since the downbeat (fractional);
// tune: { bpm, key } of the playing track (key = Camelot number or null).
export function pose(lens, gid, gi, pos, tune = {}) {
  if (gid === "none" || !Number.isFinite(pos)) return REST;
  const ph = frac(pos), i = Math.floor(pos), bar = frac(pos / 4), acc = (((i % 4) + 4) % 4) === 0 ? 1 : 0.65;
  const kick = hit(ph, 7) * acc, off = hit(frac(pos + 0.5), 7), hat = hit(frac(pos * 4), 9);
  if (!lens || lens === "feel") {
    switch (gid) {
      case "drive": return { ...REST, k: 1 + 0.055 * hit(ph, 10) * acc }; // sharp attack, fast decay: a punch
      case "lift": return { ...REST, k: 1 + 0.035 * Math.cos(Math.PI * ph) ** 2 }; // round bounce cresting ON the beat (playful takes the off-beat)
      case "play": return { ...REST, k: 1 + 0.012 * off, hop: 5 * off };
      case "groove": { const c = Math.cos(Math.PI * pos); return { ...REST, da: 0.022 * Math.sign(c) * Math.abs(c) ** 0.5, k: 1 + 0.014 * kick }; }
      case "calm": return { ...REST, k: 1 + 0.028 * (0.5 - 0.5 * Math.cos((TAU * pos) / 8)) };
      case "wonder": return { ...REST, da: 0.014 * Math.sin((TAU * pos) / 16), tw: 0.7 };
      case "sad": return { ...REST, k: 1 - 0.03 * (bar < 0.15 ? Math.sin((Math.PI / 2) * (bar / 0.15)) : hit(bar - 0.15, 2.4)) }; // a soft sigh, not a flinch
      case "shadow": return { ...REST, k: 1 - 0.018 * hit(ph, 12), jit: 2.4 };
      default: return { ...REST, k: 1 + 0.02 * kick };
    }
  }
  if (lens === "tempo") {
    const n = tempoPerBar(gid, tune.bpm); if (!n) return REST;
    const amp = n === 4 && tune.bpm >= TEMPO_LO[gid] && tune.bpm < TEMPO_HI[gid] ? 0.05 : 0.03;
    return { ...REST, k: 1 + amp * hit(frac(bar * n), 6) };
  }
  if (lens === "key") {
    const d = tune.key ? wheel(+gid, tune.key) : 6;
    if (d <= 1) return { ...REST, k: 1 + (d ? 0.035 : 0.05) * kick }; // mixes with it: in step
    if (d === 2) return { ...REST, k: 1 + 0.018 * off };                // a stretch: answers on the off-beat
    return { ...REST, k: 1 + 0.006 * Math.sin((TAU * pos) / 8) };        // clashes: barely stirs
  }
  const v = Math.max(0, Math.min(1, gi / 4));
  if (lens === "bright") return { ...REST, k: 1 + 0.04 * (1 - v) * hit(ph, 3) * acc + 0.01 * v * hat, tw: v * hat };
  if (lens === "busy") { const per = [0.25, 0.5, 1, 2, 4][Math.round(v * 4)]; return { ...REST, k: 1 + (0.045 - 0.02 * v) * hit(frac(pos * per), 6) }; }
  if (lens === "width") return { ...REST, spread: [-0.06, -0.03, 0.04, 0.1, 0.18][Math.round(v * 4)] * hit(ph, 4) * acc }; // mono and intimate pinch in
  return { ...REST, k: 1 + 0.02 * kick };
}

// Stable per-dot seed in [0,1) from a track id.
export function seedOf(id) { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; }
