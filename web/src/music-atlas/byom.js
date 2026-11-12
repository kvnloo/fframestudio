// Bring your own music. Three sources land as ordinary tracks (src "mine") on the same map:
//  - files: a folder or a pick of audio files. That is also a VLC library (VLC indexes folders); its .m3u/.xspf
//    playlists come along and match files by name. Desktop Chrome keeps a folder handle (nothing copied); other
//    browsers keep the picked files in IndexedDB so they're still here next visit.
//  - plex: PIN sign-in on plex.tv, then the server's music sections; tracks stream straight from the server.
//  - spotify: PKCE sign-in; Liked Songs + your own playlists. Plays through Spotify Connect (Premium), since
//    Spotify audio never reaches a web page outside its SDK. Spotify forbids feeding its data to ML models, so
//    Spotify tracks are placed by the word classifier only, never embedded.
// Loaded on demand (app.js dynamic import), so the TV build never parses it.
import { classify, FEELS } from "./taxonomy.js";

const AUDIO = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm)$/i, LIST = /\.(m3u8?|xspf)$/i;
export const SPOTIFY_ID = "";
const base = (p) => decodeURIComponent(String(p).split(/[\\/]/).pop()).toLowerCase();
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };

// --- IndexedDB key/value -------------------------------------------------------------------------
let dbp = null;
const db = () => (dbp ??= new Promise((ok, no) => { const r = indexedDB.open("sa-byom", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
const tx = async (mode, fn) => { const s = (await db()).transaction("kv", mode).objectStore("kv"); return new Promise((ok, no) => { const r = fn(s); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); };
export const kv = { get: (k) => tx("readonly", (s) => s.get(k)), set: (k, v) => tx("readwrite", (s) => s.put(v, k)), del: (k) => tx("readwrite", (s) => s.delete(k)) };

// One normalised track. `text` feeds the word classifier (feel/family/style) and search.
// A library's own mood tags ("Calm", "Energetic") name the feel outright: a stem match either way round, ahead of the words.
const moodFeels = (moods) => [...new Set(moods.map((m) => m.toLowerCase().trim()).map((m) => FEELS.find((F) => F.id === m || F.name?.toLowerCase() === m || F.words.some((w) => w.startsWith(m) || m.startsWith(w)))?.id).filter(Boolean))];
const place = (text, moods) => { const c = classify(text, { feelList: moods }), mf = moodFeels(moods); return mf.length ? { ...c, feel: mf[0], feels: [...new Set([...mf, ...c.feels])] } : c; };
export function mineTrack({ id, provider, title, author, album, art, audio, dur, bpm, genre = [], moods = [], uri, ...rest }) {
  const tags = [...genre, ...moods].filter(Boolean).slice(0, 12), text = [title, album, author, tags.join(", ")].filter(Boolean).join(". ");
  return { id, src: "mine", provider, title: title || "Untitled", author: author || "Unknown", album, art, audio, uri, dur: dur || null, bpm: +bpm > 0 ? Math.round(+bpm) : null,
    license: "Yours", tags, desc: album ? `From ${album}` : "", ...place(text, moods), _text: text, ...rest };
}

// --- files (and VLC playlists) ------------------------------------------------------------------
let tagLib = null;
function loadTags() { // jsmediatags (BSD-3) reads ID3, MP4 and FLAC tags from header bytes only
  return (tagLib ??= new Promise((ok, no) => { if (window.jsmediatags) return ok(window.jsmediatags); const s = Object.assign(document.createElement("script"), { src: new URL("./jsmediatags.min.js", import.meta.url).href }); s.onload = () => ok(window.jsmediatags); s.onerror = () => no(new Error("tag reader failed to load")); document.head.append(s); }));
}
const readTags = async (file) => { const lib = await loadTags().catch(() => null); if (!lib) return {}; return new Promise((ok) => lib.read(file, { onSuccess: (r) => ok(r.tags || {}), onError: () => ok({}) })); };
// "Artist - Title.mp3" when a file has no tags.
const fromName = (name) => { const s = name.replace(/\.[^.]+$/, "").replace(/^\d{1,3}[\s.\-_]+/, ""), m = s.split(/\s+[-–]\s+/); return m.length > 1 ? { author: m[0], title: m.slice(1).join(" - ") } : { title: s }; };
async function fileTrack(file, path) {
  const id = "my-" + hash(path + "|" + file.size), t = await readTags(file);
  const pic = t.picture, art = pic?.data ? URL.createObjectURL(new Blob([new Uint8Array(pic.data)], { type: pic.format || "image/jpeg" })) : null;
  const nm = fromName(file.name), num = (v) => (Array.isArray(v) ? v[0] : v);
  return mineTrack({ id, provider: "files", path, title: t.title || nm.title, author: t.artist || nm.author, album: t.album, art, audio: URL.createObjectURL(file),
    bpm: num(t.TBPM?.data) ?? t.bpm, genre: [].concat(t.genre || []).map(String) });
}
// Playlists: m3u lines / xspf <location>, matched to the library by file name.
export function parsePlaylist(name, text) {
  const paths = /\.xspf$/i.test(name)
    ? [...text.matchAll(/<location>([^<]+)<\/location>/g)].map((m) => m[1].replace(/&amp;/g, "&"))
    : text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const title = /\.xspf$/i.test(name) && text.match(/<playlist[^>]*>[\s\S]*?<title>([^<]+)<\/title>/)?.[1];
  return { name: title || name.replace(LIST, ""), files: paths.map(base) };
}
async function* walk(dir, pre = "") {
  for await (const [n, h] of dir.entries()) { if (h.kind === "directory") yield* walk(h, pre + n + "/"); else yield [pre + n, h]; }
}
// Turns files into tracks, `limit` at a time so tag reads don't stall the page.
async function filesToTracks(list, onProgress) {
  const audio = list.filter(([p]) => AUDIO.test(p)), lists = list.filter(([p]) => LIST.test(p)), tracks = [];
  for (let i = 0; i < audio.length; i += 6) {
    tracks.push(...(await Promise.all(audio.slice(i, i + 6).map(async ([p, f]) => fileTrack(await f(), p)))));
    onProgress?.(tracks.length, audio.length);
  }
  const byName = new Map(tracks.map((t) => [base(t.path), t.id])), playlists = [];
  for (const [p, f] of lists) { const pl = parsePlaylist(p, await (await f()).text()), ids = pl.files.map((n) => byName.get(n)).filter(Boolean); if (ids.length) playlists.push({ id: "pl-" + hash(p), name: pl.name, ids }); }
  return { tracks, playlists };
}
export const canKeepFolder = () => "showDirectoryPicker" in window;
// Desktop: a folder handle, rescanned each visit (Chrome may ask to allow access again).
export async function addFolder(onProgress) {
  const dir = await showDirectoryPicker({ id: "sa-music", mode: "read" });
  await kv.set("dir", dir);
  return scanFolder(dir, onProgress);
}
async function scanFolder(dir, onProgress) {
  const list = []; for await (const [p, h] of walk(dir)) if (AUDIO.test(p) || LIST.test(p)) list.push([p, () => h.getFile()]);
  return filesToTracks(list, onProgress);
}
// Elsewhere: picked files, kept in IndexedDB (browsers store the bytes, so they survive a reload).
export async function addFiles(files, onProgress) {
  const keep = [...files].filter((f) => AUDIO.test(f.name) || LIST.test(f.name)), old = (await kv.get("files")) ?? [];
  const seen = new Set(old.map((f) => f.name + f.size)), all = old.concat(keep.filter((f) => !seen.has(f.name + f.size)));
  await kv.set("files", all);
  return filesToTracks(all.map((f) => [f.webkitRelativePath || f.name, () => f]), onProgress);
}

// --- Plex ----------------------------------------------------------------------------------------
const PLEX = "https://plex.tv/api/v2";
const plexId = () => localStorage.getItem("sa-plex-cid") ?? (localStorage.setItem("sa-plex-cid", crypto.randomUUID()), localStorage.getItem("sa-plex-cid"));
const plexHead = (tok) => ({ Accept: "application/json", "X-Plex-Product": "Sound Atlas", "X-Plex-Client-Identifier": plexId(), ...(tok ? { "X-Plex-Token": tok } : {}) });
const getJSON = async (u, h, ms = 15000) => { const c = new AbortController(), k = setTimeout(() => c.abort(), ms); try { const r = await fetch(u, { headers: h, signal: c.signal }); if (!r.ok) throw new Error(`${new URL(u).host} ${r.status}`); return await r.json(); } finally { clearTimeout(k); } };
// Opens Plex's sign-in in a new tab; resolves with the account token once the PIN is claimed.
export async function plexSignIn(open = (u) => window.open(u, "_blank")) {
  const r = await fetch(PLEX + "/pins?strong=true", { method: "POST", headers: plexHead() }); if (!r.ok) throw new Error("plex.tv " + r.status);
  const pin = await r.json();
  open(`https://app.plex.tv/auth#?clientID=${encodeURIComponent(plexId())}&code=${encodeURIComponent(pin.code)}&context%5Bdevice%5D%5Bproduct%5D=Sound%20Atlas`);
  for (let i = 0; i < 150; i++) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const p = await getJSON(`${PLEX}/pins/${pin.id}`, plexHead()).catch(() => null);
    if (p?.authToken) { await kv.set("plex", { token: p.authToken }); return p.authToken; }
  }
  throw new Error("Plex sign-in timed out");
}
// First reachable https connection of each server (local first); page is https, so plain http is out.
async function plexServers(token) {
  const res = await getJSON(`${PLEX}/resources?includeHttps=1&includeRelay=1`, plexHead(token)), out = [];
  for (const s of res.filter((x) => String(x.provides).includes("server"))) {
    const cons = (s.connections || []).filter((c) => c.protocol === "https").sort((a, b) => (b.local - a.local) || (a.relay - b.relay));
    for (const c of cons) { if (await getJSON(c.uri + "/identity", plexHead(s.accessToken), 4000).then(() => true, () => false)) { out.push({ name: s.name, uri: c.uri, token: s.accessToken }); break; } }
  }
  return out;
}
export function plexTrack(sv, m) {
  const part = m.Media?.[0]?.Part?.[0], tok = encodeURIComponent(sv.token), thumb = m.thumb || m.parentThumb;
  return mineTrack({ id: "px-" + hash(sv.uri) + "-" + m.ratingKey, provider: "plex", title: m.title, author: m.originalTitle || m.grandparentTitle, album: m.parentTitle,
    art: thumb ? `${sv.uri}/photo/:/transcode?width=240&height=240&url=${encodeURIComponent(thumb)}&X-Plex-Token=${tok}` : null,
    audio: part ? `${sv.uri}${part.key}?X-Plex-Token=${tok}` : null, dur: m.duration ? Math.round(m.duration / 1000) : null,
    genre: (m.Genre || []).map((g) => g.tag), moods: (m.Mood || []).map((g) => g.tag), server: sv.name });
}
export async function plexLibrary(token, onProgress) {
  const tracks = [], playlists = [];
  for (const sv of await plexServers(token)) {
    const h = plexHead(sv.token), secs = (await getJSON(sv.uri + "/library/sections", h)).MediaContainer?.Directory?.filter((d) => d.type === "artist") ?? [];
    for (const sec of secs) for (let start = 0; ; start += 500) {
      const mc = (await getJSON(`${sv.uri}/library/sections/${sec.key}/all?type=10&X-Plex-Container-Start=${start}&X-Plex-Container-Size=500`, h)).MediaContainer ?? {};
      const got = (mc.Metadata ?? []).map((m) => plexTrack(sv, m)).filter((t) => t.audio); tracks.push(...got); onProgress?.(tracks.length, mc.totalSize);
      if (!mc.Metadata?.length || start + 500 >= (mc.totalSize ?? 0)) break;
    }
    const pls = (await getJSON(sv.uri + "/playlists?playlistType=audio", h).catch(() => null))?.MediaContainer?.Metadata ?? [];
    for (const p of pls) { const items = (await getJSON(`${sv.uri}/playlists/${p.ratingKey}/items`, h).catch(() => null))?.MediaContainer?.Metadata ?? []; playlists.push({ id: "pl-px-" + p.ratingKey, name: p.title, ids: items.map((m) => plexTrack(sv, m).id) }); }
  }
  return { tracks, playlists };
}

// --- Spotify -------------------------------------------------------------------------------------
const SP = "https://api.spotify.com/v1", ACC = "https://accounts.spotify.com";
const redirect = () => location.origin + "/"; // one registered redirect for every pretty path
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function spotifySignIn() {
  const v = b64u(crypto.getRandomValues(new Uint8Array(48))), ch = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  sessionStorage.setItem("sa-sp-v", v); sessionStorage.setItem("sa-sp-back", location.pathname + location.hash);
  const q = new URLSearchParams({ client_id: SPOTIFY_ID, response_type: "code", redirect_uri: redirect(), state: "sa-spotify", code_challenge_method: "S256", code_challenge: ch,
    scope: "user-library-read playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state" });
  location.assign(`${ACC}/authorize?${q}`);
}
// Back from Spotify's consent page: swap the code for tokens, restore the hash. True when it handled a return.
export async function spotifyReturn() {
  const u = new URL(location.href); if (u.searchParams.get("state") !== "sa-spotify") return false;
  const code = u.searchParams.get("code"), v = sessionStorage.getItem("sa-sp-v");
  history.replaceState(null, "", sessionStorage.getItem("sa-sp-back") || "/");
  if (!code || !v) throw new Error(u.searchParams.get("error") || "Spotify sign-in was cancelled");
  await spToken({ grant_type: "authorization_code", code, redirect_uri: redirect(), code_verifier: v });
  return true;
}
async function spToken(body) {
  const r = await fetch(ACC + "/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: SPOTIFY_ID, ...body }) });
  if (!r.ok) throw new Error("Spotify token " + r.status);
  const j = await r.json(), old = (await kv.get("spotify")) ?? {}, s = { access: j.access_token, refresh: j.refresh_token || old.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 };
  await kv.set("spotify", s); return s;
}
async function sp(path, init = {}) {
  let s = await kv.get("spotify"); if (!s) throw new Error("not signed in to Spotify");
  if (Date.now() > s.exp) s = await spToken({ grant_type: "refresh_token", refresh_token: s.refresh });
  const r = await fetch(path.startsWith("http") ? path : SP + path, { ...init, headers: { Authorization: "Bearer " + s.access, "Content-Type": "application/json", ...init.headers } });
  if (r.status === 204) return null;
  if (!r.ok) { const e = new Error("Spotify " + r.status); e.status = r.status; throw e; }
  return r.json();
}
export function spotifyTrack(it) {
  return mineTrack({ id: "sp-" + it.id, provider: "spotify", uri: it.uri, title: it.name, author: (it.artists || []).map((a) => a.name).join(", "), album: it.album?.name,
    art: it.album?.images?.slice(-2)[0]?.url ?? null, audio: null, dur: it.duration_ms ? Math.round(it.duration_ms / 1000) : null, sourceUrl: it.external_urls?.spotify, noEmbed: true });
}
async function spPages(path, pick, onPage) { const out = []; for (let u = path; u; ) { const j = await sp(u); out.push(...(j.items || []).map(pick).filter(Boolean)); onPage?.(out.length, j.total); u = j.next; } return out; }
export async function spotifyLibrary(onProgress) {
  const liked = await spPages("/me/tracks?limit=50", (x) => x.track?.id && spotifyTrack(x.track), onProgress), byId = new Map(liked.map((t) => [t.id, t])), playlists = [];
  const me = await sp("/me"), mine = await spPages("/me/playlists?limit=50", (p) => (p.owner?.id === me.id || p.collaborative ? p : null));
  for (const p of mine) {
    const items = await spPages(`/playlists/${p.id}/items?limit=50`, (x) => { const it = x.item ?? x.track; return it?.id && it.type !== "episode" ? spotifyTrack(it) : null; }).catch(() => []);
    for (const t of items) if (!byId.has(t.id)) byId.set(t.id, t);
    playlists.push({ id: "pl-sp-" + p.id, name: p.name, ids: items.map((t) => t.id) });
  }
  return { tracks: [...byId.values()], playlists };
}
// Plays on the active Spotify Connect device (phone app, desktop app, the TV's Spotify app).
export async function spotifyPlay(t, posMs = 0) {
  try { await sp("/me/player/play", { method: "PUT", body: JSON.stringify({ uris: [t.uri], position_ms: Math.round(posMs) }) }); }
  catch (e) {
    if (e.status !== 404) throw e;
    const d = (await sp("/me/player/devices"))?.devices?.[0]; if (!d) throw new Error("Open Spotify on any device (phone, computer or the TV app), then tap again");
    await sp(`/me/player/play?device_id=${d.id}`, { method: "PUT", body: JSON.stringify({ uris: [t.uri] }) });
  }
  return (await sp("/me/player").catch(() => null))?.device?.name ?? "Spotify";
}
export const spotifyPause = () => sp("/me/player/pause", { method: "PUT" }).catch(() => null);

// --- restore on boot -----------------------------------------------------------------------------
export const sources = async () => ({ dir: await kv.get("dir"), files: ((await kv.get("files")) ?? []).length, plex: !!(await kv.get("plex")), spotify: !!(await kv.get("spotify")) });
// Everything kept from earlier visits. A folder whose permission lapsed reports `needsFolder` (re-grant needs a tap).
export async function restore(onProgress) {
  const out = { tracks: [], playlists: [], needsFolder: false, errors: [] };
  const add = (r) => { out.tracks.push(...r.tracks); out.playlists.push(...r.playlists); };
  const dir = await kv.get("dir");
  if (dir) { if ((await dir.queryPermission?.({ mode: "read" })) === "granted") add(await scanFolder(dir, onProgress)); else out.needsFolder = true; }
  const files = (await kv.get("files")) ?? []; if (files.length) add(await filesToTracks(files.map((f) => [f.webkitRelativePath || f.name, () => f]), onProgress));
  const plex = await kv.get("plex"); if (plex) await plexLibrary(plex.token).then(add, (e) => out.errors.push("Plex: " + e.message));
  if (await kv.get("spotify")) await spotifyLibrary().then(add, (e) => out.errors.push("Spotify: " + e.message));
  return out;
}
export async function regrantFolder(onProgress) { const dir = await kv.get("dir"); if ((await dir.requestPermission({ mode: "read" })) !== "granted") throw new Error("Folder access not allowed"); return scanFolder(dir, onProgress); }
export async function forget(which) { if (which === "files") { await kv.del("dir"); await kv.del("files"); } else await kv.del(which); }
