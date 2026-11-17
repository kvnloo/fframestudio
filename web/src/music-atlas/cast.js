// Cast: play Sound Atlas on a TV from the phone. The TV opens the TV view (?tv=…#room=<code>) and
// follows a room on /api/social: the phone writes commands (song, position, play/pause), the TV
// plays them and reports where it is. Two ways onto the screen:
// - Samsung TV (Smart View): the Sound Atlas TV app (tools/sound-atlas-tv) shows its room code; the
//   phone pairs once (code or pairing link), then launches the app over the LAN on later casts.
// - Google Cast (Chromecast, Google TV, Nest Hub): the Cast SDK starts the DashCast receiver,
//   which loads the TV view with a fresh room.
// While casting, the phone keeps playing muted so its map, beat and scrubber stay in step.
// Sound is a separate choice from the screen (send.sound): "tv" plays it on the TV; "here" plays it on
// this device and mutes the TV, which keeps drawing the map in step (headphones on a laptop, the TV
// as the picture); "away" hands it to another device that opened the listen link (#castjoin=…).
// Every command carries mute/here/by, so the TV mutes itself and the other controllers yield.
// Like Chromecast, the TV plays on when the phone leaves Chrome: a hidden page sends nothing
// (Android pauses or freezes the muted copy; that is not the listener pausing), catches up with the
// TV on return, and a reopened or reloaded page takes control of the same TV again.

const ROOM = /^[a-z0-9]{6}$/;
const DASHCAST = "84912283", NS = "urn:x-cast:com.madmod.dashcast";
const params = new URLSearchParams(location.search);
export const tvKind = params.get("tv"); // "1" | "samsung" | "cast" | null
export const isTV = tvKind != null;
export const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b & 31]).join("");

