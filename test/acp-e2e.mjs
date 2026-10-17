// End-to-end ACP test: real bridge, real agents, real logins.
// Usage: node test/acp-e2e.mjs [agent ...] [--edit agent]
//  - checks the bridge refuses: no token, wrong token, foreign Origin, rebinding Host
//  - for each agent: initialize + new session + one prompt ("pong"), timing and stop reason
//  - --edit <agent>: asks that agent to edit project.json and verifies the file changed
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const bridge = spawn(process.execPath, [path.resolve('bridge/bridge.mjs'), '--port', String(port), '--root', root, '--token', token, '--quiet'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => bridge.stdout.once('data', ok));
const out = { root, security: {}, agents: {} };
try {
  const r = (p, h = {}) => fetch(base + p, { headers: h }).then((x) => x.status);
  out.security.no_token = await r('/agents');
  out.security.bad_token = await r('/agents', { Authorization: 'Bearer nope' });
  out.security.foreign_origin = await r('/agents', { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' });
  out.security.rebinding_host = await new Promise((ok) => http.get({ host: '127.0.0.1', port, path: '/agents', headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, (x) => { ok(x.statusCode); x.resume(); }).on('error', () => ok('refused')));
  out.security.ok = await r('/agents', { Authorization: `Bearer ${token}` });
  out.security.path_escape = await r('/fs?path=../../etc/passwd', { Authorization: `Bearer ${token}` });
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
} finally { bridge.kill(); }
console.log(JSON.stringify(out, null, 1));
