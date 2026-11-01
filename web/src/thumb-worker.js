// Decode images and resize video posters off the UI thread; bound the cache.
const cache = new Map();
// Image-to-video reference: centre-crop (cover) to the requested size, lossless PNG, uncached.
async function capture(id, input, { width, height }) {
  try {
    const canvas = new OffscreenCanvas(width, height), scale = Math.max(width / input.width, height / input.height);
    const w = input.width * scale, h = input.height * scale;
    canvas.getContext('2d').drawImage(input, (width - w) / 2, (height - h) / 2, w, h);
    input.close();
    self.postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/png' }) });
  } catch { input.close(); self.postMessage({ id, error: true }); }
}
self.onmessage = async ({ data: { id, url, bitmap: input, key = url, video, capture: size } }) => {
  if (size) return capture(id, input, size);
  try {
    let blob = cache.get(key);
    if (!blob) {
      if (video) { self.postMessage({ id, decode:true }); return; }
      if (input) {
        const canvas = new OffscreenCanvas(160, 90);
        canvas.getContext('2d').drawImage(input, 0, 0, 160, 90);
        input.close();
        blob = await canvas.convertToBlob({ type:'image/webp', quality:.8 });
      } else {
        const response = await fetch(url);
        if (!response.ok) throw Error(response.status);
        blob = await response.blob();
      }
      cache.set(key, blob);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    } else input?.close();
    const bitmap = await createImageBitmap(blob);
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch { input?.close(); self.postMessage({ id, error:true }); }
};
