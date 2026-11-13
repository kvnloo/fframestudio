// Same-origin subscription live adapter. OAuth stays on the helper's host.
// FFS_LIVE_HELPER_COMMAND: JSON argv, e.g. ["ssh","-T","-o","BatchMode=yes",
// "groot","env HERMES_HOME=... FFS_HERMES_SOURCE=... FFS_Z0LIVE_DESKTOP=... /path/python /path/live-helper.py"].
// Every route requires bridge auth (installed after bridge's auth gate), and all
// call routes additionally require X-FFS-Live-Token from POST /live/calls.
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import readline from 'node:readline';

const instructions = `You are the voice of this fframestudio assistant, backed by the app's real Hermes session. Speak briefly and naturally. Delegate every project lookup, edit, drawing operation and action to the client with the full request. You cannot perform actions yourself. Proposals remain unapplied until the owner accepts them. Never claim success without an Agent Final Message. Commentary is silent progress; speak the useful part of an Agent Final Message once as your own answer. Stay quiet while waiting. Do not narrate plumbing. Do not speak on noise. Never introduce yourself or summarize unprompted.`;
const failure = (message, status = 503) => Object.assign(new Error(message), { status });
const equal = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw failure('json-required', 415);
  const chunks = []; let bytes = 0;
  for await (const c of req) { bytes += c.length; if (bytes > 64000) throw failure('live-body-too-large', 413); chunks.push(c); }
  try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0; return value; }
  catch { throw failure('invalid-json', 400); }
}

