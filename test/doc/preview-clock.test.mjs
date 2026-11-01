import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../../web/src/editor.js';

const fixture = () => Object.assign(Object.create(Editor.prototype, {
  doc: { value: { fps: { num: 60, den: 1 } } }, total: { value: 3108 },
}), {
  frame: 900, rate: 1,
  studio: { loop: null },
  previewClock: { start: 900, sourceIn: 900, speed: { num: 1, den: 1 } },
});

test('audible proxy startup/buffering does not advance playhead into corrective seeks', () => {
  const e = fixture();
  const video = { currentTime: 15, seeking: false };
  for (let i = 0; i < 50; i++) e.advancePlayback(100, video);
  assert.equal(e.frame, 900);
  video.currentTime = 15.5;
  e.advancePlayback(100, video);
  assert.equal(e.frame, 930);
});

test('pending explicit seek keeps requested playhead until media settles', () => {
  const e = fixture();
  e.frame = 1200;
  e.advancePlayback(100, { currentTime: 15, seeking: true });
  assert.equal(e.frame, 1200);
});

test('media clock maps edited source-in and rational clip speed', () => {
  const e = fixture();
  e.previewClock = { start: 900, sourceIn: 600, speed: { num: 2, den: 1 } };
  e.advancePlayback(100, { currentTime: 11, seeking: false });
  assert.equal(e.frame, 930);
});

test('reverse and non-proxy playback retain wall-clock stepping', () => {
  const e = fixture();
  e.rate = -1;
  e.advancePlayback(100, { currentTime: 15, seeking: false });
  assert.equal(e.frame, 894);
  e.rate = 1; e.previewClock = null;
  e.advancePlayback(100, { currentTime: 15, seeking: false });
  assert.equal(e.frame, 900);
});

test('forward media clock respects loop bounds and stopped transport', () => {
  const e = fixture();
  e.studio.loop = 'loop-shot'; e.studio.bounds = () => [900, 960];
  e.advancePlayback(100, { currentTime: 16, seeking: false });
  assert.equal(e.frame, 900);
  e.rate = 0;
  e.advancePlayback(100, { currentTime: 16, seeking: false });
  assert.equal(e.frame, 900);
});
