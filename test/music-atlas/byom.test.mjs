import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlaylist, plexTrack, spotifyTrack, mineTrack, isSpotifyLink, spotifyLink, ytAudio } from "../../web/src/music-atlas/byom.js";

test("VLC/M3U playlists match library files by name, whatever the path style", () => {
  const m3u = "#EXTM3U\n#EXTINF:200,Artist - One\nC:\\Music\\Artist\\01 One.mp3\n../Two%20Song.flac\n\n";
  assert.deepEqual(parsePlaylist("Road trip.m3u8", m3u), { name: "Road trip", files: ["01 one.mp3", "two song.flac"] });
  const xspf = `<?xml version="1.0"?><playlist version="1"><title>Night drive</title><trackList><track><location>file:///srv/Music/A%20%26%20B.mp3</location></track></trackList></playlist>`;
  assert.deepEqual(parsePlaylist("x.xspf", xspf), { name: "Night drive", files: ["a & b.mp3"] });
});

test("Plex tracks stream from the server with the server token, and moods place them on the map", () => {
  const sv = { name: "Den", uri: "https://10-0-0-2.abc.plex.direct:32400", token: "T/k" };
  const t = plexTrack(sv, { ratingKey: "42", title: "Slow Lake", grandparentTitle: "Calm Co", parentTitle: "Waters", duration: 183400, thumb: "/library/metadata/41/thumb/1",
    Media: [{ Part: [{ key: "/library/parts/9/file.flac" }] }], Genre: [{ tag: "Ambient" }], Mood: [{ tag: "Calm" }] });
  assert.equal(t.audio, "https://10-0-0-2.abc.plex.direct:32400/library/parts/9/file.flac?X-Plex-Token=T%2Fk");
  assert.equal(t.src, "mine"); assert.equal(t.provider, "plex"); assert.equal(t.author, "Calm Co"); assert.equal(t.dur, 183);
  assert.equal(t.feel, "calm"); assert.equal(t.family, "ambient");
  assert.match(t.id, /^px-[a-z0-9]+-42$/);
});

test("Spotify tracks carry a URI, no audio, and are never embedded", () => {
  const t = spotifyTrack({ id: "abc", uri: "spotify:track:abc", name: "Neon", artists: [{ name: "A" }, { name: "B" }], album: { name: "City", images: [{ url: "big" }, { url: "mid" }, { url: "small" }] }, duration_ms: 200000, external_urls: { spotify: "https://open.spotify.com/track/abc" } });
  assert.equal(t.audio, null); assert.equal(t.uri, "spotify:track:abc"); assert.equal(t.author, "A, B"); assert.equal(t.art, "mid"); assert.equal(t.noEmbed, true);
});

test("a library mood tag names the feel even when the words don't", () => {
  assert.equal(mineTrack({ id: "m", title: "Den Lullaby", moods: ["Calm"] }).feel, "calm");
});

test("an untagged file still gets a place", () => {
  const t = mineTrack({ id: "my-1", provider: "files", title: "", author: "" });
  assert.equal(t.title, "Untitled"); assert.ok(t.feel && t.family && t.style);
});

test("Spotify share links are recognised; other text is a search", () => {
  for (const s of ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=ab12", "https://open.spotify.com/intl-de/album/4LH4d3cOWNNsVw41Gqt2kv", "spotify:track:4uLU6hMCjMI75M1A2tKUQC", "https://spotify.link/AbCd123"])
    assert.ok(isSpotifyLink(s), s);
  for (const s of ["rainy lofi", "https://youtube.com/watch?v=x", "spotify playlist"]) assert.ok(!isSpotifyLink(s), s);
});

test("a pasted Spotify link becomes your tracks + a playlist; each song streams from its YouTube match via the bridge", async () => {
  const store = new Map(), calls = [];
  globalThis.location = { search: "", hostname: "home.example.ts.net" };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  globalThis.fetch = async (u) => {
    calls.push(String(u)); const p = new URL(u);
    const body = p.pathname === "/api/load" ? { name: "Night Bus", kind: "playlist", tracks: [{ i: 0, title: "Slow Lake", artist: "Calm Co", dur: 183, uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" }, { i: 1, title: "Rush", artist: "Grid Kids", dur: 201, uri: "spotify:track:0VjIjW4GlUZAMYd2vXMi3b" }] }
      : p.pathname === "/api/resolve" ? { id: "5dPwBWvmcbQ", dur: 183, title: "Calm Co - Slow Lake (Official Audio)" } : null;
    return { ok: !!body, status: body ? 200 : 404, json: async () => body ?? { error: "not found" } };
  };
  const r = await spotifyLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", null, false);
  assert.equal(calls[0], "https://home.example.ts.net:8811/api/load?url=" + encodeURIComponent("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"));
  assert.deepEqual(r.playlists.map((p) => [p.name, p.ids]), [["Night Bus", ["yt-4uLU6hMCjMI75M1A2tKUQC", "yt-0VjIjW4GlUZAMYd2vXMi3b"]]]);
  const t = r.tracks[0];
  assert.equal(t.src, "mine"); assert.equal(t.provider, "youtube"); assert.equal(t.yt, true); assert.equal(t.audio, null); assert.equal(t.noEmbed, true);
  assert.equal(t.sourceUrl, "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"); assert.ok(t.feel && t.family);
  assert.equal(await ytAudio(t), "https://home.example.ts.net:8811/api/stream?id=5dPwBWvmcbQ");
  assert.match(calls[1], /\/api\/resolve\?title=Slow\+Lake&artist=Calm\+Co&dur=183$/);
  await ytAudio(t); assert.equal(calls.length, 2, "matched once, then remembered");
  globalThis.location = { search: "?bridge=https://pc.example.ts.net:9000/" };
  await spotifyLink("spotify:album:4LH4d3cOWNNsVw41Gqt2kv", null, false);
  assert.match(calls[2], /^https:\/\/pc\.example\.ts\.net:9000\/api\/load\?/, "?bridge= points at another bridge");
});
