import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

test('bridge compare-and-swap refuses external edit, preserves bytes, accepts matching base', async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-cas-'));
  await fs.writeFile(path.join(root, 'project.json'), 'old');
  const port = await new Promise(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const port = probe.address().port; probe.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, ['bridge/bridge.mjs', '--port', String(port), '--root', root, '--token', 'test-cas', '--no-config', '--theme-home', root], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Owned CAS bridge startup timed out')), 15000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Owned CAS bridge exited before ready')); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const url = `http://127.0.0.1:${port}/fs?path=project.json`, headers = { Authorization: 'Bearer test-cas', 'X-FFS-Expected': createHash('sha256').update('old').digest('hex') };
    await fs.writeFile(path.join(root, 'project.json'), 'external');
    let response = await fetch(url, { method: 'PUT', headers, body: 'local' });
    assert.equal(response.status, 409);
    assert.equal(await fs.readFile(path.join(root, 'project.json'), 'utf8'), 'external');
    headers['X-FFS-Expected'] = createHash('sha256').update('external').digest('hex');
    response = await fetch(url, { method: 'PUT', headers, body: 'local' });
    assert.equal(response.status, 200);
    assert.equal((await (await fetch(url, { headers })).json()).content, 'local');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
    await fs.rm(root, { recursive: true });
  }
});
