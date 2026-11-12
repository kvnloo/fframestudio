// The hidden audiophile pane. Type "aural" anywhere, open /#aural, or long-press the Sound Atlas logo.
// Nothing here loads, and no audio is rerouted, until someone opens it and turns the chain on.
//
// Tabs: Soundscapes (your dotfiles profiles) · Everything (every parameter of the graph) · Evolve (Aural
// Evolution rounds on the song you are hearing, pooled with everyone's) · This computer (the opt-in
// tools/aural-local server: PipeWire sinks, system-wide soundscapes, audio-evolve, cava spectrum).
import { SPEC, DEFAULTS, SOUNDSCAPES, scapeById, normalize, variants, comboKey, parseCombo, describeEq, AXES, AuralEngine, local, LOCAL } from "./aural.js";
import * as social from "./social.js";

const KEY = "sa-aural";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
export const prefs = Object.assign({ on: false, scape: "clean", p: { ...DEFAULTS }, follow: "mine", songs: {}, round: 0, server: false }, load());
const save = () => localStorage.setItem(KEY, JSON.stringify(prefs));

let host = null, engine = null, el = null, tab = "scapes", ev = null, srv = { up: false }, spectrum = null, sysBars = null;
export const wantsChain = () => !!prefs.on; // app.js: route media through the CORS-safe proxy

// app.js hands over what the pane needs: { audio, A, toast, track(), reroute() }.
export function attach(h) {
  host = h;
  // Left on: the AudioContext may only start after a gesture, so start on the first tap, key or play
  // (media keys and the lock screen arrive as "play"; by then the page has its user activation).
  // Touch pointerdown is not an activation, pointerup is. Never build the graph before activation: media
  // routed into a suspended context is muted.
  if (prefs.on) {
    const go = () => { if (engine?.ctx?.state === "running" || navigator.userActivation?.hasBeenActive === false) return; start().catch(() => {}); };
    for (const ev of ["pointerup", "click", "keydown"]) addEventListener(ev, go, { capture: true });
    h.audio.addEventListener("play", go);
  }
}
async function start() {
  if (!engine) { host.reroute(true); engine = new AuralEngine(host.audio); if (srv.up) engine.useLocalRooms(LOCAL); }
  if (!engine.ctx) await engine.init();
  await engine.ctx.resume(); if (engine.ctx.state !== "running") throw new Error("waiting for a tap");
  engine.apply(prefs.p);
  host.A.setStage(() => (sysBars ?? engine.field()));
  window.__aural = { engine, prefs };
}
function setOn(v) {
  prefs.on = v; save();
  if (v) start().then(() => { engine.bypass(false); render(); }, (e) => host.toast("Aural: " + e.message));
  else if (engine) { engine.bypass(true); host.A.setStage(null); }
}
function applyP(p, scape = prefs.scape) { prefs.p = normalize(p); prefs.scape = scape; save(); engine?.apply(prefs.p); }
function useScape(id) { const s = scapeById.get(id); if (!s) return; applyP({ ...s.params, ...pickEq(prefs.p) , ...pickEq(s.params, true) }, id); render(); if (prefs.server && srv.up && srv.scapes?.includes(id)) sys("/scape", { id }); }
// A soundscape keeps your evolved EQ unless it sets its own (evolved, spotlight, etc.).
const pickEq = (p, onlySet = false) => Object.fromEntries(AXES.filter((a) => !onlySet || p[a] !== 0).map((a) => [a, p[a]]));

// The song changed: bring back its combo (yours, or the community's best), as the follow setting says.
export async function onTrack(t) {
  if (!prefs.on || !t) return;
  ev = null;
  const mine = prefs.songs[t.id];
  if (prefs.follow === "mine" && mine) return applyP(mine.p, mine.scape), render();
  if (prefs.follow === "community") {
    try { const c = await social.combos(t.id), best = c.best[0] && parseCombo(c.best[0].combo); if (best && host.track()?.id === t.id) { applyP({ ...scapeById.get(best.scape).params, ...best.eq }, best.scape); host.toast(`Aural: community combo · ${scapeById.get(best.scape).name}`); } } catch {}
  }
  render();
}

