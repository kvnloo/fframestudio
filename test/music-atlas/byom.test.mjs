import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlaylist, plexTrack, spotifyTrack, mineTrack } from "../../web/src/music-atlas/byom.js";

test("VLC/M3U playlists match library files by name, whatever the path style", () => {
  const m3u = "#EXTM3U\n#EXTINF:200,Artist - One\nC:\\Music\\Artist\\01 One.mp3\n../Two%20Song.flac\n\n";
  assert.deepEqual(parsePlaylist("Road trip.m3u8", m3u), { name: "Road trip", files: ["01 one.mp3", "two song.flac"] });
  const xspf = `<?xml version="1.0"?><playlist version="1"><title>Night drive</title><trackList><track><location>file:///home/me/Music/A%20%26%20B.mp3</location></track></trackList></playlist>`;
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
