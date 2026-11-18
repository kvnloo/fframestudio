// The Stage: sing over a song (karaoke), then keep going and make it yours (a cappella studio).
// One surface, one clock: the song's layers loop over a section of N bars, every take you sing lands
// in one of five a cappella parts (lead, two harmonies, bass, beatbox) and lines up on the grid, and the
// song layer that part replaces fades to a ghost. Sing all five and the song is entirely your voice.
// Opened from the player's mic; loaded on demand so Listen never pays for it. Pure math: studio.js.
import { ROLES, roleById, GHOST, contour, parseKey, estimateKey, inKey, snapNote, noteName, placeTake, renderClip, harmonize, tune, mixdown, wav, yin, midiOf } from "./studio.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LAYER_NAMES = { drums: "Drums", bass: "Bass", other: "Synths & pads", guitar: "Guitar", piano: "Keys", vocals: "Voice", mix: "Whole song" };
const BARS = [4, 8, 16, 32];
const org = (r) => `${Math.round(r.left + r.width / 2)}px ${Math.round(r.top + r.height / 2)}px`; // the stage grows out of the mic
const HOP = 0.025; // contour hop (s)

let S = null; // the open stage
export const stageOpen = () => !!S;

// H = { track|null, audio, streamUrl(t), stems|null ({stems:[{k,f}]}), stemUrl(f), bpm, down, key, dur, toast, haptic, from: DOMRect }
export async function openStage(H) {
  if (S) return;
  H.audio?.pause();
  const ctx = new AudioContext({ latencyHint: "interactive" }), sr = ctx.sampleRate;
  const bpm = H.bpm || 92, beat = 60 / bpm, bar = beat * 4, down = H.down ?? 0;
  const saved = await load(H.track?.id ?? "blank");
  const at = H.audio && H.track ? H.audio.currentTime : 0;
  const start = saved?.start ?? Math.max(0, down + Math.max(0, Math.floor((at - down) / bar)) * bar);
  S = { H, ctx, sr, bpm, beat, bar, start, bars: saved?.bars ?? 8, key: parseKey(saved?.key ?? H.key), keyGuessed: !H.key && !saved?.key,
    layers: [], voices: Object.fromEntries(ROLES.map((r) => [r.id, { role: r, clip: null, raw: null, prev: null, auto: false, tuned: false, mute: false, c: null }])),
    sel: "lead", playing: false, t0: 0, srcs: [], gains: new Map(), master: ctx.createGain(), click: true, mic: null, rec: null, live: [], raf: 0, busy: "" };
  S.master.connect(ctx.destination);
  if (saved) for (const [id, v] of Object.entries(saved.voices ?? {})) if (S.voices[id]) Object.assign(S.voices[id], v, { c: v.clip ? contour(v.clip.pcm, sr, HOP) : null });
  build(); history.pushState({ stage: 1 }, ""); addEventListener("popstate", onPop);
  await loadLayers();
}
const onPop = () => close(true);
export function close(fromPop = false) {
  if (!S) return;
  stop(); S.mic?.stream.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(S.raf); clearInterval(S.tick);
  const el = $("#stage"), r = S.H.from; removeEventListener("popstate", onPop); if (!fromPop) history.back();
  const ctx = S.ctx; S = null; ctx.close();
  if (r && !matchMedia("(prefers-reduced-motion: reduce)").matches) el.animate([{ clipPath: `circle(150% at ${org(r)})` }, { clipPath: `circle(18px at ${org(r)})`, opacity: 0.2 }], { duration: 320, easing: "cubic-bezier(.4,0,.2,1)" }).finished.then(() => el.remove());
  else el.remove();
}

