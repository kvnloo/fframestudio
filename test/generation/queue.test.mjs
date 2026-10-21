import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { GenerationQueue, safePath, settingsFor, referenceFor, pngSize } from '../../bridge/generation/queue.mjs';
import { LTX, providers, runProcess, validateCapability } from '../../bridge/generation/providers.mjs';
import { CommandStore } from '../../web/src/doc/commands.js';
import { fromV0, validate } from '../../web/src/doc/project.js';
import { generatedCommand } from '../../web/src/generation.js';

const settings = (overrides = {}) => ({ providerId: 'fake', projectId: 'p', prompt: 'A teal sphere moving through warm studio light.', seed: 42, duration: 3, width: 704, height: 480, fps: 24, ...overrides });
const fixture = () => fromV0({ schema: 'fframestudio.project/0', id: 'p', title: 'P', canvas: { fps: 30 }, shots: [{ id: 'original', name: 'Original', t0: 0, t1: 2, text: { title: 'Untouched' } }] });
async function world(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-generation-'));
  await fs.mkdir(path.join(root, 'projects/p'), { recursive: true });
  await fs.writeFile(path.join(root, 'projects/p/project.json'), JSON.stringify(fixture()));
  const events = [], q = new GenerationQueue({ root, providers: providers({ fake: true }), publish: e => events.push(e), ...options });
  await q.ready;
  t.after(async () => { await q.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, q, events };
}
async function until(fn, message = 'condition timed out') {
  const end = Date.now() + 30000;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 25)); }
  throw Error(message);
}
const done = (q, id) => until(() => { const j = q.list().find(j => j.id === id); return ['done', 'failed', 'cancelled'].includes(j?.state) && j; });

