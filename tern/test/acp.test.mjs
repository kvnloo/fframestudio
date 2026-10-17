import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('assistant composer handles ordinary keys, paste, movement and Unicode deletion', async () => {
  const { editKey } = await import('../composer.mjs');
  const state = { draft: '', cursor: 0 };
  editKey(state, { name: 'paste', text: 'A😀B' });
  assert.deepEqual(state, { draft: 'A😀B', cursor: 4 });
  editKey(state, { name: 'left' });
  editKey(state, { name: 'backspace' });
  assert.deepEqual(state, { draft: 'AB', cursor: 1 });
  editKey(state, { name: 'home' });
  editKey(state, { name: 'delete' });
  assert.deepEqual(state, { draft: 'B', cursor: 0 });
});

test('assistant presents explicit permission choices without auto-approval', async () => {
  const { assistantView } = await import('../assistant.mjs');
  const { plain, View } = await import('@stencil-hq/tern');
  let chosen;
  const state = { title: 'Film', status: 'Ready', messages: [], agents: [{ id: 'hermes', name: 'Hermes', available: true }], draft: '', cursor: 0,
    permission: { title: 'Write project', options: [{ optionId: 'once', name: 'Allow once' }], resolve: id => { chosen = id; } } };
  const view = assistantView(state, { connect() {}, send() {}, edit() {}, cancel() {} });
  View.from(view);
  assert.equal(chosen, undefined);
  const content = plain(view);
  assert.match(content, /Allow once/);
  assert.match(content, /Deny/);
  assert.match(content, /ACP assistant/);
});

test('ACP filesystem callbacks are confined to the selected project, including symlinks', async () => {
  const { projectFiles } = await import('../acp.mjs');
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-acp-'));
  const project = path.join(root, 'projects/film');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'project.json'), 'original');
  await fs.writeFile(path.join(root, 'outside'), 'private');
  await fs.symlink(path.join(root, 'outside'), path.join(project, 'link'));
  try {
    const api = await projectFiles(root, 'film');
    assert.deepEqual(await api.readTextFile({ path: path.join(project, 'project.json') }), { content: 'original' });
    await api.writeTextFile({ path: path.join(project, 'project.json'), content: 'edited' });
    assert.equal(await fs.readFile(path.join(project, 'project.json'), 'utf8'), 'edited');
    await assert.rejects(api.readTextFile({ path: path.join(root, 'outside') }), /outside/);
    await assert.rejects(api.writeTextFile({ path: path.join(project, 'link'), content: 'bad' }), /outside/);
    assert.equal(await fs.readFile(path.join(root, 'outside'), 'utf8'), 'private');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('project file access cannot escape through symlinks', async () => {
  const { projectFiles } = await import('../acp.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-tern-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-out-'));
  try {
    const project = path.join(root, 'projects', 'p1');
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside');
    await fs.symlink(path.join(outside, 'created.txt'), path.join(project, 'dangling'));
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(project, 'readlink'));
    await fs.symlink(outside, path.join(project, 'dirlink'));
    const api = await projectFiles(root, 'p1');
    await assert.rejects(api.writeTextFile({ path: 'dangling', content: 'x' }), /outside selected project/);
    await assert.rejects(api.writeTextFile({ path: 'dirlink/new', content: 'x' }), /outside selected project/);
    await assert.rejects(api.readTextFile({ path: 'readlink' }), /outside selected project/);
    assert.deepEqual((await fs.readdir(outside)).sort(), ['secret.txt']);
    await api.writeTextFile({ path: 'notes.txt', content: 'ok' });
    assert.equal(await fs.readFile(path.join(project, 'notes.txt'), 'utf8'), 'ok');
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});
