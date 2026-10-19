// On-device pixel statistics from explicitly selected images. No upload or raw pixels persisted.
// Only measured palette colors are inferred; text, motion, genre and audio remain unknown.
export const MAX_TASTE_IMAGES = 6;
const SIDE = 64;
const SIGNAL_NAMES = ['palette', 'typography', 'framing', 'motion', 'pacing', 'transition', 'density', 'soundtrack'];
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

export function measureImagePalette(frames) {
  if (!Array.isArray(frames) || !frames.length || frames.length > MAX_TASTE_IMAGES)
    throw Error('Select 1–6 images');
  const combined = new Map();
  let pixels = 0;
  for (const image of frames) {
    const { width, height, data } = image || {};
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 ||
        height < 1 || width > SIDE || height > SIDE ||
        !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
        data.length !== width * height * 4)
      throw Error('Invalid bounded image pixels');
    const perImage = new Map();
    let visible = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const bucket = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      const entry = perImage.get(bucket) || { count: 0, r: 0, g: 0, b: 0 };
      entry.count++; entry.r += r; entry.g += g; entry.b += b;
      perImage.set(bucket, entry);
      visible++;
    }
    if (!visible) throw Error('Image has no visible pixels');
    pixels += visible;
    // Each selected screenshot contributes equally regardless of its dimensions.
    for (const [key, entry] of perImage) {
      const merged = combined.get(key) || { key, weight: 0, r: 0, g: 0, b: 0 };
      const scale = 1 / visible;
      merged.weight += entry.count * scale;
      merged.r += entry.r * scale;
      merged.g += entry.g * scale;
      merged.b += entry.b * scale;
      combined.set(key, merged);
    }
  }
  const bins = [...combined.values()].sort((a, b) => b.weight - a.weight || a.key - b.key);
  const palette = [];
  for (const entry of bins) {
    const c = [entry.r / entry.weight, entry.g / entry.weight, entry.b / entry.weight];
    const distant = palette.every(v => v.reduce((sum, x, i) => sum + (x - c[i]) ** 2, 0) >= 48 ** 2);
    if (distant) palette.push(c);
    if (palette.length === 5) break;
  }
  return { colors: palette.map(c => hex(...c)), imageCount: frames.length, sampledPixels: pixels };
}

export async function paletteTasteProfile(frames) {
  const summary = measureImagePalette(frames);
  const data = new TextEncoder().encode(JSON.stringify({ colors: summary.colors, images: summary.imageCount }));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  const signals = Object.fromEntries(SIGNAL_NAMES.map(name =>
    [name, { value: null, evidenceCount: 0, confidence: 0 }]));
  signals.palette = {
    value: summary.colors, evidenceCount: summary.imageCount,
    // Heuristic trust in the selected sample count, not a statistical probability.
    confidence: Math.min(0.76, Number((0.28 + summary.imageCount * 0.08).toFixed(2))),
  };
  return { schema: 'fframestudio.taste-profile/1', revision: 'image-colors-' + hash,
    signals, provenance: { sourceCount: 1, itemCount: summary.imageCount } };
}

export async function paletteFromLocalFiles(files) {
  const selected = Array.from(files || []);
  if (selected.length < 1 || selected.length > MAX_TASTE_IMAGES) throw Error('Select 1–6 screenshots');
  if (selected.some(f => !ALLOWED_TYPES.has(f.type) || f.size < 1 || f.size > 8_000_000) ||
      selected.reduce((n, f) => n + f.size, 0) > 24_000_000)
    throw Error('Images must be PNG, JPEG or WebP, max 8 MB each and 24 MB total');
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined')
    throw Error('Local image analysis is unsupported in this browser');
  const frames = [];
  for (const file of selected) {
    const bitmap = await createImageBitmap(file, { resizeWidth: SIDE, resizeHeight: SIDE, resizeQuality: 'medium' });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SIDE; canvas.height = SIDE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw Error('Local canvas unavailable');
      ctx.drawImage(bitmap, 0, 0, SIDE, SIDE);
      frames.push(ctx.getImageData(0, 0, SIDE, SIDE));
      canvas.width = canvas.height = 0;
    } finally { bitmap.close(); }
  }
  return paletteTasteProfile(frames);
}
