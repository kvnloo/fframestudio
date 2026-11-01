import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fromV0 } from '../../web/src/doc/project.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const snapshot = async file => { try { return { data: await fs.readFile(file), stat: (await fs.stat(file, { bigint: true })).mtimeNs }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

test('authenticated HTTP/SSE, no-secret responses/logs/bundles and real bridge crash recovery', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-gen-http-'));
  const config = path.join(os.homedir(), '.config/fframestudio/bridge.json'), before = await snapshot(config);
  const secret = 'planted-generation-key-' + crypto.randomUUID();
  let child, log = '', stream, controller;
  const p = await port(), base = 'http://127.0.0.1:' + p, token = crypto.randomUUID();
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const call = async (url, method = 'GET', body) => { const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined }); const raw = await r.text(); assert.equal(raw.includes(secret), false); return { status: r.status, data: JSON.parse(raw) }; };
  const start = async () => {
    child = spawn(process.execPath, ['bridge/bridge.mjs', '--root', root, '--port', String(p), '--token', token, '--quiet', '--no-config', '--theme-home', root, '--generation-fake'], { env: { ...process.env, FFS_TEST_SECRET: secret, FFS_PROVIDER_API_KEY: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch {} await sleep(30); }
    throw Error('owned bridge did not start');
  };
  const stop = async signal => { if (child && child.exitCode == null && child.signalCode == null) { const exited = once(child, 'exit'); child.kill(signal); await exited; } child = null; };
  const settings = { providerId: 'fake', projectId: 'p', prompt: 'Studio motion test', seed: 3, duration: 3, width: 704, height: 480, fps: 24 };
  const poll = async id => { for (let i = 0; i < 200; i++) { const { data } = await call('/generation/jobs/' + id); if (['done', 'failed', 'cancelled'].includes(data.state)) return data; await sleep(30); } throw Error('job timed out'); };
  try {
    await fs.mkdir(path.join(root, 'projects/p'), { recursive: true });
    await fs.writeFile(path.join(root, 'projects/p/project.json'), JSON.stringify(fromV0({ schema: 'fframestudio.project/0', id: 'p', shots: [], canvas: { fps: 30 } })));
    await start();
    assert.equal((await fetch(base + '/generation/providers')).status, 401);
    assert.equal((await fetch(base + '/generation/jobs', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify(settings) })).status, 403);
    const caps = await call('/generation/providers'); assert.equal(caps.data.providers.find(p => p.id === 'fake').available, true);
    assert.equal(caps.data.providers.find(p => p.id === 'hosted-experimental').available, false);
    assert.equal((await call('/generation/jobs', 'POST', { ...settings, apiKey: secret })).status, 400);
    controller = new AbortController();
    const events = await fetch(base + '/events', { headers, signal: controller.signal });
    stream = ''; const reader = events.body.getReader();
    const reading = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; stream += new TextDecoder().decode(value); } } catch {} })();
    const created = await call('/generation/jobs', 'POST', settings); assert.equal(created.status, 202);
    assert.equal((await poll(created.data.id)).state, 'done');
    for (let i = 0; i < 100 && !stream.includes('"state":"done"'); i++) await sleep(10);
    assert.ok(stream.includes('"ev":"generation"')); assert.ok(stream.includes('"state":"running"')); assert.ok(stream.includes('"state":"done"'));
    controller.abort(); await reading;
    const failed = await call('/generation/jobs', 'POST', { ...settings, prompt: '[test:fail]' }); assert.equal((await poll(failed.data.id)).error, 'generation-failed');
    const running = await call('/generation/jobs', 'POST', settings);
    const queued = await call('/generation/jobs', 'POST', settings);
    // Wait for the persisted running state, then an actual SIGKILL, not a fixture edit.
    for (let i = 0; i < 100; i++) { if ((await call('/generation/jobs/' + running.data.id)).data.state === 'running') break; await sleep(10); }
    await stop('SIGKILL'); await start();
    for (const id of [running.data.id, queued.data.id]) { const j = (await call('/generation/jobs/' + id)).data; assert.equal(j.state, 'failed'); assert.equal(j.error, 'interrupted'); }
    const retried = await call('/generation/jobs/' + running.data.id + '/retry', 'POST'); assert.equal((await poll(retried.data.id)).state, 'done');
    assert.equal(retried.data.settings.seed, settings.seed);
    assert.equal(log.includes(secret), false); assert.equal(stream.includes(secret), false);
    // Browser-shipped output, rather than an implementation-string assertion.
    for (const rel of ['src/generation.js', 'generation.css', 'dist/acp-client.js']) {
      const bundle = await fetch(base + '/app/' + rel).then(r => r.text()); assert.equal(bundle.includes(secret), false);
    }
    // i2v over HTTP: PNG-only upload, server-named reference, provenance in the job.
    const png = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2a9d8f:s=704x480', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-']);
    const upload = (body, type = 'image/png', project = 'p') => fetch(base + '/generation/references?projectId=' + project, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': type }, body });
    assert.equal((await fetch(base + '/generation/references?projectId=p', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).status, 401);
    assert.equal((await upload(png, 'image/jpeg')).status, 415);
    assert.equal((await upload(Buffer.from('not png'))).status, 400);
    assert.equal((await upload(png, 'image/png', '..%2Fp')).status, 400);
    const ref = await upload(png); assert.equal(ref.status, 201);
    const reference = await ref.json(); assert.match(reference.file, /^media\/generated\/references\/[0-9a-f-]{36}\.png$/);
    assert.equal(JSON.stringify(reference).includes(root), false, 'absolute path leaked');
    const source = { id: reference.id, videoId: 'v', clipId: 'c', clipName: 'Shot', mediaId: null, frame: 3, sourceTime: 0.1 };
    assert.equal((await call('/generation/jobs', 'POST', { ...settings, mode: 'i2v', reference: { ...source, path: '/etc/passwd' } })).data.error, 'invalid-reference');
    const i2v = await call('/generation/jobs', 'POST', { ...settings, mode: 'i2v', reference: source }); assert.equal(i2v.status, 202);
    const i2vDone = await poll(i2v.data.id); assert.equal(i2vDone.state, 'done'); assert.equal(i2vDone.result.provenance.reference.frame, 3);
    const states = await call('/generation/jobs'); assert.equal(states.data.jobs.length, 6);
  } finally {
    controller?.abort(); await stop('SIGTERM');
    assert.deepEqual(await snapshot(config), before, 'test bridge changed shared discovery config');
    await fs.rm(root, { recursive: true, force: true });
  }
});
