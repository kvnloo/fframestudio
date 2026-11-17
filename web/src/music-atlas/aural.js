// Aural, inside Sound Atlas: the audiophile layer. A Web Audio port of Aural's engine
// (kvnloo/aural pretotypes/shared/engine.js), widened so every stage of the dotfiles chain is a knob:
//
//   input -> high-pass -> low-pass -> 5-band evolve EQ -> shelves -> tilt -> pre-gain -> level trim
//         -> mid/side -> space (dry | crossfeed | true-stereo BRIR room) -> compressor -> makeup -> out
//
// Soundscapes are the custom profiles in kvnloo/.files (config/camilladsp/*.sh, config/pipewire/*.conf)
// written as parameter sets for this graph. The graph is built only when someone turns it on (the hidden
// pane), because taking over the <audio> element is one-way: after createMediaElementSource every sample
// goes through the AudioContext, and cross-origin media must arrive with CORS (app.js proxies it).
//
// The pure parts (SPEC, SOUNDSCAPES, evolve rounds, combo keys) import cleanly in Node for tests.

// Every parameter, with its range: the pane draws one control per row, grouped.
export const SPEC = [
  // group, key, label, min, max, step, default, unit
  ["Evolve EQ", "bass", "Bass · 105 Hz shelf", -8, 8, 0.1, 0, "dB"],
  ["Evolve EQ", "body", "Body · 250 Hz", -8, 8, 0.1, 0, "dB"],
  ["Evolve EQ", "presence", "Presence · 2.8 kHz", -8, 8, 0.1, 0, "dB"],
  ["Evolve EQ", "clarity", "Clarity · 5.2 kHz", -8, 8, 0.1, 0, "dB"],
  ["Evolve EQ", "air", "Air · 10 kHz shelf", -8, 8, 0.1, 0, "dB"],
  ["Tone", "tilt", "Tilt (warm − / bright +)", -6, 6, 0.1, 0, "dB"],
  ["Tone", "lsF", "Low shelf freq", 20, 400, 1, 100, "Hz"],
  ["Tone", "lsG", "Low shelf gain", -12, 12, 0.1, 0, "dB"],
  ["Tone", "hsF", "High shelf freq", 2000, 18000, 10, 10000, "Hz"],
  ["Tone", "hsG", "High shelf gain", -12, 12, 0.1, 0, "dB"],
  ["Tone", "hpF", "High-pass", 10, 8000, 1, 10, "Hz"],
  ["Tone", "lpF", "Low-pass", 60, 20000, 10, 20000, "Hz"],
  ["Tone", "gain", "Pre-gain", -24, 12, 0.1, 0, "dB"],
  ["Tone", "match", "Level-match EQ (K-weighted)", 0, 1, 1, 1, ""],
  ["Image", "mid", "Mid (centre) level", 0, 1.5, 0.01, 1, "×"],
  ["Image", "side", "Side (width) level", 0, 2, 0.01, 1, "×"],
  ["Space", "dry", "Dry headphone stereo", 0, 1, 0.01, 1, "×"],
  ["Space", "xf", "Crossfeed (speakers)", 0, 1, 0.01, 0, "×"],
  ["Space", "xfDb", "Crossfeed level", -18, 0, 0.1, -7.5, "dB"],
  ["Space", "xfMs", "Crossfeed delay (Bauer 0.28 · Haas 1–15)", 0.05, 15, 0.01, 0.28, "ms"],
  ["Space", "xfLp", "Crossfeed low-pass", 200, 4000, 10, 700, "Hz"],
  ["Space", "room", "Room (BRIR) blend", 0, 1, 0.01, 0, "×"],
  ["Space", "ir", "Room (0 R02 · 1 R32, both ~0.2 s RT60)", 0, 1, 1, 0, ""],
  ["Dynamics", "ratio", "Compressor ratio (1 = off)", 1, 20, 0.1, 1, ":1"],
  ["Dynamics", "th", "Threshold", -60, 0, 0.5, -20, "dB"],
  ["Dynamics", "att", "Attack", 0.001, 0.5, 0.001, 0.01, "s"],
  ["Dynamics", "rel", "Release", 0.01, 2, 0.01, 0.3, "s"],
  ["Dynamics", "makeup", "Makeup", 0, 18, 0.1, 0, "dB"],
].map(([group, key, label, min, max, step, def, unit]) => ({ group, key, label, min, max, step, def, unit }));
export const DEFAULTS = Object.freeze(Object.fromEntries(SPEC.map((s) => [s.key, s.def])));
export const AXES = ["bass", "body", "presence", "clarity", "air"];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const normalize = (p = {}) => Object.fromEntries(SPEC.map((s) => [s.key, clamp(Number.isFinite(+p[s.key]) ? +p[s.key] : s.def, s.min, s.max)]));