async function api(op, body) {
  const r = await fetch(`/api/social?op=${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `cast ${r.status}`);
  return j;
}

// --- the TV ---------------------------------------------------------------------------------------
// Polls once a second with its state; applies each new command once. `ended` waits briefly for the
// phone's next pick (its queue rules), then plays on by itself so the TV never falls silent.
export function receive({ sid, audio, current, apply, next, onStatus }) {
  const room = (new URLSearchParams(location.hash.slice(1)).get("room") ?? params.get("room") ?? "").toLowerCase();
  const info = { name: params.get("name") || (tvKind === "cast" ? "Cast screen" : "TV"), ip: params.get("ip") || undefined, app: params.get("app") || undefined };
  let after = 0, last = 0, err = null, wait = 0;
  addEventListener("error", (e) => { err = String(e.message).slice(0, 160); });
  audio.addEventListener("ended", () => { const at = after; clearTimeout(wait); wait = setTimeout(() => { if (after === at) next(); }, 4000); });
  const hw = probe();
  const status = () => ({ ...info, t: current(), pos: Math.round(audio.currentTime * 10) / 10, playing: !audio.paused, err, hw });
  async function poll() {
    if (ROOM.test(room)) {
      try {
        const j = await api("tvpoll", { sid, room, after, tv: status() });
        if (j.cmd && j.cseq > after) { after = j.cseq; last = Date.now() - (j.cage ?? 0); clearTimeout(wait); apply(j.cmd, j.cage ?? 0); } // a relaunch picks up the room's last command: its age, not now, says if a phone is still there
        onStatus({ room, linked: Date.now() - last < 120_000 && after > 0, ok: true });
      } catch { onStatus({ room, linked: false, ok: false }); }
    } else onStatus({ room: null, linked: false, ok: false });
    setTimeout(poll, 1000);
  }
  poll();
  return room;
}

// What the screen really is, reported in the heartbeat so TV tuning rests on measurements:
// viewport and pixel ratio, refresh rate (median rAF interval), GPU (WebGL renderer), cores, memory.
export function probe() {
  const hw = { w: innerWidth, h: innerHeight, sw: screen.width, sh: screen.height, dpr: devicePixelRatio, cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory, ua: (navigator.userAgent.match(/Tizen [\d.]+|Chrome\/[\d.]+|\b\d{2,3}\.0\.\d{4}\.\d+/g) || []).slice(0, 2).join(" ") }; // Tizen UAs carry a bare Chromium version
  try {
    const gl = document.createElement("canvas").getContext("webgl"), x = gl && gl.getExtension("WEBGL_debug_renderer_info");
    hw.gl = gl ? String(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 80) : "none";
    hw.glmax = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
  } catch { hw.gl = "error"; }
  const d = []; let t0 = 0;
  const step = (t) => { if (t0) d.push(t - t0); t0 = t; if (d.length < 90) requestAnimationFrame(step); else { d.sort((a, b) => a - b); hw.hz = Math.round(1000 / d[45]); } };
  requestAnimationFrame(step);
  return hw;
}

// --- the phone ------------------------------------------------------------------------------------
export const send = { on: false, room: null, kind: null, name: "", tv: null, tage: 0, session: null, sound: "tv" };
const SOUNDS = new Set(["tv", "here", "away"]);
let hooks = null, sentAt = 0, quietUntil = 0, echo = null, sendT = 0, peekT = 0, seen = 0;
const snapshot = () => ({ t: hooks.current(), pos: Math.round(hooks.audio.currentTime * 10) / 10, playing: !hooks.audio.paused, mute: send.sound !== "tv", here: send.sound === "here", by: hooks.sid });
const hear = () => { const m = send.on && send.sound !== "here"; if (hooks.mute) hooks.mute("cast", m); else hooks.audio.muted = m; };
const save = () => localStorage.setItem(CAST_KEY, JSON.stringify({ room: send.room, kind: send.kind, name: send.name, sound: send.sound }));
// The device holding the sound keeps the room going from a background tab; the others go quiet when hidden.
const away = () => document.visibilityState === "hidden" && send.sound !== "here";
function push() {
  if (!send.on || away()) return;
  const s = snapshot(); // the phone copying the TV fires play/seek events too; only those are skipped
  if (Date.now() < quietUntil && echo && s.t === echo.t && s.playing === echo.playing) return;
  sentAt = Date.now(); clearTimeout(sendT); sendT = setTimeout(() => { if (away()) return; sentAt = Date.now(); api("cast", { sid: hooks.sid, room: send.room, cmd: snapshot() }).catch(() => {}); }, 120); }
export const quiet = (ms = 600) => { quietUntil = Date.now() + ms; };
function mirror(tv, tage, ms = 1500) { echo = { t: tv.t, playing: tv.playing }; quiet(ms); hooks.follow(tv, tage); }

// app hooks: { sid, audio, current, follow(tv, tage), toast, haptic, onChange() }
export function attach(h) {
  hooks = h;
  for (const ev of ["play", "pause", "seeked", "loadstart"]) h.audio.addEventListener(ev, push);
  // a pairing link (#tvpair=<room>~<ip>~<app>~<name>) remembers the TV, then drops out of the URL
  const hp = new URLSearchParams(location.hash.slice(1)), pr = hp.get("tvpair");
  if (pr) {
    const [room, ip, app, name] = pr.split("~");
    if (ROOM.test(room)) { saveTV({ room, ip, app, name: name || "Samsung TV" }); setTimeout(() => castSamsung(), 0); } // scanning the TV's code is the cast: no second tap
    hp.delete("tvpair"); history.replaceState(null, "", location.pathname + location.search + (hp.toString() ? "#" + hp : ""));
  }
  if (window.chrome && !isTV) setTimeout(loadCastSDK, 1500); // the Cast picker must open inside the tap, so the SDK loads ahead
  document.addEventListener("visibilitychange", () => {
    if (away()) clearTimeout(sendT);
    else if (send.on) peek(true); // back: the TV played on, so the phone follows it
  });
  resume();
}
// A page closed or reloaded mid-cast picks the TV back up if it is still playing that room.
const CAST_KEY = "sa-casting";
async function resume() {
  let c; try { c = JSON.parse(localStorage.getItem(CAST_KEY)); } catch {}
  if (!c || !ROOM.test(c.room ?? "")) return;
  const j = await api("castpeek", { sid: hooks.sid, room: c.room }).catch(() => null);
  if (!fresh(j)) return localStorage.removeItem(CAST_KEY);
  seen = j.cseq ?? 0; begin(c.room, c.kind, c.name, true, c.sound); mirror(j.tv, j.tage ?? 0, 2000);
}
// A listen link (#castjoin=<room>~<kind>~<name>) opened on another device: it asks first (the tap also
// unlocks audio), then joins the cast holding the sound, picks up the TV's song and position, and claims
// the sound so the phone that shared the link stays muted.
export function pendingJoin() {
  const hp = new URLSearchParams(location.hash.slice(1)), v = hp.get("castjoin");
  if (!v) return null;
  hp.delete("castjoin"); history.replaceState(null, "", location.pathname + location.search + (hp.toString() ? "#" + hp : ""));
  const [room, kind, name] = v.split("~");
  return ROOM.test(room ?? "") ? { room, kind: kind || "samsung", name: name || "the TV" } : null;
}
export async function join({ room, kind, name }) {
  hooks.toast(`Joining ${name}…`, 6000);
  const j = await api("castpeek", { sid: hooks.sid, room }).catch(() => null);
  if (!fresh(j)) return hooks.toast(`${name} isn't casting right now`, 4000);
  seen = j.cseq ?? 0; begin(room, kind, name, true, "here"); mirror(j.tv, j.tage ?? 0, 2500);
  setTimeout(() => { if (send.on && send.sound === "here") { sentAt = Date.now(); api("cast", { sid: hooks.sid, room, cmd: snapshot() }).catch(() => {}); } }, 2500);
}
export const joinHash = () => "#castjoin=" + [send.room, send.kind, send.name].map((x) => encodeURIComponent(x ?? "")).join("~");
export function setSound(s) {
  if (!send.on || !SOUNDS.has(s) || s === send.sound) return;
  send.sound = s; save(); hear(); quietUntil = 0;
  sentAt = Date.now(); clearTimeout(sendT); api("cast", { sid: hooks.sid, room: send.room, cmd: snapshot() }).catch(() => {});
  hooks.onChange(); hooks.toast(s === "tv" ? `Sound on ${send.name}` : s === "here" ? `Sound here · ${send.name} shows the map` : "Open the listen link on the device you'll hear it on", 3500);
}
const loadTV = () => { try { return JSON.parse(localStorage.getItem("sa-tv")); } catch { return null; } };
const saveTV = (tv) => localStorage.setItem("sa-tv", JSON.stringify(tv));
export const savedTV = loadTV;

function begin(room, kind, name, back = false, sound = "tv") {
  Object.assign(send, { on: true, room, kind, name, sound: SOUNDS.has(sound) ? sound : "tv" });
  save(); hear(); sentAt = 0; if (!back) push();
  clearInterval(peekT); peekT = setInterval(peek, 2500);
  hooks.onChange(); hooks.haptic("keep"); hooks.toast(back ? `Still playing on ${name}` : `Playing on ${name}`);
}
export function stop() {
  if (!send.on) return;
  const s = snapshot(); s.playing = false;
  api("cast", { sid: hooks.sid, room: send.room, cmd: s }).catch(() => {}); // the TV pauses where it was
  try { send.session?.endSession(true); } catch {}
  localStorage.removeItem(CAST_KEY);
  clearInterval(peekT); Object.assign(send, { on: false, room: null, kind: null, session: null, tv: null, sound: "tv" });
  hear(); hooks.onChange(); hooks.toast("Stopped casting");
}
async function peek(force = false) {
  if (!send.on || (away() && !force)) return;
  try {
    const j = await api("castpeek", { sid: hooks.sid, room: send.room });
    send.tv = j.tv; send.tage = j.tage ?? 1e9;
    const c = j.cmd;
    if (c?.by && c.by !== hooks.sid && (j.cseq ?? 0) > seen) { // another controller spoke: follow its sound choice
      seen = j.cseq; const was = send.sound;
      if (send.sound !== "here") send.sound = c.mute ? "away" : "tv";
      else if (c.here || c.mute === false) send.sound = c.here ? "away" : "tv"; // someone took the sound, or gave it back to the TV
      if (send.sound !== was) { save(); hear(); if (was === "here") hooks.toast(send.sound === "tv" ? `Sound back on ${send.name}` : "Sound moved to another device", 3500); }
    }
    if (send.sound === "here") { // this device is the clock: nudge the muted TV back in step instead of following it
      if (j.tv && send.tage < 5000 && Date.now() - sentAt > 3000 && drift(j.tv, send.tage) > 0.6) { sentAt = Date.now(); api("cast", { sid: hooks.sid, room: send.room, cmd: snapshot() }).catch(() => {}); }
    } else if (j.tv && send.tage < 5000 && (force || Date.now() - sentAt > 6000)) mirror(j.tv, send.tage); // the TV moved on by itself (song ended, its remote)
    hooks.onChange();
  } catch {}
}
function drift(tv, tage) {
  const a = hooks.audio;
  if (tv.t !== hooks.current() || tv.playing === a.paused) return Infinity;
  return Math.abs((tv.pos ?? 0) + (tv.playing ? tage / 1000 : 0) - a.currentTime);
}
const fresh = (j) => j?.tv && (j.tage ?? 1e9) < 4000;
async function waitFresh(room, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 1200))) {
    const j = await api("castpeek", { sid: hooks.sid, room }).catch(() => null); if (fresh(j)) return j;
  }
  return null;
}

