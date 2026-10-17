#!/usr/bin/env node
// fframestudio bridge: lets the web studio talk ACP to agents installed on this machine.
//
//   browser (studio) --WebSocket, one JSON-RPC message per frame--> bridge --stdio NDJSON--> agent
//
// Security model (the bridge can start agents that run shell commands):
//  - listens on 127.0.0.1 only
//  - a random token per launch; WebSocket clients send it as a subprotocol ("fframestudio.<token>"),
//    HTTP clients as "Authorization: Bearer <token>"
//  - Origin must be in the allowlist (loopback by default, plus --allow-origin), and the Host header
//    must be loopback, which blocks DNS-rebinding pages
//  - agents run with cwd = --root (the project folder); /fs only reads and writes inside it
//
// Usage: fframestudio-bridge [--port 7878] [--root DIR] [--allow-origin URL]... [--token T]
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';
import { AGENTS as BUILTIN } from './agents.mjs';

const VERSION = '0.1.0';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const all = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));
const PORT = Number(opt('--port', 7878));
const ROOT = path.resolve(opt('--root', path.join(os.homedir(), 'fframestudio')));
const TOKEN = opt('--token', process.env.FFS_BRIDGE_TOKEN || randomBytes(24).toString('base64url'));
const ORIGINS = new Set(all('--allow-origin'));
const QUIET = argv.includes('--quiet');
const WEB = path.resolve(opt('--web', path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'web')));
const LIBDIR = path.join(ROOT, 'projects');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8' };
const cookieTok = (req) => (String(req.headers.cookie || '').match(/(?:^|;\s*)ffs=([^;]+)/) || [])[1];
// Files outside the library are served only if some project.json references them by absolute path.
function referenced() {
  const set = new Set();
  try { for (const id of fs.readdirSync(LIBDIR)) { const f = path.join(LIBDIR, id, 'project.json'); if (!fs.existsSync(f)) continue;
    const walk = (v) => { if (typeof v === 'string') { if (v.startsWith('/')) set.add(path.resolve(v)); } else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(JSON.parse(fs.readFileSync(f, 'utf8'))); } } catch {}
  return set;
}
function serveFile(req, res, file) {
  let st; try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch { return send(res, 404, { error: 'not found' }); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) { const a = range[1] ? +range[1] : Math.max(0, st.size - +range[2]), z = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    if (a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${z}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': z - a + 1, 'Cache-Control': 'no-cache' });
    return fs.createReadStream(file, { start: a, end: z }).pipe(res); }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }); fs.createReadStream(file).pipe(res);
}
fs.mkdirSync(ROOT, { recursive: true });
// ~/.config/fframestudio/agents.json: { "<id>": { "args": [...] | "append": [...], "env": {...}, "cmd", "name", "check", "login" } }
// Overrides a built-in agent, or adds a custom one (any ACP-speaking command).
const OVR_FILE = opt('--agents', path.join(os.homedir(), '.config', 'fframestudio', 'agents.json'));
let OVR = {}; try { OVR = JSON.parse(fs.readFileSync(OVR_FILE, 'utf8')); } catch {}
const AGENTS = [...BUILTIN.map((a) => ({ ...a })), ...Object.keys(OVR).filter((id) => !BUILTIN.some((a) => a.id === id)).map((id) => ({ id, name: id, login: 'custom agent', check: OVR[id].cmd, cmd: OVR[id].cmd, args: [] }))]
  .map((a) => { const o = OVR[a.id] || {}; return { ...a, ...o, args: o.args || [...a.args, ...(o.append || [])], env: o.env || {} }; });

const log = (...a) => { if (!QUIET) console.error(new Date().toISOString().slice(11, 19), ...a); };
const onPath = (bin) => /^[\w.-]+$/.test(bin) && spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;
const probed = new Map();
const has = (a) => { if (!probed.has(a.id)) probed.set(a.id, onPath(a.check) && (!a.probe || spawnSync(a.probe[0], a.probe.slice(1), { timeout: 15000, stdio: 'ignore' }).status === 0)); return probed.get(a.id); };
const tokenOk = (t) => { const a = Buffer.from(String(t || '')), b = Buffer.from(TOKEN); return a.length === b.length && timingSafeEqual(a, b); };
const loopHost = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(String(h || ''));
const originOk = (o) => !o || ORIGINS.has(o) || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(o);
const inRoot = (p) => { const r = path.resolve(ROOT, String(p || '').replace(/^\/+/, '')); return r === ROOT || r.startsWith(ROOT + path.sep) ? r : null; };

