// ACP client for fframestudio (browser and Node 22+). Wraps @agentclientprotocol/sdk.
// The studio is the ACP *client*; the agent (Claude Code, Codex, Gemini, Hermes, ...) runs
// locally behind fframestudio-bridge, using its own CLI login (the user's subscription).
import { ClientSideConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

export const CLIENT_INFO = { name: 'fframestudio', title: 'fframestudio', version: '0.1.0' };

/** Turn a WebSocket (one JSON-RPC message per frame) into the SDK's message stream. */
export function wsStream(ws, { onStderr } = {}) {
  const readable = new ReadableStream({
    start(c) {
      ws.addEventListener('message', (e) => {
        let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)); } catch { return; }
        if (m && m.method === '_fframestudio/stderr') { onStderr?.(m.params?.text || ''); return; }
        c.enqueue(m);
      });
      ws.addEventListener('close', () => { try { c.close(); } catch {} });
      ws.addEventListener('error', (e) => { try { c.error(e); } catch {} });
    },
  });
  const writable = new WritableStream({ write(m) { ws.send(JSON.stringify(m)); } });
  return { readable, writable };
}

/** Small REST helper for the bridge (agent list, project files). */
export function bridgeApi(base, token) {
  const h = token ? { Authorization: `Bearer ${token}` } : {}; // no token: same-origin cookie set by /open
  const j = async (r) => { if (!r.ok) throw new Error(`bridge ${r.status}: ${(await r.json().catch(() => ({}))).error || ''}`); return r.json(); };
  return {
    health: () => fetch(`${base}/health`).then(j),
    agents: () => fetch(`${base}/agents`, { headers: h }).then(j),
    read: (p) => fetch(`${base}/fs?path=${encodeURIComponent(p)}`, { headers: h }).then(j),
    write: (p, content) => fetch(`${base}/fs?path=${encodeURIComponent(p)}`, { method: 'PUT', headers: h, body: content }).then(j),
    events: (onEvent) => { const es = new EventSource(token ? `${base}/events?token=${encodeURIComponent(token)}` : `${base}/events`, { withCredentials: true }); es.onmessage = (e) => onEvent(JSON.parse(e.data)); return () => es.close(); },
  };
}

/**
 * Connect to one agent and open a session.
 * handlers: { update(n), permission(req) -> optionId|null, readFile(absPath) -> string|undefined,
 *             wroteFile(absPath, content), stderr(text), closed(reason) }
 */
export async function connectAgent({ bridge, token, agent, cwd, handlers = {}, WebSocketImpl = globalThis.WebSocket }) {
  const ws = new WebSocketImpl(`${bridge.replace(/^http/, 'ws')}/acp?agent=${encodeURIComponent(agent)}`, [token ? `fframestudio.${token}` : 'fframestudio.cookie']);
  await new Promise((ok, bad) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('close', (e) => bad(new Error(`bridge refused connection (${e.code} ${e.reason || ''})`)), { once: true }); });
  ws.addEventListener('close', (e) => handlers.closed?.(e.reason || `closed ${e.code}`));
  const api = bridgeApi(bridge, token);
  const root=handlers.root || cwd;
  const rel = p => root && p.startsWith(root+'/') ? p.slice(root.length+1) : p;
  const client = {
    async sessionUpdate(n) { handlers.update?.(n); },
    async requestPermission(req) {
      const id = await handlers.permission?.(req);
      return id ? { outcome: { outcome: 'selected', optionId: id } } : { outcome: { outcome: 'cancelled' } };
    },
    async readTextFile({ path, line, limit }) {
      let content = await handlers.readFile?.(path);
      if (content === undefined) content = (await api.read(rel(path))).content;
      if (line || limit) { const ls = content.split('\n'); const s = Math.max(0, (line || 1) - 1); content = ls.slice(s, limit ? s + limit : undefined).join('\n'); }
      return { content };
    },
    async writeTextFile({ path, content }) { if(handlers.canWrite && !handlers.canWrite(path))throw Error('Only proposal files may be written by this assistant'); await api.write(rel(path), content); handlers.wroteFile?.(path, content); return {}; },
  };
  const conn = new ClientSideConnection(() => client, wsStream(ws, { onStderr: handlers.stderr }));
  const init = await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }, clientInfo: CLIENT_INFO });
  const session = await conn.newSession({ cwd, mcpServers: [] });
  return {
    init, sessionId: session.sessionId, modes: session.modes, models: session.models,
    prompt: (text, extra = []) => conn.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text }, ...extra] }),
    cancel: () => conn.cancel({ sessionId: session.sessionId }),
    close: () => ws.close(),
  };
}
