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
const { createMixer, laneColor, STEMS } = await import("../../web/src/music-atlas/layers.js");

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
