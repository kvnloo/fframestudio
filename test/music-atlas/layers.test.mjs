// Layers mixer: the master <audio> stays the clock; stems take over only while the mix differs.
import test from "node:test";
import assert from "node:assert/strict";

class FakeAudio extends EventTarget {
  constructor() { super(); this.currentTime = 0; this.paused = true; this.muted = false; this.playbackRate = 1; this.dataset = {}; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {} removeAttribute() {}
}
globalThis.Audio = FakeAudio;
globalThis.location = { href: "https://example.test/labs/" };
const { createMixer, laneColor, STEMS, loadLayers, lenders } = await import("../../web/src/music-atlas/layers.js");

const L = { stems: [{ k: "drums", f: "stems/x/drums.webm" }, { k: "bass", f: "stems/x/bass.webm" }, { k: "vocals", f: "stems/x/vocals.webm" }] };

test("full mix leaves the master playing and the stems idle", () => {
  const master = new FakeAudio(), m = createMixer(master, (f) => "/" + f);
  m.load("x", L);
  assert.equal(m.engaged, false);
  assert.equal(master.muted, false);
  assert.deepEqual(L.stems.map((s) => m.audible(s.k)), [true, true, true]);
});

test("solo isolates one layer: master goes silent, only that stem is heard", () => {
  const master = new FakeAudio(), m = createMixer(master, (f) => "/" + f);
  m.load("x", L); m.toggleSolo("bass");
  assert.equal(m.engaged, true);
  assert.equal(master.muted, true);
  assert.deepEqual(L.stems.map((s) => m.audible(s.k)), [false, true, false]);
  m.toggleSolo("bass"); // tap again: back to the full mix
  assert.equal(m.engaged, false);
  assert.equal(master.muted, false);
});

test("mute drops one layer; reset restores the original mix", () => {
  const master = new FakeAudio(), m = createMixer(master, (f) => "/" + f);
  m.load("x", L); m.toggleMute("vocals");
  assert.deepEqual(L.stems.map((s) => m.audible(s.k)), [true, true, false]);
  assert.equal(m.changed, true);
  m.reset();
  assert.equal(m.changed, false);
  assert.equal(master.muted, false);
});

test("changing the track source drops the stems", () => {
  const master = new FakeAudio(), m = createMixer(master, (f) => "/" + f);
  m.load("x", L); m.toggleSolo("drums");
  master.dispatchEvent(new Event("emptied"));
  assert.equal(m.id, null);
  assert.equal(master.muted, false);
});

test("every stem has a name and a distinct colour off the same base", () => {
  const cols = Object.keys(STEMS).map((k) => laneColor("#4fa3d6", k));
  assert.equal(new Set(cols).size, cols.length);
  for (const k of Object.keys(STEMS)) assert.ok(STEMS[k].name);
});

test("borrow swaps one lane for a similar song's, stretched to this tempo and on its downbeat", () => {
  const master = new FakeAudio(), m = createMixer(master, (f) => "/" + f);
  m.load("x", L); master.play(); master.currentTime = 12;
  m.borrow("drums", { id: "y", f: "stems/y/drums.webm", rate: 1.25, at: (t) => 0.4 + (t - 0.2) * 1.25 });
  assert.equal(m.changed, true); assert.equal(master.muted, true);
  const lent = m.lent("drums").el;
  assert.equal(lent.playbackRate, 1.25);
  assert.ok(Math.abs(lent.currentTime - (0.4 + 11.8 * 1.25)) < 1e-9);
  assert.equal(lent.muted, false);
  m.toggleSolo("bass"); assert.equal(lent.muted, true); m.toggleSolo("bass");
  m.borrow("drums", null); // give it back: original mix again
  assert.equal(m.changed, false); assert.equal(master.muted, false);
});

test("lenders: only split songs with that layer, within a DJ's stretch, folding double time", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ hop: 0.5, tracks: {
    a: { stems: [{ k: "drums", f: "a/d" }, { k: "bass", f: "a/b" }] },
    near: { stems: [{ k: "drums", f: "n/d" }, { k: "bass", f: "n/b" }] },
    double: { stems: [{ k: "drums", f: "d/d" }, { k: "other", f: "d/o" }] },
    far: { stems: [{ k: "drums", f: "f/d" }, { k: "bass", f: "f/b" }] },
    nobass: { stems: [{ k: "vocals", f: "v/v" }, { k: "other", f: "v/o" }] } } }) });
  await loadLayers("./");
  const bpm = { a: 100, near: 104, double: 52, far: 150, nobass: 100 };
  const beat = (u) => ({ bpm: bpm[u.id], down: 0 });
  const ids = Object.keys(bpm).map((id) => ({ id }));
  const out = lenders({ id: "a" }, "drums", ids, beat);
  assert.deepEqual(out.map((x) => x.id), ["near", "double"]);
  assert.ok(Math.abs(out[1].rate - 100 / 52 / 2) < 1e-9); // 52 bpm rides a 100 cut at half time
  assert.deepEqual(lenders({ id: "a" }, "bass", ids, beat).map((x) => x.id), ["near"]);
});
