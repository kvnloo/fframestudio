// Sound Atlas app: the radial atlas above, a spring bottom sheet with results, track card and player
// below (a side panel on wide screens). State lives in the URL hash so it survives redirects such as
// Vercel's protection-bypass 307, which drops the query string.
import { createAtlas } from "./atlas.js";
import { FEELS, BPM_BANDS, LEVELS, FAMILY_TINT, feelById, familyById, styleName, shade } from "./taxonomy.js";
import { loadCatalog, loadModel, modelReady, embed, search, webSearch, creditLine } from "./search.js";
import { loadSound, soundReady, neighbours, profileHTML, LENSES, bpmOf, organise, beatAt } from "./sound.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mmss = (s) => (s == null || !isFinite(s) ? "–:––" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const night = (f) => feelById[f]?.night ?? "#8f8a80";
// The active organisation decides a track's group (ring 1) and every colour on the page: the
// legend, the atlas wedges, list headers, rows, card and player all read from these three.
const grpOf = (t) => (org ? org.of(t) : t.feel);
const grp = (id) => (org ? org.byId[id] : feelById[id]);
// Ring 2 (the sub-mood: family, or key mode / feel under a lens) as [id, name, tint], same rule as the atlas.
const sub = (t) => { if (org) { const a = org.path(t)[0]; return [a[0], a[1], a[3]]; } return [t.family, familyById[t.family]?.name ?? t.family, FAMILY_TINT[t.family]]; };
const tintCache = new Map();
const tinted = (gid, tint) => { const k = gid + "|" + tint; let c = tintCache.get(k); if (!c) { const base = grp(gid)?.night ?? "#8f8a80"; tintCache.set(k, (c = tint ? shade(base, tint) : base)); } return c; };
const tone = (t) => (lensFn && lensFn(t)) || tinted(grpOf(t), sub(t)[2]);
const buzz = (ms = 6) => navigator.vibrate?.(ms);
const wide = () => geo.W >= 900;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const base = new URLSearchParams(location.search).get("catalog") ?? document.body.dataset.catalog ?? "./";
const state = { lens: "feel", q: "", feels: new Set(), bands: new Set(), cc0: false, picksOnly: false, sel: null, picks: new Set(JSON.parse(localStorage.getItem("sa-picks") || "[]")) };
let org = null, lensFn = null, cardOpen = true, atlasIds = "";
let all = [], byId = new Map(), why = new Map(), nbrs = [], result = { hits: [], ranked: false }, qv = null, like = null, share = null, webBusy = false;

// --- elements ---------------------------------------------------------------------------------
const canvas = $("#atlas"), sheet = $("#sheet"), body = $("#body"), q = $("#q"), chips = $("#chips"), audio = $("#audio");
const toast = (msg, ms = 2400) => { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), ms); };

