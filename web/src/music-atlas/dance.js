// The whole atlas dances to the playing track's beat, and HOW each ring-1 group moves says what the
// current sort means. Pure: pose(...) -> how one group is displaced at beat position `pos`.
//
//   k      radial scale about the hub (1 = rest; >1 punches outward, <1 sinks in)
//   da     rigid sway of the group's wedge, radians
//   spread wedge widens (>0) or narrows (<0) about its own centre angle, as a fraction
//   hop    per-dot radial hop in SCREEN px (the atlas divides by the zoom); dots alternate direction by seed
//   jit    per-dot jitter in screen px, re-rolled every 16th note
//   tw     per-dot twinkle 0..1 (dot radius swells), phased per dot
//   open   extra opening of the tuft at the arm's end (the stalks fan out), added to the spring's own stretch
//
// Sizes are set so a group's dots travel ~8-12 px on a phone at the whole-map view (ring radius ~160 px, so
// k 1.06 ~ 10 px): the lead (playing) group dances at that size, the chorus at half. Beat-locked verbs use
// att(): a ~45 ms eased rise that peaks ON the beat, then decays, so nothing teleports in one frame.
// Emotions: each emotion moves like it feels. Fired up punches on every kick; Joyful bounces;
// Playful skips on the off-beat; Confident swaggers side to side; At peace breathes over two bars;
// Dreamy floats and shimmers; Sad sighs inward on each bar; Tense flinches and trembles on 16ths.
// Tempo: the tune's band pulses on the beat; each band away from it halves (slower) or doubles (faster) the rate,
// so the ring reads as half-time / on the beat / 8ths / 16ths, and pulses shrink with distance.
// Key: bands that mix with the tune (Camelot same, +-1) dance in step, a stretch (2) answers off the beat, clashes hold still.
// Tonality: warm bands swell on the kick; bright bands quiver on the hats on a light, fast tuft.
// Density: sparse bands pulse once a bar, congested ones on every 16th.
// Soundstage: each beat opens a band's tuft by how wide its stereo image is: wide rows space apart, mono bunches.
export const REST = Object.freeze({ k: 1, da: 0, spread: 0, hop: 0, jit: 0, tw: 0, open: 0 });

const TAU = Math.PI * 2;
const hit = (x, d) => Math.exp(-x * d); // envelope of an event x (0..1) of the way through its slot
const frac = (x) => x - Math.floor(x);
const smooth = (x) => x * x * (3 - 2 * x);
// Beat-locked envelope with an attack: rises over A beats (smoothstep) to peak exactly at phase 0, then decays.
const att = (ph, A, d) => { const p = frac(ph + A); return p < A ? smooth(p / A) : Math.exp(-(p - A) * d); };
const attOf = (tune) => (0.045 * (tune.bpm > 0 ? tune.bpm : 100)) / 60; // 45 ms in beats
const TEMPO_MID = { slow: 75, mid: 102, up: 125, fast: 147, rush: 175 };
const TEMPO_LO = { slow: 0, mid: 90, up: 115, fast: 135, rush: 160 }, TEMPO_HI = { slow: 90, mid: 115, up: 135, fast: 160, rush: 999 };

// Camelot wheel distance between two numbers 1..12 (0..6).
export const wheel = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };

// Pulses per bar for a tempo band against the tune: 4 for the tune's own band; each band away halves
// (slower) or doubles (faster) it: 2, 1 a bar below; 8, 16 above (16ths cap the fastest).
const BANDS = ["slow", "mid", "up", "fast", "rush"];
const bandOf = (bpm) => BANDS.findLast((g) => bpm >= TEMPO_LO[g]) ?? "slow";
export function tempoPerBar(gid, bpm) {
  if (!(bpm > 0) || !TEMPO_MID[gid]) return 0;
  const d = BANDS.indexOf(gid) - BANDS.indexOf(bandOf(bpm));
  return d >= 0 ? Math.min(16, 4 * 2 ** d) : Math.max(1, 4 / 2 ** -d);
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
  const ph = frac(pos), i = Math.floor(pos), bar = frac(pos / 4), acc = (((i % 4) + 4) % 4) === 0 ? 1 : 0.65, A = attOf(tune);
  const kick = att(ph, A, 7) * acc, off = att(frac(pos + 0.5), A, 7), hat = att(frac(pos * 4), A * 4, 9);
  if (!lens || lens === "feel") {
    switch (gid) {
      case "drive": { // a wind-up dip in the last 0.15 beat, then a hard eased punch landing on the kick
        const w0 = 0.85 - A, dip = ph > w0 ? 0.012 * Math.sin((Math.PI * (ph - w0)) / (1 - w0)) : 0;
        return { ...REST, k: 1 + 0.065 * att(ph, A, 5) * acc - dip };
      }
      case "lift": return { ...REST, k: 1 + 0.055 * Math.cos(Math.PI * ph) ** 2 }; // round bounce cresting ON the beat
      case "play": return { ...REST, k: 1 + 0.04 * off, hop: 4 * off }; // skips on the off-beat
      case "groove": { const c = Math.cos(Math.PI * pos); return { ...REST, da: (0.03 * Math.tanh(3 * c)) / Math.tanh(3), k: 1 + 0.014 * kick }; } // swagger: dwell at each side
      case "calm": return { ...REST, k: 1 + 0.06 * (0.5 - 0.5 * Math.cos((TAU * pos) / 8)) }; // slow, so big: breathes over two bars
      case "wonder": return { ...REST, da: 0.035 * Math.sin((TAU * pos) / 8), tw: 0.7 };
      case "sad": return { ...REST, k: 1 - 0.08 * (bar < 0.15 ? Math.sin((Math.PI / 2) * (bar / 0.15)) : hit(bar - 0.15, 2.4)) }; // a soft sigh, not a flinch
      case "shadow": return { ...REST, k: 1 - 0.04 * att(ph, A, 12), jit: 1.5 };
      default: return { ...REST, k: 1 + 0.03 * kick };
    }
  }
  if (lens === "tempo") {
    const n = tempoPerBar(gid, tune.bpm); if (!n) return REST;
    const d = Math.abs(Math.log2(n / 4)), amp = d === 0 ? 0.06 : d === 1 ? 0.04 : 0.028;
    return { ...REST, k: 1 + amp * att(frac(bar * n), (A * n) / 4, 6) };
  }
  if (lens === "key") {
    const d = tune.key ? wheel(+gid, tune.key) : 6;
    if (d <= 1) return { ...REST, k: 1 + (d ? 0.04 : 0.06) * kick }; // mixes with it: in step
    if (d === 2) return { ...REST, k: 1 + 0.03 * off };                // a stretch: answers on the off-beat
    return REST;                                                        // clashes: holds still
  }
  const v = Math.max(0, Math.min(1, gi / 4));
  if (lens === "bright") return { ...REST, k: 1 + 0.06 * (1 - v) * att(ph, A, 3) * acc + 0.045 * v * hat, tw: v * hat };
  if (lens === "busy") { // pulse rate = density; the busiest caps near 8 Hz on fast tunes
    const per = [0.25, 0.5, 1, 2, tune.bpm > 120 ? 3 : 4][Math.round(v * 4)];
    return { ...REST, k: 1 + 0.05 * att(frac(pos * per), A * per, 6) };
  }
  if (lens === "width") { const e = att(ph, A, 4) * acc, j = Math.round(v * 4); return { ...REST, spread: [-0.015, -0.008, 0.01, 0.025, 0.045][j] * e, open: [-0.25, -0.1, 0.15, 0.45, 0.9][j] * e }; }
  return { ...REST, k: 1 + 0.03 * kick };
}

// Tufts: the tracks at the end of an arm ride on springy stalks from its tip (the style node), so they carry
// momentum instead of moving rigidly with the arm. Per group, a damped spring chases the arm's radial scale k and
// sway da. The arm thrusts out: the tuft lags and bunches. The arm stops: the tuft flies on and its stalks stretch,
// so the balls space out (spread > 0: rows apart about the band's middle, columns apart about the stalk), then the
// spring pulls them back. Swinging through a sway fans them too. The spring is tuned to the tempo (its overshoot
// lands on the 16th after the beat at any bpm) and to the group's meaning (tuftOf): fired up snaps, joyful rings,
// sad drags and never bounces, tense quivers. Fixed 4 ms substeps keep it the same at 30, 60 or 120 fps.
export const TUFT = Object.freeze({ hz: 2.2, zeta: 0.32, gain: 14 });
const FEEL_TUFT = { drive: [1.3, 0.6], lift: [1, 0.25], play: [1.6, 0.2], groove: [0.8, 0.4], calm: [0.5, 0.8], wonder: [0.4, 0.6], sad: [0.5, 1], shadow: [2.5, 0.1] };
export function tuftOf(lens, gid, gi, bpm) {
  const base = Math.min(3.6, Math.max(1.2, (1.32 * (bpm > 0 ? bpm : 100)) / 60));
  if (!lens || lens === "feel") { const [F, z] = FEEL_TUFT[gid] ?? [1, TUFT.zeta]; return { hz: base * F, zeta: z }; }
  if (lens === "bright") { const v = Math.max(0, Math.min(1, gi / 4)); return { hz: base * (0.7 + 1.8 * v), zeta: 0.45 - 0.3 * v }; }
  return { hz: base, zeta: TUFT.zeta };
}
export function tuft(s, k, da, dt, hz = TUFT.hz, zeta = TUFT.zeta) {
  if (!s) return { y: k, v: 0, a: da, va: 0, spread: 0 };
  const w = TAU * hz, c = 2 * zeta * w, t = Math.min(Math.max(dt, 0), 0.1), n = Math.ceil(t / 0.004), h = n ? t / n : 0;
  for (let j = 0; j < n; j++) { // semi-implicit Euler: stable for w*h < 2 (here <= 0.25)
    s.v += (w * w * (k - s.y) - c * s.v) * h; s.y += s.v * h;
    s.va += (w * w * (da - s.a) - c * s.va) * h; s.a += s.va * h;
  }
  const e = TUFT.gain * (s.y - k); // stalks are cords: they stretch freely but barely push, so bunching is half as strong
  s.spread = Math.max(-0.3, Math.min(1, (e < 0 ? e / 2 : e) + 6 * Math.abs(s.a - da)));
  return s;
}

// Stable per-dot seed in [0,1) from a track id.
export function seedOf(id) { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; }