export function liveAPI({ send, command = process.env.FFS_LIVE_HELPER_COMMAND, spawnHelper = spawn, timeout = 40000, lifetime = 30 * 60 * 1000 } = {}) {
  const calls = new Map(); const opening = new Set();
  function launch() {
    let argv;
    try { argv = typeof command === 'string' ? JSON.parse(command) : command; } catch { throw failure('live-helper-not-configured'); }
    if (!Array.isArray(argv) || !argv.length || argv.some(a => typeof a !== 'string' || !a)) throw failure('live-helper-not-configured');
    const child = spawnHelper(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'ignore'] });
    const state = { child, token: randomBytes(32).toString('base64url'), events: [], seq: 0, delegations: new Set(), completed: new Set(), pending: new Map(), closed: false, uncertain: false };
    const failPending = error => { for (const p of state.pending.values()) { clearTimeout(p.timer); p.reject(error); } state.pending.clear(); };
    const addEvent = event => { state.events.push({ sequence: ++state.seq, ...event }); if (state.events.length > 256) state.events.shift(); };
    const lines = readline.createInterface({ input: child.stdout });
    const stop = () => { opening.delete(state); clearTimeout(state.expiry); child.stdin.end(); child.kill('SIGTERM'); const kill = setTimeout(() => child.kill('SIGKILL'), 1500); kill.unref(); };
    state.stop = stop;
    lines.on('line', line => {
      if (line.length > 256000) { state.closed = true; failPending(failure('live-helper-invalid-response')); stop(); return; }
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'event') {
        const event = message.event;
        if (!event || typeof event.type !== 'string') return;
        if (event.type === 'delegation.created' && typeof event.id === 'string') state.delegations.add(event.id);
        if (event.type === 'closed') state.closed = true;
        addEvent(event);
      } else if (message.type === 'error') {
        // Helper deliberately emits safe error codes, not provider error bodies.
        const safe = /^[a-z0-9-]{1,80}$/.test(message.error) ? message.error : 'live-helper-failed';
        failPending(failure(safe)); state.closed = true; stop();
      } else {
        const key = message.type === 'opened' ? 'open' : message.id;
        const p = state.pending.get(key); if (!p) return;
        clearTimeout(p.timer); state.pending.delete(key);
        if (message.ok === false) { state.uncertain = true; p.reject(failure('live-context-delivery-unknown', 502)); }
        else p.resolve(message);
      }
    });
    const exited = () => { state.closed = true; failPending(failure('live-helper-exited')); addEvent({ type: 'closed' }); };
    child.once('error', exited); child.once('exit', exited);
    child.stdin.on('error', () => failPending(failure('live-helper-disconnected')));
    state.request = (op, input = {}) => new Promise((resolve, reject) => {
      if (state.closed) return reject(failure('live-call-closed', 410));
      const id = op === 'open' ? 'open' : randomBytes(12).toString('hex');
      const timer = setTimeout(() => { state.pending.delete(id); state.uncertain = true; reject(failure(op === 'open' ? 'live-open-timeout' : 'live-context-delivery-unknown', 504)); }, timeout);
      state.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ ...input, op, id }) + '\n');
    });
    state.expiry = setTimeout(() => { state.closed = true; failPending(failure('live-call-expired', 410)); stop(); if (state.callId) calls.delete(state.callId); }, lifetime);
    state.expiry.unref(); opening.add(state);
    return state;
  }
  const handle = async (req, res, u) => {
    if (!u.pathname.startsWith('/live/')) return false;
    try {
      if (u.search && !/^\?after=\d+$/.test(u.search)) throw failure('invalid-live-query', 400);
      if (u.pathname === '/live/calls' && req.method === 'POST') {
        if (calls.size + opening.size >= 4) throw failure('live-call-limit', 429);
        const input = await body(req);
        if (typeof input.sdp !== 'string' || !input.sdp.startsWith('v=0') || input.sdp.length > 20000) throw failure('invalid-live-sdp', 400);
        if (calls.size + opening.size >= 4) throw failure('live-call-limit', 429);
        const state = launch();
        try {
          const result = await state.request('open', { sdp: input.sdp, instructions });
          if (!/^rtc_[\w-]+$/.test(result.callId) || result.model !== 'gpt-live-1-codex' || typeof result.sdp !== 'string' || !result.sdp.startsWith('v=0')) throw failure('live-invalid-answer', 502);
          state.callId = result.callId; opening.delete(state); calls.set(result.callId, state);
          send(res, 200, { sdp: result.sdp, callId: result.callId, model: result.model, callToken: state.token });
        } catch (e) { state.stop(); throw e; }
        return true;
      }
      const match = /^\/live\/calls\/(rtc_[\w-]+)(?:\/(events|context|end))?$/.exec(u.pathname);
      if (!match) throw failure('live-route-not-found', 404);
      const state = calls.get(match[1]);
      if (!state || !equal(req.headers['x-ffs-live-token'], state.token)) throw failure('live-call-not-found', 404);
      if ((req.method === 'DELETE' && !match[2]) || (req.method === 'POST' && match[2] === 'end')) {
        try { if (!state.closed) await state.request('end'); } finally { state.stop(); calls.delete(match[1]); }
        send(res, 200, { ok: true }); return true;
      }
      if (req.method === 'GET' && match[2] === 'events') {
        const after = Number(u.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0 || after > state.seq) throw failure('invalid-live-cursor', 400);
        if (state.events.length && after < state.events[0].sequence - 1) throw failure('live-event-gap', 409);
        send(res, 200, { events: state.events.filter(e => e.sequence > after), cursor: state.seq, closed: state.closed }); return true;
      }
      if (req.method === 'POST' && match[2] === 'context') {
        if (state.uncertain) throw failure('live-context-delivery-unknown', 409); // Never blindly resend.
        const input = await body(req);
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000 ||
            !['commentary', 'speakable'].includes(input.channel) ||
            (input.final !== undefined && typeof input.final !== 'boolean') ||
            (input.final && input.channel !== 'speakable') ||
            (input.delegationId !== undefined && !state.delegations.has(input.delegationId))) throw failure('invalid-live-context', 400);
        if (input.delegationId && state.completed.has(input.delegationId)) throw failure('live-delegation-already-completed', 409);
        if (input.final && input.delegationId) state.completed.add(input.delegationId);
        await state.request('context', { text: input.text, channel: input.channel, final: Boolean(input.final), delegationId: input.delegationId });
        send(res, 200, { ok: true }); return true;
      }
      throw failure('live-method-not-allowed', 405);
    } catch (e) { send(res, e.status || 503, { error: e.status ? e.message : 'live-unavailable' }); return true; }
  };
  handle.close = () => { for (const state of [...calls.values(), ...opening]) state.stop(); calls.clear(); opening.clear(); };
  return handle;
}
