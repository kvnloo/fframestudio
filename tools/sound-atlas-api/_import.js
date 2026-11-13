// Playlist links from other apps -> { source, name, tracks: [{ title, artist, dur, yt }] }. Pure: fetching is
// import.js's job, so these parse saved pages in tests. No API keys: each service's public page or embed
// already carries the track list (Spotify embed __NEXT_DATA__, YouTube ytInitialData, Apple's server data,
// Tidal's embed, Deezer's open API). `yt` is a YouTube video id when the source already knows it.

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const json = (html, re) => { const m = html.match(re); if (!m) return null; try { return JSON.parse(m[1]); } catch { return null; } };
function* walk(x) { if (x && typeof x === "object") { yield x; for (const v of Object.values(x)) yield* walk(v); } }
const iso = (d) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ""); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; };
const mmss = (s) => { const p = String(s || "").split(":").map(Number); return p.length > 1 && p.every(Number.isFinite) ? p.reduce((a, b) => a * 60 + b, 0) : null; };
const ent = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const norm = (s) => clean(s).toLowerCase().replace(/\s*-\s*topic$|vevo$|official$/g, "").replace(/[^\p{L}\p{N}]+/gu, "");

// "Daft Punk - Get Lucky (Official Video)" -> { artist, title }. Channel names lose " - Topic" / "VEVO".
export function splitTitle(raw, channel = "") {
  const s = clean(raw).replace(/\s*[([]\s*(official|oficial|lyrics?|letra|audio|video|vídeo|music video|hd|4k|visuali[sz]er|explicit)[^)\]]*[)\]]/gi, "").trim();
  const m = s.split(/\s+[-–—]\s+/), ch = norm(channel);
  if (m.length > 1) { // "Artist - Title" is the norm; when the channel names the right side, it's "Title - Artist"
    const [a, b] = [m[0], m.slice(1).join(" - ")];
    return ch && !norm(a).includes(ch) && norm(b).includes(ch) ? { artist: b, title: a } : { artist: a, title: b };
  }
  return { artist: clean(channel).replace(/\s*-\s*Topic$|VEVO$/i, ""), title: s };
}

