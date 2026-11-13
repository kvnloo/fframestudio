// Tune: dragging a track's meters finds the song that measures like the new settings, while the
// meters you left alone keep the rest of the seed's character.
import test from "node:test";
import assert from "node:assert/strict";
import { tuneMatch, ord } from "../../web/src/music-atlas/sound.js";

const tr = (id, p) => ({ id, p: { tempo: 0.5, bright: 0.5, busy: 0.5, width: 0.5, clarity: 0.5, lra: 0.5, low: 0.5, ...p } });
const seed = tr("seed", { bright: 0.2 });
const pool = [seed, tr("twin", { bright: 0.2 }), tr("bright-only", { bright: 0.9 }), tr("bright-but-fast", { bright: 0.9, tempo: 1, busy: 1 }), tr("other", { tempo: 0.1, width: 0.9 })];

test("moving one meter ranks the song that matches it and nothing else first", () => {
  const rows = tuneMatch(seed, { ...seed.p, bright: 0.9 }, pool, 3);
  assert.equal(rows[0].t.id, "bright-only");
  assert.equal(rows[0].why, "bright");
  assert.ok(rows.findIndex((r) => r.t.id === "bright-but-fast") > 0);
});

test("untouched settings return the closest twin and never the seed itself", () => {
  const rows = tuneMatch(seed, { ...seed.p }, pool, 4);
  assert.equal(rows[0].t.id, "twin");
  assert.ok(!rows.some((r) => r.t === seed));
});

test("tracks without a listening profile are skipped", () => {
  assert.equal(tuneMatch(seed, { ...seed.p }, [seed, { id: "x" }], 4).length, 0);
});

test("with the seed in the pool, untouched settings keep the seed playing; a big move changes it", () => {
  assert.equal(tuneMatch(seed, { ...seed.p }, pool, 3, { withSeed: true })[0].t.id, "seed");
  assert.equal(tuneMatch(seed, { ...seed.p, bright: 0.9 }, pool, 3, { withSeed: true })[0].t.id, "bright-only");
});

test("percentiles read as English ordinals (42nd, 63rd, 11th, 100th), not 42th", () => {
  assert.deepEqual([1, 2, 3, 11, 12, 13, 21, 42, 63, 100, 0].map(ord), ["1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "42nd", "63rd", "100th", "0th"]);
});
