import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const moduleURL = new URL('../bridge-client.mjs', import.meta.url);

test('alternate discovery never auto-starts or overwrites the default config', async () => {
  const { ensureBridge } = await import('../lifecycle.mjs');
  const home = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-override-'));
  const before = process.env.FFS_BRIDGE_FILE;
  try {
    process.env.FFS_BRIDGE_FILE = path.join(home, 'missing.json');
    await assert.rejects(ensureBridge({ home }), /Configured bridge is not running/);
    await assert.rejects(fs.stat(path.join(home, '.config/fframestudio/bridge.json')), { code: 'ENOENT' });
  } finally {
    if (before === undefined) delete process.env.FFS_BRIDGE_FILE; else process.env.FFS_BRIDGE_FILE = before;
    await fs.rm(home, { recursive: true });
  }
});

test('startup reuses a healthy bridge and does not replace a live unhealthy one', async () => {
  const { ensureBridge } = await import('../lifecycle.mjs');
  const home = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-start-'));
  const config = path.join(home, '.config/fframestudio/bridge.json');
  await fs.mkdir(path.dirname(config), { recursive: true });
  let healthy = true;
  const server = http.createServer((req, res) => {
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/health' ? { name: 'fframestudio-bridge', ok: true } : { root: home }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const info = { url: `http://127.0.0.1:${server.address().port}`, token: 'test-only-token', pid: process.pid, root: home };
    await fs.writeFile(config, JSON.stringify(info));
    assert.deepEqual(await ensureBridge({ home }), info);
    healthy = false;
    await assert.rejects(ensureBridge({ home }), /live.*unhealthy/);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await fs.rm(home, { recursive: true }); }
});

test('bridge discovery authenticates, rejects remote URLs, never exposes tokens in errors', async () => {
  const { readBridge, requestJSON, editorURL } = await import(moduleURL);
  const home = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-discovery-'));
  const config = path.join(home, '.config/fframestudio/bridge.json');
  await fs.mkdir(path.dirname(config), { recursive: true });
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-only-token');
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"projects":[]}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const info = { url: `http://127.0.0.1:${server.address().port}`, token: 'test-only-token', pid: process.pid, root: home };
    await fs.writeFile(config, JSON.stringify(info));
    assert.deepEqual(await readBridge(home), info);
    assert.deepEqual(await requestJSON(info, '/lib/library.json'), { projects: [] });
    const url = new URL(editorURL(info, 'hermes-x-tern'));
    assert.equal(url.searchParams.get('to'), '#/p/hermes-x-tern');
    assert.equal(url.searchParams.get('token'), info.token);
    assert.throws(() => editorURL(info, '../secret'), /project id/);
    await fs.writeFile(config, JSON.stringify({ ...info, url: 'https://example.com' }));
    await assert.rejects(readBridge(home), /loopback/);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await fs.rm(home, { recursive: true }); }
});