// Samsung: launch the installed TV app over the LAN (Chrome asks once to reach local devices), then
// wait for its heartbeat in the paired room. Without a pairing yet, the TV shows a code to type.
export async function castSamsung() {
  let tv = loadTV();
  if (!tv?.room) {
    const code = (prompt("Open Sound Atlas on your Samsung TV (Apps), then type the code it shows:") ?? "").trim().toLowerCase().replace(/\s+/g, "");
    if (!code) return;
    if (!ROOM.test(code)) return hooks.toast("That code is 6 letters and numbers");
    tv = { room: code };
  }
  hooks.toast("Looking for your TV…", 8000);
  let j = await api("castpeek", { sid: hooks.sid, room: tv.room }).catch(() => null);
  if (!fresh(j) && tv.ip && tv.app) {
    try { await fetch(`http://${tv.ip}:8001/api/v2/applications/${encodeURIComponent(tv.app)}`, { method: "POST", mode: "no-cors", targetAddressSpace: "local" }); } catch {}
    hooks.toast(`Opening Sound Atlas on ${tv.name || "the TV"}…`, 20000);
    j = await waitFresh(tv.room, 25000);
  }
  if (!fresh(j)) return hooks.toast("The TV didn't answer. Open Sound Atlas on the TV, then tap Cast again", 6000);
  tv = { ...tv, ip: j.tv.ip ?? tv.ip, app: j.tv.app ?? tv.app, name: j.tv.name ?? tv.name ?? "Samsung TV" }; saveTV(tv);
  begin(tv.room, "samsung", tv.name);
}
export const forgetTV = () => localStorage.removeItem("sa-tv");