// The dotfiles' soundscapes. `from` names the file each one comes from; `note` says what differs in a browser.
const ROOM = { dry: 0, xf: 0.9, room: 0.32 };
export const SOUNDSCAPES = [
  { id: "clean", name: "Clean", group: "Everyday", from: "pipewire.conf.d/10-headphone-dsp.conf (Clean sink)", desc: "Nothing added. The reference every other scape is heard against.", p: {} },
  { id: "evolved", name: "Evolved", group: "Everyday", from: "pipewire.conf.d/11-aural-evolution.conf (liked boot seed)", desc: "Your Aural Evolution favourite: +0.8 bass, +0.3 body, −0.2 presence.", p: { bass: 0.8, body: 0.3, presence: -0.2 } },
  { id: "speakers", name: "Speakers", group: "Everyday", from: "10-headphone-dsp.conf (bs2b crossfeed sink)", desc: "Bauer crossfeed: each ear hears the other channel 0.28 ms late through 700 Hz, like speakers in front of you.", p: { dry: 0, xf: 1 } },
  { id: "room", name: "Room", group: "Everyday", from: "camilladsp/camilladsp-room.yml · BRIR R02", desc: "Your R02 control room (measured RT60 ≈ 0.20 s) blended quietly over crossfeed.", note: "The real ASH BRIR is used when aural-local is connected; otherwise a synthetic room with the same RT60.", p: { ...ROOM } },
  { id: "room32", name: "Room R32", group: "Everyday", from: "camilladsp/coeffs/BRIR_R32_C1_True_Stereo.wav", desc: "The second true-stereo room in your coeffs: a different early-reflection pattern at the same ~0.21 s decay.", note: "Real BRIR with aural-local; synthetic stand-in otherwise.", p: { ...ROOM, ir: 1 } },
  { id: "movie", name: "Movie", group: "Everyday", from: "10-headphone-dsp.conf (Headphone DSP Movie sink) + pipewire-pulse.conf.d/30-plex-movie-dsp.conf", desc: "AutoEQ straight into a brick-wall limiter: full dynamics, nothing coloured, only the peaks caught.", note: "The 7.1/5.1 fold-down happens system-wide with aural-local; songs here are already stereo.", p: { ratio: 20, th: -1, att: 0.001, rel: 0.1 } },
  { id: "late-night", name: "Late night", group: "Experiences", from: "camilladsp/late-night-mode.sh", desc: "Fletcher-Munson loudness compensation for quiet listening: lows and highs lifted.", note: "CamillaDSP's Loudness filter follows the volume; here it is fixed at about −20 dB.", p: { lsF: 100, lsG: 6, hsF: 10000, hsG: 3 } },
  { id: "vinyl", name: "Vinyl", group: "Experiences", from: "camilladsp/the-vinyl-experience.sh", desc: "Worn-stylus roll-off above 15 kHz, turntable resonance under 100 Hz, warm tilt, rumble filter.", p: { lpF: 15000, lsF: 100, lsG: 2, tilt: -1.5, hpF: 20 } },
  { id: "warm", name: "Warm", group: "Experiences", from: "camilladsp/the-tilt-shifter.sh warm", desc: "−3 dB tilt across the band.", p: { tilt: -3 } },
  { id: "analytical", name: "Analytical", group: "Experiences", from: "camilladsp/the-tilt-shifter.sh analytical", desc: "+3 dB tilt: treble-forward detail.", p: { tilt: 3 } },
  { id: "haas", name: "Haas wide", group: "Experiences", from: "camilladsp/the-haas-widener.sh 8", desc: "Precedence effect: crossfeed delayed 8 ms at −4.5 dB widens the stage without changing tone.", p: { dry: 1, xf: 0.6, xfMs: 8, xfDb: -4.5 } },
  { id: "hall", name: "Concert hall", group: "Experiences", from: "camilladsp/concert-hall-teleporter.sh wdr", desc: "Teleporter venue at full wet blend.", p: { dry: 0, xf: 0.8, room: 0.7, gain: -3 } },
  { id: "mono-mid", name: "Mono truth · mid", group: "Ear training", from: "camilladsp/the-mono-truth.sh mid", desc: "Solo the centre: vocals, bass and kick.", p: { side: 0 } },
  { id: "mono-side", name: "Mono truth · side", group: "Ear training", from: "camilladsp/the-mono-truth.sh side", desc: "Solo the difference: reverb tails and panned parts.", p: { mid: 0, gain: 6 } },
  { id: "comp-gentle", name: "Compression · gentle", group: "Ear training", from: "camilladsp/the-compression-revealer.sh gentle", desc: "Your default bus compressor: 3:1 at −20 dB.", p: { ratio: 3, th: -20, att: 0.01, rel: 0.3, makeup: 3 } },
  { id: "comp-hyper", name: "Compression · loudness war", group: "Ear training", from: "camilladsp/the-compression-revealer.sh hyper", desc: "10:1 at −30 dB with +6 dB makeup: the loudness war, audible.", p: { ratio: 10, th: -30, att: 0.01, rel: 0.3, makeup: 6 } },
  ...[["sub", 20, 60], ["bass", 60, 250], ["lowmid", 250, 500], ["mid", 500, 2000], ["uppermid", 2000, 4000], ["presence", 4000, 8000], ["air", 8000, 20000]].map(([b, lo, hi]) => ({
    id: "spot-" + b, name: "Spotlight · " + b, group: "Frequency spotlight", from: `camilladsp/frequency-spotlight.sh ${b}`, desc: `Only ${lo}–${hi >= 20000 ? "20k" : hi} Hz, +6 dB.`, p: { hpF: Math.max(10, lo), lpF: Math.min(20000, hi), gain: 6, match: 0 },
  })),
].map((s) => ({ ...s, params: normalize({ ...DEFAULTS, ...s.p }) }));
export const scapeById = new Map(SOUNDSCAPES.map((s) => [s.id, s]));

