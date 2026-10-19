// End-to-end ACP test: real bridge, real agents, real logins.
// Usage: node test/acp-e2e.mjs [agent ...] [--edit agent]   (no agents: security checks only, ~1 s)
//  - checks the bridge refuses: no token, wrong token, foreign Origin, rebinding Host
//  - for each agent: initialize + new session + one prompt ("pong"), timing and stop reason
//  - --edit <agent>: asks that agent to edit project.json and verifies the file changed
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket as TestWebSocket } from 'ws';
import { connectAgent, bridgeApi } from '../web/src/acp-client.mjs';

const args = process.argv.slice(2);
const editAgent = args.includes('--edit') ? args[args.indexOf('--edit') + 1] : null;
const agents = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--edit');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-acp-'));
const token = 'test-' + Math.random().toString(36).slice(2);
const port = 7900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const PROJECT = { title: 'I-880 demo', shots: [{ id: 'hook', type: 'statement', text: "There's a camera every mile.", bars: 2 }, { id: 'map', type: 'map', text: 'Where the gap opens', bars: 2 }, { id: 'ask', type: 'ask', text: 'Book a walkthrough', bars: 1 }] };
fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify(PROJECT, null, 2));

// Snapshot only for comparison: never log credentials or restore a shared discovery file.
const configPath = path.join(os.homedir(), '.config/fframestudio/bridge.json');
const snapshotConfig = () => {
  try {
    return { mtimeNs: fs.statSync(configPath, { bigint: true }).mtimeNs, content: fs.readFileSync(configPath) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const configBefore = snapshotConfig();
const mockAgents=path.join(root,'agents.json');
fs.writeFileSync(mockAgents,JSON.stringify({fixture:{name:'Security fixture',cmd:process.execPath,check:'node',args:['-e','setInterval(()=>{},1000)']}}));
const bridge = spawn(process.execPath, [path.resolve('bridge/bridge.mjs'), '--port', String(port), '--root', root, '--token', token, '--quiet', '--no-config', '--theme-home', root, '--agents', mockAgents], { stdio: ['ignore', 'pipe', 'inherit'] });
const out = { root, security: {}, agents: {} };
try {
  await new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(Error('test bridge startup timed out')), 15000);
    bridge.stdout.once('data', () => { clearTimeout(timer); ok(); });
    bridge.once('error', (error) => { clearTimeout(timer); bad(error); });
    bridge.once('exit', () => { clearTimeout(timer); bad(Error('test bridge exited before startup')); });
  });
  const r = (p, h = {}) => fetch(base + p, { headers: h }).then((x) => x.status);
  out.security.no_token = await r('/agents');
  out.security.bad_token = await r('/agents', { Authorization: 'Bearer nope' });
  out.security.foreign_origin = await r('/agents', { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' });
  out.security.rebinding_host = await new Promise((ok) => http.get({ host: '127.0.0.1', port, path: '/agents', headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, (x) => { ok(x.statusCode); x.resume(); }).on('error', () => ok('refused')));
  out.security.ok = await r('/agents', { Authorization: `Bearer ${token}` });
  out.security.taste_no_token = await r('/taste/profile');
  const tasteHeaders = { Authorization: `Bearer ${token}` };
  out.security.taste_disconnected = (await fetch(base+'/taste/profile',{headers:tasteHeaders}).then(r=>r.json())).state === 'disconnected';
  out.security.taste_tenant_selector_refused = await r('/taste/profile?user=other',tasteHeaders) === 400;
  out.security.taste_read_only = await fetch(base+'/taste/profile',{method:'POST',headers:tasteHeaders}).then(r=>r.status) === 400;
  const selectedReferences = JSON.stringify({schema:'fframestudio.social-references/1',provider:'youtube',collectionId:'test',
    items:[{url:'https://youtu.be/dQw4w9WgXcQ',title:'Demo'}]});
  const socialPost = (body,headers={}) => fetch(base+'/taste/import/collection',{method:'POST',
    headers:{'Content-Type':'application/json',...headers},body});
  out.security.social_no_token = await socialPost(selectedReferences).then(r=>r.status);
  out.security.social_disabled = (await socialPost(selectedReferences,tasteHeaders).then(r=>r.json())).state === 'disconnected';
  out.security.social_invalid = await socialPost(JSON.stringify({schema:'fframestudio.social-references/1',provider:'youtube',
    collectionId:'test',items:[{url:'https://localhost/secret'}]}),tasteHeaders).then(r=>r.status);
  out.security.social_foreign_origin = await socialPost(selectedReferences,{...tasteHeaders,Origin:'https://evil.example'}).then(r=>r.status);

  const hosted='https://fframestudio.vercel.app';
  const allowed=await fetch(base+'/agents',{headers:{Origin:hosted,Authorization:'Bearer '+token}});
  out.security.hosted_token=allowed.status;out.security.hosted_cors=allowed.headers.get('access-control-allow-origin')===hosted;
  out.security.hosted_no_token=await r('/agents',{Origin:hosted});
  const preflight=await fetch(base+'/fs',{method:'OPTIONS',headers:{Origin:hosted,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'Authorization, Content-Type, X-FFS-Expected','Access-Control-Request-Private-Network':'true'}});
  out.security.pna_preflight=preflight.status===204&&preflight.headers.get('access-control-allow-private-network')==='true'&&preflight.headers.get('access-control-allow-origin')===hosted&&preflight.headers.get('access-control-allow-headers').includes('X-FFS-Expected');
  const foreign=await fetch(base+'/agents',{headers:{Origin:'https://other.example',Authorization:'Bearer '+token}});out.security.foreign_cors_absent=foreign.status===403&&!foreign.headers.has('access-control-allow-origin');
  const handshake=(origin,tok)=>new Promise(resolve=>{const w=new TestWebSocket(base.replace('http:','ws:')+'/acp?agent=fixture',['fframestudio.'+tok],{headers:{Origin:origin}});w.once('open',()=>{w.close();resolve(true);});w.once('error',()=>resolve(false));});
  out.security.hosted_ws=await handshake(hosted,token);out.security.foreign_ws_refused=!await handshake('https://other.example',token);out.security.hosted_bad_ws_refused=!await handshake(hosted,'wrong-token');
  out.security.path_escape = await r('/fs?path=../../etc/passwd', { Authorization: `Bearer ${token}` });
  // symlinks inside the root must not lead outside it (read, dangling-link write, write through a linked dir)
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link-read'));
  fs.symlinkSync(path.join(outside, 'created.txt'), path.join(root, 'link-dangling'));
  fs.symlinkSync(outside, path.join(root, 'link-dir'));
  const put = (p) => fetch(`${base}/fs?path=${encodeURIComponent(p)}`, { method: 'PUT', body: 'x', headers: { Authorization: `Bearer ${token}` } }).then((x) => x.status);
  out.security.symlink_read = await r('/fs?path=link-read', { Authorization: `Bearer ${token}` });
  out.security.symlink_write_dangling = await put('link-dangling');
  out.security.symlink_write_dir = await put('link-dir/new.txt');
  out.security.symlink_mkdir_dir = await put('link-dir/sub/new.txt');
  out.security.outside_untouched = fs.readdirSync(outside).sort().join(',') === 'secret.txt';
  out.security.inside_write = await put('notes/ok.txt');
  fs.rmSync(outside, { recursive: true, force: true });
  const wsRefusal = (protocols, extra) => new Promise((ok) => { const w = new WebSocket(`ws://127.0.0.1:${port}/acp?agent=hermes`, protocols, extra); w.onopen = () => { w.close(); ok('OPENED'); }; w.onerror = () => ok('refused'); });
  out.security.ws_no_token = await wsRefusal([]);
  out.security.ws_bad_token = await wsRefusal(['fframestudio.nope']);
  const list = await bridgeApi(base, token).agents();
  out.available = list.agents.filter((a) => a.available).map((a) => a.id);

  for (const id of agents) {
    const t0 = Date.now(); let text = '', stderr = '';
    try {
      const a = await connectAgent({ bridge: base, token, agent: id, cwd: root, handlers: {
        update: (n) => { const u = n.update; if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') text += u.content.text; },
        permission: (req) => (req.options.find((o) => o.kind === 'allow_once') || req.options[0]).optionId,
        stderr: (s) => { stderr += s; },
      } });
      const tInit = Date.now() - t0;
      const res = await Promise.race([a.prompt('Reply with exactly one word: pong. Do not use any tools.'), new Promise((_, bad) => setTimeout(() => bad(new Error('prompt timeout 180s')), 180000))]);
      out.agents[id] = { ok: /pong/i.test(text), agent: a.init.agentInfo || null, protocol: a.init.protocolVersion, init_ms: tInit, total_ms: Date.now() - t0, stop: res.stopReason, reply: text.trim().slice(0, 80) };
      a.close();
    } catch (e) { out.agents[id] = { ok: false, error: String(e.message || e).slice(0, 300), stderr_tail: stderr.slice(-300) }; }
  }

  if (editAgent) {
    const t0 = Date.now(); let tools = [], text = '';
    try {
      const a = await connectAgent({ bridge: base, token, agent: editAgent, cwd: root, handlers: {
        update: (n) => { const u = n.update; if (u.sessionUpdate === 'tool_call') tools.push(u.title || u.kind); if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') text += u.content.text; },
        permission: (req) => (req.options.find((o) => o.kind === 'allow_once') || req.options[0]).optionId,
      } });
      const res = await a.prompt(`You are the assistant inside fframestudio, a video editor. The project is ${path.join(root, 'project.json')}. Edit that file: change "title" to "Lane test" and set the bars of the shot with id "map" to 3. Keep everything else and keep it valid JSON. Then reply "done".`);
      const after = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
      out.edit = { agent: editAgent, ok: after.title === 'Lane test' && after.shots.find((s) => s.id === 'map').bars === 3, title: after.title, map_bars: after.shots.find((s) => s.id === 'map').bars, others_kept: after.shots.length === 3, tools, stop: res.stopReason, ms: Date.now() - t0 };
      a.close();
    } catch (e) { out.edit = { agent: editAgent, ok: false, error: String(e.message || e).slice(0, 300) }; }
  }
} finally {
  if (bridge.exitCode === null && bridge.signalCode === null && bridge.pid) {
    const exited = once(bridge, 'exit');
    bridge.kill('SIGTERM');
    await exited;
  }
  const configAfter = snapshotConfig();
  const bothAbsent = configBefore === null && configAfter === null;
  out.discovery_config = {
    mtime_unchanged: bothAbsent || !!(configBefore && configAfter && configBefore.mtimeNs === configAfter.mtimeNs),
    content_unchanged: bothAbsent || !!(configBefore && configAfter && configBefore.content.equals(configAfter.content)),
  };
  assert.equal(out.discovery_config.mtime_unchanged, true, 'test bridge changed discovery config mtime');
  assert.equal(out.discovery_config.content_unchanged, true, 'test bridge changed discovery config content');
}
console.log(JSON.stringify(out, null, 1));
// fail loudly so CI and agents can rely on the exit code
const sec = out.security, fails = [];
const want = { taste_no_token:401,taste_disconnected:true,taste_tenant_selector_refused:true,taste_read_only:true, social_no_token:401,social_disabled:true,social_invalid:400,social_foreign_origin:403, hosted_token:200,hosted_cors:true,hosted_no_token:401,pna_preflight:true,foreign_cors_absent:true,hosted_ws:true,foreign_ws_refused:true,hosted_bad_ws_refused:true, no_token: 401, bad_token: 401, foreign_origin: 403, rebinding_host: 403, ok: 200, path_escape: 400, symlink_read: 400, symlink_write_dangling: 400, symlink_write_dir: 400, symlink_mkdir_dir: 400, outside_untouched: true, inside_write: 200, ws_no_token: 'refused', ws_bad_token: 'refused' };
for (const [k, v] of Object.entries(want)) if (sec[k] !== v) fails.push(`security.${k}: got ${sec[k]}, want ${v}`);
for (const [id, r] of Object.entries(out.agents)) if (!r.ok) fails.push(`agent ${id}: ${r.error || 'no pong'}`);
if (out.edit && !out.edit.ok) fails.push(`edit ${out.edit.agent}: ${out.edit.error || 'file not changed as asked'}`);
if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); } else console.error('ok');
