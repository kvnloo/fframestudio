import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GenerationQueue, safePath, settingsFor } from '../../bridge/generation/queue.mjs';
import { LTX, providers, validateCapability } from '../../bridge/generation/providers.mjs';
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
