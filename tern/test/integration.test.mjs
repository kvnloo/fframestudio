import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const repo = new URL('../../', import.meta.url).pathname;

test('real bridge starts once from dead discovery; CLI reads library, project and render status', async () => {
  const { ensureBridge } = await import('../lifecycle.mjs');
  const home = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-integration-'));
  const root = path.join(home, 'fframestudio');
  await fs.mkdir(path.join(root, 'projects/film'), { recursive: true });
  await fs.mkdir(path.join(home, '.config/fframestudio'), { recursive: true });
  const library = { projects: [{ id: 'film', title: 'Integration film', kind: 'html-film', shots: 1, duration_s: 2 }] };
  const project = { ...library.projects[0], shots: [{ id: 's1', name: 'First shot', t0: 0, t1: 2, text: { head: 'Real local fixture' } }], renders: [], notes: ['Check timing'] };
  await fs.writeFile(path.join(root, 'projects/library.json'), JSON.stringify(library));
  await fs.writeFile(path.join(root, 'projects/film/project.json'), JSON.stringify(project));
  const socket = net.createServer();
  await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  let info;
  await fs.writeFile(path.join(home, '.config/fframestudio/bridge.json'), JSON.stringify({ url: `http://127.0.0.1:${port}`, token: 'expired-test-token', pid: 2147483647, root }));
  try {
    info = await ensureBridge({ home, port });
    assert.equal((await ensureBridge({ home, port })).pid, info.pid);
    assert.equal((await fs.stat(path.join(home, '.config/fframestudio/bridge.json'))).mode & 0o777, 0o600);
    for (const [args, expected] of [[[], 'Integration film'], [['--project', 'film'], 'Real local fixture'], [['--queue'], 'No render scheduler']]) {
      const result = await exec(process.execPath, ['tern/app.mjs', '--plain', ...args], { cwd: repo, env: { ...process.env, HOME: home } });
      assert.ok(result.stdout.includes(expected), result.stdout);
      assert.ok(!result.stdout.includes(info.token));
      assert.ok(!result.stderr.includes(info.token));
    }
    const response = await fetch(new URL('/open?token=' + info.token + '&to=' + encodeURIComponent('#/p/film'), info.url), { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/#/p/film');
  } finally {
    if (info) { process.kill(info.pid, 'SIGTERM'); for (let i = 0; i < 40; i++) { try { process.kill(info.pid, 0); } catch { break; } await new Promise(r => setTimeout(r, 50)); } }
    await fs.rm(home, { recursive: true, force: true });
  }
});
