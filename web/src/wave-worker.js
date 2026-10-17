// Peak/RMS reduction runs once per source key; only compact summaries are cached.
export function analyse(samples, bins = 1400) {
  const peaks = new Float32Array(bins),
    energy = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const start = Math.floor((i * samples.length) / bins),
      end = Math.floor(((i + 1) * samples.length) / bins);
    let peak = 0,
      sum = 0;
    for (let j = start; j < end; j++) {
      const v = samples[j];
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    peaks[i] = peak;
    energy[i] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return { peaks, energy };
}
if (typeof self !== "undefined")
  self.onmessage = async ({ data: { key, samples } }) => {
    let db, result;
    try {
      db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("fframestudio.waveforms", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("peaks");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const cached = await new Promise((resolve, reject) => {
        const r = db.transaction("peaks").objectStore("peaks").get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      if (cached) {
        self.postMessage({ ...cached, cached: true });
        return;
      }
      result = analyse(samples);
      await new Promise((resolve, reject) => {
        const tx = db.transaction("peaks", "readwrite");
        const store = tx.objectStore("peaks");
        store.put(result, key);
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          for (const old of keys.result
            .filter((k) => k !== key)
            .slice(0, Math.max(0, keys.result.length - 32)))
            store.delete(old);
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      self.postMessage({ ...result, cached: false });
    } catch {
      self.postMessage({ ...(result || analyse(samples)), cached: false });
    } finally {
      db?.close();
    }
  };
