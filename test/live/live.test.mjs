import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable, Readable } from 'node:stream';
import { liveAPI } from '../../bridge/live.mjs';

function harness({ silent = false, contextOK = true } = {}) {
  const sent = []; const children = [];
  const spawnHelper = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough();
    child.stdin = new Writable({ write(data, _encoding, done) {
      const value = JSON.parse(String(data)); sent.push(value);
      if (value.op === 'open' && !silent) child.stdout.write(JSON.stringify({ type: 'opened', callId: 'rtc_test', model: 'gpt-live-1-codex', sdp: 'v=0\r\nanswer' }) + '\n');
      else if (value.op !== 'open' && !silent) child.stdout.write(JSON.stringify({ type: 'ack', id: value.id, ok: value.op === 'context' ? contextOK : true }) + '\n');
      done();
    } });
    child.kill = () => { child.killed = true; }; children.push(child); return child;
  };
  const handler = liveAPI({ command: ['test-only-helper'], spawnHelper, timeout: 20, send: (res, status, data) => Object.assign(res, { status, data }) });
  const request = async (method, pathname, value, token) => {
    const req = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]);
    req.method = method; req.headers = { 'content-type': 'application/json', 'x-ffs-live-token': token };
    const res = {}; await handler(req, res, new URL(pathname, 'http://localhost')); return res;
  };
  const event = data => children[0].stdout.write(JSON.stringify({ type: 'event', event: data }) + '\n');
  return { handler, request, children, sent, event };
}

test('signaling returns scoped capability, events and final route only to that call', async t => {
  const h = harness(); t.after(() => h.handler.close());
  const opened = await h.request('POST', '/live/calls', { sdp: 'v=0\r\noffer' });
  assert.equal(opened.status, 200); assert.equal(opened.data.model, 'gpt-live-1-codex');
  assert.ok(opened.data.callToken.length >= 32); assert.equal(opened.data.sdp, 'v=0\r\nanswer');
  assert.equal(h.sent[0].op, 'open'); assert.match(h.sent[0].instructions, /unapplied/);
  assert.equal((await h.request('GET', '/live/calls/rtc_test/events')).status, 404);
  const token = opened.data.callToken;
  h.event({ type: 'delegation.created', id: 'd1', text: 'Change the title' });
  const events = await h.request('GET', '/live/calls/rtc_test/events?after=0', undefined, token);
  assert.equal(events.data.events[0].id, 'd1'); assert.equal(events.data.cursor, 1);
  assert.equal((await h.request('GET', '/live/calls/rtc_test/events?after=1', undefined, token)).data.events.length, 0);
  const final = { text: 'Proposal ready; not applied.', delegationId: 'd1', channel: 'speakable', final: true };
  assert.equal((await h.request('POST', '/live/calls/rtc_test/context', final, token)).status, 200);
  assert.deepEqual({ ...h.sent[1], id: 'ignored' }, { ...final, op: 'context', id: 'ignored' });
  assert.equal((await h.request('POST', '/live/calls/rtc_test/context', final, token)).status, 409);
  assert.equal((await h.request('POST', '/live/calls/rtc_test/context', { ...final, delegationId: 'other' }, token)).status, 400);
  assert.equal((await h.request('DELETE', '/live/calls/rtc_test', undefined, token)).status, 200);
  assert.equal(h.sent.at(-1).op, 'end'); assert.equal(h.children[0].killed, true);
  assert.equal((await h.request('GET', '/live/calls/rtc_test/events', undefined, token)).status, 404);
});

test('input and unknown routes fail explicitly without starting a helper', async t => {
  const h = harness(); t.after(() => h.handler.close());
  for (const value of [{}, { sdp: 'bad' }, { sdp: 'v=0' + 'x'.repeat(20001) }]) assert.equal((await h.request('POST', '/live/calls', value)).status, 400);
  assert.equal((await h.request('POST', '/live/nope', {})).status, 404); assert.equal(h.children.length, 0);
});

test('open timeout kills helper; never silently falls back to transcription', async t => {
  const h = harness({ silent: true }); t.after(() => h.handler.close());
  const response = await h.request('POST', '/live/calls', { sdp: 'v=0' });
  assert.equal(response.status, 504); assert.equal(response.data.error, 'live-open-timeout');
  assert.equal(h.children[0].killed, true); assert.equal(h.sent.length, 1);
});

test('partial/unknown context delivery is not blindly retried', async t => {
  const h = harness({ contextOK: false }); t.after(() => h.handler.close());
  const open = await h.request('POST', '/live/calls', { sdp: 'v=0' }); const token = open.data.callToken;
  const input = { text: 'An actual final', channel: 'speakable', final: true };
  assert.equal((await h.request('POST', '/live/calls/rtc_test/context', input, token)).data.error, 'live-context-delivery-unknown');
  assert.equal((await h.request('POST', '/live/calls/rtc_test/context', input, token)).status, 409);
  assert.equal(h.sent.filter(v => v.op === 'context').length, 1);
});

test('event overflow is explicit rather than silently losing delegations', async t => {
  const h = harness(); t.after(() => h.handler.close());
  const open = await h.request('POST', '/live/calls', { sdp: 'v=0' });
  for (let i = 0; i < 260; i++) h.event({ type: 'turn.done', role: 'assistant', transcript: 'test' });
  assert.equal((await h.request('GET', '/live/calls/rtc_test/events?after=0', undefined, open.data.callToken)).status, 409);
  assert.equal((await h.request('GET', '/live/calls/rtc_test/events?after=260', undefined, open.data.callToken)).data.events.length, 0);
});

test('missing subscription helper is a clear 503', async () => {
  const handle = liveAPI({ command: [], send: (res, status, data) => Object.assign(res, { status, data }) });
  const req = Readable.from([Buffer.from('{"sdp":"v=0"}')]); req.method = 'POST'; req.headers = { 'content-type': 'application/json' };
  const res = {}; await handle(req, res, new URL('http://localhost/live/calls'));
  assert.equal(res.status, 503); assert.equal(res.data.error, 'live-helper-not-configured'); handle.close();
});
