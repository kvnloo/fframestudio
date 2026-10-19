import test from 'node:test';
import assert from 'node:assert/strict';
import { measureImagePalette, paletteTasteProfile, paletteFromLocalFiles } from '../../web/src/taste/image-palette.js';
import { validateProfile } from '../../web/src/taste/profile.js';

const solid = (rgb, w = 8, h = 8) => ({ width: w, height: h,
  data: new Uint8ClampedArray(Array.from({ length: w*h }, () => [...rgb, 255]).flat()) });

test('opaque pixels create deterministic measured color swatches and a valid aggregate profile', async () => {
  const first = measureImagePalette([solid([255, 0, 0]), solid([0, 0, 255])]);
  const again = measureImagePalette([solid([255, 0, 0]), solid([0, 0, 255])]);
  assert.deepEqual(first, again);
  assert.equal(first.imageCount, 2);
  assert.equal(first.sampledPixels, 128);
  assert.deepEqual(first.colors, ['#0000ff', '#ff0000']);
  const profile = await paletteTasteProfile([solid([255, 0, 0]), solid([0, 0, 255])]);
  validateProfile(profile);
  assert.equal(profile.signals.palette.evidenceCount, 2);
  assert.equal(profile.signals.palette.confidence, 0.44);
  assert.deepEqual(profile.signals.palette.value, ['#0000ff', '#ff0000']);
  assert.ok(Object.entries(profile.signals).every(([name, x]) => name === 'palette' || x.value === null));
  assert.deepEqual(profile.provenance, { sourceCount: 1, itemCount: 2 });
  assert.deepEqual(profile, await paletteTasteProfile([solid([255, 0, 0]), solid([0, 0, 255])]));
});

test('each selected image has equal influence regardless of pixel count', () => {
  const a = measureImagePalette([solid([255, 255, 255], 64, 64), solid([0, 0, 0], 1, 1)]);
  assert.deepEqual(a.colors, ['#000000', '#ffffff']);
});

test('transparent pixels are ignored; transparent-only images are refused', () => {
  const red = solid([255, 0, 0], 2, 1);
  red.data.set([0, 0, 255, 0], 4);
  assert.deepEqual(measureImagePalette([red]).colors, ['#ff0000']);
  red.data[3] = 0;
  assert.throws(() => measureImagePalette([red]), /no visible/);
});

test('invalid sample dimensions, data, and image counts fail closed', () => {
  assert.throws(() => measureImagePalette([]), /1–6/);
  assert.throws(() => measureImagePalette(Array(7).fill(solid([0, 0, 0]))), /1–6/);
  assert.throws(() => measureImagePalette([{ width: 999, height: 1, data: new Uint8ClampedArray(4) }]), /Invalid/);
  assert.throws(() => measureImagePalette([{ width: 1, height: 1, data: [0, 0, 0, 255] }]), /Invalid/);
  assert.throws(() => measureImagePalette([{ width: 1, height: 1, data: new Uint8Array(3) }]), /Invalid/);
});

test('browser-only image decoder refuses SVG and oversized selections before decode', async () => {
  await assert.rejects(() => paletteFromLocalFiles([]), /1–6/);
  await assert.rejects(() => paletteFromLocalFiles([{ type: 'image/svg+xml', size: 100 }]), /PNG/);
  await assert.rejects(() => paletteFromLocalFiles([{ type: 'image/png', size: 8_000_001 }]), /8 MB/);
  await assert.rejects(() => paletteFromLocalFiles([{ type: 'image/png', size: 120 }]), /unsupported/);
});
