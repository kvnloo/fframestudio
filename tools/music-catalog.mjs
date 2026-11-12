#!/usr/bin/env node
// Build the Sound Atlas catalogue: CC0 / CC BY music only (no NC, ND or SA), filed by the shared
// taxonomy and embedded for semantic search with the same model the browser uses.
//
//   node tools/music-catalog.mjs --out <dir> [--shortlist tracks.json] [--ccmixter 400]
//
// Writes <dir>/catalog.json (tracks + facets) and <dir>/vectors.bin (int8, 384 per track, catalogue order).
// Needs @huggingface/transformers; set TRANSFORMERS_PATH to its entry file if it is not resolvable here.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { classify, INCOMPETECH_GENRE, FEELS } from "../web/src/music-atlas/taxonomy.js";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = resolve(arg("out", "verify-out/music-atlas"));
const MODEL = "Xenova/all-MiniLM-L6-v2";
const UA = "fframestudio-sound-atlas/1 (+https://github.com/kvnloo/fframestudio)";
const CC_BY = /creativecommons\.org\/licenses\/by\/(\d\.\d)\/?$/; // plain BY only: by-nc, by-sa, by-nd do not match
// curl, not fetch: ccMixter's response headers overflow undici (UND_ERR_HEADERS_OVERFLOW) and its
// bodies carry stray non-UTF-8 bytes, which the lenient decoder replaces.
const utf8 = new TextDecoder("utf-8");
const getJSON = async (u, tries = 3) => {
  for (let i = 0; ; i++) {
    try { return JSON.parse(utf8.decode(execFileSync("curl", ["-sfL", "-m", "60", "-A", UA, u], { maxBuffer: 64 << 20 }))); }
    catch (e) { if (i + 1 >= tries) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
};
const secs = (s) => (s ? s.split(":").reduce((a, x) => a * 60 + +x, 0) : null);

async function incompetech() {
  const list = await getJSON("https://incompetech.com/music/royalty-free/pieces.json");
  return list.filter((p) => p.genre !== "23" && secs(p.length) >= 25).map((p) => {
    const genre = INCOMPETECH_GENRE[p.genre] ?? "Unclassifiable";
    const feelList = (p.feel || "").split(",").map((s) => s.trim()).filter(Boolean);
    const text = [p.title, genre, p.feel, p.instruments, p.description].join(". ");
    return {
      id: "inc-" + (p.isrc || p.filename.replace(/\W+/g, "-")), src: "incompetech", title: p.title, author: "Kevin MacLeod",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://incompetech.com/music/royalty-free/music.html",
      audio: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/" + encodeURIComponent(p.filename),
      bpm: +p.bpm || null, dur: secs(p.length), tags: [genre, ...feelList, ...(p.instruments || "").split(",").map((s) => s.trim()).filter(Boolean)],
      desc: p.description || "", year: (p.uploaded || "").slice(0, 4), ...classify(text, { genre, feelList }), text,
    };
  });
}

async function ccmixter(max) {
  // The API returns nothing for limit > 25 or an explicit offset=0, so page by 20 from the second page on.
  const rows = [];
  for (let off = 0; off < max; off += 20) {
    const page = await getJSON(`https://ccmixter.org/api/query?f=json&lic=by&tags=instrumental&sort=rank&limit=20${off ? "&offset=" + off : ""}`).catch(() => []);
    if (!page.length) break; rows.push(...page);
  }
  return rows.flatMap((u) => {
    const m = CC_BY.exec(u.license_url || ""), f = u.files?.find((x) => x.file_format_info?.["default-ext"] === "mp3");
    if (!m || !f?.download_url) return [];
    const tags = (u.upload_extra?.usertags || "").split(",").filter((t) => t && t !== "instrumental").map((t) => t.replace(/_/g, " "));
    const text = [u.upload_name, tags.join(", ")].join(". ");
    return [{
      id: "ccm-" + u.upload_id, src: "ccmixter", title: String(u.upload_name), author: String(u.user_real_name || u.user_name), // titles like "1973" arrive as numbers
      license: "CC BY " + m[1], licenseUrl: `https://creativecommons.org/licenses/by/${m[1]}/`, sourceUrl: u.file_page_url,
      audio: f.download_url.replace(/^http:/, "https:"), bpm: +u.upload_extra?.bpm || null, dur: secs(f.file_format_info?.ps),
      tags, desc: "", year: (u.upload_date_format || "").match(/\d{4}/)?.[0] ?? "", ...classify(text), text,
    }];
  });
}

function shortlist(path) {
  if (!path) return [];
  const m = JSON.parse(readFileSync(path, "utf8"));
  return m.tracks.map((t) => {
    const text = [t.title, t.group, t.note].filter(Boolean).join(". ");
    const lic = /^CC0/.test(t.license) ? "CC0" : t.license;
    return { id: "sl-" + t.id, src: "shortlist", title: t.title, author: t.author, license: lic, licenseUrl: t.license_url, sourceUrl: t.source_url,
      audio: "tracks/" + t.file.split("/").pop(), bpm: t.bpm || null, dur: Math.round(t.duration_s) || null, tags: [t.group].filter(Boolean), desc: t.note || "",
      peaks: t.peaks, year: "", ...classify(text + " electronic"), text: text + ". electronic" };
  });
}

const sources = [
  ["shortlist", "Glide shortlist", "", () => shortlist(arg("shortlist"))],
  ["incompetech", "Incompetech", "https://incompetech.com/music/royalty-free/", incompetech],
  ["ccmixter", "ccMixter", "https://ccmixter.org/", () => ccmixter(+arg("ccmixter", 400))],
];
const tracks = [], seen = new Map();
for (const [id, name, , load] of sources) {
  const got = await load(); let n = 0;
  for (const t of got) {
    const k = (t.title + "|" + (t.author || "").split(/\s+/).pop()).toLowerCase(), twin = seen.get(k);
    // A shortlist pick that is also in a full catalogue keeps its local file but takes the richer metadata.
    if (twin) { if (twin.src === "shortlist") Object.assign(twin, { feel: t.feel, feels: t.feels, family: t.family, style: t.style, tags: [...twin.tags, ...t.tags], desc: t.desc, bpm: twin.bpm ?? t.bpm, text: t.text }); continue; }
    seen.set(k, t); tracks.push(t); n++;
  }
  console.log(`${name}: ${n} tracks`);
}
const bad = tracks.filter((t) => !/^(CC0|CC BY \d\.\d)$/.test(t.license));
if (bad.length) throw new Error("licence gate: " + bad.map((t) => t.id + " " + t.license).join(", "));

const tp = process.env.TRANSFORMERS_PATH ? pathToFileURL(process.env.TRANSFORMERS_PATH).href : "@huggingface/transformers";
const { pipeline } = await import(tp);
const embed = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
const vec = new Int8Array(tracks.length * 384);
for (let i = 0; i < tracks.length; i += 32) {
  const batch = tracks.slice(i, i + 32).map((t) => t.text.slice(0, 600));
  const out = await embed(batch, { pooling: "mean", normalize: true });
  const d = out.data; for (let j = 0; j < d.length; j++) vec[i * 384 + j] = Math.max(-127, Math.min(127, Math.round(d[j] * 127)));
}
// Tracks whose text names no feeling get the nearest feel prototype (zero-shot on the same embedding).
const protos = await embed(FEELS.map((F) => `${F.name} music: ${F.ask}. ${F.words.join(", ")}`), { pooling: "mean", normalize: true });
let zs = 0;
tracks.forEach((t, i) => {
  if (t.feels.length) return;
  let best = 0, bs = -2;
  FEELS.forEach((F, f) => { let d = 0; for (let j = 0; j < 384; j++) d += vec[i * 384 + j] * protos.data[f * 384 + j]; if (d > bs) { bs = d; best = f; } });
  t.feel = FEELS[best].id; t.feelGuess = true; zs++;
});
console.log(`zero-shot feel for ${zs} tracks`);
mkdirSync(OUT, { recursive: true });
for (const t of tracks) delete t.text;
const catalog = { version: 1, built: new Date().toISOString(), model: MODEL, dim: 384,
  sources: sources.map(([id, name, url]) => ({ id, name, url, count: tracks.filter((t) => t.src === id).length })), tracks };
writeFileSync(join(OUT, "catalog.json"), JSON.stringify(catalog));
writeFileSync(join(OUT, "vectors.bin"), Buffer.from(vec.buffer));
console.log(`wrote ${tracks.length} tracks -> ${OUT}`);
