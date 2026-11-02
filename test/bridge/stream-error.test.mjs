import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(here), '../..');
const token = 'stream-error-fixture';

// The subprocess runs the real bridge with only the file stream replaced. IPC
// waits until the client has received a byte before injecting an asynchronous EIO.
if (process.argv.includes('--stream-error-child')) {
  const target = path.resolve(process.env.FFS_STREAM_ERROR_TARGET);
  const mode = process.env.FFS_STREAM_ERROR_MODE;
  const statSync = fs.statSync;
  const createReadStream = fs.createReadStream;
  let statSucceeded = false;
  fs.statSync = function (file, ...args) {
    const stat = statSync.call(fs, file, ...args);
    if (typeof file === 'string' && path.resolve(file) === target && stat.isFile()) statSucceeded = true;
    return stat;
  };
  fs.createReadStream = function (file, options) {
    if (typeof file !== 'string' || path.resolve(file) !== target) return createReadStream.call(fs, file, options);
    assert.equal(statSucceeded, true, 'the bridge must stat the file successfully before opening its stream');
    if (mode === 'range') {
      assert.equal(options?.start, 1);
      assert.equal(options?.end, 3);
    } else {
      assert.equal(mode, 'full');
      assert.equal(options, undefined);
    }
    process.send({ kind: 'armed' });
    const stream = new PassThrough();
    process.once('message', message => {
      if (message === 'inject-error') {
        setImmediate(() => stream.destroy(Object.assign(new Error('synthetic asynchronous read EIO'), { code: 'EIO' })));
      }
    });
    setImmediate(() => stream.write('x'));
    return stream;
  };
  const createServer = http.createServer;
  http.createServer = function (...args) {
    const server = createServer.apply(http, args);
    server.once('listening', () => process.send({ kind: 'ready', port: server.address().port }));
    return server;
  };
  await import('../../bridge/bridge.mjs');
} else {
  function readyPort(child, getStderr) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('bridge startup timed out: ' + getStderr())), 12000);
      function cleanup() {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('error', fail);
        child.off('exit', onExit);
      }
      function fail(error) { cleanup(); reject(error); }
      function onExit(code, signal) { fail(new Error('bridge exited during startup: ' + (code ?? signal) + '\n' + getStderr())); }
      function onMessage(message) {
        if (message?.kind === 'ready') { cleanup(); resolve(message.port); }
      }
      child.on('message', onMessage);
      child.on('error', fail);
      child.on('exit', onExit);
    });
  }

  function requestInterrupted(port, child, range) {
    return new Promise((resolve, reject) => {
      const headers = { Authorization: 'Bearer ' + token };
      if (range) headers.Range = range;
      const req = http.get({ hostname: '127.0.0.1', port, path: '/lib/p/fault.bin', headers }, res => {
        let bytes = 0;
        let signaled = false;
        const done = state => resolve({ state, status: res.statusCode, bytes, contentRange: res.headers['content-range'] });
        res.on('data', chunk => {
          bytes += chunk.length;
          if (!signaled) {
            signaled = true;
            child.send('inject-error');
          }
        });
        res.once('end', () => done('end'));
        res.once('aborted', () => done('aborted'));
        res.on('error', error => error.code === 'ECONNRESET' ? done('aborted') : reject(error));
      });
      req.setTimeout(5000, () => req.destroy(new Error('failed file response did not terminate')));
      req.on('error', reject);
    });
  }

  function requestHealthyFile(port) {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/lib/p/healthy.bin',
        headers: { Authorization: 'Bearer ' + token } }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.once('end', () => resolve({ status: res.statusCode, body }));
        res.on('error', reject);
      });
      req.setTimeout(5000, () => req.destroy(new Error('following file response timed out')));
      req.on('error', reject);
    });
  }

  for (const { mode, range, status } of [
    { mode: 'full', range: null, status: 200 },
    { mode: 'range', range: 'bytes=1-3', status: 206 },
  ]) {
    test('bridge survives asynchronous ' + mode + ' stream EIO after stat', { timeout: 30000 }, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-stream-error-'));
      const project = path.join(root, 'projects', 'p');
      fs.mkdirSync(project, { recursive: true });
      const target = path.join(project, 'fault.bin');
      fs.writeFileSync(target, 'abcdef');
      fs.writeFileSync(path.join(project, 'healthy.bin'), 'still-serving');
      const child = spawn(process.execPath, [here, '--stream-error-child', '--port', '0', '--root', root,
        '--token', token, '--quiet', '--no-config', '--theme-home', root,
        '--agents', path.join(root, 'no-agents.json')], {
        cwd: repoRoot, env: { ...process.env, FFS_STREAM_ERROR_TARGET: target, FFS_STREAM_ERROR_MODE: mode },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let stderr = '';
      let armed = false;
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.stdout.resume();
      child.on('message', message => { if (message?.kind === 'armed') armed = true; });
      try {
        const port = await readyPort(child, () => stderr);
        const broken = await requestInterrupted(port, child, range);
        assert.equal(armed, true, 'the fault-injection stream was used');
        assert.equal(broken.status, status, 'stat succeeded and the correct response headers were sent');
        if (range) assert.equal(broken.contentRange, 'bytes 1-3/6');
        assert.equal(broken.bytes, 1, 'one chunk was received before the asynchronous fault');
        assert.equal(broken.state, 'aborted', 'incomplete response must close rather than hang or finish successfully');
        // Negative control for both paths: deleting the stream error handler in
        // bridge/bridge.mjs crashes this child on EIO; the subsequent request fails.
        assert.deepEqual(await requestHealthyFile(port), { status: 200, body: 'still-serving' });
        assert.equal(child.exitCode, null, 'bridge crashed after stream failure: ' + stderr);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGTERM');
          const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
          try { await exited; } finally { clearTimeout(timer); }
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