// The page to fetch for a pasted link, or null when it isn't a playlist/album/track we can read.
export function source(link) {
  let u; try { u = new URL(String(link).trim()); } catch { return null; }
  const h = u.hostname.replace(/^(www|m|open|music|listen|embed)\./, ""), p = u.pathname;
  let m;
  if (h === "spotify.com" && (m = p.match(/^\/(?:intl-[\w-]+\/)?(playlist|album|track)\/([A-Za-z0-9]{10,32})/))) return { source: "spotify", url: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
  if ((h === "youtube.com" || h === "youtu.be") && /^[\w-]{10,64}$/.test(u.searchParams.get("list") || "")) return { source: "youtube", url: "https://www.youtube.com/playlist?list=" + u.searchParams.get("list") };
  if (h === "apple.com" && u.hostname.startsWith("music.") && /^\/[a-z]{2}\/(playlist|album|song)\//.test(p)) return { source: "apple", url: `https://music.apple.com${p}` };
  if (h === "tidal.com" && (m = p.match(/\/(playlist|album|mix)s?\/([\w-]{6,40})/))) return { source: "tidal", url: `https://embed.tidal.com/${m[1]}s/${m[2]}` };
  if (h === "deezer.com" && (m = p.match(/^\/(?:[a-z]{2}\/)?(playlist|album)\/(\d{1,15})/))) return { source: "deezer", url: `https://api.deezer.com/${m[1]}/${m[2]}` };
  return null;
}

export function parse(src, body) {
  const out = (name, tracks) => ({ source: src, name: clean(name) || "Imported", tracks: tracks.map((t) => ({ title: clean(t.title), artist: clean(t.artist), dur: t.dur > 0 ? Math.round(t.dur) : null, yt: t.yt || null })).filter((t) => t.title).slice(0, 500) });
  if (src === "spotify") {
    const e = json(body, /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.props?.pageProps?.state?.data?.entity;
    if (!e) return null;
    const list = e.trackList?.length ? e.trackList.map((t) => ({ title: t.title, artist: t.subtitle, dur: t.duration / 1000 })) : [{ title: e.title || e.name, artist: (e.artists || []).map((a) => a.name).join(", "), dur: e.duration / 1000 }];
    return out(e.name || e.title, list);
  }
  if (src === "youtube") {
    const d = json(body, /var ytInitialData = (\{[\s\S]*?\});<\/script>/); if (!d) return null;
    const list = [];
    for (const x of walk(d)) {
      const r = x.playlistVideoRenderer, l = x.lockupViewModel;
      if (r?.videoId) list.push({ yt: r.videoId, ...splitTitle(r.title?.runs?.map((t) => t.text).join(""), r.shortBylineText?.runs?.map((t) => t.text).join("")), dur: +r.lengthSeconds });
      else if (l?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
        const md = l.metadata?.lockupMetadataViewModel, ch = md?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content;
        const dur = [...walk(l.contentImage)].map((o) => o.thumbnailBadgeViewModel?.text).find((s) => /^\d+:\d\d/.test(s || ""));
        list.push({ yt: l.contentId, ...splitTitle(md?.title?.content, ch), dur: mmss(dur) });
      }
    }
    const name = d.metadata?.playlistMetadataRenderer?.title || body.match(/<title>([^<]*?)(?: - YouTube)?<\/title>/)?.[1];
    return out(name, list);
  }
  if (src === "apple") {
    const sd = json(body, /id="serialized-server-data">([\s\S]*?)<\/script>/), list = [];
    for (const x of walk(sd)) if (typeof x.id === "string" && x.id.startsWith("track-lockup") && x.title) list.push({ title: x.title, artist: x.artistName || x.subtitleLinks?.[0]?.title, dur: x.duration / 1000 });
    const ld = json(body, /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
    if (!list.length && ld?.track) for (const t of [].concat(ld.track)) list.push({ title: t.name, artist: t.byArtist?.name, dur: iso(t.duration) }); // songs carry no artist here: titles only
    if (!list.length && ld?.["@type"] === "MusicRecording") list.push({ title: ld.name, artist: ld.byArtist?.[0]?.name ?? ld.byArtist?.name, dur: iso(ld.duration) });
    return list.length ? out(ld?.name, list) : null;
  }
  if (src === "tidal") {
    const list = [], one = (row, slot) => row.match(new RegExp(`slot="${slot}"[^>]*>([\\s\\S]*?)</(?:span|time)>`))?.[1];
    for (const [row] of body.matchAll(/<list-item[^>]*product-type="track"[\s\S]*?<\/list-item>/g)) {
      const artists = [...(one(row, "artist") || "").matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => ent(m[1]));
      list.push({ title: ent(one(row, "title")), artist: artists.join(", ") || ent(one(row, "artist")), dur: mmss(one(row, "duration")) });
    }
    return list.length ? out("Tidal playlist", list) : null; // the embed page names no playlist
  }
  if (src === "deezer") {
    let d; try { d = JSON.parse(body); } catch { return null; }
    if (d.error) return null;
    return out(d.title, (d.tracks?.data || []).map((t) => ({ title: t.title, artist: t.artist?.name, dur: t.duration })));
  }
  return null;
}

// Videos on a YouTube results page, best first: [{ id, title }]. Several, because labels often
// switch embedding off for the top hit (player error 101/150) while a lyric or audio upload plays.
export function videos(html, n = 5) {
  const d = json(html, /var ytInitialData = (\{[\s\S]*?\});<\/script>/), out = [], seen = new Set();
  for (const x of walk(d)) {
    const v = x.videoRenderer; if (!v?.videoId || seen.has(v.videoId)) continue;
    seen.add(v.videoId); out.push({ id: v.videoId, title: v.title?.runs?.map((t) => t.text).join("") || "" });
    if (out.length >= n) return out;
  }
  if (!out.length) for (const [, id] of html.matchAll(/"videoId":"([\w-]{11})"/g)) if (!seen.has(id) && seen.add(id) && out.push({ id, title: "" }) >= n) break;
  return out;
}
export const firstVideo = (html) => videos(html, 1)[0] || null;