test('provider capability schema, runtime probes and strict settings', async () => {
  validateCapability(LTX);
  for (const patch of [{ modes: ['chat'] }, { maxDuration: -1 }, { fps: [] }, { resolutions: [[1, 2]] }, { licence: null }, { vram: {} }, { cost: {} }]) assert.throws(() => validateCapability({ ...LTX, ...patch }));
  for (const patch of [{ output: '../../outside' }, { apiKey: 'never-accepted' }, { projectId: '../p' }, { seed: -1 }, { fps: 30 }, { duration: 100 }, { width: 1920 }, { prompt: '' }]) assert.throws(() => settingsFor(settings(patch), { ...LTX, id: 'fake' }));
  const hosted = providers().find(p => p.capability.id === 'hosted-experimental');
  assert.equal((await hosted.probe()).available, false);
  await assert.rejects(hosted.generate(), /unavailable/);
});
test('safe paths reject traversal, absolute paths and linked output ancestors', async t => {
  const { root, q } = await world(t), outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-gen-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  for (const p of ['../outside', '/absolute', 'projects/../outside', 'projects\\p', 'projects//p']) await assert.rejects(safePath(root, p, { create: true }), /unsafe/);
  await fs.symlink(outside, path.join(root, 'projects/p/media'));
  await assert.rejects(safePath(root, 'projects/p/media/generated/clip/result.mp4', { create: true }), /unsafe/);
  const j = await q.submit(settings()); assert.equal((await done(q, j.id)).error, 'unsafe-path');
  assert.deepEqual(await fs.readdir(outside), []);
});
test('fake provider succeeds, validates media, emits progress and persists provenance', async t => {
  const { root, q, events } = await world(t);
  const j = await q.submit(settings()), completed = await done(q, j.id);
  assert.equal(completed.state, 'done'); assert.equal(completed.progress, 1);
  assert.deepEqual([...new Set(events.map(e => e.job.state))], ['queued', 'running', 'done']);
  assert.ok(events.some(e => e.job.progress > 0 && e.job.progress < 1));
  const saved = JSON.parse(await fs.readFile(path.join(root, '.generation/jobs', j.id + '.json')));
  assert.deepEqual(saved, completed);
  const sidecar = JSON.parse(await fs.readFile(path.join(root, 'projects/p', completed.result.sidecar)));
  assert.equal(sidecar.seed, 42); assert.equal(sidecar.prompt, j.settings.prompt); assert.equal(sidecar.machineGenerated, true);
  assert.equal(sidecar.media.codec, 'h264'); assert.equal(sidecar.media.width, 704); assert.equal(sidecar.media.height, 480);
  assert.match(sidecar.media.sha256, /^[a-f0-9]{64}$/);
  // Asset + clip is one atomic command. Preview and invalid transactions cannot mutate sources.
  const store = new CommandStore(fixture()), original = structuredClone(store.doc);
  const cmd = generatedCommand(completed, store.doc, store.doc.videos[0].id);
  store.preview(cmd); assert.deepEqual(store.doc, original);
  store.apply(cmd); assert.equal(store.past.length, 1); assert.equal(store.doc.media.length, 1);
  assert.equal(store.doc.videos[0].clips.at(-1).mediaId, store.doc.media[0].id);
  const imported = JSON.parse(JSON.stringify(store.doc)); validate(imported);
  store.undo(); assert.deepEqual({ ...store.doc, revision: 0 }, original);
  store.redo(); assert.deepEqual(store.doc.media, imported.media);
  assert.deepEqual(store.doc.videos[0].clips[0], original.videos[0].clips[0]);
  const reopened = new CommandStore(JSON.parse(JSON.stringify(store.doc)));
  assert.equal(reopened.doc.media[0].generation.seed, 42);
  assert.throws(() => store.apply(cmd), /already imported/);
  const beforeFailure = structuredClone(store.doc);
  assert.throws(() => store.apply({ type: 'batch', commands: [{ ...cmd, media: { ...cmd.media, id: 'another-media' }, clipId: 'another-clip' }, { type: 'trim', clipId: 'original', duration: -2 }] }));
  assert.deepEqual(store.doc, beforeFailure);
});
test('failure, invalid output, mid-run and queued cancellation; retry keeps seed', async t => {
  const { q } = await world(t);
  const failed = await q.submit(settings({ prompt: '[test:fail]' }));
  assert.equal((await done(q, failed.id)).state, 'failed');
  const retry = await q.retry(failed.id); assert.notEqual(retry.id, failed.id); assert.equal(retry.retryOf, failed.id); assert.equal(retry.settings.seed, failed.settings.seed);
  await done(q, retry.id);
  const invalid = await q.submit(settings({ prompt: '[test:invalid]' })); assert.equal((await done(q, invalid.id)).result, null);
  const running = await q.submit(settings());
  await until(() => q.list().find(j => j.id === running.id)?.state === 'running');
  const waiting = await q.submit(settings({ seed: 7 }));
  assert.equal((await q.cancel(waiting.id)).state, 'cancelled');
  assert.equal((await q.cancel(running.id)).state, 'cancelled');
  const replacement = await q.retry(running.id); assert.equal((await done(q, replacement.id)).state, 'done');
  await assert.rejects(q.retry(replacement.id), /not-retryable/);
});
test('restart recovers running and queued jobs as interrupted, no automatic expensive rerun', async t => {
  const { root, q } = await world(t);
  const completed = await q.submit(settings()); await done(q, completed.id);
  const journal = JSON.parse(await fs.readFile(path.join(root, '.generation/jobs', completed.id + '.json')));
  await q.close();
  for (const [id, state] of [['interrupted-running', 'running'], ['interrupted-queued', 'queued']]) await fs.writeFile(path.join(root, '.generation/jobs', id + '.json'), JSON.stringify({ ...journal, id, state, progress: 0.2, result: null }));
  const restarted = new GenerationQueue({ root, providers: providers({ fake: true }) }); t.after(() => restarted.close()); await restarted.ready;
  assert.equal(restarted.list().find(j => j.id === completed.id).state, 'done');
  for (const id of ['interrupted-running', 'interrupted-queued']) {
    const j = restarted.list().find(j => j.id === id); assert.equal(j.state, 'failed'); assert.equal(j.error, 'interrupted');
    assert.equal(JSON.parse(await fs.readFile(path.join(root, '.generation/jobs', id + '.json'))).state, 'failed');
  }
});
test('concurrent submissions reserve bounded queue capacity before async probes', async t => {
  const provider = { capability: { ...LTX, id: 'fake' },
    async probe() { await new Promise(r => setTimeout(r, 10)); return { available: true }; },
    async generate(settings, { signal }) { if (signal.aborted) throw Error('cancelled'); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw Error('cancelled'); } };
  const { q } = await world(t, { providers: [provider] });
  const attempts = await Promise.allSettled(Array.from({ length: 40 }, (_, seed) => q.submit(settings({ seed }))));
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 32);
  assert.equal(attempts.filter(a => a.status === 'rejected' && a.reason.message === 'queue-full').length, 8);
  assert.equal(q.list().length, 32);
  await q.close();
});
test('provider exception credentials never enter events or journal', async t => {
  const secret = 'planted-test-key-' + crypto.randomUUID();
  const provider = { capability: { ...LTX, id: 'fake' }, async probe() { return { available: true }; }, async generate() { throw Error('Upstream returned key=' + secret); } };
  const { root, q, events } = await world(t, { providers: [provider] });
  const j = await q.submit(settings()); await done(q, j.id);
  const serialized = JSON.stringify(events) + await fs.readFile(path.join(root, '.generation/jobs', j.id + '.json'));
  assert.equal(serialized.includes(secret), false);
});
// Image-to-video from a captured playhead frame (fake provider: holds the frame; not AI).
const png = async (root, w = 704, h = 480) => {
  const file = path.join(root, `ref-${w}x${h}.png`);
  await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=0x2a9d8f:s=${w}x${h}`, '-frames:v', '1', '-y', file], { timeout: 15000 });
  return fs.readFile(file);
};
const source = id => ({ id, videoId: 'v1', clipId: 'clip-a', clipName: 'Opening', mediaId: null, frame: 12, sourceTime: 0.4 });
test('i2v is schema-gated: only providers advertising i2v accept a reference', () => {
  const id = crypto.randomUUID(), fake = { ...LTX, id: 'fake', modes: ['t2v', 'i2v'] };
  assert.throws(() => settingsFor(settings({ mode: 'i2v', reference: source(id) }), { ...LTX, id: 'fake', modes: ['t2v'] }), /unsupported-mode/);
  assert.equal(settingsFor(settings(), fake).mode, 't2v');
  const ok = settingsFor(settings({ mode: 'i2v', reference: source(id) }), fake);
  assert.equal(ok.mode, 'i2v'); assert.deepEqual(ok.reference, source(id));
  for (const reference of [undefined, { ...source(id), path: '/etc/passwd' }, { ...source(id), id: '../x' }, { ...source(id), url: 'https://x' }, { ...source(id), frame: -1 }, { ...source(id), sourceTime: NaN }, { ...source(id), clipId: '../c' }])
    assert.throws(() => settingsFor(settings({ mode: 'i2v', reference }), fake), /invalid-reference/);
  assert.throws(() => settingsFor(settings({ reference: source(id) }), fake), /invalid-reference/);
  assert.throws(() => settingsFor(settings({ mode: 'v2v' }), fake), /invalid-settings/);
  assert.equal(referenceFor(source(id)).clipName, 'Opening');
  assert.throws(() => pngSize(Buffer.from('GIF89a not a png at all, definitely not')), /invalid-reference/);
});
test('reference store: PNG only, server-named, no overwrite; i2v job records provenance and retry reuses it', async t => {
  const { root, q, events } = await world(t);
  await assert.rejects(q.addReference('p', Buffer.from('not an image')), /invalid-reference/);
  await assert.rejects(q.addReference('../p', await png(root)), /invalid-settings/);
  await assert.rejects(q.addReference('missing', await png(root)), /unknown-project/);
  const bytes = await png(root), ref = await q.addReference('p', bytes);
  assert.match(ref.file, /^media\/generated\/references\/[0-9a-f-]{36}\.png$/); assert.equal(ref.width, 704); assert.equal(ref.height, 480);
  assert.deepEqual(await fs.readFile(path.join(root, 'projects/p', ref.file)), bytes);
  assert.equal((await fs.readdir(path.join(root, 'projects/p/media/generated/references'))).length, 1, 'temp file left behind');
  await assert.rejects(q.submit(settings({ mode: 'i2v', reference: source(crypto.randomUUID()) })), /unknown-reference/);
  const small = await q.addReference('p', await png(root, 480, 480));
  await assert.rejects(q.submit(settings({ mode: 'i2v', reference: source(small.id) })), /reference-mismatch/);
  const j = await q.submit(settings({ mode: 'i2v', reference: source(ref.id) }));
  assert.equal(j.mode, 'i2v'); assert.equal(j.reference.sha256, ref.sha256); assert.equal(j.reference.frame, 12);
  const completed = await done(q, j.id); assert.equal(completed.state, 'done');
  const sidecar = JSON.parse(await fs.readFile(path.join(root, 'projects/p', completed.result.sidecar)));
  assert.equal(sidecar.mode, 'i2v'); assert.equal(sidecar.reference.file, ref.file); assert.equal(sidecar.reference.clipId, 'clip-a');
  assert.equal(sidecar.reference.sourceTime, 0.4); assert.equal(sidecar.reference.sha256, ref.sha256);
  // Fake i2v holds the reference frame: the decoded 1 s frame is the teal fill, not testsrc2.
  const [r, g, b] = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', path.join(root, 'projects/p', completed.result.file), '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  assert.ok(Math.abs(r - 0x2a) < 12 && Math.abs(g - 0x9d) < 12 && Math.abs(b - 0x8f) < 12, `reference not used: ${r},${g},${b}`);
  // Insert carries reference provenance and is one undoable transaction.
  const store = new CommandStore(fixture()), original = structuredClone(store.doc);
  store.apply(generatedCommand(completed, store.doc, store.doc.videos[0].id));
  assert.equal(store.doc.media[0].generation.reference.frame, 12); validate(JSON.parse(JSON.stringify(store.doc)));
  store.undo(); assert.deepEqual({ ...store.doc, revision: 0 }, original);
  const cancelled = await q.cancel((await q.submit(settings({ mode: 'i2v', reference: source(ref.id) }))).id);
  const retry = await q.retry(cancelled.id);
  assert.equal(retry.reference.id, ref.id); assert.equal(retry.reference.sha256, ref.sha256); assert.equal((await done(q, retry.id)).state, 'done');
  // A reference changed after submission fails the job instead of conditioning on other bytes.
  const front = await q.submit(settings({ seed: 8 }));
  const swapped = await q.submit(settings({ mode: 'i2v', reference: source(ref.id), seed: 9 }));
  await fs.writeFile(path.join(root, 'projects/p', ref.file), await png(root, 704, 480).then(() => execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=704x480', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'])));
  assert.equal((await done(q, front.id)).state, 'done');
  const failed = await done(q, swapped.id);
  assert.equal(failed.state, 'failed'); assert.equal(failed.error, 'unknown-reference'); assert.equal(failed.result, null);
  assert.ok(events.every(e => !JSON.stringify(e).includes(root)), 'absolute paths leaked into events');
});
