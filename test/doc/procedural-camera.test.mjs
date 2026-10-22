import test from 'node:test';
import assert from 'node:assert/strict';
import { fromV0, validate } from '../../web/src/doc/project.js';
import { CommandStore, proposalCommand } from '../../web/src/doc/commands.js';
import { ACTIONS, validateCommand } from '../../web/src/actions.js';
import { parseIntent } from '../../web/src/intent.js';
import { cameraOverrides, proceduralSource } from '../../web/src/procedural.js';
import { editCamera, frameOf, sampleCamera, sourceKeys, nearestEvent, eventSeconds, changedCells } from '../../web/src/procedural-camera.js';

// Synthetic ff-unmute sidecar (test data, not the upstream film).
const keys = [[0, 600, 3, 0.1, 0.2, 0, 0, 1], [8, 400, 2, 0.2, -0.2, 0.1, 10, 1.2], [16, 560, 1.1, 0.1, 0, 0, 0, 0.5]];
const procedural = () => ({
  family: 'ff-unmute', fps: 30, total_frames: 480, bpm: 120, render_verified: false, source_revision: 'fixture-sha',
  source_sha256: { 'hud/src/lib.rs': 'a'.repeat(64) },
  event_seconds: { kick: [4.0, 4.5, 5.0213], clap: [8.5, 9.5], token: [2.0, 2.4375, 11.75] },
  event_frames: { kick: [120, 135, 151], clap: [255, 285], token: [60, 73, 353], bar: [0, 60, 120, 180, 240, 300, 360, 420] },
  camera_keyframes: keys.map(k => ({ ...Object.fromEntries(['time_s', 'look_y', 'zoom', 'tilt_x', 'tilt_y', 'roll', 'dx', 'blur'].map((f, i) => [f, k[i]])), frame: frameOf(k[0], 30) })),
  camera_interpolation: 'Catmull–Rom', credits: ['Mustafa Saraç · original film · MIT'],
});
const fixture = () => fromV0({ schema: 'fframestudio.project/0', id: 'ff-unmute', title: 'ff-unmute', kind: 'procedural-fframes', canvas: { fps: 30 }, shots: [{ id: 's01', name: 'Continuous camera take', t0: 0, t1: 16 }], renders: [], media: {}, procedural: procedural() });

test('frames use Rust positive half-up rounding, not ties-to-even', () => {
  assert.equal(frameOf(0.75, 30), 23); // 22.5 → 23 (Python round would give 22)
  assert.equal(frameOf(13.5, 30), 405);
});

test('snap to a measured kick keeps exact sub-frame seconds; source sidecar is never mutated', () => {
  const store = new CommandStore(fixture()), source = structuredClone(store.doc.metadata.procedural);
  store.commit({ type: 'edit-procedural-camera', key: 1, snap: { kind: 'kick', index: 3 } });
  const o = store.doc.metadata.proceduralOverrides;
  assert.equal(o.camera_keyframes[1].time_s, 5.0213);
  assert.equal(frameOf(o.camera_keyframes[1].time_s, 30), 151);
  assert.deepEqual(store.doc.metadata.procedural, source);
  assert.deepEqual(o.base, { source_revision: 'fixture-sha', lib_sha256: 'a'.repeat(64) });
  assert.deepEqual(o.stages, ['rust', 'flat', 'lens']);
  store.commit({ type: 'edit-procedural-camera', key: 1, changes: { zoom: 2.75 } });
  assert.deepEqual(changedCells(store.doc.metadata).map(c => c.field), ['time_s', 'zoom']);
  store.commit({ type: 'undo' });
  assert.equal(store.doc.metadata.proceduralOverrides.camera_keyframes[1].zoom, 2);
  store.commit({ type: 'redo' });
  assert.equal(store.doc.metadata.proceduralOverrides.camera_keyframes[1].zoom, 2.75);
  store.commit({ type: 'edit-procedural-camera', key: 1, reset: true });
  assert.equal(store.doc.metadata.proceduralOverrides, undefined, 'reset to source drops the override');
  assert.ok(!('proceduralOverrides' in store.doc.metadata));
});