// --- section, layers -----------------------------------------------------------------------------------
const secLen = () => Math.min(S.bars * S.bar, Math.max(S.bar, (S.H.dur || Infinity) - S.start));
const N = () => Math.round(secLen() * S.sr);
async function loadLayers() {
  const { H } = S, want = H.stems?.stems?.map((s) => ({ k: s.k, url: H.stemUrl(s.f) })) ?? (H.track ? [{ k: "mix", url: H.streamUrl(H.track) }] : []);
  S.layers = want.map((w) => ({ k: w.k, pcm: null, mute: false, c: null }));
  paint();
  let n = 0;
  for (const [i, w] of want.entries()) {
    if (!S) return;
    S.busy = `Loading song layers ${++n}/${want.length}`; paintStatus();
    try {
      const buf = await S.ctx.decodeAudioData(await (await fetch(w.url)).arrayBuffer()), a = Math.round(S.start * buf.sampleRate), len = N(), pcm = new Float32Array(len);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let j = 0; j < len && a + j < d.length; j++) pcm[j] += d[a + j] / buf.numberOfChannels; }
      if (!S) return; S.layers[i].pcm = pcm;
      if (w.k === "vocals") S.layers[i].c = contour(pcm, S.sr, HOP); // the song's melody: the karaoke guide
    } catch (e) { console.warn("[stage] layer failed", w.k, e); if (S) S.layers[i].fail = true; }
  }
  if (!S) return;
  if (!S.layers.some((l) => l.pcm)) S.click = true;
  S.busy = S.layers.length && !S.layers.some((l) => l.pcm) ? "This song can't load here: sing to a click instead" : ""; paint();
}

// --- playback ---------------------------------------------------------------------------------------------
// The song's own voice starts as a quiet guide (karaoke): its melody is drawn on the ribbon instead.
const ghosted = (k) => k === "vocals" || ROLES.some((r) => r.replaces.includes(k) && S.voices[r.id].clip && !S.voices[r.id].mute);
const layerGain = (l) => (l.mute ? 0 : ghosted(l.k) ? GHOST : 1);
const pos = () => (S.playing ? (((S.ctx.currentTime - S.t0) % secLen()) + secLen()) % secLen() : S.pausedAt ?? 0);
function lanes() {
  const out = S.layers.filter((l) => l.pcm).map((l) => ({ id: "l:" + l.k, pcm: l.pcm, gain: layerGain(l) }));
  for (const v of Object.values(S.voices)) if (v.clip) out.push({ id: "v:" + v.role.id, pcm: (v.buf ??= renderClip(v.clip, N(), S.sr)), gain: v.mute ? 0 : v.auto ? 0.7 : 1 });
  return out;
}
function play(from = pos(), lead = 0.06) {
  stop(true); const { ctx } = S, T = ctx.currentTime + lead;
  S.t0 = T - from; S.playing = true;
  for (const L of lanes()) {
    const b = ctx.createBuffer(1, N(), S.sr); b.copyToChannel(L.pcm.subarray(0, N()), 0);
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = b; src.loop = true; g.gain.value = L.gain;
    src.connect(g).connect(S.master); src.start(T, from); S.srcs.push(src); S.gains.set(L.id, g);
  }
  S.nextClick = Math.ceil((ctx.currentTime - S.t0) / S.beat - 1e-6); clearInterval(S.tick); S.tick = setInterval(clicks, 40); clicks();
  paint();
}
function stop(keep = false) {
  if (!S) return; if (S.playing) S.pausedAt = pos();
  for (const s of S.srcs) try { s.stop(); } catch {}
  S.srcs = []; S.gains.clear(); S.playing = false; clearInterval(S.tick);
  if (!keep) { if (S.rec) endTake(); paint(); }
}
const regain = () => { for (const L of lanes()) S.gains.get(L.id)?.gain.setTargetAtTime(L.gain, S.ctx.currentTime, 0.05); };
// Metronome: on while there is nothing to play against, during a count-in, or by choice.
function clicks() {
  const { ctx } = S, horizon = ctx.currentTime + 0.2;
  while (S.t0 + S.nextClick * S.beat < horizon) {
    const n = S.nextClick++, t = S.t0 + n * S.beat; if (t < ctx.currentTime - 0.01) continue;
    const pre = n < 0, inSec = (((n % (S.bars * 4)) + S.bars * 4) % (S.bars * 4));
    if (!(S.click || pre)) continue;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = inSec % 4 === 0 ? 1568 : 1046;
    g.gain.setValueAtTime(pre ? 0.5 : 0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.06);
  }
}

