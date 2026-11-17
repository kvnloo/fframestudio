// The hidden audiophile pane. Type "aural" anywhere, open /#aural, or long-press the Sound Atlas logo.
// Nothing here loads, and no audio is rerouted, until someone opens it and turns the chain on.
//
// Tabs: Soundscapes (your dotfiles profiles) · Everything (every parameter of the graph) · Evolve (Aural
// Evolution rounds on the song you are hearing, pooled with everyone's) · This computer (the opt-in
// tools/aural-local server: PipeWire sinks, system-wide soundscapes, audio-evolve, cava spectrum).
import { SPEC, DEFAULTS, SOUNDSCAPES, scapeById, normalize, variants, comboKey, parseCombo, describeEq, AXES, AuralEngine, local, LOCAL } from "./aural.js";
import * as social from "./social.js";
import { renderSVG } from "./uqr.js";

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
  if (!engine) { host.reroute(true); engine = new AuralEngine(host.audio); if (srv.up) engine.useLocalRooms(srv.base); }
  if (!engine.ctx) await engine.init();
  await engine.ctx.resume(); if (engine.ctx.state !== "running") throw new Error("waiting for a tap");
  engine.apply(prefs.p);
  host.A.setStage(() => (sysBars ?? engine.field()));
  window.__aural = { engine, prefs };
}
function setOn(v) {
  prefs.on = v; save(); nat?.refresh(); // bit-perfect auto steps aside while the in-page chain is on
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
// Where aural-local answers: this computer (127.0.0.1), or the tailnet address a phone was given
// (https://<machine>.<tailnet>.ts.net:4317, published by the server through `tailscale serve`).
const TS = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net(:\d+)?$/i;
const call = (path, body, timeout = 4000) => local(path, body, { base: srv.base ?? prefs.base ?? LOCAL, timeout });
export function useServer(u) { // from #aural=<address> (the computer's phone code) or the address box
  u = String(u ?? "").trim().replace(/\/+$/, ""); if (!TS.test(u) && u !== LOCAL) return false;
  prefs.base = u === LOCAL ? null : u; tab = "pc"; connect(); return true;
}
const phoneHint = `<p class="hint"><b>On a phone?</b> Turn on Tailscale here, signed in to the same tailnet as the computer (on the same Wi‑Fi it goes direct; elsewhere it still works). Plain Wi‑Fi alone can't: browsers block local addresses from this https page. Then scan the code in the computer's Aural pane, or paste the address aural-local printed:</p>
    <div class="row addr"><input data-addr type="url" inputmode="url" placeholder="https://your-pc.tailnet.ts.net:4317" value="${esc(prefs.base ?? "")}" spellcheck="false" autocomplete="off"><button data-useaddr class="primary">Connect</button></div>`;
function phoneCode() { // shown on the computer: open the same site on the phone, pointed at this server
  if (!srv.tailnet || srv.base !== LOCAL) return "";
  const link = `${location.origin}${location.pathname}#aural=${encodeURIComponent(srv.tailnet)}`;
  return `<h5>On your phone</h5><p class="hint">With Tailscale on, scan this (or open the link) to drive this computer from the phone.</p><div class="pcode">${renderSVG(link, { border: 2, pixelSize: 5, whiteColor: "#ece8df", blackColor: "#0d1112" })}</div><pre>${esc(link)}</pre>`;
}
// --- one-command setup: the pane knows the OS, the installer (tools/aural-local/install.sh, served at
// /aural/install.sh) does the rest. Everything it installs is listed with a direct link to the file or package.
const LIVE = "https://glide-music-picker.vercel.app";
const DOTS = "https://github.com/kvnloo/.files/blob/dev/";
export function osKind(nav = navigator) { // "mac" | "linux" | "phone" | "windows" | "other"; Hyprland itself isn't visible to a page
  const ua = nav.userAgent ?? "", p = nav.userAgentData?.platform ?? nav.platform ?? "";
  if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(p + ua) && nav.maxTouchPoints > 1)) return "phone";
  if (/Mac/i.test(p) || /Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Win/i.test(p) || /Windows/i.test(ua)) return "windows";
  if (/Linux|X11|CrOS/i.test(p + ua)) return "linux";
  return "other";
}
export function installCmd(origin = location.origin) {
  const url = `${origin}/aural/install.sh`;
  return origin === LIVE ? `curl -fsSL ${url} | bash` : `curl -fsSL ${url} | AURAL_SITE=${origin} bash`;
}
const L = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
const df = (path, text = path.split("/").pop()) => L(DOTS + path, text);
export const PLAN = {
  linux: { title: "Linux · Hyprland or any PipeWire desktop", items: () => [
    ["Packages", `${L("https://pipewire.org", "PipeWire")} + ${L("https://pipewire.pages.freedesktop.org/wireplumber/", "WirePlumber")}, ${L("https://github.com/lsp-plugins/lsp-plugins", "LSP")} and ${L("https://github.com/zamaudio/zam-plugins", "ZAM")} LV2 plugins, ${L("https://github.com/alexmarsev/libbs2b", "bs2b")} LADSPA, ${L("https://github.com/karlstav/cava", "cava")}, Node.js (pacman, apt or dnf)`],
    ["Filter-chain sinks", `${df("config/pipewire/pipewire.conf.d/10-headphone-dsp.conf")} (Clean · Crossfeed · Room · Movie) and ${df("config/pipewire/pipewire.conf.d/11-aural-evolution.conf")}, with your ${df("config/autoeq/active_48000Hz.wav", "AutoEQ")} and ${df("config/brir/BRIR_R02_C1_True_Stereo.wav", "BRIR")} files`],
    ["Routing", `${df("config/pipewire/pipewire-pulse.conf.d/30-plex-movie-dsp.conf")}, ${df("config/pipewire/pipewire-pulse.conf.d/20-browser-bypass-brir.conf")} (Chrome to the Movie sink), ${df("config/wireplumber/wireplumber.conf.d/51-topping-dx5.conf")}`],
    ["Commands", `${df("scripts/audio-evolve")}, ${df("scripts/audio-sink")}, ${df("config/pipewire/headphone-switch.sh")} in ~/.local/bin`],
    ["Bit-perfect", `${df("config/pipewire/pipewire.conf")} (follows each song's rate, 44.1–768 kHz; realtime prio 88), realtime limits ${df("config/host/etc/security/limits.d/99-realtime-privileges.conf", "99-realtime")} · ${df("config/host/etc/security/limits.d/20-audio.conf", "20-audio")} · ${df("config/host/etc/security/limits.d/99-pipewire.conf", "99-pipewire")} and the groups, USB power management off (${df("config/host/etc/udev/rules.d/50-usb-low-latency.rules")}), ${L("https://mpv.io", "mpv")} as the native player`],
    ["Service", `aural-local as a systemd user service (${L("/aural/server.mjs", "server.mjs")}), published to your tailnet`],
  ] },
  mac: { title: "macOS", items: () => [
    ["Packages", `${L("https://brew.sh", "Homebrew")}: Node.js, ${L("https://github.com/deweller/switchaudio-osx", "SwitchAudioSource")}, ${L("https://github.com/karlstav/cava", "cava")}, ${L("https://github.com/ExistentialAudio/BlackHole", "BlackHole 2ch")}`],
    ["DSP engine", `${L("https://github.com/HEnquist/camilladsp/releases/tag/v4.1.3", "CamillaDSP 4.1.3")} + ${L("https://github.com/HEnquist/pycamilladsp", "pycamilladsp")}, playing to the output you use now`],
    ["Profiles", `${df("config/camilladsp/camilladsp.yml")} · ${df("config/camilladsp/camilladsp-crossfeed.yml", "crossfeed")} · ${df("config/camilladsp/camilladsp-room.yml", "room")}, ${df("config/camilladsp/headphone-switch.sh")} and every experience (${df("config/camilladsp/the-vinyl-experience.sh", "vinyl")}, ${df("config/camilladsp/late-night-mode.sh", "late night")}, ${df("config/camilladsp/concert-hall-teleporter.sh", "hall")}…)`],
    ["Bit-perfect", `${L("https://mpv.io", "mpv")} as the native player: CoreAudio exclusive (hog) mode on your DAC at each song's own rate, around BlackHole and CamillaDSP`],
    ["Services", `CamillaDSP and aural-local as LaunchAgents (${df("config/camilladsp/com.camilladsp.daemon.plist", "your plist")}, with this Mac's paths); system output set to BlackHole`],
  ] },
};
let poll = 0;
function waitForServer() { // after the command is copied: connect by itself once the installer has started aural-local
  clearInterval(poll); let n = 0;
  poll = setInterval(async () => {
    if (++n > 200 || !isOpen() || tab !== "pc" || srv.up) return clearInterval(poll);
    try { await local("/health", undefined, { timeout: 1500 }); clearInterval(poll); connect(); } catch { /* not yet */ }
  }, 3000);
}
function setup(kind = osKind()) {
  const plan = PLAN[kind];
  if (!plan) return kind === "phone" ? "" : `<p class="hint">One-command setup covers macOS and Linux with PipeWire${kind === "windows" ? "; on Windows, use the in-page chain (other tabs)" : ""}.</p>`;
  const cmd = installCmd();
  return `<h5>Set up this computer · ${esc(plan.title)}</h5>
    <p class="hint">One command installs the chain from your dotfiles, starts the services, and connects this pane. It asks for your password once (packages${kind === "mac" ? ", BlackHole" : ""}).</p>
    <pre data-cmd>${esc(cmd)}</pre>
    <div class="row"><button data-install class="primary">Copy · then paste in Terminal</button><a class="btn" href="/aural/install.sh" download="aural-install.sh">Download installer</a>${L("/aural/install.txt", "Read it first")}</div>
    <details class="plan"><summary>What it sets up</summary><ul>${plan.items().map(([k, v]) => `<li><b>${esc(k)}</b> ${v}</li>`).join("")}</ul>
    <p class="hint">Dotfiles: ${L("https://github.com/kvnloo/.files/tree/dev", "kvnloo/.files")} (uses ~/workspace/.files if you have it; otherwise a sparse clone of the audio parts). Re-running updates in place; replaced files are kept as .bak-aural-*.</p></details>`;
}
function pc() {
  const cmd = `node tools/aural-local/server.mjs`;
  if (!prefs.server) return `<p class="hint">Run Aural's backend on this computer to drive the real chain system-wide: PipeWire sinks or CamillaDSP, your AutoEQ + BRIR filters, the experiences and Aural Evolution. It only listens on 127.0.0.1; with Tailscale on, your own devices can reach it too.</p>${setup()}<div class="row"><button data-server>Already running? Connect</button></div>${phoneHint}`;
  if (!srv.up) return `<p class="hint">${esc(srv.err ?? "Looking for aural-local…")}</p>${setup()}<pre>${esc(cmd)}</pre><div class="row"><button data-server>Try again</button><button data-unserver>Stop using it</button></div>${phoneHint}`;
  const e = srv.evolve;
  return `<p class="desc">Connected${srv.base !== LOCAL ? ` over Tailscale (${esc(new URL(srv.base).hostname.split(".")[0])})` : ""} · dotfiles <code>${esc(srv.caps?.dotfiles ?? "none")}</code> · CamillaDSP ${srv.camilla ? "running" : "not running"}${srv.caps?.cava ? " · cava" : ""}</p>
    ${bitPerfectBox()}
    <h5>Output</h5><div class="sinks">${(srv.sinks ?? []).map((s) => `<button data-sink="${esc(s.name)}" class="${s.default ? "on" : ""}"><b>${esc(s.desc)}</b><small>${esc([s.format, s.rate && s.rate / 1000 + " kHz", s.channels && s.channels + " ch"].filter(Boolean).join(" · "))}</small></button>`).join("")}</div>
    <h5>System-wide soundscapes</h5><div class="chips">${(srv.scapes ?? []).map((id) => `<button data-sys="${id}" class="${srv.active === id ? "on" : ""}">${esc(scapeById.get(id)?.name ?? id)}</button>`).join("") || `<span class="hint">None available.</span>`}</div>
    ${e ? `<h5>Aural Evolution · ${esc(e.device)} · ${esc(e.mode)} · gen ${e.generation}</h5><div class="chips">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-ev="select" data-arg="${n}" class="${e.active === n ? "on" : ""}">${n}</button>`).join("")}<button data-ev="favorite">★ keep</button><button data-ev="mode" data-arg="${e.mode === "room" ? "native" : "room"}">→ ${e.mode === "room" ? "native" : "room"}</button></div>` : ""}
    ${srv.caps?.cava ? `<h5>Map</h5><div class="chips"><button data-spec class="${spectrum ? "on" : ""}">Draw the computer's whole output (cava) on the map</button></div>` : ""}
    <div class="row"><button data-server>Refresh</button><button data-unserver>Disconnect</button></div>${phoneCode()}`;
}
// Bit-perfect (native.js): this computer's player straight to the DAC, the page silent and following.
let nat = null; // the loaded native.js module
function bitPerfectBox() {
  if (!srv.caps?.native) return `<h5>Bit-perfect</h5><p class="hint">Needs mpv on this computer: run the setup command again (it installs mpv and the bit-perfect stack).</p>`;
  const mode = nat?.bp.mode ?? prefs.bitperfect ?? "auto", sum = nat?.summary() ?? { ok: false, text: "Starting…" };
  return `<h5>Bit-perfect</h5><div class="chips">${[["auto", "Auto"], ["on", "Always"], ["off", "Off"]].map(([k, n]) => `<button data-bp="${k}" class="${mode === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <p class="bpstat ${sum.ok ? "ok" : ""}" data-bpstat>${esc(sum.text)}</p>
    <p class="hint">Browsers resample everything to the output's rate. Bit-perfect plays the song with this computer's own player, straight to ${esc(nat?.bp.now?.target ?? "the DAC")} at the song's own rate, with no DSP and no volume change; the page plays along silently. Auto follows your system: on when the output is the DAC itself (<code>audio-sink bitperfect</code>), off on a DSP sink or while the in-page chain (top switch) is on.</p>`;
}
export function onNative() { // native.js status changed: update the line in place (a full render would steal focus)
  const box = el?.querySelector("[data-bpstat]"); if (!box || !nat) return;
  const s = nat.summary(); box.textContent = s.text; box.classList.toggle("ok", s.ok);
}
const loadNative = () => host.bitPerfect?.().then((m) => { nat = m; m.refresh(); return m; });

async function connect() {
  prefs.server = true; save(); srv = { up: false }; render();
  const base = prefs.base ?? LOCAL; // the address the phone was given, else this computer
  try { const h = await local("/health", undefined, { base, timeout: 4000 }), s = await local("/state", undefined, { base, timeout: 4000 });
    srv = { up: true, base, caps: h.caps, tailnet: h.tailnet, ...s }; engine?.useLocalRooms(base);
    if (h.caps?.native) loadNative();
  } catch (e) {
    const gone = e.name === "AbortError" || /fetch/i.test(e.message);
    srv = { up: false, err: !gone ? e.message : base !== LOCAL ? `Can't reach ${base}. Is Tailscale on here, and aural-local running on the computer?` : "aural-local is not running on this computer (or the browser blocked local access: allow it when asked)." };
  }
  render();
}
async function sys(path, body) {
  try { const r = await call(path, body, 25000); host.toast(r.via ? `This computer: ${r.via}` : "Done"); } catch (e) { host.toast(e.message); }
  connect();
}
function toggleSpectrum() {
  if (spectrum) { spectrum.close(); spectrum = null; sysBars = null; return render(); }
  spectrum = new EventSource(srv.base + "/spectrum");
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
  if ("install" in d) { const ok = await navigator.clipboard?.writeText(installCmd()).then(() => true, () => false); if (!ok) getSelection()?.selectAllChildren(el.querySelector("[data-cmd]")); host.toast(ok ? "Copied · paste it in Terminal; this pane connects when it's done" : "Select the command and copy it", 5000); prefs.server = true; save(); return waitForServer(); }
  if (d.bp) { (nat ? Promise.resolve(nat) : loadNative()).then((m) => { m?.setMode(d.bp); render(); }); prefs.bitperfect = d.bp; save(); return render(); }
  if ("server" in d) return connect();
  if ("unserver" in d) { prefs.server = false; prefs.base = null; save(); nat?.refresh(); engine?.useLocalRooms(null); spectrum?.close(); spectrum = null; sysBars = null; srv = { up: false }; return render(); }
  if (d.sink) return sys("/sink", { name: d.sink });
  if (d.sys) return sys("/scape", { id: d.sys });
  if (d.ev) return sys("/evolve", { cmd: d.ev, arg: d.arg && /^\d$/.test(d.arg) ? +d.arg : d.arg });
  if ("spec" in d) return toggleSpectrum();
  if ("useaddr" in d) { const v = el.querySelector("[data-addr]")?.value; if (!useServer(v)) host.toast("Paste the https://….ts.net:4317 address aural-local printed"); return; }
}
// 1–4 audition variants while the Evolve tab is open.
addEventListener("keydown", (e) => { if (!isOpen() || tab !== "evolve" || !ev || e.target.closest?.("input")) return; const n = +e.key; if (n >= 1 && n <= ev.list.length) { e.stopPropagation(); el.querySelector(`[data-var="${n - 1}"]`)?.click(); } }, true);
