// The tiny YouTube player, for imported songs the catalogue doesn't have. The app stays a music player first:
// the video is a 96×54 tile tucked above the player bar, and the bar's own ▶ / ⏮ ⏭ / scrub drive it.
//  - tap the tile: play / pause
//  - press and hold, or press harder (force touch / pen pressure): the tile grows to 320×180 and takes
//    touches, so YouTube's own controls work; tap outside it, or its ⤡, and it shrinks back.
// Loaded on demand (app.js dynamic import) the first time an imported song plays. youtube-nocookie keeps
// YouTube's cookies off until the video plays.
import { HOLD, SLOP, FORCE, haptic, pressRing } from "./gestures.js";

export const yt = { id: null, paused: true, time: 0, dur: 0, big: false };
let api = null, player = null, el = null, hooks = {}, poll = 0, want = null;

const loadApi = () => (api ??= new Promise((ok, no) => {
  if (window.YT?.Player) return ok(window.YT);
  const prev = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { prev?.(); ok(window.YT); };
  const s = Object.assign(document.createElement("script"), { src: "https://www.youtube.com/iframe_api", async: true });
  s.onerror = () => { api = null; no(new Error("YouTube didn't load here (a blocker?)")); }; document.head.append(s);
}));

// Where to look a song up: video ids, best first. Imported YouTube playlists already carry the id.
export async function findVideo(t, base = "/api/import") {
  if (t.yt && !t.ytAlt) return [t.yt];
  if (t.ytAlt) return [t.yt, ...t.ytAlt];
  const r = await fetch(`${base}?q=${encodeURIComponent(`${t.author === "Unknown" ? "" : t.author} ${t.title}`.trim())}`).catch(() => null);
  if (!r?.ok) throw new Error(`Couldn't find “${t.title}” on YouTube`);
  const j = await r.json(); t.yt = j.id; t.ytAlt = j.alt || [];
  return [j.id, ...t.ytAlt];
}

function place() { // over the map, above the chip rail and the sheet, at the player's right edge; follows the sheet
  const p = document.querySelector("#player")?.getBoundingClientRect(); if (!el || !p) return;
  const tops = [".rail .railrow", "#sheet .search"].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter((r) => r?.height).map((r) => r.top);
  const top = Math.min(p.top, ...tops);
  const right = `${Math.max(8, innerWidth - p.right + 12)}px`, bottom = `${Math.min(innerHeight - 120, Math.max(8, innerHeight - top + 10))}px`;
  if (el.style.right !== right) el.style.right = right;
  if (el.style.bottom !== bottom) el.style.bottom = bottom;
}
function grow(on) {
  if (yt.big === on) return; yt.big = on; el.classList.toggle("big", on); haptic(on ? "press" : "tick"); hooks.onChange?.();
}
function mount() {
  if (el) return el;
  el = document.createElement("div"); el.className = "ytmini"; el.setAttribute("aria-label", "YouTube player: tap to play or pause, press and hold to use it");
  el.innerHTML = `<div class="ytf"><div id="ytm-frame"></div></div><i class="ytc"></i><button class="ytx" aria-label="Shrink the video">⤡</button>`;
  document.body.append(el); place(); addEventListener("resize", place);
  const cover = el.querySelector(".ytc"); let p = null;
  const clear = () => { clearTimeout(p?.t); clearTimeout(p?.a); };
  cover.addEventListener("pointerdown", (e) => {
    p = { x: e.clientX, y: e.clientY, p0: e.pressure, on: false };
    p.a = setTimeout(() => p && pressRing.arm(p.x, p.y), 110);
    p.t = setTimeout(() => { if (p) { p.on = true; pressRing.fire(); grow(true); } }, HOLD);
  });
  cover.addEventListener("pointermove", (e) => {
    if (!p || p.on) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) { clear(); pressRing.hide(); p = null; return; }
    if (e.pointerType !== "mouse" && p.p0 > 0 && e.pressure - p.p0 > FORCE) { clear(); p.on = true; pressRing.fire(); grow(true); } // pressed harder
  });
  const up = (e) => { if (!p) return; clear(); pressRing.hide(); const tap = !p.on && e.type === "pointerup"; p = null; if (tap) { haptic("tick"); toggle(); } };
  cover.addEventListener("pointerup", up); cover.addEventListener("pointercancel", up);
  cover.addEventListener("contextmenu", (e) => e.preventDefault());
  el.querySelector(".ytx").onclick = (e) => { e.stopPropagation(); grow(false); };
  document.addEventListener("pointerdown", (e) => { if (yt.big && !el.contains(e.target)) grow(false); }, true);
  return el;
}
const state = () => { // mirror the iframe into `yt` and tell the app
  if (!player?.getPlayerState) return;
  const s = player.getPlayerState(); yt.paused = s !== 1 && s !== 3; yt.time = player.getCurrentTime?.() || 0; yt.dur = player.getDuration?.() || yt.dur;
  place(); hooks.onChange?.();
};

// Play track `t` (title/author, maybe .yt). onEnded: next song; onChange: repaint the bar; onFound(id): remember it.
// A song YouTube can't give us is skipped; after 3 in a row (offline, or blocked) we stop instead of spinning.
let ids = [], fails = 0, kept = null; // kept: the id we've told the app plays (so it's remembered once)
const giveUp = (msg) => {
  el?.classList.remove("busy"); hooks.onError?.(msg); yt.paused = true; hooks.onChange?.();
  if (++fails < 3) hooks.onEnded?.(); else fails = 0;
};
function failed(code) { // try the next video for this song, then the next song
  if (ids.length) { yt.id = ids.shift(); return player.loadVideoById(yt.id); }
  giveUp(code === 101 || code === 150 ? "That song won't play outside YouTube; skipping" : "YouTube couldn't play that; skipping");
}
export async function play(t, h = {}) {
  hooks = h; want = t.id;
  mount(); el.classList.add("on", "busy"); place();
  let YT, found;
  try { [YT, found] = await Promise.all([loadApi(), findVideo(t)]); } catch (e) { if (want === t.id) giveUp(e.message + "; skipping"); return; }
  if (want !== t.id) return; // a newer pick won while we searched
  const id = found[0]; ids = found.slice(1);
  yt.id = id; kept = null; el.classList.remove("busy");
  if (player) player.loadVideoById(id);
  else await new Promise((ok) => {
    player = new YT.Player("ytm-frame", { host: "https://www.youtube-nocookie.com", videoId: id, width: 320, height: 180,
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 1, iv_load_policy: 3 },
      events: { onReady: () => { player.playVideo(); ok(); },
        onStateChange: (e) => { state(); if (e.data === 1) { fails = 0; if (kept !== yt.id) hooks.onFound?.((kept = yt.id)); } if (e.data === 0) hooks.onEnded?.(); },
        onError: (e) => failed(e.data) } });
  });
  clearInterval(poll); poll = setInterval(state, 500);
}
export function toggle() { if (!player?.getPlayerState) return; yt.paused ? player.playVideo() : player.pauseVideo(); setTimeout(state, 60); }
export function seek(k) { if (player?.seekTo && yt.dur) { player.seekTo(k * yt.dur, true); setTimeout(state, 60); } }
export function stop() { want = null; clearInterval(poll); player?.stopVideo?.(); yt.paused = true; yt.time = 0; grow(false); el?.classList.remove("on", "busy"); }
