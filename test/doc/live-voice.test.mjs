import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveVoice } from '../../web/src/feedback/live.js';
import { FeedbackDesk } from '../../web/src/feedback/desk.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function globals(t, values) {
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
}

test('live microphone permission failure is visible and never falls back to recording', async t => {
  globals(t, { isSecureContext: true, RTCPeerConnection: class {}, navigator: { mediaDevices: { getUserMedia: async () => { throw Object.assign(Error('denied'), { name: 'NotAllowedError' }); } } } });
  const states = [];
  const live = new LiveVoice({ onState: state => states.push(state) });
  await live.start();
  assert.equal(live.state, 'error');
  assert.match(states.at(-1).detail, /Microphone access was denied/);
  assert.equal(live.call, null);
});

test('stopping before permission arrives releases the late stream', async t => {
  const grant = deferred(); let stops = 0;
  globals(t, { isSecureContext: true, RTCPeerConnection: class {}, navigator: { mediaDevices: { getUserMedia: () => grant.promise } } });
  const live = new LiveVoice();
  const starting = live.start();
  await live.stop();
  grant.resolve({ getTracks: () => [{ stop: () => stops++ }] });
  await starting;
  assert.equal(stops, 1);
  assert.equal(live.state, 'idle');
});

test('cancelled signaling closes its exact late call without resubmitting', async t => {
  const answer = deferred(); let opens = 0; const ended = [];
  const stream = { getTracks: () => [{ stop() {} }] };
  globals(t, {
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { body: { append() {} }, createElement: () => ({ setAttribute() {}, pause() {}, remove() {} }) },
    RTCPeerConnection: class { addTrack() {} createDataChannel() {} async createOffer() { return { sdp: 'v=0' }; } async setLocalDescription() {} close() {} },
  });
  const live = new LiveVoice();
  live.api = () => { opens++; return answer.promise; };
  live.endCall = async call => { if (call) ended.push(call.callId); };
  const starting = live.start();
  while (!opens) await new Promise(resolve => setImmediate(resolve));
  await live.stop();
  answer.resolve({ callId: 'rtc_late', callToken: 'test-call-only', sdp: 'v=0', model: 'gpt-live-1-codex' });
  await starting;
  assert.equal(opens, 1);
  assert.deepEqual(ended, ['rtc_late']);
  assert.equal(live.state, 'idle');
});

test('repeated provider delegation is dispatched once and returns the actual agent final', async () => {
  let delegated = 0; const appended = [];
  const live = new LiveVoice({ delegate: async text => { delegated++; assert.equal(text, 'Inspect this frame'); return { ok: true, text: 'Actual verified answer' }; } });
  live.call = { callId: 'rtc_test' }; live.abort = new AbortController();
  live.api = async () => ({ cursor: 2, closed: false, events: [{ type: 'delegation.created', id: 'one', text: 'Inspect this frame' }, { type: 'delegation.created', id: 'one', text: 'Inspect this frame' }] });
  live.append = async body => appended.push(body);
  live.endCall = async () => {};
  await live.poll(0);
  await new Promise(resolve => setImmediate(resolve));
  await live.stop();
  assert.equal(delegated, 1);
  assert.deepEqual(appended, [{ delegationId: 'one', text: 'Actual verified answer', channel: 'speakable', final: true }]);
});

test('retained recorded draft does not disable the separate live microphone path', async () => {
  const desk = Object.create(FeedbackDesk.prototype); let starts = 0;
  Object.assign(desk, { active: true, review: { phase: 'draft' }, live: { state: 'idle', start: async () => starts++ }, editor: { connectLiveAssistant: async () => {} }, current: () => ({ projectId: 'demo', videoId: 'main' }), render() {} });
  await desk.command('live');
  assert.equal(starts, 1);
  assert.equal(desk.review.phase, 'draft');
});