// --- evolve ---------------------------------------------------------------------------------------
// Aural Evolution's round (config/pipewire/AURAL_EVOLUTION.md): level-matched variants around the
// current favourite, keep one, the search narrows. Variant 0 is always the unchanged centre (control).
export function variants(center, round = 0, rnd = Math.random, n = 4) {
  const c = normalize(center), step = Math.max(0.5, 2 * 0.8 ** round), out = [c];
  for (let tries = 0; out.length < n && tries < 200; tries++) {
    const v = { ...c };
    const axes = [...AXES].sort(() => rnd() - 0.5).slice(0, 2);
    for (const a of axes) v[a] = Math.round(clamp(c[a] + (rnd() < 0.5 ? -step : step), -6, 6) * 10) / 10;
    if (out.every((o) => Math.max(...AXES.map((a) => Math.abs(o[a] - v[a]))) >= 0.5)) out.push(v); // 0.5 dB minimum pair distance
  }
  return out;
}
// A filter-song combo, as the community counts it: the scape plus the evolve EQ rounded to 0.5 dB.
export const comboKey = (scape, p) => `${scape}|${AXES.map((a) => (Math.round((+p[a] || 0) * 2) / 2).toFixed(1)).join(",")}`;
export function parseCombo(key) {
  const [scape, eq = ""] = String(key).split("|"), v = eq.split(",").map(Number);
  if (!scapeById.has(scape) || v.length !== 5 || v.some((x) => !Number.isFinite(x))) return null;
  return { scape, eq: Object.fromEntries(AXES.map((a, i) => [a, v[i]])) };
}
export const describeEq = (p) => AXES.filter((a) => Math.abs(p[a]) >= 0.25).map((a) => `${p[a] > 0 ? "+" : ""}${(+p[a]).toFixed(1)} ${a}`).join(", ") || "flat EQ";

