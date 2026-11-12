// Sound Atlas listening layer: what each track measures like (tools/music-features.py) and which
// tracks sound alike. Values are shown as catalogue percentiles because "bright" only means
// something next to everything else; neighbours blend CLAP timbre with tempo, key and texture,
// so a creator can follow a sound across feels instead of staying inside one wedge.
const DIM = 512;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Scalar descriptors: [key, label, low word, high word, value formatter].
export const METERS = [
  ["tempo", "Tempo", "slow", "fast", (f) => `${Math.round(f.tempo)} bpm heard`],
  ["bright", "Tonality", "warm", "bright", (f) => `${(f.bright / 1000).toFixed(1)} kHz centroid`],
  ["clarity", "Separation", "congested", "transparent", (f) => `${f.clarity} dB contrast`],
  ["width", "Soundstage", "intimate", "expansive", (f) => `side/mid ${f.width.toFixed(2)} · L/R ${f.corr.toFixed(2)}`],
  ["busy", "Density", "sparse", "dense", (f) => `${f.busy} onsets/s`],
  ["lra", "Dynamics", "compressed", "breathing", (f) => `LRA ${(+f.lra).toFixed(1)} dB · crest ${(+f.crest).toFixed(1)} dB`],
  ["low", "Weight", "lean", "full", (f) => `${Math.round(f.low * 100)}% below 120 Hz`],
];
const pctKeys = ["tempo", ...METERS.map((m) => m[0])];
// Listed BPM wins where a source publishes one: measured tempo matched Incompetech's within 4% on
// 24/40 tracks (34/40 allowing half/double time), so it fills gaps rather than overriding.
export const bpmOf = (t) => t.bpm || (t.f?.tempo ? Math.round(t.f.tempo) : null);
const val = (t, k) => (k === "tempo" ? bpmOf(t) : t.f?.[k]);
let sorted = {}, clapNorm = null, ready = false;

const pct = (k, v) => { const a = sorted[k]; if (!a?.length || v == null) return null; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; a[m] < v ? (lo = m + 1) : (hi = m); } return lo / a.length; };

export async function loadSound(base, tracks) {
  const [js, buf] = await Promise.all([
    fetch(base + "sound.json").then((r) => (r.ok ? r.json() : null)).catch((e) => (console.warn("sound.json unusable", e), null)),
    fetch(base + "sound.bin").then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
  ]);
  if (!js) return false;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const vec = buf && js.dims && buf.byteLength === js.ids.length * js.dims ? new Int8Array(buf) : null;
  js.ids.forEach((id, i) => {
    const t = byId.get(id), f = js.features[id]; if (!t || !f) return;
    t.f = f;
    if (vec) t.cv = vec.subarray(i * DIM, (i + 1) * DIM);
  });
  for (const k of pctKeys) sorted[k] = tracks.filter((t) => t.f).map((t) => val(t, k)).filter((v) => v != null).sort((a, b) => a - b);
  for (const t of tracks) if (t.f) {
    t.p = Object.fromEntries(pctKeys.map((k) => [k, pct(k, val(t, k))]));
    t.hay.meta += " " + words(t).join(" ").toLowerCase(); // "piano", "8a", "wide", "a minor" now search
  }
  if (vec) { clapNorm = new Map(); for (const t of tracks) if (t.cv) { let n = 0; for (let j = 0; j < DIM; j++) n += t.cv[j] * t.cv[j]; clapNorm.set(t, Math.sqrt(n) || 1); } }
  ready = true;
  return true;
}
export const soundReady = () => ready;

// Plain words for a track's measurements, used for search and the card's one-line summary.
function words(t) {
  const f = t.f, p = t.p, w = [f.key, f.camelot, f.timbre, ...(f.inst ?? []).map((x) => x[0])];
  const ends = (k, lo, hi) => (p[k] == null ? null : p[k] > 0.75 ? hi : p[k] < 0.25 ? lo : null);
  w.push(ends("bright", "dark", "bright"), ends("width", "narrow mono", "wide stereo"), ends("busy", "sparse minimal", "busy dense"), ends("clarity", "washy", "clear crisp"), ends("lra", "compressed", "dynamic"), ends("low", "light", "bassy"));
  return w.filter(Boolean);
}
export const summary = (t) => (t.f ? words(t).slice(2, 7).join(" · ") : "");

