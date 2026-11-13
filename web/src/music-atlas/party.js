// Listen together: every device in a room is one speaker of the same system. The room holds an
// anchor (song, position, playing, the server time of that position; tools/sound-atlas-api/party.js).
// Each device:
//  1. learns its offset to the server clock NTP style (best of several round trips, redone every 20 s),
//  2. works out where the song is "now" from the anchor, plus its own output latency (and a per-device
//     delay you can slide for Bluetooth speakers),
//  3. keeps its <audio> there: a jump when it is far off, otherwise a gentle playbackRate nudge
//     (pitch preserved) so corrections are inaudible. The approach is Beatsync's (freeman-jiang/beatsync),
//     on the app's existing player instead of a separate Web Audio graph.
// Anyone in the room can change the song, seek or pause; what you do becomes the room's anchor.
import { ROOM } from "./links.js";

const POLL_MS = 1000, TICK_MS = 200, JUMP = 0.25, DEAD = 0.008, MAXRATE = 0.06;
export const party = { on: false, room: null, peers: 0, st: null, seq: 0, by: null, off: 0, rtt: 0, lat: 0, err: [], nudge: +(localStorage.getItem("sa-nudge") ?? 0) || 0 };
let H = null, pollT = 0, tickT = 0, clockT = 0, endT = 0;
const lnow = () => performance.timeOrigin + performance.now();
const snow = () => lnow() + party.off; // server time, as this device estimates it
export const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b & 31]).join("");