function cors(req, res) {
  const o = req.headers.origin;
  if (o && originOk(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS'); res.setHeader('Access-Control-Allow-Private-Network', 'true'); }
}
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };

const watchers = new Set();
try { fs.watch(ROOT, { recursive: true }, (ev, file) => { if (!file) return; const msg = `data: ${JSON.stringify({ ev, path: file })}\n\n`; watchers.forEach((r) => r.write(msg)); }); } catch (e) { log('fs.watch unavailable:', e.message); }

const server = http.createServer(async (req, res) => {
  cors(req, res);
  const u = new URL(req.url, 'http://x');
  if (!loopHost(req.headers.host) || !originOk(req.headers.origin)) return send(res, 403, { error: 'origin or host not allowed' });
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (u.pathname === '/health') return send(res, 200, { ok: true, name: 'fframestudio-bridge', version: VERSION });
  if (u.pathname === '/open') { // one-time link printed at start: sets a same-site cookie, then opens the app
    if (!tokenOk(u.searchParams.get('token'))) return send(res, 401, { error: 'bad token' });
    res.writeHead(302, { 'Set-Cookie': `ffs=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' + (u.searchParams.get('to') || '') }); return res.end();
  }
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname.startsWith('/app/'))) { // the web app itself (no secrets in it)
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(5));
    const f = path.resolve(WEB, rel); if (!f.startsWith(WEB + path.sep)) return send(res, 400, { error: 'bad path' });
    return serveFile(req, res, f);
  }
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '') || u.searchParams.get('token') || cookieTok(req); // query only for EventSource
  if (!tokenOk(auth)) return send(res, 401, { error: 'bad token' });
  if (u.pathname === '/me') return send(res, 200, { ok: true, root: ROOT });
  if (u.pathname.startsWith('/lib/')) { const f = path.resolve(LIBDIR, decodeURIComponent(u.pathname.slice(5))); if (!f.startsWith(LIBDIR + path.sep)) return send(res, 400, { error: 'bad path' }); return serveFile(req, res, f); }
  if (u.pathname === '/file') { const f = path.resolve(String(u.searchParams.get('path') || '')); if (!referenced().has(f)) return send(res, 403, { error: 'file is not referenced by any project' }); return serveFile(req, res, f); }
  if (u.pathname === '/agents') return send(res, 200, { root: ROOT, agents: AGENTS.map((a) => ({ id: a.id, name: a.name, login: a.login, available: has(a) })) });
  if (u.pathname === '/fs') {
    const p = inRoot(u.searchParams.get('path')); if (!p) return send(res, 400, { error: 'path outside project root' });
    if (req.method === 'GET') { try { return send(res, 200, { path: path.relative(ROOT, p), absolute: p, content: fs.readFileSync(p, 'utf8') }); } catch { return send(res, 404, { error: 'not found' }); } }
    if (req.method === 'PUT') { let b = ''; for await (const c of req) { b += c; if (b.length > 8e6) return send(res, 413, { error: 'too big' }); }
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, b); return send(res, 200, { ok: true, absolute: p }); }
  }
  if (u.pathname === '/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write(': ok\n\n'); watchers.add(res); req.on('close', () => watchers.delete(res)); return; }
  send(res, 404, { error: 'not found' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024,
  handleProtocols: (protocols) => [...protocols].find((p) => p.startsWith('fframestudio.')) || [...protocols][0] || false });
server.on('upgrade', (req, sock, head) => {
  const u = new URL(req.url, 'http://x');
  const proto = (req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim()).find((p) => p.startsWith('fframestudio.'));
  const agent = AGENTS.find((a) => a.id === u.searchParams.get('agent'));
  const deny = (code, why) => { log('ws denied', code, why, req.headers.origin || ''); sock.write(`HTTP/1.1 ${code} ${why}\r\n\r\n`); sock.destroy(); };
  if (u.pathname !== '/acp') return deny(404, 'Not Found');
  if (!loopHost(req.headers.host) || !originOk(req.headers.origin)) return deny(403, 'Forbidden');
  if (!(proto && tokenOk(proto.slice('fframestudio.'.length))) && !tokenOk(cookieTok(req))) return deny(401, 'Unauthorized');
  if (!agent) return deny(400, 'Unknown agent');
  if (!has(agent)) return deny(424, 'Agent not installed');
  wss.handleUpgrade(req, sock, head, (ws) => attach(ws, agent));
});

function attach(ws, agent) {
  const env = { ...process.env, ...agent.env, FFS_PROJECT_ROOT: ROOT };
  const child = spawn(agent.cmd, agent.args, { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
  log(`agent ${agent.id} pid ${child.pid} started`);
  const out = readline.createInterface({ input: child.stdout });
  out.on('line', (line) => { if (line.trim() && ws.readyState === 1) ws.send(line); });
  child.stderr.on('data', (d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ jsonrpc: '2.0', method: '_fframestudio/stderr', params: { text: String(d).slice(-4000) } })); });
  child.on('exit', (code, sig) => { log(`agent ${agent.id} exited`, code ?? sig); if (ws.readyState === 1) ws.close(1011, `agent exited ${code ?? sig}`); });
  child.on('error', (e) => { log('spawn error', e.message); if (ws.readyState === 1) ws.close(1011, 'spawn failed'); });
  ws.on('message', (data) => { const s = String(data); if (!child.stdin.writable) return; try { JSON.parse(s); } catch { return; } child.stdin.write(s.replace(/\n/g, ' ') + '\n'); });
  ws.on('close', () => { if (child.exitCode === null) { child.kill('SIGTERM'); setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 3000); } });
}

server.listen(PORT, '127.0.0.1', () => {
  const cfg = path.join(os.homedir(), '.config', 'fframestudio'); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'bridge.json'), JSON.stringify({ url: `http://127.0.0.1:${PORT}`, token: TOKEN, root: ROOT, pid: process.pid }), { mode: 0o600 });
  console.log(`fframestudio bridge ${VERSION} on http://127.0.0.1:${PORT}  root=${ROOT}`);
  console.log(`open the studio: http://127.0.0.1:${PORT}/open?token=${QUIET ? '<see ~/.config/fframestudio/bridge.json>' : TOKEN}`);
  console.log(`agents: ${AGENTS.map((a) => `${a.id}${has(a) ? '' : ' (not available)'}`).join(', ')}`);
});
