import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage ??= { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, String(v)); } };
const { radioNext, crowdRank, compact, sid } = await import("../../web/src/music-atlas/social.js");

const T = (id, f = true) => ({ id, f: f ? {} : null });
const all = ["a", "b", "c", "d", "e", "f", "g"].map((x) => T(x)), byId = new Map(all.map((t) => [t.id, t]));
// a's neighbours by ear, closest first
const neighbours = (cur, pool) => (cur.id === "a" ? ["b", "c", "d", "e", "f", "g"] : pool.map((t) => t.id).filter((x) => x !== cur.id)).map((id) => ({ t: byId.get(id) }));

test("ear radio walks to a close neighbour it hasn't played, never repeating", () => {
  const playedIds = new Set(["b"]);
  assert.equal(radioNext({ kind: "ear", cur: byId.get("a"), all, byId, playedIds, neighbours, rand: () => 0 }).id, "c", "closest unplayed");
  const far = radioNext({ kind: "ear", cur: byId.get("a"), all, byId, playedIds, neighbours, rand: () => 0.999 }).id;
  assert.ok(["c", "d", "e", "f", "g"].slice(0, 5).includes(far), "stays within the top five");
  const seen = new Set(["a"]); let cur = byId.get("a");
  for (let i = 0; i < 6; i++) { cur = radioNext({ kind: "ear", cur, all, byId, playedIds: seen, neighbours, rand: Math.random }); assert.ok(!seen.has(cur.id)); seen.add(cur.id); }
  assert.equal(radioNext({ kind: "ear", cur, all, byId, playedIds: seen, neighbours }), null, "runs out only when everything played");
});

test("crowd radio plays what the room loves first, live listeners count most", () => {
  const r = { likes: { c: 2 }, top: [["d", 5]], now: [["e", 2]] };
  assert.deepEqual(crowdRank(r), ["e", "c", "d"]);
  assert.equal(radioNext({ kind: "crowd", cur: byId.get("e"), all, byId, playedIds: new Set(), neighbours, r }).id, "c");
  assert.equal(radioNext({ kind: "crowd", cur: byId.get("a"), all, byId, playedIds: new Set(["e", "c", "d"]), neighbours, r, rand: () => 0 }).id, "b", "falls back to the ear walk");
});

test("unmeasured tracks still get a next track", () => {
  const raw = [T("x", false), T("y", false)], m = new Map(raw.map((t) => [t.id, t]));
  assert.equal(radioNext({ kind: "ear", cur: raw[0], all: raw, byId: m, playedIds: new Set(), neighbours }).id, "y");
});

test("compact counts and a stable anonymous id", () => {
  assert.deepEqual([0, 999, 1000, 1250, 12500, 2_000_000].map(compact), ["0", "999", "1k", "1.3k", "13k", "2m"]);
  assert.match(sid, /^[a-z0-9]{16,40}$/);
});