async function api(op, body) {
  const r = await fetch(`/api/party?op=${op}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid: H.sid, room: party.room, ...body }) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `party ${r.status}`);
  return j;
}
// NTP style: offset = server - midpoint of the round trip; the shortest trip has the least asymmetry.
async function syncClock(n = 6) {
  let best = null;
  for (let i = 0; i < n; i++) {
    const t0 = lnow(); const j = await api("time").catch(() => null); const t1 = lnow();
    if (j && (!best || t1 - t0 < best.rtt)) best = { rtt: t1 - t0, off: j.now - (t0 + t1) / 2 };
  }
  if (best) { party.off = best.off; party.rtt = best.rtt; }
}
// How late sound leaves this device's speaker: AudioContext reports it (Bluetooth adds a lot).
let ctx = null;
function measureLatency() {
  try { ctx ??= new AudioContext(); party.lat = Math.min(0.5, (ctx.outputLatency || 0) + (ctx.baseLatency || 0)); } catch { party.lat = 0; }
}
const lead = () => party.lat + party.nudge / 1000; // seconds of output delay to play ahead by
// Where the room's song is at server time `s` (ms).
const want = (st, s) => (st.playing ? st.pos + (s - st.at) / 1000 : st.pos);

// --- following the room ------------------------------------------------------------------------------
function tick() {
  const st = party.st, a = H.audio; if (!party.on || !st) return;
  if (H.current() !== st.t) return H.apply(st); // a new song: the app loads it
  if (!st.playing) { if (!a.paused) a.pause(); if (Math.abs(a.currentTime - st.pos) > JUMP && a.readyState) seekTo(a, st.pos); a.playbackRate = 1; return; }
  const goal = want(st, snow() + lead() * 1000);
  if (a.duration && goal >= a.duration) return; // the room's song is over here too; `ended` moves on
  if (a.paused) { if (a.readyState) seekTo(a, goal); a.play().catch(() => H.blocked?.()); return; }
  if (a.readyState < 3) return;
  const err = a.currentTime - goal; // + : this speaker is ahead
  party.err.push(Math.abs(err)); if (party.err.length > 25) party.err.shift();
  if (Math.abs(err) > JUMP) { a.playbackRate = 1; seekTo(a, goal + 0.03); } // seeking takes a moment; land slightly ahead
  else a.playbackRate = Math.abs(err) < DEAD ? 1 : 1 - Math.max(-MAXRATE, Math.min(MAXRATE, err * 2)); // ~0.5 s to close the gap
}
// Typical error over the last ~5 s, in ms (shown in the room sheet).
export const drift = () => { const e = [...party.err].sort((x, y) => x - y); return e.length ? Math.round(e[e.length >> 1] * 1000) : null; };

async function poll() {
  clearTimeout(pollT); if (!party.on) return;
  try { take(await api("poll", { after: party.seq })); } catch {}
  pollT = setTimeout(poll, POLL_MS);
}
function take(j) {
  const before = party.peers; party.peers = j.peers;
  if (j.st && j.seq > party.seq && !pending) { party.seq = j.seq; party.st = j.st; party.by = j.by; clearTimeout(endT); tick(); }
  if (j.st || before !== party.peers) H.onChange();
}

// --- leading the room --------------------------------------------------------------------------------
// What you do (a new song, play, pause, a seek) becomes the room's anchor; what the room did doesn't echo back.
let mySeek = null; // where this device's own last correction seek was headed
const seekTo = (a, x) => { mySeek = x; a.currentTime = x; };
let chain = Promise.resolve(), pending = 0; // sets go out one at a time, in order
function announce(playing) {
  const a = H.audio, t = H.current(); if (!t) return;
  const st = { t, pos: a.currentTime || 0, playing, at: snow() };
  party.st = { ...st }; party.by = H.sid; pending++; // follow yourself at once
  chain = chain.then(() => api("set", { st })).then((j) => { party.seq = Math.max(party.seq, j.seq); party.peers = j.peers; H.onChange(); }, () => {}).finally(() => pending--);
}
// The app reports its audio events here: "play" | "pause" | "seeked" | "loadstart".
export function heard(kind) {
  if (!party.on) return;
  const st = party.st, a = H.audio, mine = st && H.current() === st.t;
  if (!mine) { // you picked another song: announce it playing, or (if it doesn't start) paused
    if (kind === "play") announce(true);
    if (kind === "loadstart") { const t = H.current(); setTimeout(() => { if (H.current() === t && party.st?.t !== t) announce(!a.paused); }, 600); }
    return;
  }
  if (kind === "play" && !st.playing) return announce(true);
  if (kind === "pause" && st.playing && !a.ended && !(a.duration && a.currentTime >= a.duration - 0.3)) return announce(false);
  if (kind === "seeked") { // your scrub moves the room; this device's own corrections don't
    const own = mySeek != null && Math.abs(a.currentTime - mySeek) < 0.15; mySeek = null;
    if (!own && Math.abs(a.currentTime - want(st, snow() + lead() * 1000)) > 0.6) return announce(!a.paused);
  }
}
// End of a song: whoever set it picks the next one; if they're gone, anyone does after 4 s.
export function onEnded(next) {
  if (!party.on) return next();
  const seq = party.seq;
  if (party.by === H.sid) return next();
  clearTimeout(endT); endT = setTimeout(() => { if (party.seq === seq) next(); }, 4000);
}

export function setNudge(ms) { party.nudge = ms; localStorage.setItem("sa-nudge", String(ms)); party.err.length = 0; }

// hooks: { sid, audio, current(), apply(st), onChange(), blocked() }
export async function join(room, hooks) {
  H = hooks; room = room.toLowerCase(); if (!ROOM.test(room)) throw new Error("room");
  if (party.on) leave(true);
  Object.assign(party, { on: true, room, seq: 0, st: null, by: null, peers: 1, err: [] });
  measureLatency(); // inside the tap that joined, so the AudioContext may start
  await syncClock();
  const j = await api("hello", {});
  if (j.st) take(j); else { party.peers = j.peers; if (H.current()) await announce(!H.audio.paused); } // an empty room starts with what you're playing
  clearInterval(tickT); tickT = setInterval(tick, TICK_MS);
  clearInterval(clockT); clockT = setInterval(() => { syncClock(4); measureLatency(); }, 20000);
  poll(); H.onChange();
  return party;
}
export function leave(quiet = false) {
  if (!party.on) return;
  navigator.sendBeacon?.("/api/party?op=bye", new Blob([JSON.stringify({ sid: H.sid, room: party.room })], { type: "application/json" }));
  clearTimeout(pollT); clearInterval(tickT); clearInterval(clockT); clearTimeout(endT);
  Object.assign(party, { on: false, room: null, st: null, seq: 0, peers: 0 });
  H.audio.playbackRate = 1; if (!quiet) H.onChange();
}