// --- the engine (browser only) ----------------------------------------------------------------------
const GRID = (() => { const a = new Float32Array(128); for (let i = 0; i < 128; i++) a[i] = 20 * 1000 ** (i / 127); return a; })();
const kWeight2 = (f) => { const hp = (f / 38) ** 4 / (1 + (f / 38) ** 4); return hp * 10 ** ((4 / (1 + (1500 / f) ** 2)) / 10); };
const db2 = (d) => 10 ** (d / 20);
const EQ_DEF = [["bass", "lowshelf", 105, 0.7], ["body", "peaking", 250, 0.7], ["presence", "peaking", 2800, 0.7], ["clarity", "peaking", 5200, 1], ["air", "highshelf", 10000, 0.7]];
// Rooms. The dotfiles' ASH true-stereo BRIRs (config/brir R02, R32) stay on your computer: with aural-local
// connected the engine convolves with the real files (GET /brir/0|1). Without it, a synthetic true-stereo
// room with the same RT60 stands in, so the public site ships no third-party impulse responses.
export const ROOMS = [{ name: "R02 · control room", rt60: 0.2, pre: 0.004, refl: [3.1, 4.6, 6.8, 9.5, 13.2] }, { name: "R32 · alt room", rt60: 0.21, pre: 0.001, refl: [2.4, 5.2, 7.9, 10.6, 14.8] }];
export function synthRoom(ctx, { rt60, pre, refl }, seed = 1) {
  const sr = ctx.sampleRate, n = Math.ceil(sr * Math.min(3, rt60 * 1.6 + 0.05)), b = ctx.createBuffer(4, n, sr);
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let ch = 0; ch < 4; ch++) {
    const d = b.getChannelData(ch), same = ch === 0 || ch === 3, itd = same ? 0 : Math.round(0.00025 * sr), k = 6.91 / (rt60 * sr);
    let lp = 0; // tail darkens with time: a one-pole low-pass whose cutoff falls as the energy decays
    for (let i = Math.round(pre * sr) + itd; i < n; i++) { const a = Math.min(0.9, 0.15 + i / (rt60 * sr)); lp += (1 - a) * (rnd() - lp); d[i] = lp * Math.exp(-k * i) * (same ? 0.5 : 0.38); }
    refl.forEach((ms, j) => { const i = Math.round((ms / 1000) * sr) + itd + (same ? 0 : j % 2); if (i < n) d[i] += (same ? 0.55 : 0.4) * 0.72 ** j * (j % 2 ? -1 : 1); });
  }
  return b;
}

