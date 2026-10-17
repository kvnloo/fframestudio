import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { CommandStore } from '../../web/src/doc/commands.js';
import { fromV0 } from '../../web/src/doc/project.js';
import { Editor } from '../../web/src/editor.js';

const fixture = () => fromV0({
  schema: 'fframestudio.project/0', id: 'parity', canvas: { fps: 30 },
  shots: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, t0: i * 3, t1: (i + 1) * 3, text: { title: `Clip ${i}` } })),
});

test('an edit updates the authoritative store and views before a blocked worker can reply', async () => {
  const nodes = new Map();
  globalThis.document = { querySelector: (s) => {
    if (!nodes.has(s)) nodes.set(s, { textContent: '' });
    return nodes.get(s);
  } };
  try {
    const editor = Object.create(Editor.prototype);
    editor.store = new CommandStore(fixture());
    editor.videoId = editor.store.doc.videos[0].id;
    editor.rpc = () => new Promise(() => {});
    editor.journal = { append() {} };
    let painted;
    editor.patchViews = () => { painted = editor.store.doc.videos[0].clips[0].textOverrides.title; };
    const pending = editor.run({ type: 'edit-text', clipId: 'c0', field: 'title', value: 'Immediate' });
    assert.equal(editor.store.doc.videos[0].clips[0].textOverrides.title, 'Immediate');
    assert.equal(painted, 'Immediate');
    await pending;
  } finally {
    delete globalThis.document;
  }
});

test('main thread and real module worker replay the same seeded 200 commands including undo and redo', async () => {
  const initial = fixture(), main = new CommandStore(initial), entries = [];
  let seed = 0x5eed;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 200; i++) {
    const clips = main.doc.videos[0].clips, clip = clips[Math.floor(random() * clips.length)];
    const choices = [
      { type: 'edit-text', clipId: clip.id, field: 'title', value: `Seeded ${i}` },
      { type: 'move', clipId: clip.id, index: Math.floor(random() * clips.length) },
      { type: 'trim', clipId: clip.id, duration: 30 + Math.floor(random() * 60) },
      { type: 'duplicate', clipId: clip.id, newId: `copy-${i}` },
      { type: 'edit-style', styleId: 'default', color: '#abcdef' },
      { type: 'group', clipIds: [clip.id], id: `scene-${i}` },
      { type: 'save-version', id: `version-${i}` },
      { type: 'undo' }, { type: 'redo' },
    ];
    const command = choices[Math.floor(random() * choices.length)];
    main.commit(command);
    entries.push({ command, version: main.doc.revision });
  }
  const worker = new Worker(new URL('../helpers/doc-worker.mjs', import.meta.url));
  try {
    worker.postMessage({ id: 1, type: 'replay', value: { document: initial, entries } });
    const [reply] = await once(worker, 'message');
    assert.equal(reply.error, undefined);
    assert.deepEqual(reply.result.doc, main.doc);
    assert.equal(reply.result.undo, main.past.length);
    assert.equal(reply.result.redo, main.future.length);
  } finally {
    await worker.terminate();
  }
});

test('recovery can undo across the saved baseline without the old in-memory history', async () => {
  const { recoveryCommand } = await import('../../web/src/doc/commands.js');
  const original = new CommandStore(fixture());
  original.commit({ type: 'edit-text', clipId: 'c0', field: 'title', value: 'Saved' });
  const saved = original.doc;
  const undone = original.commit({ type: 'undo' });
  const entry = { command: { type: 'undo' }, version: original.doc.revision,
    patches: undone.patches.filter((p) => p.path !== '/revision').map(({ path, after }) => ({ path, after })) };
  const reopened = new CommandStore(saved);
  reopened.commit(recoveryCommand(entry));
  assert.deepEqual(reopened.doc, original.doc);
  reopened.undo();
  assert.equal(reopened.doc.videos[0].clips[0].textOverrides.title, 'Saved');
});

test('persisted undo/redo patches reproduce every step across a saved history boundary', async () => {
  const { recoveryCommand } = await import('../../web/src/doc/commands.js');
  const original = new CommandStore(fixture());
  for (let i = 0; i < 4; i++) original.commit({ type: 'edit-text', clipId: 'c0', field: 'title', value: `Saved ${i}` });
  const reopened = new CommandStore(original.doc);
  for (const type of ['undo', 'undo', 'undo', 'redo', 'redo', 'undo']) {
    const result = original.commit({ type });
    const entry = { command: { type }, version: original.doc.revision,
      patches: result.patches.filter((p) => p.path !== '/revision').map(({ path, after }) => ({ path, after })) };
    reopened.commit(recoveryCommand(entry));
    assert.deepEqual(reopened.doc, original.doc);
  }
});

test('an external change preserves a pending recovery offer as a local conflict', async () => {
  const editor = Object.create(Editor.prototype);
  editor.store = new CommandStore(fixture());
  editor.baseRaw = JSON.stringify(editor.doc);
  editor.journal = { recovery: [{ command: { type: 'edit-text' }, version: 1 }] };
  editor.opening = Promise.resolve();
  editor.api = { read: async () => ({ content: JSON.stringify({ ...editor.doc, title: 'External change' }) }) };
  editor.rpc = async () => ({ doc: editor.doc });
  editor.openJournal = async () => { editor.journal = null; };
  editor.refresh = editor.toast = () => {};
  let conflicted = false;
  editor.externalConflict = () => { conflicted = true; };
  await editor.external(editor.path());
  assert.equal(conflicted, true);
  assert.equal(editor.journal.recovery.length, 1);
});

test('an edit committed during external migration survives the worker reply', async () => {
  const editor = Object.create(Editor.prototype);
  editor.store = new CommandStore(fixture());
  editor.baseRaw = JSON.stringify(editor.doc);
  const baseline = editor.baseRaw, external = { ...editor.doc, title: 'External title' };
  editor.journal = { recovery: [] };
  editor.opening = Promise.resolve();
  editor.api = { read: async () => ({ content: JSON.stringify(external) }) };
  let reply, requested;
  const started = new Promise((resolve) => { requested = resolve; });
  editor.rpc = () => { requested(); return new Promise((resolve) => { reply = resolve; }); };
  editor.openJournal = editor.refresh = editor.toast = () => {};
  let conflicted = false;
  editor.externalConflict = () => { conflicted = true; };
  const pending = editor.external(editor.path());
  await started;
  editor.store.commit({ type: 'edit-text', clipId: 'c0', field: 'title', value: 'Edit during reload' });
  editor.dirty = true;
  reply({ doc: external }); await pending;
  assert.equal(conflicted, true);
  assert.equal(editor.doc.videos[0].clips[0].textOverrides.title, 'Edit during reload');
  assert.equal(editor.baseRaw, baseline);
  assert.equal(editor.store.past.length, 1);
});

test('global Save shortcut is gated while recovery is opening', async () => {
  globalThis.document = { querySelector: () => ({ open: false }) };
  try {
    const editor = Object.create(Editor.prototype);
    editor.loading = true;
    editor.settings = {};
    let saves = 0;
    editor.save = async () => { saves++; };
    editor.key({ target: { matches: () => false }, key: 's', ctrlKey: true, preventDefault() {} });
    await Promise.resolve();
    assert.equal(saves, 0);
  } finally { delete globalThis.document; }
});
