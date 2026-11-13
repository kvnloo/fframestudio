// Playlist import: link -> page to fetch (and nothing else), each service's page shape -> songs, pasted lists,
// and catalogue matching. The fixtures are trimmed to the real pages' shapes (11-12). IMPORT_LIVE=1 also runs
// /api/import against the live services.
import { test } from "node:test";
import assert from "node:assert/strict";
import { source, parse, splitTitle, firstVideo, videos } from "../../tools/sound-atlas-api/_import.js";
import handler from "../../tools/sound-atlas-api/import.js";
import { parseSongList, songKey, matchCatalog } from "../../web/src/music-atlas/byom.js";

test("links map to the one page we read; anything else is refused", () => {
  const ok = {
    "https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x": "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M",
    "https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa": "https://open.spotify.com/embed/album/4m2880jivSbbyEGAKfITCa",
    "https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijk": "https://www.youtube.com/playlist?list=OLAK5uy_abcdefghijk",
    "https://youtu.be/dQw4w9WgXcQ?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI": "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
    "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb": "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb",
    "https://tidal.com/browse/playlist/1b087082-ab54-4e7d-a0d3-b1cf1cf18ebc": "https://embed.tidal.com/playlists/1b087082-ab54-4e7d-a0d3-b1cf1cf18ebc",
    "https://listen.tidal.com/album/12345678": "https://embed.tidal.com/albums/12345678",
    "https://www.deezer.com/fr/playlist/908622995": "https://api.deezer.com/playlist/908622995",
  };
  for (const [k, v] of Object.entries(ok)) assert.equal(source(k)?.url, v, k);
  for (const bad of ["https://evil.com/?list=PLabcdefghijk", "https://open.spotify.com.evil.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "file:///etc/passwd", "http://169.254.169.254/latest", "javascript:alert(1)", "", "Daft Punk - Get Lucky"])
    assert.equal(source(bad), null, bad);
});

test("each service's page shape parses to songs", () => {
  const sp = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: "Hits", trackList: [{ title: "Loser", subtitle: "Tame Impala", duration: 223000 }] } } } } } })}</script>`;
  assert.deepEqual(parse("spotify", sp), { source: "spotify", name: "Hits", tracks: [{ title: "Loser", artist: "Tame Impala", dur: 223, yt: null }] });

  const yd = { metadata: { playlistMetadataRenderer: { title: "Mix" } }, x: [{ lockupViewModel: { contentId: "fOT0BUpITw8", contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
    contentImage: { a: { thumbnailBadgeViewModel: { text: "3:55" } } },
    metadata: { lockupMetadataViewModel: { title: { content: "BELLAKEO (Video Oficial) - Peso Pluma, Anitta" }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: "Peso Pluma" } }] }] } } } } } },
    { playlistVideoRenderer: { videoId: "5NV6Rdv1a3I", title: { runs: [{ text: "Daft Punk - Get Lucky (Official Audio)" }] }, shortBylineText: { runs: [{ text: "Daft Punk" }] }, lengthSeconds: "369" } }] };
  assert.deepEqual(parse("youtube", `<script>var ytInitialData = ${JSON.stringify(yd)};</script>`).tracks, [
    { title: "BELLAKEO", artist: "Peso Pluma, Anitta", dur: 235, yt: "fOT0BUpITw8" },
    { title: "Get Lucky", artist: "Daft Punk", dur: 369, yt: "5NV6Rdv1a3I" }]);

  const ap = `<script type="application/ld+json">{"name":"Today’s Hits","track":[]}</script><script type="application/json" id="serialized-server-data">${JSON.stringify([{ a: { id: "track-lockup - pl.x - 1", title: "Choosin' Texas", artistName: "Ella Langley", duration: "232226" } }])}</script>`;
  assert.deepEqual(parse("apple", ap), { source: "apple", name: "Today’s Hits", tracks: [{ title: "Choosin' Texas", artist: "Ella Langley", dur: 232, yt: null }] });

  const td = `<list-item tabindex="1" product-id="1" product-type="track"><span slot="title">Lola&#39;s Theme</span><span slot="artist"><a href="x">Shapeshifters</a><a href="y">A &amp; B</a></span><time slot="duration">3:27</time></list-item>`;
  assert.deepEqual(parse("tidal", td).tracks, [{ title: "Lola's Theme", artist: "Shapeshifters, A & B", dur: 207, yt: null }]);

  assert.deepEqual(parse("deezer", JSON.stringify({ title: "En mode 60", tracks: { data: [{ title: "Hey Jude", artist: { name: "The Beatles" }, duration: 429 }] } })).tracks, [{ title: "Hey Jude", artist: "The Beatles", dur: 429, yt: null }]);
  assert.equal(parse("deezer", JSON.stringify({ error: { code: 800 } })), null);
  assert.equal(parse("spotify", "<html>consent wall</html>"), null);
});

