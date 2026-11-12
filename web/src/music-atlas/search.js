// Sound Atlas search: facets, lexical match and semantic similarity. Queries are embedded in the
// browser with all-MiniLM-L6-v2, the model tools/music-catalog.mjs embedded the catalogue with, so
// "clean geometry dash energy" lands near tracks described as bright, driving electronic.
// A live Openverse query adds CC0 / CC BY music from across the web (Jamendo, Freesound, Wikimedia...).
import { classify, expand, bpmBand, FEELS, familyById, styleName } from "./taxonomy.js";

const TF = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;

const hayOf = (t) => ({
  title: t.title.toLowerCase(), author: (t.author || "").toLowerCase(),
  meta: [feelName(t.feel), familyById[t.family]?.name, styleName(t.family, t.style), ...(t.tags || []), t.band].join(" ").toLowerCase(),
  desc: (t.desc || "").toLowerCase(),
});
const feelName = (id) => FEELS.find((f) => f.id === id)?.name ?? "";
function prep(t) { t.title = String(t.title ?? "Untitled"); t.author = String(t.author ?? "Unknown"); t.band = bpmBand(t.bpm); t.hay = hayOf(t); return t; }

export async function loadCatalog(base = "./") {
  const [cat, buf] = await Promise.all([
    fetch(base + "catalog.json").then((r) => { if (!r.ok) throw new Error("catalog.json " + r.status); return r.json(); }),
    fetch(base + "vectors.bin").then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
  ]);
  const vec = buf && buf.byteLength === cat.tracks.length * DIM ? new Int8Array(buf) : null;
  cat.tracks.forEach((t, i) => { prep(t); if (vec) t.v = vec.subarray(i * DIM, (i + 1) * DIM); });
  return cat;
}

// --- semantic model (lazy: ~23 MB, cached by the browser after the first load) ------------------
let embedder = null, loading = null;
export function loadModel(onState) {
  if (embedder) return Promise.resolve(embedder);
  loading ??= (async () => {
    onState?.("loading");
    const { pipeline, env } = await import(/* @vite-ignore */ TF);
    env.allowLocalModels = false;
    embedder = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
    onState?.("ready");
    return embedder;
  })().catch((e) => { loading = null; onState?.("off", e); throw e; });
  return loading;
}
export const modelReady = () => !!embedder;
export async function embed(texts) {
  if (!embedder) return null;
  const out = await embedder(texts, { pooling: "mean", normalize: true });
  return texts.map((_, k) => { const v = new Int8Array(DIM); for (let j = 0; j < DIM; j++) v[j] = Math.max(-127, Math.min(127, Math.round(out.data[k * DIM + j] * 127))); return v; });
}
const dot = (a, b) => { let d = 0; for (let j = 0; j < DIM; j++) d += a[j] * b[j]; return d / 16129; };