// --- metre ---------------------------------------------------------------------------------------
// Where playback sits in the music: phase inside the beat (0 at the hit) and a metric accent that
// ranks the hit like a composer would (phrase start > bar downbeat > beat 3 > beats 2 and 4), from
// the downbeat music-features.py measured. Unmeasured tracks fall back to the BPM from t=0.
export function beatAt(t, track) {
  const b = track?.f?.beat, len = 60 / (b?.bpm || bpmOf(track) || 100);
  const n = (t - (b?.down ?? 0)) / len, i = Math.floor(n), pos = ((i % 16) + 16) % 16;
  return { ph: n - i, i, len, acc: pos === 0 ? 1 : pos % 4 === 0 ? 0.7 : pos % 2 === 0 ? 0.45 : 0.28 };
}

// --- harmony ------------------------------------------------------------------------------------
const cam = (c) => (c ? { n: +c.slice(0, -1), l: c.slice(-1) } : null);
// Camelot rule DJs mix by: same code, +-1 on the wheel, or the relative major/minor.
export function keyRelation(a, b) {
  const x = cam(a), y = cam(b); if (!x || !y) return null;
  if (x.n === y.n && x.l === y.l) return "same key";
  if (x.l === y.l && ((x.n - y.n + 12) % 12 === 1 || (y.n - x.n + 12) % 12 === 1)) return "next on the wheel";
  if (x.n === y.n) return "relative " + (y.l === "B" ? "major" : "minor");
  return null;
}
export const mixesWith = (c) => { const x = cam(c); if (!x) return []; const r = (n) => ((n + 11) % 12) + 1; return [`${r(x.n - 1)}${x.l}`, `${r(x.n + 1)}${x.l}`, `${x.n}${x.l === "A" ? "B" : "A"}`]; };

// Tempo distance in octaves, folding half and double time (a 70 bpm track rides a 140 cut).
const tempoGap = (a, b) => Math.min(...[1, 2, 0.5].map((m) => Math.abs(Math.log2((a * m) / b))));