test('bars are the authored 4/4 grid; out-of-range and reordering edits fail closed', () => {
  assert.equal(eventSeconds(procedural(), 'bar', 3), 4);
  assert.deepEqual(nearestEvent(procedural(), 4.4, 'kick'), { kind: 'kick', index: 2, seconds: 4.5 });
  const store = new CommandStore(fixture());
  for (const [cmd, message] of [
    [{ key: 1, snap: { kind: 'bar', index: 9 } }, /past the end/],
    [{ key: 1, snap: { kind: 'clap', index: 7 } }, /No clap 7/],
    [{ key: 1, changes: { time_s: 16 } }, /must come after/],
    [{ key: 0, changes: { time_s: 1 } }, /pinned/],
    [{ key: 0, snap: { kind: 'kick', index: 1 } }, /pinned/],
    [{ key: 2, changes: { zoom: 0.5 } }, /zoom must be/],
    [{ key: 2, changes: { time_s: 16.5 } }, /end by 16/],
    [{ key: 9, changes: { zoom: 2 } }, /Unknown camera key/],
  ]) assert.throws(() => store.commit({ type: 'edit-procedural-camera', ...cmd }), message);
  assert.throws(() => validateCommand({ type: 'edit-procedural-camera', key: 1, changes: { shader: 1 } }), /unknown parameter/);
  assert.throws(() => validateCommand({ type: 'edit-procedural-camera', key: 1, snap: { kind: 'drop', index: 1 } }), /unsupported value/);
  assert.equal(store.doc.metadata.proceduralOverrides, undefined);
});

test('saved overrides validate against the recorded source hash', () => {
  const store = new CommandStore(fixture());
  store.commit({ type: 'edit-procedural-camera', key: 2, changes: { blur: 0.8 } });
  const doc = structuredClone(store.doc);
  assert.doesNotThrow(() => validate(doc));
  doc.metadata.procedural.source_sha256['hud/src/lib.rs'] = 'b'.repeat(64);
  assert.throws(() => validate(doc), /another source revision/);
  const reordered = structuredClone(store.doc);
  reordered.metadata.proceduralOverrides.camera_keyframes[2].time_s = 1;
  assert.throws(() => validate(reordered), /must come after/);
});

test('voice, palette registry and assistant proposals share the same command', () => {
  const store = new CommandStore(fixture());
  const ctx = { store, get doc() { return store.doc; }, get video() { return store.doc.videos[0]; }, selection: 's01', frame: 0, total: 480 };
  assert.deepEqual(parseIntent('Snap camera key two to kick three', ctx).action, { id: 'edit-procedural-camera', params: { key: 1, snap: { kind: 'kick', index: 3 } } });
  assert.deepEqual(parseIntent('set camera key 3 tilt x to -0.25', ctx).action, { id: 'edit-procedural-camera', params: { key: 2, changes: { tilt_x: -0.25 } } });
  assert.deepEqual(parseIntent('reset camera key 2', ctx).action, { id: 'edit-procedural-camera', params: { key: 1, reset: true } });
  assert.match(parseIntent('move camera key one to bar three', ctx).clarification, /pinned/);
  assert.match(parseIntent('make the camera dive into the bass at bar three', ctx).clarification, /precise action/);
  ACTIONS['edit-procedural-camera'].preview(ctx, { key: 1, snap: { kind: 'bar', index: 3 } });
  assert.equal(store.doc.metadata.proceduralOverrides, undefined, 'preview does not apply');
  const batch = proposalCommand({ schema: 'fframestudio.proposal/1', projectId: 'ff-unmute', baseRevision: store.doc.revision, commands: [{ id: 'edit-procedural-camera', params: { key: 1, changes: { zoom: 2.5 } } }] }, store.doc);
  store.commit(batch);
  assert.equal(store.doc.metadata.proceduralOverrides.camera_keyframes[1].zoom, 2.5);
});

test('camera sampler mirrors hud::camera at keys and clamps zoom', () => {
  const k = sourceKeys(procedural());
  assert.deepEqual(Object.values(sampleCamera(k, 8)), keys[1].slice(1));
  assert.equal(sampleCamera(k, 16).zoom, 1.1);
  assert.ok(sampleCamera(k.map(x => ({ ...x, zoom: 1 })), 12).zoom >= 1);
});

test('working-copy editor is separate from the read-only source and says it is not rendered', () => {
  const store = new CommandStore(fixture());
  const md = store.doc.metadata;
  assert.doesNotMatch(proceduralSource(md, md.shots), /<(?:input|select|button)\b/);
  let html = cameraOverrides(md);
  assert.match(html, /id="procedural-overrides"/);
  assert.match(html, /Not rendered/);
  assert.match(html, /matches source/);
  assert.match(html, /data-camera-key="0" data-camera-field="time_s"[^>]* disabled/);
  assert.equal((html.match(/data-camera-snap=/g) || []).length, 2);
  store.commit({ type: 'edit-procedural-camera', key: 1, snap: { kind: 'kick', index: 3 } });
  html = cameraOverrides(store.doc.metadata, { field: 'look_y', projectPath: '<script>' });
  assert.match(html, /1 override/);
  assert.match(html, /Rust rebuild · hud \+ flat \+ lens → flat pass/);
  assert.match(html, /music\/synth\.py/);
  assert.match(html, /data-camera-reset="1"/);
  assert.match(html, /value="kick:3" selected>on kick 3 · 5\.0213 s/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<option selected>look_y<\/option>/);
  assert.equal(cameraOverrides({ procedural: { family: 'ff-tracking' } }), '');
});
