import { test } from "node:test";
import assert from "node:assert/strict";
import { search, prep } from "../../web/src/music-atlas/search.js";

const T = (id, title, extra = {}) => prep({ id, title, author: "Kevin MacLeod", feel: "calm", family: "ambient", style: "", tags: [], bpm: 90, ...extra });

test("words match from their start: 'rain' finds rain songs before Brain Dance (#83 bug 4)", () => {
  const all = [T("a", "Brain Dance"), T("b", "Quiet Rain"), T("c", "Rainbows"), T("d", "Terrain Survey"), T("e", "Sunny Day")];
  const ids = search(all, { q: "rain" }).hits.map((h) => h.t.id);
  assert.deepEqual(ids.slice(0, 2).sort(), ["b", "c"]); // whole word and word-prefix lead
  assert.ok(ids.indexOf("a") > 1 && ids.indexOf("d") > 1); // mid-word hits still found, after them
  assert.ok(!ids.includes("e"));
});

test("an exact title phrase still wins outright", () => {
  const all = [T("a", "Night on the Docks"), T("b", "Docks at Night", { desc: "night on the docks" })];
  assert.equal(search(all, { q: "night on the docks" }).hits[0].t.id, "a");
});
