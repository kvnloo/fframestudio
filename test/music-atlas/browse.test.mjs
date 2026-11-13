import { test } from "node:test";
import assert from "node:assert/strict";
import { artists, albums, genres, detail, artistsOf, remember, shuffled } from "../../web/src/music-atlas/browse.js";

const T = (id, author, extra = {}) => ({ id, title: id, author, family: "ambient", style: "drone", ...extra });
const lib = [
  T("a1", "Tide Room", { album: "Harbour", track: "2/9" }),
  T("a2", "Tide Room", { album: "Harbour", track: "1/9" }),
  T("a3", "Tide Room"),
  T("b1", "Grid Kids, Tide Room", { album: "Night Shift", family: "electronic", style: "synthwave" }),
  T("c1", "Simon & Garfunkel", { album: "Harbour" }),
  T("k1", "Kevin MacLeod"),
];

test("artists credit every listed act, keep '&' acts whole, most songs first", () => {
  assert.deepEqual(artistsOf({ author: "A feat. B; C" }), ["A", "B", "C"]);
  const a = artists(lib);
  assert.equal(a[0].name, "Tide Room"); assert.equal(a[0].tracks.length, 4); assert.equal(a[0].albums, 2);
  assert.ok(a.some((x) => x.name === "Simon & Garfunkel"));
});

test("albums group by name, order by track number, name a mixed album Various artists", () => {
  const h = albums(lib).find((x) => x.name === "Harbour");
  assert.deepEqual(h.tracks.map((t) => t.id), ["a2", "a1", "c1"]);
  assert.equal(h.artist, "Various artists");
  assert.equal(albums(lib).length, 2, "tracks without an album tag are not albums");
});

test("genres nest styles under families, biggest first", () => {
  const g = genres(lib);
  assert.equal(g[0].id, "ambient"); assert.equal(g[0].n, 5); assert.equal(g[1].styles[0].key, "electronic.synthwave");
});

test("an artist page lists their albums then loose songs, and its tracks are the play order", () => {
  const d = detail("a:tide room", lib);
  assert.equal(d.name, "Tide Room");
  assert.deepEqual(d.groups.map((g) => g.name), ["Harbour", "Night Shift", "Singles & more"]);
  assert.deepEqual(d.tracks.map((t) => t.id), ["a2", "a1", "b1", "a3"]);
  assert.equal(detail("a:nobody", lib), null);
  assert.equal(detail("g:ambient.drone", lib).tracks.length, 5);
});

test("recent keeps newest first without repeats; shuffle keeps every id", () => {
  assert.deepEqual(remember(["x", "y", "z"], "y"), ["y", "x", "z"]);
  assert.equal(remember([...Array(80).keys()].map(String), "n").length, 60);
  const ids = ["a", "b", "c", "d", "e"]; assert.deepEqual(shuffled(ids).sort(), ids);
});