test("YouTube titles split the right way round", () => {
  assert.deepEqual(splitTitle("Get Lucky", "Daft Punk - Topic"), { artist: "Daft Punk", title: "Get Lucky" });
  assert.deepEqual(splitTitle("Daft Punk - Get Lucky [Official Video]", "DaftPunkVEVO"), { artist: "Daft Punk", title: "Get Lucky" });
  assert.deepEqual(splitTitle("FN8 ( Video Lyric )", "Arcángel"), { artist: "Arcángel", title: "FN8" });
  const html = `<script>var ytInitialData = ${JSON.stringify({ c: [{ videoRenderer: { videoId: "5NV6Rdv1a3I", title: { runs: [{ text: "Get Lucky" }] } } }] })};</script>`;
  assert.deepEqual(firstVideo(html), { id: "5NV6Rdv1a3I", title: "Get Lucky" });
  const vr = (id) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: id }] } } });
  const many = `<script>var ytInitialData = ${JSON.stringify({ c: ["aaaaaaaaaaa", "bbbbbbbbbbb", "aaaaaaaaaaa", "ccccccccccc"].map(vr) })};</script>`;
  assert.deepEqual(videos(many).map((v) => v.id), ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"], "fallbacks, best first, no repeats");
});

test("pasted lists from any app: lines, 'by', numbered, CSV exports", () => {
  assert.deepEqual(parseSongList("1. Daft Punk - Get Lucky\nLoser by Tame Impala\n# comment\nJust A Title"), [
    { artist: "Daft Punk", title: "Get Lucky" }, { title: "Loser", artist: "Tame Impala" }, { title: "Just A Title", artist: "" }]);
  const csv = `"Track URI","Track Name","Artist Name(s)","Album Name"\n"spotify:track:1","Get Lucky (feat. Pharrell Williams)","Daft Punk;Pharrell Williams","RAM"\n"spotify:track:2","Say ""Hi""","A","B"`;
  assert.deepEqual(parseSongList(csv), [{ title: "Get Lucky (feat. Pharrell Williams)", artist: "Daft Punk, Pharrell Williams" }, { title: 'Say "Hi"', artist: "A" }]);
});

test("songs the catalogue has play from it, the rest stay for YouTube", () => {
  assert.equal(songKey("Kevin MacLeod", "Sneaky Snitch (feat. X)"), songKey("kevin macleod", "Sneaky Snitch"));
  const cat = [{ id: "inc-1", src: "inc", author: "Kevin MacLeod", title: "Sneaky Snitch" }];
  const r = { tracks: [{ id: "yt-a", provider: "yt", author: "Kevin MacLeod", title: "Sneaky Snitch" }, { id: "yt-b", provider: "yt", author: "Daft Punk", title: "Get Lucky" }], playlists: [{ id: "im-1", name: "x", ids: ["yt-a", "yt-b"] }] };
  const m = matchCatalog(r, cat);
  assert.deepEqual(m.tracks.map((t) => t.id), ["yt-b"]);
  assert.deepEqual(m.playlists[0].ids, ["inc-1", "yt-b"]);
});

test("/api/import refuses links it doesn't know without fetching anything", async () => {
  const real = globalThis.fetch; let fetched = 0; globalThis.fetch = async () => { fetched++; return new Response(""); };
  try {
    for (const u of ["https://evil.com/x", "http://127.0.0.1:4317/state", "not a url"]) assert.equal((await handler(new Request("https://x/api/import?url=" + encodeURIComponent(u)))).status, 400, u);
    assert.equal((await handler(new Request("https://x/api/import?q="))).status, 400);
    assert.equal(fetched, 0);
  } finally { globalThis.fetch = real; }
});

test("live: every service through /api/import", { skip: !process.env.IMPORT_LIVE }, async () => {
  const links = ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
    "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb", "https://tidal.com/browse/playlist/1b087082-ab54-4e7d-a0d3-b1cf1cf18ebc", "https://www.deezer.com/playlist/908622995"];
  for (const l of links) {
    const r = await handler(new Request("https://x/api/import?url=" + encodeURIComponent(l))), j = await r.json();
    assert.equal(r.status, 200, `${l}: ${j.error}`); assert.ok(j.tracks.length >= 20 && j.tracks.every((t) => t.title && t.artist), l);
    console.log(`  ${j.source}: “${j.name}” · ${j.tracks.length} songs · ${j.tracks[0].artist} - ${j.tracks[0].title}`);
  }
  const s = await (await handler(new Request("https://x/api/import?q=" + encodeURIComponent("Daft Punk Get Lucky")))).json();
  assert.match(s.id, /^[\w-]{11}$/); assert.ok(s.alt.length >= 2, "fallback videos"); console.log(`  search: ${s.id} ${s.title}`);
});
