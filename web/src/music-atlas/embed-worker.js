// The semantic model off the main thread: loading and compiling it (~1 s of wasm on a phone) and embedding each
// query no longer stall taps, typing or the dance. search.js talks to it; it falls back to the page if workers fail.
let embedder = null;
self.onmessage = async ({ data: { id, op, tf, model, texts } }) => {
  try {
    if (op === "load") {
      const { pipeline, env } = await import(tf);
      env.allowLocalModels = false;
      embedder = await pipeline("feature-extraction", model, { dtype: "q8" });
      self.postMessage({ id });
    } else {
      const out = await embedder(texts, { pooling: "mean", normalize: true }), data = out.data;
      self.postMessage({ id, data }, [data.buffer]);
    }
  } catch (e) { self.postMessage({ id, err: String(e?.message || e) }); }
};
