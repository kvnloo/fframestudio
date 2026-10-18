import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_STYLE_PRESETS, instantiate, evaluateRecipe, serializeRecipe, parseRecipe, interpolate } from '../../web/src/video-style/components.mjs';

test('three composable launch mechanisms are discoverable', () => {
  assert.deepEqual(Object.keys(VIDEO_STYLE_PRESETS), [
    'headline-reveal', 'foreground-fly-through', 'ui-action-result',
  ]);
  assert.ok(evaluateRecipe(instantiate('headline-reveal'), 0).layers.some(l => l.opacity === 1));
});

test('time-seeking is deterministic, including at start and end', () => {
  for (const component of Object.keys(VIDEO_STYLE_PRESETS)) {
    const recipe = instantiate(component);
    const first = evaluateRecipe(recipe, 0), last = evaluateRecipe(recipe, recipe.durationFrames - 1);
    for (const frame of [43, 10, recipe.durationFrames - 1, 0, 43]) {
      assert.deepEqual(evaluateRecipe(recipe, frame), evaluateRecipe(recipe, frame));
    }
    assert.deepEqual(evaluateRecipe(recipe, 0), first);
    assert.deepEqual(evaluateRecipe(recipe, recipe.durationFrames - 1), last);
    assert.ok(first.layers.every(l => Number.isFinite(l.x) && Number.isFinite(l.opacity)));
  }
});

test('round trip retains text, rational fps, cues and exact frame samples', () => {
  const r = instantiate('ui-action-result', { action: 'Create video', result: 'Video ready' });
  r.fps = { num: 30000, den: 1001 };
  const r2 = parseRecipe(serializeRecipe(r));
  assert.deepEqual(r2, r);
  assert.deepEqual(evaluateRecipe(r2, 80), evaluateRecipe(r, 80));
  assert.equal(evaluateRecipe(r2, 0).layers[0].text, 'Create video');
  assert.ok(Array.from({length: r2.durationFrames}, (_, i) => evaluateRecipe(r2, i).cues).some(c => c.length));
});

test('rejects invalid formats, times and unexpected properties', () => {
  assert.throws(() => instantiate('nonexistent'), /Unknown component/);
  assert.throws(() => instantiate('headline-reveal', { unsupported: 'injection' }), /Unsupported prop/);
  assert.throws(() => instantiate('headline-reveal', { background: 'url(data:bad)' }), /background color/);
  const r = instantiate('headline-reveal');
  assert.throws(() => evaluateRecipe(r, -1), /bounds/);
  assert.throws(() => evaluateRecipe(r, r.durationFrames), /bounds/);
  r.durationFrames = 1;
  assert.throws(() => serializeRecipe(r), /frame duration/);
});

test('interpolator uses normalized keyframes and respects easing', () => {
  assert.equal(interpolate([[0, 10], [1, 20]], 0.5), 15);
  assert.equal(interpolate([[0, 10], [1, 20, 'hold']], 0.9), 10);
  assert.equal(interpolate([[0, 0], [1, 1, 'out-cubic']], 0.5), .875);
});
