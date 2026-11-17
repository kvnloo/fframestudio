// Bit-perfect playback, from the page's side. A browser can't play bit-perfect (Chrome resamples every page to
// the output's current rate), so when it's on, this computer's own player (aural-local's native.mjs: mpv straight
// to the DAC, no DSP, no gain, the DAC switched to the song's rate) plays the song, and the page keeps playing
// silently so its map, beat and scrubber stay in step. The page stays the remote: play, pause, seek and song
// changes go to the player; the player is the clock, and the silent page follows it.
//
// Modes (localStorage "sa-aural".bitperfect): "auto" (default) follows the system: on when aural-local is
// connected and the system output is the DAC itself (Linux: an alsa_output sink, e.g. `audio-sink bitperfect`;
// macOS: not BlackHole), off on a DSP sink or with the in-page Aural chain on. "on" always, "off" never.
// Songs that only exist in this browser (your own files) stay in the browser.
import { local, LOCAL } from "./aural.js";

const KEY = "sa-aural";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
export const MODES = ["auto", "on", "off"];
export const bp = { mode: "auto", active: false, now: null, why: "", base: LOCAL };
let h = null, pollT = 0, probeT = 0, sentAt = 0, sendT = 0, echoUntil = 0, skipped = null;

// app hooks: { audio, current() -> track, url(track) -> absolute http(s) URL or null, mute(key, on), toast, onChange() }
export function attach(hooks) {
  h = hooks;
  for (const ev of ["play", "pause", "seeked", "loadstart"]) h.audio.addEventListener(ev, () => { if (ev === "seeked" && Date.now() < echoUntil) return; push(); });
  probe(); probeT = setInterval(probe, 8000);
}
export function setMode(m) {
  if (!MODES.includes(m)) return;
  const p = read(); p.bitperfect = m; localStorage.setItem(KEY, JSON.stringify(p)); probe();
}
export const refresh = () => probe();

async function probe() {
  const p = read(); bp.mode = MODES.includes(p.bitperfect) ? p.bitperfect : "auto"; bp.base = p.base ?? LOCAL;
  if (!p.server || bp.mode === "off") return off(p.server ? "off" : "aural-local not set up");
  let j; try { j = await local("/native/now", undefined, { base: bp.base, timeout: 2000 }); } catch { return off("aural-local not reachable"); }
  bp.now = j;
  const want = bp.mode === "on" || (bp.mode === "auto" && j.auto && !p.on);
  if (want && !bp.active) on(); else if (!want && bp.active) off(bp.mode === "auto" ? (p.on ? "the in-page Aural chain is on" : "the system output is a DSP sink") : "off");
  else h?.onChange();
}
function on() {
  bp.active = true; bp.why = ""; h.mute("bitperfect", true); sentAt = 0; push(true);
  clearInterval(pollT); pollT = setInterval(poll, 1000);
  h.toast(`Bit-perfect · ${bp.now?.target ?? "this computer's output"}`, 3000); h.onChange();
}
function off(why) {
  bp.why = why; if (!bp.active) return h?.onChange();
  bp.active = false; clearInterval(pollT); clearTimeout(sendT); skipped = null;
  local("/native/stop", {}, { base: bp.base }).catch(() => {});
  h.mute("bitperfect", false); h.toast("Bit-perfect off · playing in the browser", 2600); h.onChange();
}
function push(now = false) {
  if (!bp.active) return;
  clearTimeout(sendT);
  sendT = setTimeout(async () => {
    const t = h.current(), url = t && h.url(t);
    if (!url) { // only in this browser: let the page be heard for this one
      if (t && skipped !== t.id) { skipped = t.id; h.toast("This song only plays in the browser (not bit-perfect)", 3000); }
      h.mute("bitperfect", false); local("/native/stop", {}, { base: bp.base }).catch(() => {}); return;
    }
    skipped = null; h.mute("bitperfect", true); sentAt = Date.now();
    try { bp.now = await local("/native/play", { url, pos: h.audio.currentTime, playing: !h.audio.paused }, { base: bp.base, timeout: 20000 }); h.onChange(); }
    catch (e) { bp.why = e.message; off(e.message); }
  }, now ? 0 : 150);
}
async function poll() {
  if (!bp.active) return;
  let j; try { j = await local("/native/now", undefined, { base: bp.base, timeout: 1500 }); } catch { return off("aural-local stopped answering"); }
  bp.now = j;
  const t = h.current(), url = t && h.url(t);
  if (j.running && url && j.url === url && j.pos != null && Date.now() - sentAt > 1500 && !h.audio.paused) {
    if (Math.abs(j.pos - h.audio.currentTime) > 0.35) { echoUntil = Date.now() + 800; h.audio.currentTime = j.pos; } // silent page: the seek is inaudible
  }
  if (bp.mode === "auto" && !j.auto) return off("the system output is a DSP sink");
  h.onChange();
}
// One line for the pane: what's playing and whether it's really bit-perfect.
export function summary(j = bp.now) {
  if (!bp.active) return { ok: false, text: bp.mode === "off" ? "Off · the browser plays (Chrome resamples to the output rate)" : `Not active · ${bp.why || "waiting for aural-local"}` };
  if (!j?.running || !j.params) return { ok: false, text: `Ready · ${j?.target ?? "the DAC"} · press play` };
  const khz = (r) => (r ? `${+(r / 1000).toFixed(1)} kHz` : "?"), fmt = j.hw?.format ?? j.out?.format ?? j.params.format;
  return j.bitperfect
    ? { ok: true, text: `Bit-perfect · ${khz(j.params.samplerate)} · ${fmt} → ${j.target ?? "DAC"}` }
    : { ok: false, text: `Not bit-perfect · ${j.why.join(" · ")}` };
}
