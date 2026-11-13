// Browse like any music app: artists, albums, genres and what you played lately. Built from whatever the
// search and filters keep, so "Artists" under a Calm filter lists the calm artists. Pure: app.js renders.
import { familyById, styleName } from "./taxonomy.js";

export const MODES = [["feel", "Feels"], ["artists", "Artists"], ["albums", "Albums"], ["genres", "Genres"], ["recent", "Recent"]];
const songs = (n) => `${n} song${n === 1 ? "" : "s"}`;
export const keyOf = (s) => String(s ?? "").trim().toLowerCase().replace(/^the\s+/, "");
const fold = keyOf;
const byName = (a, b) => fold(a.name).localeCompare(fold(b.name));
// "A, B", "A; B", "A feat. B" credit each artist; "A & B" stays one act (Simon & Garfunkel).
export const artistsOf = (t) => [...new Set(String(t.author ?? "").split(/\s*(?:[,;/]|\s(?:feat\.?|ft\.?|featuring)\s)\s*/i).map((s) => s.trim()).filter(Boolean))];
const num = (v) => { const n = parseInt(String(v ?? "").split("/")[0], 10); return Number.isFinite(n) ? n : null; };
export const albumOrder = (a, b) => (num(a.disc) ?? 1) - (num(b.disc) ?? 1) || (num(a.track) ?? 1e3) - (num(b.track) ?? 1e3) || fold(a.title).localeCompare(fold(b.title));

export function artists(tracks) {
  const m = new Map();
  for (const t of tracks) for (const name of artistsOf(t)) { const k = fold(name); const e = m.get(k) ?? { key: k, name, tracks: [] }; e.tracks.push(t); m.set(k, e); }
  return [...m.values()].map((e) => ({ ...e, albums: new Set(e.tracks.map((t) => t.album).filter(Boolean)).size })).sort((a, b) => b.tracks.length - a.tracks.length || byName(a, b));
}

// An album is its name plus who released it; one with several credited artists is "Various artists".
export function albums(tracks) {
  const m = new Map();
  for (const t of tracks) {
    if (!t.album) continue;
    const k = fold(t.album) + "|" + (t.albumArtist ? fold(t.albumArtist) : "");
    const e = m.get(k) ?? { key: k, name: String(t.album).trim(), tracks: [] }; e.tracks.push(t); m.set(k, e);
  }
  return [...m.values()].map((e) => {
    const who = [...new Set(e.tracks.map((t) => t.albumArtist || t.author))];
    return { ...e, artist: who.length === 1 ? who[0] : "Various artists", art: e.tracks.find((t) => t.art)?.art ?? null, year: e.tracks.find((t) => t.year)?.year ?? "", tracks: e.tracks.sort(albumOrder) };
  }).sort(byName);
}

// Genres are the atlas's own family → style tree (catalogue and your music are filed into it alike).
export function genres(tracks) {
  const m = new Map();
  for (const t of tracks) {
    const k = t.family + "." + t.style; const e = m.get(k) ?? { key: k, family: t.family, familyName: familyById[t.family]?.name ?? t.family, name: styleName(t.family, t.style), tracks: [] };
    e.tracks.push(t); m.set(k, e);
  }
  const fam = new Map();
  for (const g of [...m.values()].sort((a, b) => b.tracks.length - a.tracks.length)) { const f = fam.get(g.family) ?? { id: g.family, name: g.familyName, styles: [], n: 0 }; f.styles.push(g); f.n += g.tracks.length; fam.set(g.family, f); }
  return [...fam.values()].sort((a, b) => b.n - a.n);
}

// A detail page: "a:<artist>", "al:<album key>", "g:<family.style>". Returns { kind, name, sub, tracks, groups? }.
export function detail(open, tracks) {
  if (!open) return null;
  const [kind, ...rest] = open.split(":"), k = rest.join(":");
  if (kind === "a") {
    const e = artists(tracks).find((x) => x.key === k); if (!e) return null;
    const al = albums(e.tracks), loose = e.tracks.filter((t) => !t.album);
    const groups = [...al.map((a) => ({ name: a.name, open: "al:" + a.key, sub: a.year, tracks: a.tracks })), ...(loose.length ? [{ name: al.length ? "Singles & more" : "Songs", tracks: loose }] : [])];
    return { kind, name: e.name, sub: `${songs(e.tracks.length)}${al.length ? ` · ${al.length} album${al.length === 1 ? "" : "s"}` : ""}`, tracks: groups.flatMap((g) => g.tracks), groups };
  }
  if (kind === "al") { const a = albums(tracks).find((x) => x.key === k); return a && { kind, name: a.name, sub: [a.artist, a.year, songs(a.tracks.length)].filter(Boolean).join(" · "), artist: a.artist, art: a.art, tracks: a.tracks }; }
  if (kind === "g") { const g = genres(tracks).flatMap((f) => f.styles).find((x) => x.key === k); return g && { kind, name: g.name, sub: `${g.familyName} · ${songs(g.tracks.length)}`, tracks: g.tracks }; }
  return null;
}

// Recently played: newest first, no repeats, kept on this device.
export function remember(list, id, max = 60) { return [id, ...list.filter((x) => x !== id)].slice(0, max); }

export function shuffled(ids, rand = Math.random) { const a = [...ids]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
