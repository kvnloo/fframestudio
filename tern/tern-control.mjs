import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Node pipes are sockets on Linux: /dev/stdin cannot reliably be reopened by Tern.
 * A private, short-lived scenario file keeps the credential out of argv and logs.
 */
export async function controlFile(command, invoke) {
  const base = process.env.TMPDIR || path.join(os.homedir(), '.cache/fframestudio');
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const dir = await fs.mkdtemp(path.join(base, 'ffs-control-'));
  const file = path.join(dir, 'open.txt');
  try {
    await fs.writeFile(file, command, { mode: 0o600 });
    return await invoke(['ctl', '--file', file]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