export class AuralEngine {
  constructor(media) { this.media = media; this.p = { ...DEFAULTS }; this.ctx = null; this.on = false; this.irs = []; this.irBase = null; }
  // aural-local connected: swap the synthetic rooms for the real BRIRs it serves.
  useLocalRooms(base) { if (this.irBase === base) return; this.irBase = base; this.irs = []; const i = this.roomIr; this.roomIr = null; if (i != null) this.setRoom(i); }
  // Build the graph on the media element. Call inside a user gesture (AudioContext must start from one).
  async init() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext({ latencyHint: "playback" });
    const bq = (type, f, q = 0.707) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.src = ctx.createMediaElementSource(this.media);
    this.hp = bq("highpass", 10); this.lp = bq("lowpass", 20000);
    this.eq = EQ_DEF.map(([, t, f, q]) => bq(t, f, q));
    this.ls = bq("lowshelf", 100); this.hs = bq("highshelf", 10000);
    this.tl = bq("lowshelf", 630, 0.5); this.th = bq("highshelf", 630, 0.5);
    this.pre = ctx.createGain(); this.bypassG = ctx.createGain(); this.bypassG.gain.value = 0; this.wetIn = ctx.createGain();
    const chain = [this.hp, this.lp, ...this.eq, this.ls, this.hs, this.tl, this.th, this.pre];
    this.src.connect(this.wetIn); this.wetIn.connect(chain[0]); for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    // mid/side: M = (L+R)/2, S = (L-R)/2; L' = m*M + s*S, R' = m*M - s*S
    const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), g = (v) => { const x = ctx.createGain(); x.gain.value = v; return x; };
    this.pre.connect(sp);
    this.midG = g(1); this.sideG = g(1); const neg = g(-1);
    const lm = g(0.5), rm = g(0.5), ls = g(0.5), rs = g(-0.5);
    sp.connect(lm, 0); sp.connect(rm, 1); sp.connect(ls, 0); sp.connect(rs, 1);
    lm.connect(this.midG); rm.connect(this.midG); ls.connect(this.sideG); rs.connect(this.sideG);
    this.midG.connect(mg, 0, 0); this.midG.connect(mg, 0, 1); this.sideG.connect(mg, 0, 0); this.sideG.connect(neg).connect(mg, 0, 1);
    const img = this.img = mg;
    // space: dry + crossfeed + room, summed
    this.space = ctx.createGain(); this.dryG = g(1); this.xfG = g(0); this.roomG = g(0);
    img.connect(this.dryG).connect(this.space);
    const xs = ctx.createChannelSplitter(2), xm = ctx.createChannelMerger(2); img.connect(xs);
    this.xd = []; this.xl = []; this.xc = [];
    for (const [from, to] of [[0, 1], [1, 0]]) {
      const d = ctx.createDelay(0.02), lp = bq("lowpass", 700, 0.5), c = g(db2(-7.5)), direct = g(0.82);
      xs.connect(d, from); d.connect(lp).connect(c).connect(xm, 0, to); xs.connect(direct, to); direct.connect(xm, 0, to);
      this.xd.push(d); this.xl.push(lp); this.xc.push(c);
    }
    xm.connect(this.xfG).connect(this.space);
    this.rs = ctx.createChannelSplitter(2); this.rm = ctx.createChannelMerger(2); img.connect(this.rs); this.rm.connect(this.roomG).connect(this.space);
    this.comp = ctx.createDynamicsCompressor(); this.comp.knee.value = 6; this.makeup = g(1); this.out = g(1);
    this.space.connect(this.comp).connect(this.makeup).connect(this.out);
    this.src.connect(this.bypassG).connect(this.out); // A/B: bypass flips to the untouched signal, level-equal
    this.out.connect(ctx.destination);
    // measurements: per-channel spectra for the soundstage the atlas draws, and an output meter
    const ms = ctx.createChannelSplitter(2); this.out.connect(ms);
    const fa = () => { const a = ctx.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0.6; return a; };
    this.fL = fa(); this.fR = fa(); this.fS = fa(); ms.connect(this.fL, 0); ms.connect(this.fR, 1);
    const sl = g(0.5), sr = g(-0.5); ms.connect(sl, 0); ms.connect(sr, 1); sl.connect(this.fS); sr.connect(this.fS);
    this._spec = [0, 1, 2].map(() => new Float32Array(this.fL.frequencyBinCount));
    this._probe = [...EQ_DEF.map(([, t, f, q]) => bq(t, f, q)), bq("lowshelf", 100), bq("highshelf", 10000), bq("lowshelf", 630, 0.5), bq("highshelf", 630, 0.5)];
    this.on = true; this.apply(this.p, true);
  }
  async loadIr(i) {
    if (this.irs[i] || !this.ctx) return this.irs[i];
    let buf = null, real = false;
    if (this.irBase) try { buf = await fetch(`${this.irBase}/brir/${i}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((b) => this.ctx.decodeAudioData(b)); real = true; } catch { buf = null; }
    buf ??= synthRoom(this.ctx, ROOMS[i], i + 1);
    let e = 0; for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) e += v * v;
    return (this.irs[i] = { buf, real, norm: 1 / Math.sqrt(Math.max(e / 2, 1e-9)) });
  }
  async setRoom(i) {
    if (this.roomIr === i) return; this.roomIr = i;
    const ir = await this.loadIr(i); if (this.roomIr !== i || !ir) return;
    for (const c of this.convs ?? []) c.disconnect();
    const mono = (ch) => { const b = this.ctx.createBuffer(1, ir.buf.length, ir.buf.sampleRate); b.copyToChannel(ir.buf.getChannelData(Math.min(ch, ir.buf.numberOfChannels - 1)), 0); return b; };
    // true stereo: ch0 L->L, ch1 L->R, ch2 R->L, ch3 R->R (concert-hall-teleporter.sh channel order)
    this.convs = [[0, 0, 0], [0, 1, 1], [1, 0, 2], [1, 1, 3]].map(([inp, out, ch]) => { const c = this.ctx.createConvolver(); c.normalize = false; c.buffer = mono(ch); this.rs.connect(c, inp); c.connect(this.rm, 0, out); return c; });
    this.roomNorm = ir.norm; this.roomReal = ir.real; this.apply(this.p);
  }
  // Apply a full parameter set (missing keys keep their defaults).
  apply(p, instant = false) {
    this.p = normalize({ ...DEFAULTS, ...p }); if (!this.ctx) return this.p;
    const P = this.p, t = this.ctx.currentTime, tc = instant ? 0.001 : 0.05, set = (a, v) => a.setTargetAtTime(v, t, tc);
    set(this.hp.frequency, P.hpF); set(this.lp.frequency, Math.min(P.lpF, this.ctx.sampleRate / 2 - 100));
    EQ_DEF.forEach(([k], i) => set(this.eq[i].gain, P[k]));
    set(this.ls.frequency, P.lsF); set(this.ls.gain, P.lsG); set(this.hs.frequency, P.hsF); set(this.hs.gain, P.hsG);
    set(this.tl.gain, -P.tilt / 2); set(this.th.gain, P.tilt / 2);
    this.trimDb = P.match ? -this.loudnessDelta(P) : 0;
    set(this.pre.gain, db2(P.gain + this.trimDb));
    set(this.midG.gain, P.mid); set(this.sideG.gain, P.side);
    set(this.dryG.gain, P.dry); set(this.xfG.gain, P.xf);
    for (let i = 0; i < 2; i++) { set(this.xd[i].delayTime, P.xfMs / 1000); set(this.xl[i].frequency, P.xfLp); set(this.xc[i].gain, db2(P.xfDb)); }
    if (P.room > 0) this.setRoom(P.ir); set(this.roomG.gain, P.room * (this.roomNorm ?? 0));
    set(this.comp.ratio, P.ratio); set(this.comp.threshold, P.ratio > 1 ? P.th : 0); set(this.comp.attack, P.att); set(this.comp.release, P.rel);
    set(this.makeup.gain, db2(P.ratio > 1 ? P.makeup : 0));
    return P;
  }
  // Instant A/B against the untouched signal (what you hear without Aural).
  bypass(v) { if (!this.ctx) return; this.bypassed = !!v; const t = this.ctx.currentTime; this.wetIn.gain.setTargetAtTime(v ? 0 : 1, t, 0.01); this.bypassG.gain.setTargetAtTime(v ? 1 : 0, t, 0.01); }
  // K-weighted pink-noise loudness change of the tonal stages (dB), from their analytic responses.
  loudnessDelta(P) {
    if (!this.ctx) return 0;
    const mag = new Float32Array(GRID.length), ph = new Float32Array(GRID.length), sum = new Float32Array(GRID.length);
    const gains = [...EQ_DEF.map(([k]) => P[k]), P.lsG, P.hsG, -P.tilt / 2, P.tilt / 2], freqs = [...EQ_DEF.map(([, , f]) => f), P.lsF, P.hsF, 630, 630];
    this._probe.forEach((b, i) => { b.gain.value = gains[i]; b.frequency.value = freqs[i]; b.getFrequencyResponse(GRID, mag, ph); for (let k = 0; k < GRID.length; k++) sum[k] += 20 * Math.log10(mag[k]); });
    let num = 0, den = 0; for (let k = 0; k < GRID.length; k++) { const w = kWeight2(GRID[k]); num += w * 10 ** (sum[k] / 10); den += w; }
    return 10 * Math.log10(num / den);
  }
  // 24 log bands of what you are hearing: level, pan (−1 L .. +1 R) and diffuseness (side energy panning
  // alone cannot explain). The atlas draws these around the playing dot: Aural's soundstage, seen from above.
  field(nb = 24) {
    if (!this.ctx) return null;
    const [L, R, S] = this._spec; this.fL.getFloatFrequencyData(L); this.fR.getFloatFrequencyData(R); this.fS.getFloatFrequencyData(S);
    const hz = this.ctx.sampleRate / 2 / L.length, out = [];
    for (let b = 0; b < nb; b++) {
      const f0 = 40 * 400 ** (b / nb), f1 = 40 * 400 ** ((b + 1) / nb); let l = 0, r = 0, s = 0;
      for (let k = Math.max(1, Math.floor(f0 / hz)); k <= Math.ceil(f1 / hz) && k < L.length; k++) { l += 10 ** (L[k] / 10); r += 10 ** (R[k] / 10); s += 10 ** (S[k] / 10); }
      const al = Math.sqrt(l), ar = Math.sqrt(r), pan = (ar - al) / (ar + al + 1e-12), m = Math.sqrt(Math.max(1e-20, (l + r) / 2));
      out.push({ f: Math.sqrt(f0 * f1), db: 10 * Math.log10((l + r) / 2 + 1e-20), pan, diffuse: clamp(Math.sqrt(s) / m - Math.abs(pan), 0, 1) });
    }
    return out;
  }
}

// --- the opt-in local server (tools/aural-local) ----------------------------------------------------
// Nothing talks to it until the audiophile pane is opened and "This computer" is switched on.
export const LOCAL = "http://127.0.0.1:4317";
export async function local(path, body, { base = LOCAL, timeout = 1500 } = {}) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(base + path, body === undefined ? { signal: ac.signal } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `aural-local ${r.status}`); return j;
  } finally { clearTimeout(tm); }
}