// --- bottom sheet with spring physics -----------------------------------------------------------
const sh = { y: innerHeight, v: 0, target: "peek", raf: 0, drag: null };
// Geometry is measured once per resize, never per frame: reading layout inside rAF forces a style
// recalc + layout every frame (it was ~15% of each playback frame).
const geo = { H: innerHeight, W: innerWidth, top: 110, sat: 0, sab: 0 };
const inset = Object.assign(document.createElement("div"), { style: "position:fixed;visibility:hidden;pointer-events:none;top:0;height:env(safe-area-inset-top,0px);width:env(safe-area-inset-bottom,0px)" });
document.body.appendChild(inset);
function measure() { geo.H = innerHeight; geo.W = innerWidth; geo.sat = inset.offsetHeight; geo.sab = inset.offsetWidth; geo.top = $(".top").getBoundingClientRect().bottom + 4; geo.left = sheet.getBoundingClientRect().left; }
const snaps = () => { const H = geo.H; return { peek: H - 156 - geo.sab, half: Math.round(H * 0.5), full: 72 + geo.sat }; };
function sheetTo(name, v = 0) { if (wide()) return; if (sh.target !== name) buzz(4); sh.target = name; sh.v = v; if (!sh.raf) sh.raf = requestAnimationFrame(sheetStep); atlasRefit(); }
let shLast = 0;
function sheetStep(now) {
  sh.raf = 0;
  const dt = Math.min(32, now - (shLast || now)) / 1000; shLast = now;
  const goal = snaps()[sh.target];
  if (reduced) { sh.y = goal; sh.v = 0; }
  else { const k = 520, c = 2 * Math.sqrt(k) * 0.92; const a = -k * (sh.y - goal) - c * sh.v; sh.v += a * dt; sh.y += sh.v * dt; } // slightly under-damped spring
  sheet.style.transform = `translate3d(0, ${sh.y.toFixed(2)}px, 0)`;
  sheet.style.setProperty("--open", Math.max(0, Math.min(1, (snaps().peek - sh.y) / (snaps().peek - snaps().full))).toFixed(3));
  if (Math.abs(sh.y - goal) > 0.4 || Math.abs(sh.v) > 4) sh.raf = requestAnimationFrame(sheetStep); else { sh.y = goal; sheet.style.transform = `translate3d(0, ${goal}px, 0)`; shLast = 0; }
}
function sheetPointer() {
  const grabs = [$(".grab"), $("#player")];
  const down = (e) => {
    if (wide() || e.target.closest("button, input, .scrub")) return;
    sh.drag = { y0: e.clientY, s0: sh.y, t: performance.now(), y: e.clientY, v: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId); cancelAnimationFrame(sh.raf); sh.raf = 0;
  };
  const move = (e) => {
    const d = sh.drag; if (!d) return;
    const now = performance.now(), dy = e.clientY - d.y0; if (Math.abs(dy) > 4) d.moved = true;
    d.v = ((e.clientY - d.y) / Math.max(1, now - d.t)) * 1000; d.y = e.clientY; d.t = now;
    const S = snaps(); let y = d.s0 + dy; if (y < S.full) y = S.full - (S.full - y) * 0.25; if (y > S.peek) y = S.peek + (y - S.peek) * 0.25; // rubber band
    sh.y = y; sheet.style.transform = `translate3d(0, ${y}px, 0)`;
  };
  const up = () => {
    const d = sh.drag; sh.drag = null; if (!d) return;
    if (!d.moved) return sheetTo(sh.target === "peek" ? "half" : sh.target === "half" ? "full" : "half");
    const S = snaps(), proj = sh.y + d.v * 0.18; // project the fling
    const name = Object.entries(S).sort((a, b) => Math.abs(a[1] - proj) - Math.abs(b[1] - proj))[0][0];
    sheetTo(name, d.v);
  };
  for (const g of grabs) { g.addEventListener("pointerdown", down); g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up); }
  // Pull the list down from its top to lower the sheet.
  let ty = null;
  body.addEventListener("touchstart", (e) => { ty = body.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  body.addEventListener("touchmove", (e) => { if (ty !== null && e.touches[0].clientY - ty > 70 && sh.target !== "peek") { ty = null; sheetTo(sh.target === "full" ? "half" : "peek"); } }, { passive: true });
}

// --- atlas --------------------------------------------------------------------------------------
const A = createAtlas({
  canvas,
  region: () => {
    const top = geo.top;
    if (wide()) return { x: 0, y: top, w: geo.left, h: geo.H - top };
    const bottom = snaps()[sh.target]; return { x: 0, y: top, w: geo.W, h: Math.max(140, bottom - top) };
  },
  onTap: (n) => {
    if (!n) { if (A.focusId !== "root") A.focus(A.graph.byId.get(A.focusId)?.parent?.id ?? "root"); return; } // empty tap steps out
    buzz(5);
    if (n.level === 4) return select(n.id, { play: true, fly: true });
    A.focus(n.id === A.focusId ? n.parent?.id ?? "root" : n.id);
    if (n.level >= 1) scrollToGroup(n.feel);
  },
});
let refitT = 0;
// A selected track with neighbours frames its whole "sounds like" constellation, not just itself.
const focusSel = (ms) => { if (!nbrs.length) return A.focus(state.sel, ms); A.flyToIds([state.sel, ...nbrs.slice(0, 6).map((n) => n.t.id)], ms); A.focusId = state.sel; };
function atlasRefit() { clearTimeout(refitT); refitT = setTimeout(() => { if (state.sel) focusSel(600); else if (result.ranked) A.flyToIds(result.hits.slice(0, 40).map((h) => h.t.id), 600); else A.focus(A.focusId, 600); }, 30); }

// --- lenses: what the dots' colour means ----------------------------------------------------------
const lensNav = $("#lens");
function setLens(id, save = true) {
  const L = LENSES.find((x) => x.id === id) ?? LENSES[0]; state.lens = L.id;
  const changed = save && (org?.id ?? "feel") !== L.id;
  lensFn = L.color ?? null; org = organise(L.id, FEELS, familyById); if (org) org.id = L.id; tintCache.clear();
  A.setLens(lensFn);
  lensNav.innerHTML = soundReady() ? `<span class="lk">Sort</span>${LENSES.map((x) => `<button class="${x.id === L.id ? "on" : ""}" data-lens="${x.id}">${x.name}</button>`).join("")}` : "";
  if (save) saveHash();
  if (changed) { atlasIds = ""; run({ fly: false, scroll: true }).then(() => (state.sel ? focusSel(700) : A.fitAll(700))); }
}
lensNav.addEventListener("click", (e) => { const b = e.target.closest("[data-lens]"); if (b) { buzz(4); setLens(b.dataset.lens); } });

// --- chips --------------------------------------------------------------------------------------
function renderChips() {
  const counts = {}; for (const t of all) counts[t.feel] = (counts[t.feel] ?? 0) + 1;
  const legend = org ? (() => { const n = {}; for (const t of all) { const k = grpOf(t); n[k] = (n[k] ?? 0) + 1; } return org.groups.filter((G) => n[G.id]).map((G) => `<button class="chip feel" data-jump="${G.id}" style="--c:${G.night}"><i></i>${esc(G.name)}<small>${n[G.id]}</small></button>`).join("") + `<span class="sep"></span>`; })() : "";
  restPulse();
  chips.innerHTML = legend +
    FEELS.map((f) => `<button class="chip feel ${state.feels.has(f.id) ? "on" : ""}" data-feel="${f.id}" style="--c:${f.night}"><i></i>${f.name}<small>${counts[f.id] ?? 0}</small></button>`).join("") +
    `<span class="sep"></span>` +
    BPM_BANDS.map((b) => `<button class="chip bpm ${state.bands.has(b.id) ? "on" : ""}" data-band="${b.id}">${b.name}<small>${b.hi < 999 ? (b.lo ? b.lo + "–" : "<") + b.hi : b.lo + "+"}</small></button>`).join("") +
    `<span class="sep"></span><button class="chip ${state.cc0 ? "on" : ""}" data-cc0="1">CC0 only</button><button class="chip ${state.picksOnly ? "on" : ""}" data-picks="1">♥ Picks<small>${state.picks.size}</small></button>`;
}
chips.addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return; buzz(4);
  if (b.dataset.jump) { A.focus("f:" + b.dataset.jump); return scrollToGroup(b.dataset.jump); }
  cardOpen = false; // the filtered list, not the old card, is the answer to a filter tap
  if (b.dataset.feel) toggle(state.feels, b.dataset.feel);
  if (b.dataset.band) toggle(state.bands, b.dataset.band);
  if (b.dataset.cc0) state.cc0 = !state.cc0;
  if (b.dataset.picks) state.picksOnly = !state.picksOnly;
  like = null; run({ fly: true });
});
const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

