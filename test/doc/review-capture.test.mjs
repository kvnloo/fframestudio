import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewCapture } from '../../web/src/feedback/capture.js';
import { VoiceControl } from '../../web/src/voice.js';

test('pencil can sample an already presented paused video without recording or another playback frame', () => {
  const previous = globalThis.document;
  const video = { hidden: false, paused: true, seeking: false, readyState: 4, currentTime: 0,
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 4 }),
    addEventListener() {}, requestVideoFrameCallback() {} };
  globalThis.document = { querySelector: selector => selector === '#preview-video' ? video : null };
  try {
    const capture = Object.create(PreviewCapture.prototype);
    Object.assign(capture, { paintedTime: null, shownFrame: null, rvfc: false, editor: {
      frame: 0, rate: 0, video: { clips: [{ start: 0, duration: 120, sourceIn: 0, speed: { num: 1, den: 1 }, mediaId: 'master' }] },
      doc: { fps: { num: 30, den: 1 }, preview: { proxy: 'proxy.mp4' }, media: [{ id: 'master' }] },
    } });
    assert.equal(capture.sample().presented, true);
    video.seeking = true;
    assert.equal(capture.sample().presented, false);
  } finally { globalThis.document = previous; }
});

test('still dimensions do not certify a newly requested source as presented', () => {
  const previous = globalThis.document;
  const still = { width: 960, style: { display: 'block' }, dataset: { ready: 'false', thumbSource: 'new.png', presentedSource: 'old.png' } };
  globalThis.document = { querySelector: selector => selector === '#preview-still' ? still : null };
  try {
    const capture = Object.create(PreviewCapture.prototype);
    capture.editor = { frame: 48, video: { clips: [{ start: 0, duration: 120, mediaId: 'independent' }] }, doc: { preview: {}, media: [{ id: 'master' }] } };
    capture.shownFrame = null;
    assert.equal(capture.sample().presented, false);
    still.dataset.ready = 'true';
    assert.equal(capture.sample().presented, false);
    still.dataset.presentedSource = 'new.png';
    assert.equal(capture.sample().presented, true);
    assert.equal(capture.sample().shownFrame, 48);
  } finally { globalThis.document = previous; }
});

test('recorder drain latency is not added to microphone duration', async () => {
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const cancel = globalThis.cancelAnimationFrame;
  let now = 1000;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  globalThis.cancelAnimationFrame = () => {};
  const recorder = () => {
    let stopped;
    return { state: 'recording', addEventListener: (_name, callback) => { stopped = callback; }, requestData() {}, stop() { now = 9000; queueMicrotask(stopped); } };
  };
  try {
    const capture = Object.create(PreviewCapture.prototype);
    Object.assign(capture, { recorder: recorder(), micRecorder: recorder(), startedAt: 500, chunks: [], micChunks: [], releaseStreams() {} });
    const result = await capture.finish();
    assert.equal(result.durationMs, 500);
  } finally {
    Object.defineProperty(globalThis, 'performance', performanceDescriptor);
    globalThis.cancelAnimationFrame = cancel;
  }
});

test('short voice cannot acquire a second microphone during a recorded review', async () => {
  for (const phase of ['acquiring', 'recording', 'finalizing']) {
    const messages = [];
    const controller = { editor: { feedback: { review: { phase } }, toast: text => messages.push(text) } };
    await VoiceControl.prototype.start.call(controller);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /recorded review/);
    assert.equal(controller.listening, undefined);
  }
});