export function open() {
  if (!el) {
    el = document.createElement("aside"); el.className = "aural"; el.setAttribute("aria-label", "Aural: audiophile settings");
    document.body.append(el);
    el.addEventListener("click", onClick); el.addEventListener("input", onInput);
    el.addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-ab]"); if (b && engine) { engine.bypass(true); b.classList.add("on"); } });
    const up = () => { if (engine && prefs.on) engine.bypass(false); el.querySelector("[data-ab].on")?.classList.remove("on"); };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }
  el.classList.add("open"); render();
}
export const close = () => el?.classList.remove("open");
export const isOpen = () => !!el?.classList.contains("open");
export const getEngine = () => engine; // tests and the canvas read the live chain

function render() {
  if (!el) return;
  const t = host.track(), s = scapeById.get(prefs.scape);
  const tabs = [["scapes", "Soundscapes"], ["all", "Everything"], ["evolve", "Evolve"], ["pc", "This computer"]];
  el.innerHTML = `<header><b>Aural</b><small>${prefs.on ? `${esc(s?.name ?? "Custom")} · ${engine?.ctx ? `${engine.ctx.sampleRate / 1000} kHz · ${Math.round(((engine.ctx.baseLatency || 0) + (engine.ctx.outputLatency || 0)) * 1000)} ms` : "starting…"}` : "off"}</small>
    <label class="sw"><input type="checkbox" data-power ${prefs.on ? "checked" : ""}><i></i></label><button data-close aria-label="Close">×</button></header>
    <nav>${tabs.map(([k, n]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${n}</button>`).join("")}</nav>
    <div class="ab-row"><button data-ab ${prefs.on ? "" : "disabled"}>Hold for the untouched signal</button></div>
    <div class="pane">${prefs.on || tab === "pc" ? { scapes, all, evolve, pc }[tab](t) : `<p class="hint">Aural runs the dotfiles DSP chain on this page's audio: EQ, tilt, crossfeed, rooms, mid/side and dynamics, level-matched. Turn it on to hear it; the map then draws the soundstage around the playing song.</p>`}</div>`;
}
function scapes() {
  const groups = [...new Set(SOUNDSCAPES.map((s) => s.group))], s = scapeById.get(prefs.scape);
  return groups.map((g) => `<h5>${g}</h5><div class="chips">${SOUNDSCAPES.filter((x) => x.group === g).map((x) => `<button data-scape="${x.id}" class="${x.id === prefs.scape ? "on" : ""}">${esc(x.name)}${srv.up && srv.scapes?.includes(x.id) ? `<i title="also runs system-wide">⌂</i>` : ""}</button>`).join("")}</div>`).join("")
    + (s ? `<p class="desc">${esc(s.desc)}${s.note ? ` <em>${esc(s.note)}</em>` : ""}<br><code>${esc(s.from)}</code></p>` : "");
}
function all() {
  let g0 = "";
  return SPEC.map((s) => { const v = prefs.p[s.key], h = s.group !== g0 ? `<h5>${(g0 = s.group)}</h5>` : ""; return `${h}<label class="knob"><span>${esc(s.label)}</span><input type="range" data-k="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}"><output>${fmt(v, s)}</output></label>`; }).join("")
    + `<div class="row"><button data-reset>Reset to ${esc(scapeById.get(prefs.scape)?.name ?? "Clean")}</button><button data-copy>Copy settings</button><button data-paste>Paste settings</button></div>`;
}
const fmt = (v, s) => (s.unit === "Hz" ? (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + " k" : Math.round(v) + " ") + "Hz" : s.unit === "" ? (s.max === 1 && s.min === 0 ? (v ? "on" : "off") : v) : `${+(+v).toFixed(2)} ${s.unit}`);
function evolve(t) {
  if (!t) return `<p class="hint">Play a song to evolve its sound.</p>`;
  if (!ev || ev.track !== t.id) ev = { track: t.id, list: variants(prefs.p, prefs.round), cur: 0, heard: new Set([0]), base: prefs.p };
  const mine = prefs.songs[t.id];
  return `<p class="hint">Round ${prefs.round + 1} on <b>${esc(t.title)}</b>. Four level-matched variants of ${esc(scapeById.get(prefs.scape)?.name ?? "this")}; 1 is the one you have now. Listen to each (keys 1–4), then keep the best. Every keep also counts toward the community's best combo for this song.</p>
    <div class="vars">${ev.list.map((v, i) => `<button data-var="${i}" class="${i === ev.cur ? "on" : ""} ${ev.heard.has(i) ? "heard" : ""}"><b>${i + 1}</b><small>${esc(describeEq(v))}</small></button>`).join("")}</div>
    <div class="row"><button data-keep class="primary">Keep ${ev.cur + 1}</button><button data-skip>None of these</button></div>
    ${mine ? `<p class="desc">Yours for this song: ${esc(scapeById.get(mine.scape)?.name)} · ${esc(describeEq(mine.p))}</p>` : ""}
    <h5>Follow per song</h5><div class="chips">${[["mine", "My combos"], ["community", "Community's best"], ["off", "Keep one sound"]].map(([k, n]) => `<button data-follow="${k}" class="${prefs.follow === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <h5>Community</h5><div class="comm" data-comm>Loading…</div>`;
}
async function fillCommunity(t) {
  const box = el?.querySelector("[data-comm]"); if (!box || !t) return;
  try {
    const c = await social.combos(t.id);
    box.innerHTML = (c.best.length ? c.best.map((b) => { const x = parseCombo(b.combo); return x ? `<button data-try="${esc(b.combo)}"><b>${esc(scapeById.get(x.scape).name)}</b> · ${esc(describeEq(x.eq))}<small>${b.keeps} kept of ${b.seen} heard</small></button>` : ""; }).join("") : `<p class="hint">Nobody has evolved this song yet. Your keep will be the first.</p>`)
      + (c.scapes.length ? `<p class="desc">Across all songs: ${c.scapes.map((s) => `${esc(scapeById.get(s.scape)?.name ?? s.scape)} ${s.keeps}`).join(" · ")}</p>` : "");
  } catch { box.innerHTML = `<p class="hint">Community evolution needs the deployed site (or tools/sound-atlas-serve.mjs with a database).</p>`; }
}
function pc() {
  const cmd = `node tools/aural-local/server.mjs`;
  if (!prefs.server) return `<p class="hint">Run Aural's backend on this computer to drive the real chain system-wide: PipeWire sinks, your AutoEQ + BRIR filter-chains, CamillaDSP experiences and Aural Evolution. It is a small local server you start yourself; it only listens on 127.0.0.1 and only answers this site.</p><pre>${esc(cmd)}</pre><div class="row"><button data-server class="primary">Connect to ${esc(LOCAL.replace("http://", ""))}</button></div>`;
  if (!srv.up) return `<p class="hint">${esc(srv.err ?? "Looking for aural-local…")}</p><pre>${esc(cmd)}</pre><div class="row"><button data-server>Try again</button><button data-unserver>Stop using it</button></div>`;
  const e = srv.evolve;
  return `<p class="desc">Connected · dotfiles <code>${esc(srv.caps?.dotfiles ?? "none")}</code> · CamillaDSP ${srv.camilla ? "running" : "not running"}${srv.caps?.cava ? " · cava" : ""}</p>
    <h5>Output</h5><div class="sinks">${(srv.sinks ?? []).map((s) => `<button data-sink="${esc(s.name)}" class="${s.default ? "on" : ""}"><b>${esc(s.desc)}</b><small>${esc([s.format, s.rate && s.rate / 1000 + " kHz", s.channels && s.channels + " ch"].filter(Boolean).join(" · "))}</small></button>`).join("")}</div>
    <h5>System-wide soundscapes</h5><div class="chips">${(srv.scapes ?? []).map((id) => `<button data-sys="${id}" class="${srv.active === id ? "on" : ""}">${esc(scapeById.get(id)?.name ?? id)}</button>`).join("") || `<span class="hint">None available.</span>`}</div>
    ${e ? `<h5>Aural Evolution · ${esc(e.device)} · ${esc(e.mode)} · gen ${e.generation}</h5><div class="chips">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-ev="select" data-arg="${n}" class="${e.active === n ? "on" : ""}">${n}</button>`).join("")}<button data-ev="favorite">★ keep</button><button data-ev="mode" data-arg="${e.mode === "room" ? "native" : "room"}">→ ${e.mode === "room" ? "native" : "room"}</button></div>` : ""}
    ${srv.caps?.cava ? `<h5>Map</h5><div class="chips"><button data-spec class="${spectrum ? "on" : ""}">Draw the computer's whole output (cava) on the map</button></div>` : ""}
    <div class="row"><button data-server>Refresh</button><button data-unserver>Disconnect</button></div>`;
}
async function connect() {
  prefs.server = true; save(); srv = { up: false }; render();
  try { const h = await local("/health"), s = await local("/state"); srv = { up: true, caps: h.caps, ...s }; engine?.useLocalRooms(LOCAL); }
  catch (e) { srv = { up: false, err: e.name === "AbortError" || /fetch/i.test(e.message) ? "aural-local is not running (or the browser blocked local access: allow it when asked)." : e.message }; }
  render();
}
async function sys(path, body) {
  try { const r = await local(path, body, { timeout: 25000 }); host.toast(r.via ? `This computer: ${r.via}` : "Done"); } catch (e) { host.toast(e.message); }
  connect();
}
function toggleSpectrum() {
  if (spectrum) { spectrum.close(); spectrum = null; sysBars = null; return render(); }
  spectrum = new EventSource(LOCAL + "/spectrum");
  spectrum.onmessage = (m) => { const b = JSON.parse(m.data), h = b.length / 2; // cava stereo: left mirrored, then right
    sysBars = Array.from({ length: h }, (_, i) => { const l = b[h - 1 - i], r = b[h + i]; return { db: -95 + 60 * Math.max(l, r), pan: (r - l) / (r + l + 1e-9), diffuse: 0.2 }; }); };
  host.A.setStage(() => sysBars ?? engine?.field()); render();
}

function onInput(e) {
  const k = e.target.dataset.k; if (!k) return;
  const s = SPEC.find((x) => x.key === k); applyP({ ...prefs.p, [k]: +e.target.value }, prefs.scape);
  e.target.nextElementSibling.textContent = fmt(prefs.p[k], s);
}
async function onClick(e) {
  const b = e.target.closest("button, input[data-power]"); if (!b) return;
  const d = b.dataset, t = host.track();
  if ("power" in d) return setOn(b.checked);
  if ("close" in d) return close();
  if (d.tab) { if (ev) { engine?.apply(prefs.p); ev = null; } tab = d.tab; render(); if (tab === "evolve") fillCommunity(t); if (tab === "pc" && prefs.server) connect(); return; }
  if (d.scape) return useScape(d.scape);
  if ("reset" in d) { applyP(scapeById.get(prefs.scape)?.params ?? DEFAULTS); return render(); }
  if ("copy" in d) { await navigator.clipboard?.writeText(JSON.stringify({ scape: prefs.scape, p: prefs.p })); return host.toast("Aural settings copied"); }
  if ("paste" in d) { try { const j = JSON.parse(await navigator.clipboard.readText()); applyP(j.p ?? j, scapeById.has(j.scape) ? j.scape : prefs.scape); render(); } catch { host.toast("Clipboard has no Aural settings"); } return; }
  if (d.var) { ev.cur = +d.var; ev.heard.add(ev.cur); engine?.apply(ev.list[ev.cur]); return render(); }
  if ("keep" in d || "skip" in d) {
    const kept = "keep" in d ? ev.list[ev.cur] : null, heard = [...ev.heard].map((i) => comboKey(prefs.scape, ev.list[i]));
    if (kept) { applyP(kept); prefs.songs[t.id] = { scape: prefs.scape, p: prefs.p }; prefs.round++; save(); } else engine?.apply(ev.base);
    social.evolved(t.id, heard, kept ? comboKey(prefs.scape, kept) : null).catch(() => {});
    ev = null; render(); fillCommunity(t); return host.toast(kept ? "Kept. Next round narrows in." : "Fresh variants");
  }
  if (d.follow) { prefs.follow = d.follow; save(); render(); return fillCommunity(t); }
  if (d.try) { const x = parseCombo(d.try); if (x) { applyP({ ...scapeById.get(x.scape).params, ...x.eq }, x.scape); ev = null; render(); fillCommunity(t); } return; }
  if ("server" in d) return connect();
  if ("unserver" in d) { prefs.server = false; save(); spectrum?.close(); spectrum = null; sysBars = null; srv = { up: false }; return render(); }
  if (d.sink) return sys("/sink", { name: d.sink });
  if (d.sys) return sys("/scape", { id: d.sys });
  if (d.ev) return sys("/evolve", { cmd: d.ev, arg: d.arg && /^\d$/.test(d.arg) ? +d.arg : d.arg });
  if ("spec" in d) return toggleSpectrum();
}
// 1–4 audition variants while the Evolve tab is open.
addEventListener("keydown", (e) => { if (!isOpen() || tab !== "evolve" || !ev || e.target.closest?.("input")) return; const n = +e.key; if (n >= 1 && n <= ev.list.length) { e.stopPropagation(); el.querySelector(`[data-var="${n - 1}"]`)?.click(); } }, true);