// --- neighbours ---------------------------------------------------------------------------------
export function neighbours(t, pool, k = 8) {
  if (!t?.f) return [];
  const na = t.cv && clapNorm?.get(t);
  const rows = [];
  for (const u of pool) {
    if (u === t || !u.f) continue;
    let timbre = null;
    if (na && u.cv) { let d = 0; for (let j = 0; j < DIM; j++) d += t.cv[j] * u.cv[j]; timbre = d / (na * clapNorm.get(u)); }
    const tg = bpmOf(t) && bpmOf(u) ? tempoGap(bpmOf(t), bpmOf(u)) : 1;
    const sTempo = Math.exp(-((tg / 0.07) ** 2)); // ~5% apart still scores well: inside a DJ's pitch range
    const rel = keyRelation(t.f.camelot, u.f.camelot), sKey = rel === "same key" ? 1 : rel ? 0.7 : 0;
    let tex = 0, n = 0; for (const m of ["bright", "busy", "width", "clarity"]) if (t.p[m] != null && u.p[m] != null) { tex += 1 - Math.abs(t.p[m] - u.p[m]); n++; }
    const sTex = n ? tex / n : 0;
    rows.push({ t: u, timbre, sTempo, sKey, sTex, rel, tg });
  }
  // CLAP cosines bunch in a narrow band; rescale them across this pool before blending.
  const ts = rows.map((r) => r.timbre).filter((x) => x != null).sort((a, b) => a - b);
  const lo = ts[Math.floor(ts.length * 0.5)] ?? 0, hi = ts[ts.length - 1] ?? 1;
  for (const r of rows) {
    r.sTimbre = r.timbre == null ? null : clamp((r.timbre - lo) / Math.max(1e-6, hi - lo), 0, 1);
    r.score = r.sTimbre == null ? 0.45 * r.sTex + 0.35 * r.sTempo + 0.2 * r.sKey : 0.55 * r.sTimbre + 0.18 * r.sTempo + 0.12 * r.sKey + 0.15 * r.sTex;
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, k).map((r) => ({ ...r, why: why(t, r) }));
}
// --- tune: drag a track's meters and find the song that measures like that -------------------------
// target = percentiles per meter (0..1). Moved meters weigh 3x the ones left alone, so "this, but
// brighter" keeps the rest of the song's character; the seed's timbre is a soft tiebreak.
export const ord = (n) => { n = Math.round(n); const t = n % 100, u = n % 10; return n + (t > 10 && t < 14 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"); };

export function tuneMatch(seed, target, pool, k = 6, { withSeed = false } = {}) {
  const keys = Object.keys(target).filter((m) => seed.p?.[m] != null);
  const moved = new Set(keys.filter((m) => Math.abs(target[m] - seed.p[m]) > 0.02));
  const na = seed.cv && clapNorm?.get(seed), rows = [];
  for (const u of pool) {
    if ((u === seed && !withSeed) || !u.p) continue;
    let s = 0, w = 0;
    for (const m of keys) { if (u.p[m] == null) continue; const wt = moved.has(m) ? 3 : 1, d = Math.abs(u.p[m] - target[m]); s += wt * (1 - d) ** 2; w += wt; }
    if (!w) continue;
    let tim = 0; if (na && u.cv) { let d = 0; for (let j = 0; j < DIM; j++) d += seed.cv[j] * u.cv[j]; tim = d / (na * clapNorm.get(u)); }
    rows.push({ t: u, fit: s / w, tim });
  }
  const ts = rows.map((r) => r.tim).sort((a, b) => a - b), lo = ts[Math.floor(ts.length * 0.5)] ?? 0, hi = ts[ts.length - 1] ?? 1;
  for (const r of rows) r.score = 0.85 * r.fit + 0.15 * clamp((r.tim - lo) / Math.max(1e-6, hi - lo), 0, 1);
  rows.sort((a, b) => b.score - a.score);
  const label = Object.fromEntries(METERS.map((m) => [m[0], m]));
  return rows.slice(0, k).map((r) => {
    const near = [...moved].filter((m) => Math.abs(r.t.p[m] - target[m]) < 0.12).map((m) => { const [, , lo2, hi2] = label[m]; return r.t.p[m] > seed.p[m] ? hi2 : lo2; });
    return { ...r, why: near.length ? near.slice(0, 3).join(" · ") : r.fit > 0.9 ? "close on every meter" : "nearest overall" };
  });
}

function why(t, r) {
  const u = r.t, out = [];
  if (r.sTimbre != null && r.sTimbre > 0.6) {
    const shared = (u.f.inst ?? []).map((x) => x[0]).filter((x) => (t.f.inst ?? []).some((y) => y[0] === x));
    out.push(shared.length ? `same ${shared.slice(0, 2).join(" + ")}` : "similar timbre");
  }
  if (r.tg < 0.04) out.push(Math.abs(Math.log2(bpmOf(t) / bpmOf(u))) > 0.5 ? `half/double time ${bpmOf(u)}` : `${bpmOf(u)} bpm`);
  if (r.rel) out.push(`${u.f.camelot} ${r.rel}`);
  if (!out.length) out.push(r.sTex > 0.75 ? "same texture" : r.sTimbre != null && r.sTimbre > 0.4 ? "similar timbre" : "close overall");
  return out.slice(0, 3).join(" · ");
}

// --- lenses: recolour the atlas by a measurement ---------------------------------------------------
// Colours are quantised so the renderer still batches dots into a handful of paths.
const ramp = (stops, x) => { x = clamp(x, 0, 1) * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(x)), k = x - i; const a = stops[i], b = stops[i + 1]; return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(",")})`; };
const q = (x) => Math.round(clamp(x, 0, 1) * 10) / 10;
const COOL_WARM = [[64, 120, 220], [95, 211, 220], [236, 232, 223], [244, 178, 90], [234, 92, 84]];
const DARK_LIGHT = [[110, 70, 40], [196, 132, 60], [240, 214, 150], [220, 246, 255]];
const QUIET_LOUD = [[70, 92, 110], [95, 211, 220], [255, 214, 102], [255, 110, 150]];
export const LENSES = [
  { id: "feel", name: "Emotions" },
  { id: "key", name: "Key", legend: "Camelot wheel · A minor, B major", color: (t) => { const c = cam(t.f?.camelot); return c ? `hsl(${(c.n - 1) * 30},${c.l === "B" ? 70 : 55}%,${c.l === "B" ? 66 : 52}%)` : null; } },
  { id: "tempo", name: "Tempo", legend: "slow ↔ fast", color: (t) => (t.p?.tempo == null ? null : ramp(COOL_WARM, q(t.p.tempo))) },
  { id: "bright", name: "Tonality", legend: "warm ↔ bright", color: (t) => (t.p?.bright == null ? null : ramp(DARK_LIGHT, q(t.p.bright))) },
  { id: "busy", name: "Density", legend: "sparse ↔ dense", color: (t) => (t.p?.busy == null ? null : ramp(QUIET_LOUD, q(t.p.busy))) },
  { id: "width", name: "Soundstage", legend: "intimate ↔ expansive", color: (t) => (t.p?.width == null ? null : ramp(COOL_WARM, q(t.p.width))) },
];

// --- organisations: a lens also re-sorts the atlas into its own rings ------------------------------
// Feel keeps the taxonomy (feel -> family -> style). Every other lens becomes ring 1 itself, with
// feel and family nested inside, so switching lens regroups the whole map and the list below.
const BANDS5 = { bright: ["Dark", "Warm", "Neutral", "Bright", "Airy"], busy: ["Sparse", "Open", "Moving", "Dense", "Congested"], width: ["Mono", "Intimate", "Natural", "Wide", "Expansive"] };
const RAMPS = { tempo: COOL_WARM, bright: DARK_LIGHT, busy: QUIET_LOUD, width: COOL_WARM };
const TEMPO = [["slow", "Slow", 0, 90], ["mid", "Mid", 90, 115], ["up", "Up", 115, 135], ["fast", "Fast", 135, 160], ["rush", "Rush", 160, 999]];
const FEEL_LIGHT = { drive: 12, lift: 9, play: 6, groove: 2, calm: -3, wonder: -7, sad: -14, shadow: -10 };
const UNMEASURED = { id: "none", name: "Unmeasured", color: "#8a857a", night: "#8f8a80", ask: "no listening profile" };
export function organise(id, feels, families) {
  if (!id || id === "feel") return null;
  const feelIx = Object.fromEntries(feels.map((F, i) => [F.id, i]));
  // Ring 2 tints: a feel shades by its energy (drive lightest, shadow deepest); minor keys sit deeper than major.
  const inner = (t) => [[t.feel, feels[feelIx[t.feel]]?.name ?? t.feel, feelIx[t.feel] ?? 99, [0, FEEL_LIGHT[t.feel] ?? 0]], [t.family, families[t.family]?.name ?? t.family, 0]];
  let groups, top;
  if (id === "key") {
    groups = Array.from({ length: 12 }, (_, i) => { const c = `hsl(${i * 30},62%,60%)`, d = `hsl(${i * 30},55%,46%)`; return { id: String(i + 1), name: `${i + 1}`, color: d, night: c, ask: "Camelot neighbours mix" }; });
    top = (t) => { const c = cam(t.f?.camelot); return c ? String(c.n) : null; };
    const path = (t) => { const c = cam(t.f.camelot); return [[c.l, `${t.f.camelot} ${t.f.key}`, c.l === "A" ? 0 : 1, c.l === "A" ? [-6, -11] : [6, 11]], inner(t)[0]]; };
    return finish(groups, top, path, inner);
  }
  if (id === "tempo") {
    groups = TEMPO.map(([gid, name, lo, hi], i) => ({ id: gid, name, lo, hi, color: ramp(RAMPS.tempo, (i + 0.5) / TEMPO.length), night: ramp(RAMPS.tempo, (i + 0.5) / TEMPO.length), ask: hi < 999 ? `${lo || "<"}${lo ? "–" : ""}${hi} bpm` : `${lo}+ bpm` }));
    top = (t) => { const b = +bpmOf(t); return b > 0 ? ([...TEMPO].reverse().find(([, , lo]) => b >= lo) ?? TEMPO[0])[0] : null; };
  } else {
    const names = BANDS5[id];
    groups = names.map((name, i) => ({ id: name.toLowerCase(), name, color: ramp(RAMPS[id], (i + 0.5) / 5), night: ramp(RAMPS[id], (i + 0.5) / 5), ask: `${i * 20}–${i * 20 + 20}th pct` }));
    top = (t) => (t.p?.[id] == null ? null : groups[Math.min(4, Math.floor(t.p[id] * 5))].id);
  }
  return finish(groups, top, inner, inner);
}
function finish(groups, top, path, inner) {
  const all = [...groups, UNMEASURED], byId = Object.fromEntries(all.map((G, i) => [G.id, { ...G, i }]));
  return { groups: all, byId, of: (t) => top(t) ?? "none", path: (t) => (top(t) ? path(t) : inner(t)) };
}

// --- card ----------------------------------------------------------------------------------------
export function profileHTML(t, tune = null) {
  const f = t.f; if (!f) return "";
  const src = t.bpm ? (Math.abs(Math.log2(t.bpm / f.tempo)) > 0.03 ? `listed · heard ${Math.round(f.tempo)}` : "listed · confirmed") : `measured${f.tempoConf < 0.25 ? " · loose" : ""}`;
  const meter = ([k, label, lo, hi, fmt]) => {
    const p = t.p[k]; if (p == null || f[k] == null) return "";
    const tv = tune?.[k] ?? p, moved = Math.abs(tv - p) > 0.02;
    const extra = k === "busy" && f.busyBands ? `<span class="bb">${["low", "mid", "high"].map((b) => `<i style="--h:${clamp(f.busyBands[b] / 9, 0.04, 1).toFixed(2)}" title="${b} ${f.busyBands[b]}/s"></i>`).join("")}</span>`
      : k === "width" ? `<svg class="stage" viewBox="0 0 44 22" aria-hidden="true"><ellipse cx="22" cy="11" rx="${(4 + clamp(f.width, 0, 1) * 17).toFixed(1)}" ry="8" /><circle cx="22" cy="11" r="1.6" /></svg>` : "";
    return `<div class="mt"><span class="ml">${label}</span><span class="mb"><i style="left:${(p * 100).toFixed(1)}%"></i>${tune ? `<i class="tg" style="left:${(tv * 100).toFixed(1)}%"></i>` : ""}<input class="tune" type="range" min="0" max="100" value="${Math.round(tv * 100)}" data-k="${k}" aria-label="Find a song with this ${esc(label.toLowerCase())}"></span>${extra}<span class="mw"><span>${lo}</span><b>${moved ? `${ord(p * 100)} → ${ord(tv * 100)} pct` : `${ord(p * 100)} pct`}</b><span>${hi}</span></span><span class="mv">${esc(fmt(f))}</span></div>`;
  };
  const bands = (f.bands ?? []).map((d, i) => `<i style="--n:${i};--h:${clamp((d + 40) / 40, 0.03, 1).toFixed(2)}" title="${[32, 63, 125, 250, 500, "1k", "2k", "4k", "8k", "16k"][i]} Hz ${d} dB"></i>`).join("");
  const inst = (f.inst ?? []).slice(0, 4).map((x) => `<span>${esc(x[0])}</span>`).join("");
  return `<section class="snd">
    <div class="big">
      <div><b>${bpmOf(t)}</b><small>bpm</small><small>${src}</small></div>
      <div><b>${esc(f.camelot)}</b><small>key ${esc(f.key)}${f.keyConf < 0.5 ? " · ambiguous" : ""}</small><small title="Camelot wheel: neighbours mix in key">mixes with ${mixesWith(f.camelot).join(" ")}</small></div>
      <div class="spec" title="Tonal balance, 32 Hz–16 kHz octaves">${bands}<small>32 Hz – 16k</small></div>
    </div>
    ${inst || f.timbre ? `<div class="inst">${inst}${f.timbre ? `<em>${esc(f.timbre)}</em>` : ""}</div>` : ""}
    <div class="meters${tune ? " tuning" : ""}"><p class="hint">${tune ? "Your settings · the closest songs are below" : "Drag a meter: the song switches to one that measures like that. pct = its rank among all songs"}</p>${METERS.map(meter).join("")}</div>
  </section>`;
}
