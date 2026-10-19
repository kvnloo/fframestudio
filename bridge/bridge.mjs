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
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';
import { referenceAPI, stopReferenceHelpers } from './reference.mjs';
import { AGENTS as BUILTIN } from './agents.mjs';
import { watchTheme, detectTheme } from './system-theme.mjs';
import { agentWebAdapter } from './taste.mjs';
import { GenerationQueue } from './generation/queue.mjs';
import { providers as generationProviders } from './generation/providers.mjs';
import { parseSocialReferences, MAX_SOCIAL_REFERENCES_BYTES } from '../web/src/taste/social-references.js';

const VERSION = '0.1.0';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const all = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));
const PORT = Number(opt('--port', 7878));
const ROOT = path.resolve(opt('--root', path.join(os.homedir(), 'fframestudio')));
const TOKEN = opt('--token', process.env.FFS_BRIDGE_TOKEN || randomBytes(24).toString('base64url'));
const HOSTED = opt('--hosted-origin', 'https://fframestudio.vercel.app');
const ORIGINS = new Set([HOSTED, ...all('--allow-origin')]);
const QUIET = argv.includes('--quiet');
// A single bridge represents its owner's authenticated user, never a caller-supplied tenant.
const taste = agentWebAdapter({ enabled: argv.includes('--enable-agentweb-taste'), baseURL: process.env.FFS_TASTE_AGENTWEB_URL, token: process.env.FFS_TASTE_AGENTWEB_TOKEN });
// Do not pass the service credential to ACP children or any browser configuration.
delete process.env.FFS_TASTE_AGENTWEB_TOKEN;
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
// /fs must not follow a symlink out of the root. Resolve the nearest existing ancestor with realpath,
// refuse a symlink as the final component, and write with O_NOFOLLOW so a link swapped in later fails.
const REAL_ROOT = fs.realpathSync(ROOT);
const insideReal = (r) => r === REAL_ROOT || r.startsWith(REAL_ROOT + path.sep);
const fsPath = (p, write) => {
  const lexical = inRoot(p); if (!lexical) return null;
  let st = null; try { st = fs.lstatSync(lexical); } catch {}
  if (st?.isSymbolicLink()) { if (write) return null; try { return insideReal(fs.realpathSync(lexical)) ? lexical : null; } catch { return null; } }
  let anc = st ? lexical : path.dirname(lexical);
  for (;;) { try { fs.lstatSync(anc); break; } catch { anc = path.dirname(anc); } }
  try { return insideReal(fs.realpathSync(anc)) ? lexical : null; } catch { return null; }
};
const NOFOLLOW_WRITE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);

function cors(req, res) {
  const o = req.headers.origin;
  if (o && originOk(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-FFS-Expected'); res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Private-Network', 'true'); }
}
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };

const watchers = new Set();
const publish=(ev,file)=>{const msg=`data: ${JSON.stringify({ev,path:file})}\n\n`;watchers.forEach(r=>r.write(msg));};
try { fs.watch(ROOT, { recursive: true }, (ev, file) => { if(file)publish(ev,String(file)); }); } catch (e) { log('fs.watch unavailable:', e.message); }
// fs.watch can lose inode subscriptions after an atomic rename; poll the small document
// surface as a recovery lane, not media directories. Also covers new proposal files.
let checking=false;const stamps=new Map();
const poll=setInterval(async()=>{if(!watchers.size||checking)return;checking=true;try{
 const entries=await fs.promises.readdir(LIBDIR,{withFileTypes:true}).catch(()=>[]);
 for(const entry of entries){if(!entry.isDirectory())continue;const base=`projects/${entry.name}`;
  const proposals=await fs.promises.readdir(path.join(ROOT,base,'proposals')).catch(()=>[]);
  for(const rel of [`${base}/project.json`,...proposals.filter(n=>n.endsWith('.json')).map(n=>`${base}/proposals/${n}`)]){
   const st=await fs.promises.stat(path.join(ROOT,rel),{bigint:true}).catch(()=>null);if(!st)continue;
   const stamp=`${st.mtimeNs}:${st.size}`;if(stamps.has(rel)&&stamps.get(rel)!==stamp)publish('change',rel);else if(!stamps.has(rel)&&rel.includes('/proposals/'))publish('rename',rel);stamps.set(rel,stamp);
  }
 }
}finally{checking=false;}},750);poll.unref();