// --- ranking ------------------------------------------------------------------------------------
// opts: { q, qv (Int8Array query vector), like (track), feels:Set, bands:Set, cc0, picks:Set|null, keep:(t)=>bool, web }
export function search(tracks, opts) {
  const pool = tracks.filter((t) =>
    (!opts.feels?.size || opts.feels.has(t.feel)) &&
    (!opts.bands?.size || opts.bands.has(t.band)) &&
    (!opts.cc0 || t.license === "CC0") &&
    (!opts.picks || opts.picks.has(t.id)) &&
    (!opts.keep || opts.keep(t)) &&
    (opts.web !== false || t.src !== "web"));
  const q = (opts.q || "").trim();
  const qv = opts.like?.v ?? opts.qv;
  if (!q && !qv) return { hits: pool.map((t) => ({ t, score: 0 })), ranked: false };
  const toks = q ? [...new Set(expand(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))] : [];
  const lexOf = (t) => {
    if (!toks.length) return 0;
    let s = 0;
    for (const w of toks) { const h = t.hay; s += h.title.includes(w) ? 3 : 0; s += h.author.includes(w) ? 2 : 0; s += h.meta.includes(w) ? 1.6 : 0; s += h.desc.includes(w) ? 0.8 : 0; }
    // Exact phrase in title or author wins outright (people search by name).
    if (q.length > 3 && (t.hay.title.includes(q.toLowerCase()) || t.hay.author.includes(q.toLowerCase()))) s += 8;
    return s;
  };
  const rows = pool.map((t) => ({ t, lex: lexOf(t), sim: qv && t.v ? dot(qv, t.v) : null }));
  const lexMax = Math.max(1e-6, ...rows.map((r) => r.lex));
  const sims = rows.map((r) => r.sim).filter((x) => x !== null).sort((a, b) => b - a);
  const top = sims[0] ?? 0, floor = sims[Math.floor(sims.length * 0.6)] ?? 0;
  for (const r of rows) {
    const lexN = r.lex / lexMax;
    const semN = r.sim === null ? 0 : Math.max(0, (r.sim - floor) / Math.max(1e-6, top - floor));
    r.score = sims.length ? (toks.length ? 0.62 * semN + 0.38 * lexN : semN) + (r.lex >= 8 ? 1 : 0) : lexN;
  }
  if (opts.like) rows.forEach((r) => { if (r.t === opts.like) r.score = 9; });
  rows.sort((a, b) => b.score - a.score);
  const best = rows[0]?.score ?? 0;
  const hits = rows.filter((r, i) => r.score > 0 && (r.score >= best * 0.42 || i < 24)).slice(0, 160);
  return { hits, ranked: true };
}

// --- Openverse: CC0 / CC BY music from across the web ----------------------------------------------
const LIC = { cc0: () => "CC0", by: (v) => `CC BY ${v || "4.0"}` };
export async function webSearch(q, known) {
  const key = "ov:" + q.toLowerCase();
  let rows = null;
  try { rows = JSON.parse(sessionStorage.getItem(key)); } catch {}
  if (!rows) {
    const u = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&license=cc0,by&page_size=20&mature=false`; // anonymous page_size caps at 20
    const r = await fetch(u);
    if (r.status === 429) throw new Error("Openverse rate limit: try again in a minute");
    if (!r.ok) throw new Error("Openverse " + r.status);
    rows = (await r.json()).results ?? [];
    try { sessionStorage.setItem(key, JSON.stringify(rows)); } catch {}
  }
  const seen = new Set(known.map((t) => (t.title + "|" + t.author).toLowerCase()));
  const out = [];
  for (const r of rows) {
    // Licence gate again on the client: plain CC0 / BY only, full songs (>= 30 s), streamable.
    if (!LIC[r.license] || !r.url || (r.duration ?? 0) < 30000 || r.category === "sound_effect" || r.category === "podcast") continue;
    const k = (r.title + "|" + r.creator).toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    const tags = [...(r.genres || []), ...(r.tags || []).map((x) => x.name)].slice(0, 14);
    const text = [r.title, tags.join(", ")].join(". ");
    out.push(prep({
      id: "ov-" + r.id, src: "web", provider: r.provider, title: r.title || "Untitled", author: r.creator || "Unknown",
      license: LIC[r.license](r.license_version), licenseUrl: r.license_url, sourceUrl: r.foreign_landing_url, audio: r.url,
      bpm: null, dur: Math.round(r.duration / 1000), tags, desc: "", ...classify(text), _text: text,
    }));
  }
  if (out.length && modelReady()) (await embed(out.map((t) => t._text))).forEach((v, i) => (out[i].v = v));
  return out;
}

export const creditLine = (t) => `"${t.title}" by ${t.author}${t.src === "incompetech" ? " (incompetech.com)" : ""}, ${t.license}${t.licenseUrl ? " " + t.licenseUrl : ""}${t.sourceUrl ? " · " + t.sourceUrl : ""}`;