// --- the mic: live pitch always, a take while recording ----------------------------------------------------------
const WORKLET = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=(e)=>{this.on=e.data}}process(i){const c=i[0]&&i[0][0];if(this.on&&c)this.port.postMessage({t:currentTime,d:c.slice(0)});return true}}registerProcessor("sa-rec",R)`;
async function mic() {
  if (S.mic) return S.mic;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const { ctx } = S, src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
  const node = new AudioWorkletNode(ctx, "sa-rec"), sink = ctx.createGain(); sink.gain.value = 0; src.connect(node).connect(sink).connect(ctx.destination);
  node.port.onmessage = (e) => S?.rec?.chunks.push(e.data);
  const inLat = stream.getAudioTracks()[0].getSettings().latency ?? 0.01;
  return (S.mic = { stream, an, node, buf: new Float32Array(2048), inLat });
}
const latency = () => (S.ctx.outputLatency || S.ctx.baseLatency || 0) + (S.mic?.inLat ?? 0);
async function record() {
  if (S.rec) return endTake();
  try { await mic(); } catch { return S.H.toast?.("The mic is blocked: allow it in the browser to sing"); }
  S.H.haptic?.("press");
  if (!S.playing) play(0, S.bar + 0.05); // a bar of count-in clicks, then the section from the top
  // A take is one pass of the section: from the pass it starts in (or the top, after a count-in) to its loop point.
  const k = Math.max(0, Math.floor((S.ctx.currentTime - S.t0) / secLen())), base = S.t0 + k * secLen();
  S.rec = { role: S.sel, chunks: [], base, end: base + secLen() };
  S.mic.node.port.postMessage(true); paint();
}
function endTake() {
  const R = S.rec; S.rec = null; S.mic.node.port.postMessage(false);
  if (!R.chunks.length) return paint();
  const L = R.chunks.reduce((n, c) => n + c.d.length, 0), pcm = new Float32Array(L); let p = 0; for (const c of R.chunks) { pcm.set(c.d, p); p += c.d.length; }
  let at = R.chunks[0].t - R.base - latency(); const len = secLen();
  const cut = at < 0 ? Math.round(-at * S.sr) : 0; at = Math.max(0, at); // singing during the count-in is a pickup; keep from the top
  const body = pcm.subarray(cut, cut + Math.round((len - at) * S.sr)); // a take ends where the section loops
  const v = S.voices[R.role], placed = placeTake(body, S.sr, at, { beat: S.beat, down: 0 }, { loop: v.role.loop });
  if (!placed) { S.H.toast?.("Didn't hear anything: sing closer to the mic"); return paint(); }
  v.prev = v.clip ? { clip: v.clip, raw: v.raw, auto: v.auto, tuned: v.tuned } : null;
  Object.assign(v, { clip: placed, raw: placed.pcm, auto: false, tuned: false, buf: null, c: contour(placed.pcm, S.sr, HOP) });
  if ((!S.key || S.keyGuessed) && R.role !== "beat") { const k = estimateKey(v.c); if (k) { S.key = k; S.keyGuessed = true; S.H.toast?.(`Sounds like ${k.name}`); } }
  const ms = Math.round(placed.nudge * 1000);
  S.H.toast?.(`${v.role.name} in${Math.abs(ms) > 8 ? ` · moved ${ms > 0 ? "+" : ""}${ms} ms onto the beat` : ""}${placed.loopLen ? ` · loops every ${Math.round(placed.loopLen / S.bar)} bar${placed.loopLen / S.bar > 1.5 ? "s" : ""}` : ""}`);
  // walk to the next empty part, the way a group stacks a song
  S.sel = ROLES.find((r) => !S.voices[r.id].clip)?.id ?? S.sel;
  save(); if (S.playing) play(); else paint();
}

// --- magic: harmonies from your lead, gentle tuning, undo ------------------------------------------------------
async function harmonies() {
  const lead = S.voices.lead; if (!lead.clip || !S.key) return;
  S.busy = "Writing harmonies in " + S.key.name; paintStatus(); await new Promise((r) => setTimeout(r, 30));
  for (const [id, steps] of [["hi", 2], ["mid", -3]]) { // a third above, a fourth below: the triad around the tune
    const v = S.voices[id]; if (v.clip && !v.auto) continue;
    const pcm = harmonize(lead.clip.pcm, S.sr, S.key, steps);
    Object.assign(v, { clip: { ...lead.clip, pcm }, raw: pcm, auto: true, tuned: false, buf: null, c: contour(pcm, S.sr, HOP) });
  }
  S.busy = ""; S.H.toast?.("Two harmonies under your lead · sing over either to replace it"); save(); S.playing ? play() : paint();
}
function toggleTune(id) {
  const v = S.voices[id]; if (!v.clip || !S.key) return;
  v.tuned = !v.tuned; const pcm = v.tuned ? tune(v.raw, S.sr, S.key) : v.raw;
  Object.assign(v, { clip: { ...v.clip, pcm }, buf: null, c: contour(pcm, S.sr, HOP) }); save(); S.playing ? play() : paint();
}
function undo(id) { const v = S.voices[id]; if (!v.prev) return; Object.assign(v, v.prev, { prev: null, buf: null, c: contour(v.prev.clip.pcm, S.sr, HOP) }); save(); S.playing ? play() : paint(); }
function clear(id) { const v = S.voices[id]; v.prev = v.clip ? { clip: v.clip, raw: v.raw, auto: v.auto, tuned: v.tuned } : null; Object.assign(v, { clip: null, raw: null, buf: null, c: null, auto: false }); save(); S.playing ? play() : paint(); }
function exportWav() {
  const mix = mixdown(lanes(), N()), url = URL.createObjectURL(new Blob([wav(mix, S.sr)], { type: "audio/wav" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${(S.H.track?.title ?? "my song").replace(/[^\w\- ]+/g, "")} - my version.wav` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  S.lastExport = mix; S.H.toast?.("Saved your mix as a WAV");
}
async function setBars(b) {
  if (b === S.bars) return; const was = S.playing; stop(); S.bars = b; S.pausedAt = 0;
  for (const v of Object.values(S.voices)) v.buf = null;
  save(); await loadLayers(); if (was && S) play(0);
}