// --- search -------------------------------------------------------------------------------------
let seq = 0, debounce = 0;
async function run({ fly = false, scroll = true } = {}) {
  const my = ++seq;
  state.q = q.value.trim();
  $(".search").classList.toggle("has", !!state.q || !!like);
  qv = null;
  if (state.q && modelReady()) qv = (await embed([state.q]))?.[0] ?? null;
  if (my !== seq) return;
  const facets = { feels: state.feels, bands: state.bands, cc0: state.cc0, picks: state.picksOnly ? state.picks : null };
  why = new Map();
  if (like?.f) { // "More like this" listens: CLAP timbre + tempo + key + texture, not the words
    const near = neighbours(like, search(all, facets).hits.map((h) => h.t), 80);
    near.forEach((n) => why.set(n.t.id, n.why));
    result = { hits: [{ t: like, score: 9 }, ...near.map((n) => ({ t: n.t, score: n.score }))], ranked: true };
  } else result = search(all, { q: state.q, qv, like, ...facets });
  // Facets reshape the atlas itself (the kept tracks re-pack into full wedges); searches only light up.
  const pool = like?.f || result.ranked ? search(all, facets).hits.map((h) => h.t) : result.hits.map((h) => h.t), ids = pool.length + ":" + (pool[0]?.id ?? "") + (pool.at(-1)?.id ?? "") + (org?.id ?? "feel");
  if (ids !== atlasIds) { atlasIds = ids; A.setTracks(pool, org); }
  $("#count").textContent = pool.length === all.length ? all.length.toLocaleString() : `${pool.length.toLocaleString()} / ${all.length.toLocaleString()}`;
  const filtered = result.ranked;
  A.setLit(filtered ? result.hits.map((h) => h.t.id) : null);
  A.setFeatured(result.ranked ? result.hits.slice(0, 8).map((h) => h.t.id) : []);
  renderChips(); renderBody(scroll); saveHash();
  if (fly) { if (result.ranked || filtered) A.flyToIds(result.hits.slice(0, result.ranked ? 40 : 400).map((h) => h.t.id)); else A.focus("root"); }
}
q.addEventListener("input", () => { like = null; clearTimeout(debounce); debounce = setTimeout(() => run({ fly: true }), 180); });
q.addEventListener("focus", () => { warmModel(); if (!wide() && sh.target === "peek") sheetTo("half"); });
q.addEventListener("keydown", (e) => { if (e.key === "Enter") { q.blur(); run({ fly: true }); if (state.q) searchWeb(); } if (e.key === "Escape") { q.value = ""; like = null; run({ fly: true }); q.blur(); } });
$("#clear").onclick = () => { q.value = ""; like = null; run({ fly: true }); };

