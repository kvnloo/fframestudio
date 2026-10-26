// Guard: a storyboard whose scenes differ must not preview as N copies of one page.
// Regression for the o8 storyboard (2026-10-25): eight studio-spec shots, each with its own
// slate image and no thumbnail, all previewed as the project poster (the first slate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fromV0, clipStill, duplicateStills } from '../../web/src/doc/project.js';

const storyboard = (n = 8) => fromV0({
  schema: 'fframestudio.project/0', id: 'board', title: 'Board', kind: 'studio-spec',
  canvas: { width: 1920, height: 1080, fps: 60 },
  shots: Array.from({ length: n }, (_, i) => ({
    id: `S0${i + 1}`, name: `Scene ${i + 1}`, t0: i * 6, t1: (i + 1) * 6,
    media: [`media/S0${i + 1}.png`], text: {},
  })),
  media: { poster: 'media/S01.png' },
});

test('every scene of a storyboard previews its own page', () => {
  const doc = storyboard();
  const clips = doc.videos[0].clips;
  const pages = clips.map((c) => clipStill(doc, c));
  assert.deepEqual(pages, clips.map((_, i) => `media/S0${i + 1}.png`));
  assert.equal(new Set(pages).size, clips.length, 'distinct scenes rendered identical pages');
  assert.deepEqual(duplicateStills(doc), []);
});

test('a clip thumbnail still wins over its source image, and the poster is only a fallback', () => {
  const doc = storyboard(2);
  const [a, b] = doc.videos[0].clips;
  a.thumb = 'media/shots/001.jpg';
  b.mediaId = null;
  assert.equal(clipStill(doc, a), 'media/shots/001.jpg');
  assert.equal(clipStill(doc, b), 'media/S01.png');
});

test('duplicateStills names scenes that would show the same page', () => {
  const doc = storyboard(3);
  for (const c of doc.videos[0].clips) c.mediaId = null; // nothing of their own: all fall back
  assert.deepEqual(duplicateStills(doc), [['S01', 'S02', 'S03']]);
});

test('scenes that share a poster but carry different words are different pages', () => {
  const doc = storyboard(2);
  const [a, b] = doc.videos[0].clips;
  a.mediaId = b.mediaId = null;
  a.text = { title: 'One' };
  b.text = { title: 'Two' };
  assert.deepEqual(duplicateStills(doc), []);
});