const THEME_HOME = path.resolve(opt('--theme-home', os.homedir()));
const themeOptions = { home: THEME_HOME, source: opt('--theme-source', undefined), desktop: !argv.includes('--theme-home') };
const theme = watchTheme({ ...themeOptions, onChange: state => {
  const msg = `event: theme\ndata: ${JSON.stringify(state)}\n\n`; watchers.forEach(r => r.write(msg));
} });
const generation = new GenerationQueue({ root: ROOT, providers: generationProviders({ fake: argv.includes('--generation-fake') }),
  publish: data => { const msg = `data: ${JSON.stringify(data)}\n\n`; watchers.forEach(r => r.write(msg)); } });
await generation.ready;
const shutdown = async () => { theme.close(); stopReferenceHelpers(); await generation.close(); process.exit(0); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
const handleReference = referenceAPI({ root: ROOT, safePath: fsPath, send });
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
  if (u.pathname === '/share-worker.js' && req.method === 'GET') return serveFile(req,res,path.join(WEB,'share-worker.js'));
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname.startsWith('/app/'))) { // the web app itself (no secrets in it)
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(5));
    const f = path.resolve(WEB, rel); if (!f.startsWith(WEB + path.sep)) return send(res, 400, { error: 'bad path' });
    return serveFile(req, res, f);
  }
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '') || u.searchParams.get('token') || cookieTok(req); // query only for EventSource
  if (u.pathname === '/me') return send(res, 200, tokenOk(auth) ? { ok: true, root: ROOT } : { ok: false }); // lets the app show the sign-in page without a console error
  if (!tokenOk(auth)) return send(res, 401, { error: 'bad token' });
  if (await handleReference(req, res, u)) return;
  if (u.pathname === '/taste/profile') {
    if (req.method !== 'GET' || u.search) return send(res, 400, { error: 'Read-only owner-scoped profile; no query parameters' });
    return send(res, 200, await taste.getProfile());
  }
  if (u.pathname.startsWith('/generation/')) {
    try {
      if (req.method === 'GET' && u.pathname === '/generation/providers') return send(res, 200, { providers: await generation.capabilities() });
      if (req.method === 'GET' && u.pathname === '/generation/jobs') return send(res, 200, { jobs: generation.list(u.searchParams.get('projectId')) });
      const match = /^\/generation\/jobs\/([\w-]+)(?:\/(cancel|retry))?$/.exec(u.pathname);
      if (req.method === 'GET' && match && !match[2]) {
        const job = generation.list().find(j => j.id === match[1]); return send(res, job ? 200 : 404, job || { error: 'unknown-job' });
      }
      if (req.method === 'POST' && match?.[2]) return send(res, 200, await generation[match[2]](match[1]));
      if (req.method === 'POST' && u.pathname === '/generation/jobs') {
        let body = '', size = 0; for await (const chunk of req) { size += chunk.length; if (size > 16384) return send(res, 413, { error: 'too-big' }); body += chunk; }
        let input; try { input = JSON.parse(body); } catch { return send(res, 400, { error: 'invalid-json' }); }
        return send(res, 202, await generation.submit(input));
      }
      return send(res, 404, { error: 'not-found' });
    } catch (e) {
      const known = ['invalid-settings', 'invalid-prompt', 'invalid-seed', 'unsupported-timing', 'unsupported-resolution', 'unknown-provider', 'provider-unavailable', 'queue-full', 'queue-closed', 'unknown-job', 'not-retryable', 'unsafe-path'];
      return send(res, 400, { error: known.includes(e.message) ? e.message : 'generation-request-failed' });
    }
  }
  if (u.pathname === '/taste/import/collection') {
    if (req.method !== 'POST' || u.search)
      return send(res, 400, { error: 'Selected collection import requires POST without query parameters' });
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json')
      return send(res, 415, { error: 'JSON body required' });
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > MAX_SOCIAL_REFERENCES_BYTES) return send(res, 413, { error: 'Reference file exceeds 64 KiB' });
      chunks.push(chunk);
    }
    let collection;
    try { collection = parseSocialReferences(Buffer.concat(chunks).toString('utf8')); }
    catch { return send(res, 400, { error: 'Invalid selected reference collection' }); }
    return send(res, 200, await taste.importCollection(collection));
  }
  if (u.pathname === '/theme' && req.method === 'GET') {
    await theme.ready;
    const source = u.searchParams.get('source');
    return send(res, 200, source ? await detectTheme({ ...themeOptions, source }) : theme.state);
  }
  if (u.pathname.startsWith('/lib/')) { const f = path.resolve(LIBDIR, decodeURIComponent(u.pathname.slice(5))); if (!f.startsWith(LIBDIR + path.sep)) return send(res, 400, { error: 'bad path' }); return serveFile(req, res, f); }
  if (u.pathname === '/file') { const f = path.resolve(String(u.searchParams.get('path') || '')); if (!referenced().has(f)) return send(res, 403, { error: 'file is not referenced by any project' }); return serveFile(req, res, f); }
  if (u.pathname === '/agents') return send(res, 200, { root: ROOT, agents: AGENTS.map((a) => ({ id: a.id, name: a.name, login: a.login, available: has(a) })) });
  if (u.pathname === '/fs') {
    const p = fsPath(u.searchParams.get('path'), req.method === 'PUT'); if (!p) return send(res, 400, { error: 'path outside project root' });
    if (req.method === 'GET') { try { return send(res, 200, { path: path.relative(ROOT, p), absolute: p, content: fs.readFileSync(p, 'utf8') }); } catch { return send(res, 404, { error: 'not found' }); } }
    if (req.method === 'PUT') { const binary=req.headers['content-type']==='application/octet-stream', chunks=[]; let size=0; for await (const c of req) { size+=c.length; if(size>(binary?60e6:8e6))return send(res,413,{error:'too big'}); chunks.push(c); } const b=binary?Buffer.concat(chunks):Buffer.concat(chunks).toString('utf8');
      const expected=req.headers['x-ffs-expected'];
      if(expected){let current='';try{current=fs.readFileSync(p,'utf8');}catch{}if(createHash('sha256').update(current).digest('hex')!==expected)return send(res,409,{error:'File changed since load'});}
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (!fsPath(path.relative(ROOT, p), true)) return send(res, 400, { error: 'path outside project root' });
      // atomic: write a fresh temp file (O_EXCL|O_NOFOLLOW) and rename it over the target; rename replaces the entry, never follows a link
      const tmp=p+'.ffs-'+randomBytes(6).toString('hex');
      try{fs.writeFileSync(tmp,b,{flag:NOFOLLOW_WRITE|fs.constants.O_EXCL});fs.renameSync(tmp,p);}catch(e){try{fs.unlinkSync(tmp);}catch{}return send(res,500,{error:e.message});}
      publish('change',path.relative(ROOT,p));return send(res, 200, { ok: true, absolute: p }); }
  }
  if (u.pathname === '/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write(': ok\n\n'); res.write(`event: theme\ndata: ${JSON.stringify(theme.state)}\n\n`); watchers.add(res); req.on('close', () => watchers.delete(res)); return; }
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
  if (!argv.includes('--no-config')) {
    const cfg = path.join(os.homedir(), '.config', 'fframestudio'); fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'bridge.json'), JSON.stringify({ url: `http://127.0.0.1:${PORT}`, token: TOKEN, root: ROOT, pid: process.pid }), { mode: 0o600 });
  }
  console.log(`fframestudio bridge ${VERSION} on http://127.0.0.1:${PORT}  root=${ROOT}`);
  console.log(`open the studio: http://127.0.0.1:${PORT}/open?token=${QUIET ? '<see ~/.config/fframestudio/bridge.json>' : TOKEN}`);
  console.log(`hosted studio: ${HOSTED}/#bridge=http://127.0.0.1:${PORT}&token=${QUIET ? '<hidden>' : TOKEN}`);
  console.log(`agents: ${AGENTS.map((a) => `${a.id}${has(a) ? '' : ' (not available)'}`).join(', ')}`);
});
