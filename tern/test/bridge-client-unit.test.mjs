import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectID, validateBridge, editorURL, requestJSON, readBridge } from '../bridge-client.mjs';

const ok = { url: 'http://127.0.0.1:4100/', pid: 12, root: '/srv/lib', token: 'abc-123' };

test('projectID keeps valid IDs and rejects invalid IDs', () => {
  for (const id of ['abc', 'a.b-c_d', '-x']) {
    assert.equal(projectID(id), id);
  }
  for (const id of ['..', '.hidden', 'a/b', '', 5]) {
    assert.throws(() => projectID(id), /Invalid project id/);
  }
});

test('validateBridge preserves the valid discovery object identity', () => {
  assert.strictEqual(validateBridge(ok), ok);
});

test('validateBridge rejects non-loopback or decorated URLs', () => {
  for (const url of [
    'http://localhost:4100/',
    'https://127.0.0.1:1/',
    'http://127.0.0.1:1/x',
    'http://u:p@127.0.0.1:1/',
    'http://127.0.0.1:1/?q',
    'http://127.0.0.1:1/#h',
  ]) {
    assert.throws(() => validateBridge({ ...ok, url }), /HTTP loopback origin/, url);
  }
  assert.throws(() => validateBridge({ ...ok, url: 'nope' }), /Invalid bridge URL/);
});

test('validateBridge rejects invalid discovery fields', () => {
  for (const info of [
    { ...ok, pid: 0 },
    { ...ok, pid: 1.5 },
    { ...ok, root: 'rel' },
    { ...ok, token: 'a b' },
  ]) {
    assert.throws(() => validateBridge(info), /Invalid bridge discovery data/);
  }
  const missingToken = { ...ok };
  delete missingToken.token;
  assert.throws(() => validateBridge(missingToken), /Invalid bridge discovery data/);
});

test('editorURL encodes the token and project route and rejects unsafe IDs', () => {
  assert.equal(
    editorURL(ok, 'proj'),
    'http://127.0.0.1:4100/open?token=abc-123&to=%23%2Fp%2Fproj',
  );
  assert.equal(editorURL(ok), 'http://127.0.0.1:4100/open?token=abc-123&to=');
  assert.throws(() => editorURL(ok, '../x'), /Invalid project id/);
});

test('requestJSON rejects invalid routes without invoking fetch', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = () => {
      calls += 1;
      throw new Error('Unexpected fetch');
    };
    for (const route of ['//x', 'x']) {
      await assert.rejects(requestJSON(ok, route), /Invalid bridge route/);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestJSON handles HTTP, transport, JSON and success responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(requestJSON(ok, '/health'), /HTTP 403/);

    globalThis.fetch = async () => { throw new Error('Network unavailable'); };
    await assert.rejects(requestJSON(ok, '/health'), /check the local bridge/);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => { throw new SyntaxError('bad JSON'); },
    });
    await assert.rejects(requestJSON(ok, '/health'), /invalid JSON/);

    const body = { projects: [{ id: 'sample' }] };
    let captured;
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => body };
    };
    assert.strictEqual(await requestJSON(ok, '/health'), body);
    assert.deepEqual(captured.options.headers, { Authorization: 'Bearer abc-123' });
    assert.equal(captured.options.redirect, 'error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readBridge handles absent, invalid and valid overridden discovery files', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-bridge-client-unit-'));
  const previousFile = process.env.FFS_BRIDGE_FILE;
  try {
    process.env.FFS_BRIDGE_FILE = path.join(temp, 'missing.json');
    assert.strictEqual(await readBridge(temp), null);

    const file = path.join(temp, 'bridge.json');
    process.env.FFS_BRIDGE_FILE = file;
    await fs.writeFile(file, '{invalid JSON', 'utf8');
    await assert.rejects(readBridge(temp), /Cannot read bridge discovery file/);

    await fs.writeFile(file, JSON.stringify(ok), 'utf8');
    assert.deepEqual(await readBridge(temp), ok);
  } finally {
    if (previousFile === undefined) delete process.env.FFS_BRIDGE_FILE;
    else process.env.FFS_BRIDGE_FILE = previousFile;
    await fs.rm(temp, { recursive: true, force: true });
  }
});
