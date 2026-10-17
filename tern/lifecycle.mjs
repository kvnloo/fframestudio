import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readBridge, requestJSON } from './bridge-client.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(r => setTimeout(r, ms));
export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
async function healthy(info) {
  try {
    const health = await requestJSON(info, '/health');
    const me = await requestJSON(info, '/me');
    return health.ok && health.name === 'fframestudio-bridge' && me.root === info.root;
  } catch { return false; }
}

/** Only starts a bridge when discovery's PID is absent/dead; never kills an existing process. */
export async function ensureBridge({ home = os.homedir(), root = path.join(home, 'fframestudio'), port = 7878 } = {}) {
  const existing = await readBridge(home);
  if (existing && alive(existing.pid)) {
    if (await healthy(existing)) return existing;
    throw new Error('Bridge PID is live but unhealthy; inspect it before restarting');
  }
  if (process.env.FFS_BRIDGE_FILE) throw new Error('Configured bridge is not running; start its owner first');
  const dir = path.join(home, '.config/fframestudio');
  await fs.mkdir(dir, { recursive: true });
  const lock = path.join(dir, 'tern-start.lock');
  let acquired = false;
  for (let n = 0; n < 80; n++) {
    try { await fs.mkdir(lock); acquired = true; break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw new Error('Cannot acquire bridge startup lock');
      const info = await readBridge(home);
      if (info && alive(info.pid) && await healthy(info)) return info;
      await delay(100);
    }
  }
  if (!acquired) throw new Error('Bridge startup locked; if no launcher is running, remove tern-start.lock');
  try {
    const info = await readBridge(home);
    if (info && alive(info.pid)) {
      if (await healthy(info)) return info;
      throw new Error('Bridge PID is live but unhealthy; inspect it before restarting');
    }
    // writeFile(mode) in the existing bridge does not tighten an existing file.
    // Protect a stale discovery file before the child replaces its credential.
    try { await fs.chmod(path.join(dir, 'bridge.json'), 0o600); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot secure bridge discovery file'); }
    // Ignore all bridge output: /open carries a credential. --quiet is defense in depth.
    const child = spawn(process.execPath, [path.join(repo, 'bridge/bridge.mjs'), '--quiet', '--root', root, '--port', String(port)], {
      cwd: repo, env: { ...process.env, HOME: home }, detached: true, stdio: 'ignore',
    });
    let failed = false;
    child.on('error', () => { failed = true; });
    child.unref();
    for (let n = 0; n < 100; n++) {
      if (failed || child.exitCode !== null) break;
      const next = await readBridge(home);
      if (next?.pid === child.pid && await healthy(next)) return next;
      await delay(100);
    }
    // This child is ours and never became healthy. Do not leave an orphan.
    if (child.pid && alive(child.pid)) child.kill('SIGTERM');
    throw new Error('Bridge did not start; install root dependencies and check port availability');
  } finally { await fs.rmdir(lock); }
}