const ai = $("#ai");
function warmModel() {
  if (modelReady()) return;
  loadModel((s) => { ai.dataset.state = s; ai.title = { loading: "Loading semantic search…", ready: "Semantic search on", off: "Semantic search unavailable; matching words only" }[s]; if (s === "ready") { if (state.q) run({ fly: true, scroll: false }); toast("Semantic search ready"); } }).catch(() => {});
}

async function searchWeb() {
  if (webBusy || !state.q) return; webBusy = true; renderBody(false);
  try {
    const got = await webSearch(state.q, all);
    if (got.length) { all = [...all, ...got]; got.forEach((t) => byId.set(t.id, t)); A.setTracks(all); }
    toast(got.length ? `+${got.length} from across the web (Openverse)` : "No new CC0 / CC BY songs on Openverse for that");
  } catch (e) { toast(e.message); }
  webBusy = false; run({ fly: true, scroll: false });
}

// --- results & card -----------------------------------------------------------------------------
const ICON = {
  play: `<svg viewBox="0 0 20 20"><path d="M6 4.5v11l9-5.5z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 20 20"><rect x="5" y="4.5" width="3.4" height="11" rx="1" fill="currentColor"/><rect x="11.6" y="4.5" width="3.4" height="11" rx="1" fill="currentColor"/></svg>`,
  heart: `<svg viewBox="0 0 20 20"><path d="M10 16.5s-6-3.7-6-8.2A3.3 3.3 0 0 1 10 6a3.3 3.3 0 0 1 6 2.3c0 4.5-6 8.2-6 8.2z" fill="currentColor"/></svg>`,
};
const rowHTML = (t, i, reason) => {
  const playing = state.sel === t.id && !audio.paused;
  return `<button class="trk ${state.sel === t.id ? "sel" : ""} ${playing ? "playing" : ""} ${i < 14 && animateRows ? "" : "q"}" data-id="${esc(t.id)}" style="--c:${tone(t)};--i:${i};--beat:${(60 / (t.bpm || 100)).toFixed(3)}s">
    <span class="pl">${playing ? `<span class="eq"><i></i><i></i><i></i></span>` : ICON.play}</span>
    <span class="tt"><b>${esc(t.title)}</b><small>${esc(t.author)} · ${esc(styleName(t.family, t.style))}${t.f ? ` · ${bpmOf(t)} bpm · ${t.f.camelot}` : t.bpm ? ` · ${t.bpm} bpm` : ""}${t.src === "web" ? ` · ${esc(t.provider)}` : ""}</small>${(reason ?? why.get(t.id)) ? `<em class="why">${esc(reason ?? why.get(t.id))}</em>` : ""}</span>
    <span class="du">${mmss(t.dur)}</span><span class="hv ${state.picks.has(t.id) ? "on" : ""}" data-heart="${esc(t.id)}" role="button" aria-label="Pick">${ICON.heart}</span></button>`;
};
let animateRows = true;
function renderBody(scroll = true) {
  animateRows = scroll; // a scroll-to-top render is a new result set; in-place re-renders (pick, select) stay still
  const hits = result.hits;
  const sel = state.sel && byId.get(state.sel);
  let html = sel && cardOpen ? cardHTML(sel) : "";
  const label = like ? `Sounds like “${esc(like.title)}”` : state.q ? `“${esc(state.q)}”` : state.feels.size || state.bands.size || state.cc0 || state.picksOnly ? "Filtered" : "Every track";
  html += `<div class="sum"><b>${label}</b><span>${hits.length.toLocaleString()} ${hits.length === 1 ? "track" : "tracks"}${result.ranked ? (like?.f ? " · by ear" : qv || like ? " · semantic" : " · words") : ""}</span></div>`;
  // Group by feel (the atlas's first ring); ranked searches keep their order inside each group and
  // order groups by their best hit, so the strongest vibe comes first.
  const groups = new Map();
  hits.forEach((h, i) => { const f = grpOf(h.t); if (!groups.has(f)) groups.set(f, { f, best: i, rows: [] }); groups.get(f).rows.push(h.t); });
  const rank = (id) => (org ? grp(id).i : FEELS.findIndex((F) => F.id === id));
  const order = [...groups.values()].sort((a, b) => (result.ranked ? a.best - b.best : rank(a.f) - rank(b.f)));
  const LIM = result.ranked ? 40 : 30;
  // By-ear results stay one ranked list: the point is that a neighbour can live in another feel.
  if (like?.f) html += `<section class="grp" style="--c:${night(like.feel)}"><h3><i></i>By ear<small>CLAP timbre · tempo · Camelot · texture</small></h3>${hits.slice(0, 80).map((h, i) => rowHTML(h.t, i)).join("")}</section>`;
  else for (const g of order) {
    const F = grp(g.f), bpms = g.rows.map((t) => t.bpm).filter(Boolean), more = g.rows.length - LIM;
    // The group's sub-moods as tinted swatches, biggest first: the same shades the atlas draws.
    const subs = new Map(); for (const t of g.rows) { const [id, name, tint] = sub(t), e = subs.get(id) ?? { name, tint, n: 0 }; e.n++; subs.set(id, e); }
    const styles = [...subs.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((e) => `<span style="--t:${tinted(g.f, e.tint)}"><i></i>${esc(e.name)}</span>`).join("");
    html += `<section class="grp" data-feel="${g.f}" style="--c:${F.night}"><h3 data-focus="f:${g.f}"><i></i>${F.name}<small>${g.rows.length}${bpms.length ? ` · ${Math.min(...bpms)}–${Math.max(...bpms)} bpm` : ""}</small><em class="subs">${styles}</em></h3>
      ${g.rows.slice(0, g.open ? 400 : LIM).map((t, i) => rowHTML(t, i)).join("")}${more > 0 ? `<button class="more" data-more="${g.f}">Show ${more} more ${F.name.toLowerCase()} tracks</button>` : ""}</section>`;
  }
  if (!hits.length) html += `<div class="empty">Nothing in the catalogue matches. ${state.q ? "Try the open web below, or fewer filters." : "Try fewer filters."}</div>`;
  if (state.q) html += `<button class="web ${webBusy ? "busy" : ""}" id="web">${webBusy ? "Searching the open web…" : `Search the open web for “${esc(state.q)}”`}<small>Openverse · Jamendo, Freesound, Wikimedia · CC0 / CC BY only</small></button>`;
  html += `<footer class="src">${sourcesLine()}</footer>`;
  body.innerHTML = html; restPulse();
  if (scroll) body.scrollTop = 0;
}
const sourcesLine = () => { const n = {}; for (const t of all) n[t.src] = (n[t.src] ?? 0) + 1; return `Sources: ${[["shortlist", "Glide shortlist"], ["incompetech", "Incompetech"], ["ccmixter", "ccMixter"], ["web", "Openverse"]].filter(([k]) => n[k]).map(([k, v]) => `${v} ${n[k].toLocaleString()}`).join(" · ")}. CC0 and CC BY only; no NC, ND or SA. Credit CC BY tracks with the line on each card.`; };

function cardHTML(t) {
  const F = feelById[t.feel], c = tone(t);
  const rows = [
    [F.name, F.ask + (t.feelGuess ? " · inferred" : "")],
    [familyById[t.family]?.name, ""],
    [styleName(t.family, t.style), [t.bpm ? `${t.bpm} bpm` : "", t.dur ? mmss(t.dur) : ""].filter(Boolean).join(" · ")],
    [`<em>${esc(t.title)}</em>`, esc(t.author)],
  ];
  return `<article class="card" style="--c:${c}">
    <div class="lin">${LEVELS.map((L, i) => `<div class="lv"><b>0${i + 1}</b><span class="k">${L}</span><span class="v">${i === 3 ? rows[i][0] : esc(rows[i][0])}</span>${rows[i][1] ? `<span class="s">${i === 3 ? rows[i][1] : esc(rows[i][1])}</span>` : ""}</div>`).join("")}</div>
    ${profileHTML(t)}
    ${nbrs.length ? `<section class="near"><h4>Sounds like<small>timbre · tempo · key · texture</small></h4>${nbrs.slice(0, 6).map((n, i) => rowHTML(n.t, i, n.why)).join("")}</section>` : ""}
    ${t.tags?.length ? `<div class="tags">${t.tags.slice(0, 8).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
    ${t.desc ? `<p class="desc">${esc(t.desc)}</p>` : ""}
    <div class="lic"><span class="badge">${esc(t.license)}</span><code>${esc(creditLine(t))}</code></div>
    <div class="acts"><button data-act="like">More like this</button><button data-act="credit">Copy credit</button><button data-act="pick" class="${state.picks.has(t.id) ? "on" : ""}">${state.picks.has(t.id) ? "♥ Picked" : "♥ Pick"}</button>${t.sourceUrl ? `<a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>` : ""}</div>
  </article>`;
}
function scrollToGroup(feel) { const g = body.querySelector(`.grp[data-feel="${feel}"]`); if (g) { if (!wide() && sh.target === "peek") sheetTo("half"); body.scrollTo({ top: g.offsetTop - 8, behavior: reduced ? "auto" : "smooth" }); } }

body.addEventListener("click", async (e) => {
  const heart = e.target.closest("[data-heart]");
  if (heart) { e.stopPropagation(); return pick(heart.dataset.heart); }
  const row = e.target.closest(".trk");
  if (row) { buzz(5); const id = row.dataset.id; return id === state.sel ? togglePlay() : select(id, { play: true, fly: true, keepScroll: true }); }
  const h = e.target.closest("[data-focus]"); if (h) { buzz(4); return A.focus(h.dataset.focus); }
  const desc = e.target.closest(".desc"); if (desc) return desc.classList.toggle("open");
  const more = e.target.closest("[data-more]"); if (more) { more.outerHTML = (result.hits.filter((x) => grpOf(x.t) === more.dataset.more).slice(result.ranked ? 40 : 30).map((x, i) => rowHTML(x.t, i)).join("")); return; }
  if (e.target.closest("#web")) return searchWeb();
  const act = e.target.closest("[data-act]")?.dataset.act, t = state.sel && byId.get(state.sel);
  if (!act || !t) return;
  if (act === "pick") pick(t.id);
  if (act === "credit") { await copy(creditLine(t)); toast("Credit line copied"); }
  if (act === "like") { if (!t.f) { warmModel(); if (!t.v) return toast("Semantic search is still loading"); } like = t; q.value = ""; run({ fly: true }); toast(t.f ? `Tracks that sound like “${t.title}”` : `Tracks described like “${t.title}”`); }
});

function pick(id) {
  buzz(8);
  state.picks.has(id) ? state.picks.delete(id) : state.picks.add(id);
  localStorage.setItem("sa-picks", JSON.stringify([...state.picks]));
  renderChips(); renderBody(false); renderPlayer(); saveHash();
}

// --- player -------------------------------------------------------------------------------------
// ccMixter serves mp3s only with its own Referer, so deployed builds stream them through /api/ccm
// (tools/sound-atlas-api/ccm.js). Catalogue paths are relative to the catalogue.
const CCM = "https://ccmixter.org/content/";
const proxied = !/^(localhost|127\.|\[::1\])/.test(location.hostname) && location.protocol === "https:";
const streamUrl = (t) => (proxied && t.audio.startsWith(CCM) ? "/api/ccm?p=" + encodeURIComponent(t.audio.slice(CCM.length)) : new URL(t.audio, new URL(base, location.href)).href);
function select(id, { play = false, fly = false, keepScroll = false } = {}) {
  const t = byId.get(id); if (!t) return;
  const changed = state.sel !== id;
  cardOpen = true; state.sel = id; A.focusId = id;
  if (changed) { audio.src = streamUrl(t); audio.load(); }
  if (play) audio.play().catch((e) => { if (e.name !== "AbortError") toast("Tap ▶ to play"); });
  if (changed) {
    nbrs = soundReady() ? neighbours(t, all, 8) : [];
    const top = nbrs[0]?.score || 1;
    A.setLinks(nbrs.length ? id : null, nbrs.map((n) => ({ id: n.t.id, w: Math.max(0, (n.score / top - 0.6) / 0.4) })));
  }
  if (fly) focusSel();
  A.setPlaying(playState());
  const st = body.scrollTop; renderBody(false); if (keepScroll) body.scrollTop = st; else body.scrollTop = 0;
  renderPlayer(); saveHash();
  if (!wide() && sh.target === "peek" && !play) sheetTo("half");
}
function togglePlay() { if (!state.sel) { const first = result.hits[0]?.t; return first && select(first.id, { play: true, fly: true }); } audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
function step(d) { const list = result.hits.map((h) => h.t.id), i = list.indexOf(state.sel); const n = list[(i + d + list.length) % list.length]; if (n) select(n, { play: true, fly: true }); }
function renderPlayer() {
  const t = state.sel && byId.get(state.sel), p = $("#player");
  p.style.setProperty("--c", t ? tone(t) : "#5fd3dc");
  $("#pt").innerHTML = t ? `<b>${esc(t.title)}</b><small>${esc(t.author)}${bpmOf(t) ? ` · ${bpmOf(t)} bpm` : ""}${t.f?.camelot ? ` · ${t.f.camelot}` : ""}</small>` : `<b>Sound Atlas</b><small>${all.length.toLocaleString()} free tracks · CC0 / CC BY</small>`;
  $("#pp").innerHTML = audio.paused ? ICON.play : ICON.pause;
  $("#ph").classList.toggle("on", !!t && state.picks.has(t.id));
}
const bar = $("#bar"), thumb = $("#thumb"), tc = $("#tc");
const playState = () => { const t = state.sel && byId.get(state.sel); return t ? { id: t.id, paused: audio.paused, beat: () => beatAt(audio.currentTime, t), progress: () => (audio.duration ? audio.currentTime / audio.duration : 0) } : null; };
// The page plays along: the player button, brand mark and the playing group's legend/header dots
// swell on accented beats; the row's three bars read kick, off-beat and bar accent. Only the
// `scale` property is written (compositor-only, and it composes with CSS transform animations).
let pulse = null;
const restPulse = () => { if (pulse) for (const el of pulse.all) el.style.scale = ""; pulse?.eq[0]?.parentNode.classList.remove("live"); pulse = null; };
function beatFrame() {
  const t = state.sel && byId.get(state.sel); if (!t || reduced) return;
  if (!pulse) {
    const G = grpOf(t), dots = [...document.querySelectorAll(`.grp[data-feel="${G}"] h3 i, .chip[data-jump="${G}"] i, .chip.feel[data-feel="${t.feel}"] i`)], eq = [...body.querySelectorAll(".trk.sel .eq i")];
    pulse = { pp: $("#pp"), dot: $(".brand .dot"), dots, eq, all: [$("#pp"), $(".brand .dot"), ...dots, ...eq] };
    eq[0]?.parentNode.classList.add("live");
  }
  const b = beatAt(audio.currentTime, t), e = Math.exp(-b.ph * 5) * b.acc, off = Math.exp(-((b.ph + 0.5) % 1) * 7);
  pulse.pp.style.scale = (1 + 0.06 * e).toFixed(3);
  pulse.dot.style.scale = (1 + 0.4 * e).toFixed(3);
  for (const d of pulse.dots) d.style.scale = (1 + 0.7 * e).toFixed(3);
  const [k, h, a] = pulse.eq; if (a) { k.style.scale = `1 ${(0.2 + 0.8 * Math.exp(-b.ph * 5)).toFixed(3)}`; h.style.scale = `1 ${(0.2 + 0.55 * off).toFixed(3)}`; a.style.scale = `1 ${(0.2 + 0.8 * e).toFixed(3)}`; }
}
function tick() {
  const d = audio.duration, c = audio.currentTime;
  const k = d ? c / d : 0; bar.style.transform = `scaleX(${k})`; thumb.style.transform = `translate3d(${(k * 100).toFixed(2)}%, 0, 0)`; // compositor-only
  const label = `${mmss(c)} / ${mmss(d)}`; if (label !== tc.textContent) tc.textContent = label; // text changes re-layout: once a second, not per frame
  if (!audio.paused) { beatFrame(); requestAnimationFrame(tick); }
}
const syncPlay = () => { A.setPlaying(playState()); renderPlayer(); if (audio.paused) restPulse(); const r = body.querySelector(".trk.sel"); if (r) { const t = byId.get(state.sel); r.classList.toggle("playing", !audio.paused); r.querySelector(".pl").innerHTML = !audio.paused ? `<span class="eq"><i></i><i></i><i></i></span>` : ICON.play; r.style.setProperty("--beat", (60 / (t?.bpm || 100)).toFixed(3) + "s"); } tick(); };
audio.addEventListener("play", syncPlay); audio.addEventListener("pause", syncPlay); audio.addEventListener("loadedmetadata", tick);
audio.addEventListener("ended", () => step(1));
audio.addEventListener("error", () => { if (audio.src && state.sel) toast("This one won't stream here; open its source ↗"); });
$("#pp").onclick = (e) => { e.stopPropagation(); buzz(5); togglePlay(); };
$("#pn").onclick = (e) => { e.stopPropagation(); step(1); };
$("#pv").onclick = (e) => { e.stopPropagation(); step(-1); };
$("#ph").onclick = (e) => { e.stopPropagation(); if (state.sel) pick(state.sel); };
$("#ps").onclick = (e) => { e.stopPropagation(); shareLink(); };
{ // scrub
  const sc = $(".scrub"); let on = false;
  const seek = (e) => { const r = sc.getBoundingClientRect(), k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); if (audio.duration) { audio.currentTime = k * audio.duration; tick(); } };
  sc.addEventListener("pointerdown", (e) => { e.stopPropagation(); on = true; sc.setPointerCapture(e.pointerId); sc.classList.add("on"); seek(e); });
  sc.addEventListener("pointermove", (e) => on && seek(e));
  const off = () => { on = false; sc.classList.remove("on"); }; sc.addEventListener("pointerup", off); sc.addEventListener("pointercancel", off);
}
addEventListener("keydown", (e) => {
  if (e.target === q) return;
  if (e.key === "/") { e.preventDefault(); q.focus(); }
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  if (e.key === "ArrowDown" || e.key === "j") step(1);
  if (e.key === "ArrowUp" || e.key === "k") step(-1);
  if (e.key === "ArrowRight" && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
  if (e.key === "Escape") { A.focus("root"); }
});

// --- url state & sharing ------------------------------------------------------------------------
function hashOf() {
  const h = new URLSearchParams();
  if (state.q) h.set("q", state.q);
  if (state.feels.size) h.set("f", [...state.feels].join(","));
  if (state.bands.size) h.set("b", [...state.bands].join(","));
  if (state.cc0) h.set("cc0", "1");
  if (state.picks.size) h.set("p", [...state.picks].join(","));
  if (state.sel) h.set("t", state.sel);
  if (state.lens !== "feel") h.set("l", state.lens);
  return h.toString();
}
let hashT = 0;
function saveHash() { clearTimeout(hashT); hashT = setTimeout(() => history.replaceState(null, "", location.pathname + location.search + (hashOf() ? "#" + hashOf() : "")), 250); }
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  q.value = h.get("q") ?? "";
  for (const f of (h.get("f") ?? "").split(",").filter((x) => feelById[x])) state.feels.add(f);
  for (const b of (h.get("b") ?? "").split(",").filter((x) => BPM_BANDS.some((B) => B.id === x))) state.bands.add(b);
  state.cc0 = h.get("cc0") === "1";
  if (LENSES.some((L) => L.id === h.get("l"))) state.lens = h.get("l");
  const shared = (h.get("p") ?? "").split(",").filter((id) => byId.has(id));
  if (shared.length) { shared.forEach((id) => state.picks.add(id)); state.picksOnly = true; toast(`${shared.length} shared picks`); }
  return h.get("t");
}
async function shareLink() {
  // share.json (deploy-time, never in git) carries the protected-deploy entry link; the hash rides through its redirect.
  const url = (share?.base ?? location.origin + location.pathname) + "#" + hashOf();
  buzz(8);
  if (navigator.share && matchMedia("(pointer: coarse)").matches) { try { await navigator.share({ title: "Sound Atlas picks", url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  await copy(url); toast(state.picks.size ? `Link with ${state.picks.size} picks copied` : "Link copied");
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const t = Object.assign(document.createElement("textarea"), { value: text }); document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}

// --- boot ---------------------------------------------------------------------------------------
new ResizeObserver(() => { measure(); atlasRefit(); }).observe($(".top")); // chips wrap / fonts load
addEventListener("resize", () => { measure(); if (!wide()) { sheet.style.transform = `translate3d(0, ${snaps()[sh.target]}px, 0)`; sh.y = snaps()[sh.target]; } else sheet.style.transform = ""; atlasRefit(); });
// Phones get the whole screen: browsers only grant fullscreen inside a user gesture, so the first
// tap anywhere asks for it. Skipped when installed (the manifest already launches fullscreen) and
// never re-asked once the user leaves it (back gesture / swipe), so exiting stays their choice.
if (matchMedia("(pointer: coarse)").matches && !matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches && document.documentElement.requestFullscreen) {
  const go = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {}); };
  addEventListener("click", go, { once: true, capture: true });
  addEventListener("pointerup", go, { once: true, capture: true }); // a drag on the atlas never makes a click
}

(async function boot() {
  measure(); sheetPointer();
  sh.y = innerHeight; sheetTo("peek");
  const cat = await loadCatalog(base).catch((e) => { body.innerHTML = `<div class="empty">Could not load the catalogue (${esc(e.message)}).</div>`; throw e; });
  share = await fetch(base + "share.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  all = cat.tracks; byId = new Map(all.map((t) => [t.id, t]));
  await loadSound(base, all); // optional: measured tempo/key/texture + CLAP neighbours
  $("#count").textContent = all.length.toLocaleString();
  await document.fonts?.ready;
  A.setTracks(all); A.fitAll(1);
  const t = readHash(); setLens(state.lens, false);
  await run({ fly: !!(state.q || state.feels.size || state.bands.size || state.picksOnly) });
  if (t && byId.has(t)) select(t, { fly: true });
  if (state.q) warmModel(); else if (!matchMedia("(pointer: coarse)").matches) setTimeout(warmModel, 2500); // phones load the model on first search focus
  renderPlayer();
  window.__sa = { A, state, get all() { return all; }, get result() { return result; }, audio, modelReady, sheetTo, select, run };
})();