// Google Cast via DashCast (a public receiver that opens a URL), so no receiver registration is needed.
let sdk = null, sdkState = "idle"; // idle → loading → ready | none (no Cast in this browser: Chromium, Brave, headless)
export function loadCastSDK() {
  if (!sdk) sdkState = "loading";
  return (sdk ??= new Promise((ok) => {
    window.__onGCastApiAvailable = (a) => {
      if (a) cast.framework.CastContext.getInstance().setOptions({ receiverApplicationId: DASHCAST, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
      ok(!!a);
    };
    const s = Object.assign(document.createElement("script"), { src: "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1", onerror: () => ok(false) });
    document.head.append(s);
  }).then((a) => ((sdkState = a ? "ready" : "none"), a)));
}
export const castSDKReady = () => !!window.cast?.framework;
export const castSDKState = () => (castSDKReady() ? "ready" : sdkState);
export async function castGoogle() {
  const ctx = cast.framework.CastContext.getInstance();
  try { await ctx.requestSession(); } catch (e) { if (e !== "cancel") hooks.toast("No Cast screen picked"); return; } // opens the system picker; must run inside the tap
  const s = ctx.getCurrentSession(), name = s.getCastDevice().friendlyName || "Cast screen", room = rid();
  const url = new URL(location.pathname, location.href); url.search = `?tv=cast&name=${encodeURIComponent(name)}`; url.hash = "room=" + room;
  hooks.toast(`Opening Sound Atlas on ${name}…`, 20000);
  await s.sendMessage(NS, { url: url.href, force: true, reload: false, reload_time: 0 }).catch(() => {});
  if (!(await waitFresh(room, 30000))) { try { s.endSession(true); } catch {} return hooks.toast(`${name} didn't load Sound Atlas`, 5000); }
  send.session = s; begin(room, "cast", name);
}
