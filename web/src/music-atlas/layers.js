// Layers (stems): a track split offline by tools/sound-atlas-stems.py into drums, bass, synths,
// guitar, keys and voice. The atlas draws them as rings at full zoom (when each layer plays); the
// sheet lists them with mute / solo (what each is, how much of the song it fills). Both read
// lane colours from here, so a ring and its row always match.
import { shade } from "./taxonomy.js";

// Inner ring -> outer ring. Colour = the track's hue, turned per layer (same tint idea as ring 2).
export const STEMS = {
  drums: { name: "Drums", tint: [0, 20] },
  bass: { name: "Bass", tint: [-28, -12] },
  other: { name: "Synths & pads", tint: [0, 0] },
  guitar: { name: "Guitar", tint: [32, 8] },
  piano: { name: "Keys", tint: [-60, 14] },
  vocals: { name: "Voice", tint: [70, 22] },
};

// Stems live in a public HF dataset that the GPU job publishes to as it goes, so new layers appear
// without a redeploy; a stems.json next to the catalogue is the offline fallback.
export const STEM_HUB = "https://huggingface.co/datasets/kvnloo/sound-atlas-stems/resolve/main/";
let doc = null, root = STEM_HUB;
const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
export async function loadLayers(base) {
  doc = await get(STEM_HUB + "stems.json");
  if (!doc) { const local = new URL(base, location.href); doc = await get(new URL("stems.json", local)); if (doc) root = local.href; }
  if (!doc) console.warn("[layers] no stems index: layers stay hidden");
  // A one-layer split (everything landed in one stem) has nothing to isolate.
  if (doc) for (const [id, L] of Object.entries(doc.tracks)) if (L.stems.length < 2) delete doc.tracks[id];
  return doc;
}
export const layersOf = (id) => doc?.tracks?.[id] ?? null;
export const layerCount = () => (doc ? Object.keys(doc.tracks).length : 0);
export const layerHop = () => doc?.hop ?? 0.5;
export const stemUrl = (f) => new URL(f, root).href;
export const laneColor = (base, k) => shade(base, STEMS[k]?.tint ?? [0, 0]);

// Mixer: the master <audio> stays the clock (seek bar, beat grid, next-track all keep working);
// while any layer is muted or soloed the master goes silent and the stems play in its place,
// nudged back into step with playbackRate (hard seek only past 120 ms). The stems sum back to
// the mix, so nothing is engaged until the mix differs from the original.
export function createMixer(master, urlOf) {
  let id = null, els = [], on = false, timer = 0;
  const mute = new Set(); let solo = null;
  const audible = (k) => (solo ? solo === k : !mute.has(k));
  function load(trackId, L) {
    if (id === trackId) return;
    drop(); id = trackId;
    els = L.stems.map((s) => { const a = new Audio(); a.preload = "auto"; a.src = urlOf(s.f); a.dataset.k = s.k; return a; });
  }
  function drop() { disengage(); for (const a of els) { a.pause(); a.removeAttribute("src"); a.load(); } els = []; id = null; mute.clear(); solo = null; }
  function sync(hard = false) {
    const t = master.currentTime;
    for (const a of els) {
      const d = a.currentTime - t;
      if (hard || Math.abs(d) > 0.12) { try { a.currentTime = t; } catch {} a.playbackRate = 1; }
      else a.playbackRate = Math.abs(d) > 0.015 ? 1 - Math.max(-0.04, Math.min(0.04, d * 1.5)) : 1;
      if (master.paused && !a.paused) a.pause();
      if (!master.paused && a.paused) a.play().catch(() => {});
    }
  }
  function engage() { if (on || !els.length) return; on = true; master.muted = true; sync(true); timer = setInterval(sync, 500); }
  function disengage() { if (!on) return; on = false; master.muted = false; clearInterval(timer); for (const a of els) a.pause(); }
  function apply() { if (!solo && !mute.size) disengage(); else engage(); for (const a of els) a.muted = !audible(a.dataset.k); }
  master.addEventListener("play", () => on && sync(true));
  master.addEventListener("pause", () => on && sync());
  master.addEventListener("seeked", () => on && sync(true));
  master.addEventListener("emptied", () => { if (id) drop(); });
  return {
    load, drop, audible,
    get id() { return id; }, get engaged() { return on; }, get changed() { return !!solo || mute.size > 0; },
    get solo() { return solo; }, muted: (k) => mute.has(k),
    toggleMute(k) { solo = null; mute.has(k) ? mute.delete(k) : mute.add(k); apply(); },
    toggleSolo(k) { solo = solo === k ? null : k; if (solo) mute.clear(); apply(); },
    reset() { solo = null; mute.clear(); apply(); },
  };
}
