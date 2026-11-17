// Aural: the pure half of the audiophile engine (soundscapes, evolve rounds, combo keys, synthetic rooms)
// and the opt-in local server's safety rules (Host, Origin, verb allowlists), with no audio hardware.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC, DEFAULTS, SOUNDSCAPES, scapeById, normalize, variants, comboKey, parseCombo, AXES, ROOMS, synthRoom } from "../../web/src/music-atlas/aural.js";
import { handler } from "../../tools/aural-local/server.mjs";

const COMBO = /^[a-z0-9-]{1,24}\|-?\d{1,2}\.\d(,-?\d{1,2}\.\d){4}$/; // tools/sound-atlas-api/social.js

test("every soundscape is complete, in range and unique", () => {
  assert.ok(SOUNDSCAPES.length >= 10);
  assert.equal(scapeById.size, SOUNDSCAPES.length);
  for (const s of SOUNDSCAPES) {
    assert.match(s.id, /^[a-z0-9-]{1,24}$/, s.id);
    assert.ok(s.name && s.desc && s.group, s.id);
    assert.deepEqual(Object.keys(s.params).sort(), SPEC.map((x) => x.key).sort());
    for (const k of SPEC) assert.ok(s.params[k.key] >= k.min && s.params[k.key] <= k.max, `${s.id}.${k.key}`);
  }
});

test("normalize clamps, fills defaults and ignores junk", () => {
  const p = normalize({ bass: 99, air: -99, tilt: "x", nope: 1 });
  assert.equal(p.bass, SPEC.find((s) => s.key === "bass").max);
  assert.equal(p.air, SPEC.find((s) => s.key === "air").min);
  assert.equal(p.tilt, DEFAULTS.tilt);
  assert.ok(!("nope" in p));
});

test("evolve rounds: variant 1 is the current sound, the rest differ audibly and stay in range", () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const round of [0, 3, 9]) {
    const v = variants(DEFAULTS, round, rnd);
    assert.equal(v.length, 4);
    assert.deepEqual(v[0], normalize(DEFAULTS));
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++)
      assert.ok(Math.max(...AXES.map((a) => Math.abs(v[i][a] - v[j][a]))) >= 0.5, `round ${round} ${i}/${j} too close`);
    for (const x of v) for (const a of AXES) assert.ok(x[a] >= -6 && x[a] <= 6);
  }
});

test("combo keys round-trip and always pass the server's validator", () => {
  for (const s of SOUNDSCAPES) {
    const k = comboKey(s.id, { ...s.params, bass: 2.26, air: -0.2 });
    assert.match(k, COMBO, k);
    const back = parseCombo(k);
    assert.equal(back.scape, s.id);
    assert.equal(back.eq.bass, 2.5); assert.equal(back.eq.air, 0);
    assert.equal(comboKey(back.scape, back.eq), k);
  }
  assert.equal(parseCombo("nope|0,0,0,0,0"), null);
  assert.equal(parseCombo("clean|0,0"), null);
});

test("synthetic rooms are true-stereo, decay at their RT60 and are deterministic", () => {
  const ctx = { sampleRate: 48000, createBuffer: (ch, n, sr) => { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { numberOfChannels: ch, length: n, sampleRate: sr, getChannelData: (i) => d[i] }; } };
  for (const room of ROOMS) {
    const b = synthRoom(ctx, room, 1), c = synthRoom(ctx, room, 1);
    assert.equal(b.numberOfChannels, 4);
    assert.deepEqual(b.getChannelData(1), c.getChannelData(1));
    const d = b.getChannelData(0), sr = ctx.sampleRate, e = (a, z) => d.slice(a * sr, z * sr).reduce((s, x) => s + x * x, 0);
    // energy 60 dB down by RT60: compare a window at the start with one at RT60 (allow 10 dB slack for noise)
    const early = e(0, 0.02), late = e(room.rt60, room.rt60 + 0.02);
    assert.ok(10 * Math.log10(early / Math.max(late, 1e-30)) > 50, `${room.name} decays too slowly`);
    assert.ok(d.every(Number.isFinite));
  }
});

// --- aural-local ---------------------------------------------------------------------------------------
function call(path, { host = "127.0.0.1:4317", origin, method = "GET", body } = {}) {
  return new Promise((ok) => {
    const chunks = [], headers = { host, ...(origin ? { origin } : {}) };
    const req = { headers, method, url: path, on(ev, f) { if (ev === "data" && body) f(Buffer.from(JSON.stringify(body))); if (ev === "end") setImmediate(f); } };
    const res = { code: 0, h: {}, writeHead(c, h) { this.code = c; this.h = h ?? {}; }, write(d) { chunks.push(Buffer.from(d)); },
      end(d) { if (d) chunks.push(Buffer.from(d)); const t = Buffer.concat(chunks); ok({ code: this.code, h: this.h, body: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }); },
      on() {}, once() {}, emit() {}, removeListener() {} };
    handler(req, res);
  });
}

test("aural-local refuses DNS-rebinding hosts and foreign origins", async () => {
  assert.equal((await call("/health", { host: "evil.example:4317" })).code, 421);
  assert.equal((await call("/health", { origin: "https://evil.example" })).code, 403);
  const ok = await call("/health", { origin: "https://glide-music-picker.vercel.app" });
  assert.equal(ok.code, 200);
  assert.equal(ok.h["access-control-allow-origin"], "https://glide-music-picker.vercel.app");
  assert.equal(ok.json.name, "aural-local");
  assert.equal((await call("/health", { origin: "http://localhost:8873" })).code, 200);
});

test("aural-local only runs allowlisted verbs and known soundscapes", async () => {
  const o = { origin: "http://localhost:8873", method: "POST" };
  assert.equal((await call("/evolve", { ...o, body: { cmd: "rm", arg: "-rf" } })).code, 400);
  assert.equal((await call("/evolve", { ...o, body: { cmd: "select", arg: "1; reboot" } })).code, 400);
  assert.equal((await call("/scape", { ...o, body: { id: "../../bin/sh" } })).code, 400);
  assert.equal((await call("/sink", { ...o, body: { name: "not-a-sink-$(id)" } })).code, 400);
  assert.equal((await call("/brir/7", { origin: o.origin })).code, 404);
});