// --- persistence (IndexedDB: a cover per song survives reloads) -------------------------------------------------
const idb = () => new Promise((res, rej) => { const r = indexedDB.open("sa-studio", 1); r.onupgradeneeded = () => r.result.createObjectStore("p"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function load(id) { try { const db = await idb(); return await new Promise((res) => { const g = db.transaction("p").objectStore("p").get(id); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null); }); } catch { return null; } }
async function save() {
  if (!S) return; const id = S.H.track?.id ?? "blank";
  const voices = Object.fromEntries(Object.entries(S.voices).filter(([, v]) => v.clip).map(([k, v]) => [k, { clip: v.clip, raw: v.raw, auto: v.auto, tuned: v.tuned, mute: v.mute }]));
  try { const db = await idb(); db.transaction("p", "readwrite").objectStore("p").put({ start: S.start, bars: S.bars, key: S.key?.name ?? null, voices, at: Date.now() }, id); } catch {}
}

// --- the surface ---------------------------------------------------------------------------------------------------
function build() {
  const el = document.createElement("section"); el.id = "stage"; el.className = "stage"; el.setAttribute("aria-label", "Sing and make your own version");
  const r = S.H.from;
  el.innerHTML = `<header class="st-top"><button class="ib st-x" data-a="close" aria-label="Back to listening"><svg viewBox="0 0 20 20"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div class="st-t"><b></b><small></small></div><button class="ib st-dl" data-a="export" aria-label="Save my mix as WAV"><svg viewBox="0 0 20 20"><path d="M10 3v9M6 8.5 10 12.5l4-4M4 15.5h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></header>
    <div class="st-ribbon"><canvas></canvas><div class="st-note" aria-live="off"></div><div class="st-count"></div></div>
    <div class="st-bars" role="radiogroup" aria-label="Section length"></div>
    <div class="st-body"></div>
    <footer class="st-dock"><button class="ib st-play" data-a="play" aria-label="Play"></button><button class="st-rec" data-a="rec"><i></i><span></span></button><button class="ib st-click" data-a="click" aria-label="Click track" aria-pressed="true"><svg viewBox="0 0 20 20"><path d="M7 17h6l-2-13H9zM10 10l5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></footer>`;
  document.body.append(el);
  if (r && !matchMedia("(prefers-reduced-motion: reduce)").matches) el.animate([{ clipPath: `circle(18px at ${org(r)})` }, { clipPath: `circle(150% at ${org(r)})` }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  el.addEventListener("click", onClick);
  S.raf = requestAnimationFrame(frame);
}
function onClick(e) {
  const b = e.target.closest("[data-a]"); if (!b || !S) return;
  const a = b.dataset.a, id = b.closest("[data-role]")?.dataset.role, k = b.closest("[data-layer]")?.dataset.layer;
  S.H.haptic?.("touch");
  if (a === "close") return close();
  if (a === "export") return exportWav();
  if (a === "play") return S.playing ? stop() : play();
  if (a === "rec") return record();
  if (a === "click") { S.click = !S.click; return paint(); }
  if (a === "bars") return setBars(+b.dataset.n);
  if (a === "sel") { S.sel = id; return paint(); }
  if (a === "harm") return harmonies();
  if (a === "tune") return toggleTune(id);
  if (a === "undo") return undo(id);
  if (a === "clear") return clear(id);
  if (a === "vmute") { S.voices[id].mute = !S.voices[id].mute; regain(); save(); return paint(); }
  if (a === "lmute") { const l = S.layers.find((x) => x.k === k); l.mute = !l.mute; regain(); return paint(); }
}
function paintStatus() { const s = $("#stage .st-t small"); if (s && S) s.textContent = S.busy || sub(); }
const sub = () => `${S.key ? S.key.name + (S.keyGuessed ? " (heard)" : "") : "key: sing to find it"} · ${Math.round(S.bpm)} bpm`;
function paint() {
  const el = $("#stage"); if (!el || !S) return;
  const t = S.H.track, sel = roleById[S.sel], done = ROLES.filter((r) => S.voices[r.id].clip && !S.voices[r.id].auto).length;
  $(".st-t b", el).textContent = t ? t.title : "A blank song"; paintStatus();
  $(".st-bars", el).innerHTML = BARS.map((n) => `<button role="radio" data-a="bars" data-n="${n}" aria-checked="${n === S.bars}">${n} bars</button>`).join("") + `<span title="parts sung by you">${done}/5 you</span>`;
  const play = $(".st-play", el); play.innerHTML = S.playing ? `<svg viewBox="0 0 20 20"><path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor"/></svg>` : `<svg viewBox="0 0 20 20"><path d="M6 4l10 6-10 6z" fill="currentColor"/></svg>`; play.setAttribute("aria-label", S.playing ? "Pause" : "Play");
  const rec = $(".st-rec", el); rec.classList.toggle("on", !!S.rec); rec.style.setProperty("--h", sel.hue); $("span", rec).textContent = S.rec ? "Stop" : `Sing ${sel.name.toLowerCase()}`;
  $(".st-click", el).setAttribute("aria-pressed", S.click);
  const voice = (r) => { const v = S.voices[r.id], state = v.clip ? (v.auto ? "✨ written for you · sing it to replace" : `your take${v.clip.loopLen ? ` · ${Math.round(v.clip.loopLen / S.bar)}-bar loop` : ""}${v.tuned ? " · tuned" : ""}`) : r.id === S.sel ? "next up · tap Sing" : `replaces ${r.replaces.map((k) => LAYER_NAMES[k]).join(" + ").toLowerCase()}`;
    return `<li class="st-v${r.id === S.sel ? " sel" : ""}${v.clip ? " has" : ""}${v.auto ? " auto" : ""}${v.mute ? " mute" : ""}" data-role="${r.id}" style="--h:${r.hue}"><button class="st-pick" data-a="sel" aria-pressed="${r.id === S.sel}"><i></i><b>${esc(r.name)}</b><small>${esc(state)}</small></button>
      ${r.id === "lead" && v.clip && S.key ? `<button class="st-chip" data-a="harm" title="Write two harmonies in key from your lead">✨ Harmonies</button>` : ""}
      ${v.clip && S.key ? `<button class="st-chip${v.tuned ? " on" : ""}" data-a="tune" aria-pressed="${v.tuned}" title="Pull notes onto the key">♪ Tune</button>` : ""}
      ${v.prev ? `<button class="st-chip" data-a="undo" title="Back to the last take">↶</button>` : ""}
      ${v.clip ? `<button class="st-chip" data-a="vmute" aria-pressed="${v.mute}">${v.mute ? "Muted" : "On"}</button><button class="st-chip" data-a="clear" aria-label="Delete this take">×</button>` : ""}</li>`; };
  const layer = (l) => `<li class="st-l${ghosted(l.k) ? " ghost" : ""}${l.mute ? " mute" : ""}${l.fail ? " fail" : ""}" data-layer="${l.k}"><b>${esc(LAYER_NAMES[l.k] ?? l.k)}</b><small>${l.fail ? "couldn't load" : !l.pcm ? "loading…" : l.k === "vocals" && !S.voices.lead.clip ? "quiet guide · its melody is on the ribbon" : ghosted(l.k) ? "ghost · your voice took over" : "inspiration"}</small><button class="st-chip" data-a="lmute" aria-pressed="${l.mute}">${l.mute ? "Off" : "On"}</button></li>`;
  $(".st-body", el).innerHTML = `<h4>Your voices</h4><ul class="st-list">${ROLES.map(voice).join("")}</ul>` +
    (S.layers.length ? `<h4>Song layers <small>fade as your parts replace them</small></h4><ul class="st-list">${S.layers.map(layer).join("")}</ul>` : `<p class="st-hint">No song underneath: sing a melody to a click and the key is found from what you sing.</p>`);
}

// The ribbon: pitch (up) over time (right), the song's grid behind, every part's melody running towards the
// now-line, and your voice drawn live. Notes in key glow in the part's colour; off-key notes stay grey.
function frame() {
  if (!S) return; S.raf = requestAnimationFrame(frame);
  const cv = $("#stage .st-ribbon canvas"); if (!cv) return;
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, Hh = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const now = pos(), span = 6, nowX = W * 0.32, X = (t) => nowX + ((t - now) / span) * W, len = secLen();
  // live pitch
  let live = NaN;
  if (S.mic) { S.mic.an.getFloatTimeDomainData(S.mic.buf); live = midiOf(yin(S.mic.buf, S.sr, { gate: 0.008 })); S.live.push({ t: performance.now(), m: live }); while (S.live.length && performance.now() - S.live[0].t > 2000) S.live.shift(); }
  const guides = [...Object.values(S.voices).filter((v) => v.c && !v.mute).map((v) => ({ c: v.c, at: v.clip.at, loop: v.clip.loopLen, hue: v.role.hue, a: v.auto ? 0.45 : 0.8 })), ...S.layers.filter((l) => l.c).map((l) => ({ c: l.c, at: 0, loop: 0, hue: "#ece8df", a: 0.35 }))];
  const ms = guides.flatMap((q) => q.c.filter(isFinite)); const mid = ms.length ? ms.sort((a, b) => a - b)[ms.length >> 1] : isFinite(live) ? live : 60;
  S.mid = (S.mid ?? mid) * 0.98 + mid * 0.02; const lo = S.mid - 12, Y = (m) => Hh - ((m - lo) / 24) * Hh;
  // key lines
  for (let m = Math.floor(lo); m <= lo + 24; m++) { const ik = S.key ? inKey(S.key, m) : m % 12 === 0, tonic = S.key && (((m - S.key.root) % 12) + 12) % 12 === 0; if (!ik) continue; g.fillStyle = tonic ? "rgba(236,232,223,.16)" : "rgba(236,232,223,.06)"; g.fillRect(0, Y(m) - 0.5, W, 1); if (tonic) { g.fillStyle = "rgba(236,232,223,.4)"; g.font = "10px 'IBM Plex Mono', monospace"; g.fillText(noteName(m), 4, Y(m) - 3); } }
  // beat lines (the section repeats)
  for (let b = Math.floor((now - nowX / W * span) / S.beat); b * S.beat < now + span; b++) { const t = b * S.beat, x = X(t), bi = ((b % (S.bars * 4)) + S.bars * 4) % (S.bars * 4); g.fillStyle = bi === 0 ? "rgba(255,179,92,.45)" : bi % 4 === 0 ? "rgba(236,232,223,.14)" : "rgba(236,232,223,.05)"; g.fillRect(x, 0, bi === 0 ? 2 : 1, Hh); }
  // guides: each part's melody (looped where the part loops), and the song's own vocal line
  for (const q of guides) {
    g.fillStyle = q.hue; g.globalAlpha = q.a;
    for (let t = now - nowX / W * span; t < now + span; t += HOP) {
      const st = ((t % len) + len) % len; let rel = st - q.at; if (q.loop) rel = ((rel % q.loop) + q.loop) % q.loop; const m = q.c[Math.round(rel / HOP)];
      if (rel >= 0 && isFinite(m)) g.fillRect(X(t), Y(m) - 1.5, 3, 3);
    }
  }
  g.globalAlpha = 1;
  // now line + your voice
  g.fillStyle = S.rec ? "rgba(255,90,90,.8)" : "rgba(236,232,223,.5)"; g.fillRect(nowX, 0, 1.5, Hh);
  const hue = roleById[S.sel].hue, t1 = performance.now();
  for (const p of S.live) if (isFinite(p.m)) { g.globalAlpha = 1 - (t1 - p.t) / 2000; g.fillStyle = S.key && inKey(S.key, p.m) && Math.abs(snapNote(S.key, p.m) - p.m) < 0.3 ? hue : "#8f8a80"; g.fillRect(nowX - ((t1 - p.t) / 1000 / span) * W, Y(p.m) - 2, 3, 4); }
  g.globalAlpha = 1;
  if (isFinite(live)) { g.fillStyle = hue; g.beginPath(); g.arc(nowX, Y(live), 6, 0, 7); g.fill(); }
  const note = $("#stage .st-note"); if (note) note.textContent = isFinite(live) ? noteName(live) : "";
  // count-in
  const ci = $("#stage .st-count"); if (ci) { const pre = S.playing && S.ctx.currentTime < S.t0 ? Math.ceil((S.t0 - S.ctx.currentTime) / S.beat) : 0; ci.textContent = pre ? String(pre) : ""; }
  if (S.rec && S.playing && S.ctx.currentTime >= S.rec.end + latency()) endTake(); // one pass of the section per take
}

// test hook (e2e drives the stage through this)
export const probe = () => S && { playing: S.playing, sel: S.sel, key: S.key?.name ?? null, bars: S.bars, layers: S.layers.map((l) => ({ k: l.k, ok: !!l.pcm, ghost: ghosted(l.k) })), voices: Object.fromEntries(Object.entries(S.voices).map(([k, v]) => [k, v.clip ? { at: v.clip.at, len: v.clip.pcm.length / S.sr, loop: v.clip.loopLen, auto: v.auto, tuned: v.tuned } : null])), rec: !!S.rec, busy: S.busy, sr: S.sr, exportPeak: S.lastExport ? S.lastExport.reduce((m, x) => Math.max(m, Math.abs(x)), 0) : null };
