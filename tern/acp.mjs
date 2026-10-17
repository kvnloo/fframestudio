import fs from 'node:fs/promises';
import path from 'node:path';
import { ClientSideConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { wsStream } from '../web/src/acp-client.mjs';
import { projectID, validateBridge } from './bridge-client.mjs';

/** Bound client-mediated filesystem operations; agent processes themselves are NOT sandboxed. */
export async function projectFiles(root, id) {
  const requestedBase = path.resolve(root, 'projects', projectID(id));
  const base = await fs.realpath(requestedBase);
  const fsc = (await import('node:fs')).constants;
  const inside = p => { if (p !== base && !p.startsWith(base + path.sep)) throw new Error('ACP path outside selected project'); return p; };
  const resolve = async (p, write = false) => {
    let candidate = path.resolve(base, p);
    if (candidate === requestedBase || candidate.startsWith(requestedBase + path.sep)) candidate = path.join(base, path.relative(requestedBase, candidate));
    inside(candidate);
    try { return inside(await fs.realpath(candidate)); }
    catch (e) {
      if (!write || e.code !== 'ENOENT') throw e;
      // ENOENT can also mean a dangling symlink; writing through it would create a file outside the project.
      const st = await fs.lstat(candidate).catch(() => null);
      if (st?.isSymbolicLink()) throw new Error('ACP path outside selected project');
      return inside(path.join(inside(await fs.realpath(path.dirname(candidate))), path.basename(candidate)));
    }
  };
  return {
    cwd: base,
    async readTextFile({ path: p, line = 1, limit }) {
      let content = await fs.readFile(await resolve(p), 'utf8');
      if (line !== 1 || limit !== undefined) content = content.split('\n').slice(Math.max(0, line - 1), limit === undefined ? undefined : Math.max(0, line - 1) + limit).join('\n');
      return { content };
    },
    async writeTextFile({ path: p, content }) {
      const target = await resolve(p, true);
      // O_NOFOLLOW: a symlink swapped in after the check makes the write fail instead of escaping.
      const fh = await fs.open(target, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_TRUNC | (fsc.O_NOFOLLOW || 0));
      try { await fh.writeFile(content, 'utf8'); } finally { await fh.close(); }
      return {};
    },
  };
}

export async function connectACP(info, id, agent, handlers) {
  validateBridge(info);
  const files = await projectFiles(info.root, id);
  const ws = new WebSocket(`${info.url.replace(/^http/, 'ws')}/acp?agent=${encodeURIComponent(agent)}`, [`fframestudio.${info.token}`]);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ACP connection timed out')), 12000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ACP connection failed')); }, { once: true });
      ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('ACP connection closed')); }, { once: true });
    });
    ws.addEventListener('close', () => handlers.closed?.());
    const connection = new ClientSideConnection(() => ({
      readTextFile: files.readTextFile,
      writeTextFile: files.writeTextFile,
      sessionUpdate: n => handlers.update?.(n.update),
      requestPermission: async request => {
        const optionId = await handlers.permission?.(request);
        return { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } };
      },
    }), wsStream(ws));
    const init = await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientInfo: { name: 'fframestudio-tern', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false } });
    const session = await connection.newSession({ cwd: files.cwd, mcpServers: [] });
    return {
      init,
      prompt: message => connection.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: `Project: ${path.join(files.cwd, 'project.json')}. Preserve all unrelated fields. Apply text changes under edits[shotId] rather than original shot.text.\n\n${message}` }] }),
      cancel: () => connection.cancel({ sessionId: session.sessionId }),
      close: () => ws.close(),
    };
  } catch (e) { ws.close(); throw e; }
}
