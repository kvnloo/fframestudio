// The shared layer of the Sound Atlas, client side: page views, who is here right now, likes, play
// counts, community playlists (tools/sound-atlas-api/social.js) and the radio that never runs out.
// Everything degrades quietly: without the API (local builds, an outage) the atlas works as before
// and the social numbers just don't show.

const BEAT_MS = 25_000;
const sidKey = "sa-sid";
export const sid = (() => {
  let s = localStorage.getItem(sidKey);
  if (!/^[a-z0-9]{16,40}$/.test(s ?? "")) { s = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24); localStorage.setItem(sidKey, s); }
  return s;
})();

const empty = () => ({ on: false, views: 0, visitors: 0, plays: 0, here: 0, listening: 0, now: [], likes: {}, top: [], playlists: [] });
export const room = empty();
let listeners = [], now = () => ({ track: null, playing: false }), timer = 0;
const emit = () => listeners.forEach((f) => f(room));
export const onRoom = (f) => listeners.push(f);

async function api(op, body) {
  const r = await fetch(`/api/social?op=${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid, ...body }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `social ${r.status}`);
  return r.json();
}
const take = (j) => { Object.assign(room, { on: true, views: j.views, visitors: j.visitors, plays: j.plays, here: j.here, listening: j.listening, now: j.now, likes: j.likes, top: j.top }); emit(); };

// hello once per page view, then a heartbeat that carries what this tab is playing.
export async function join(getNow) {
  now = getNow;
  try { const j = await api("hello", now()); take(j); room.mine = j.mine; } catch { return null; }
  const beat = () => { clearTimeout(timer); timer = setTimeout(async () => { if (document.visibilityState === "visible") { try { take(await api("beat", now())); } catch {} } beat(); }, BEAT_MS); };
  beat();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && !now().playing) navigator.sendBeacon?.("/api/social?op=bye", JSON.stringify({ sid })); // still listening in the background? stay in the room
    else if (document.visibilityState === "visible") pulse();
  });
  loadPlaylists();
  return room.mine;
}
// Send a beat now (play/pause/track change) instead of waiting for the next tick.
let pT = 0;
export function pulse() { if (!room.on) return; clearTimeout(pT); pT = setTimeout(async () => { try { take(await api("beat", now())); } catch {} }, 400); }

export async function like(track, on) {
  if (!room.on) return;
  room.likes[track] = Math.max(0, (room.likes[track] ?? 0) + (on ? 1 : -1)); emit(); // optimistic
  try { const j = await api("like", { track, on }); room.likes[track] = j.likes; emit(); } catch {}
}
const counted = new Set();
export function played(track) { if (!room.on || counted.has(track)) return; counted.add(track); api("play", { track }).catch(() => {}); }

export async function loadPlaylists() { try { room.playlists = (await api("playlists", {})).playlists; emit(); } catch {} return room.playlists; }
export async function publish(name, tracks) { const j = await api("publish", { name, tracks }); room.playlists = j.playlists; emit(); return j.id; }
export async function unpublish(id) { await api("unpublish", { id }); return loadPlaylists(); }
export async function likePlaylist(id, on) {
  const p = room.playlists.find((x) => x.id === id); if (p) { p.liked = on; p.likes += on ? 1 : -1; emit(); }
  try { const j = await api("plike", { id, on }); if (p) { p.likes = j.likes; emit(); } } catch {}
}
// Aural: community evolution of filter-song combos (aural.js comboKey). A round reports every variant heard and the one kept.
export const combos = (track) => api("combos", { track });
export const evolved = (track, heard, kept) => api("combo", { track, heard, kept });
export const playlistPlayed = (id) => api("pplay", { id }).catch(() => {});

// --- radio ----------------------------------------------------------------------------------------
// "ear": an endless walk by ear. Each next track is one of the current track's closest neighbours
// that hasn't played this session, chosen with a little chance so the walk drifts instead of
// ping-ponging between two twins. "crowd": what the room loves, most-liked and most-played first,
// with live picks pushed to the front; it falls back to the ear walk when the crowd runs out.
export function crowdRank(r = room) {
  const s = new Map(), add = (id, v) => s.set(id, (s.get(id) ?? 0) + v);
  for (const [id, n] of Object.entries(r.likes)) add(id, 3 * n);
  for (const [id, n] of r.top) add(id, n);
  for (const [id, n] of r.now) add(id, 5 * n);
  return [...s].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
export function radioNext({ kind, cur, all, byId, playedIds, neighbours, rand = Math.random, r = room }) {
  const fresh = (t) => t && t.id !== cur?.id && !playedIds.has(t.id);
  if (kind === "crowd") { const id = crowdRank(r).find((x) => fresh(byId.get(x))); if (id) return byId.get(id); }
  if (cur?.f) {
    const near = neighbours(cur, all, 24).map((n) => n.t).filter(fresh);
    if (near.length) { const k = Math.min(near.length, 5), i = Math.floor(Math.pow(rand(), 1.6) * k); return near[i]; } // weighted toward the closest
  }
  const pool = all.filter((t) => fresh(t) && t.f), any = pool.length ? pool : all.filter(fresh);
  return any.length ? any[Math.floor(rand() * any.length)] : null;
}

export const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : String(n));
