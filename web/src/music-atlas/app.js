// Sound Atlas app: the radial atlas above, a spring bottom sheet with results, track card and player
// below (a side panel on wide screens). State lives in the URL hash so it survives redirects such as
// Vercel's protection-bypass 307, which drops the query string.
import { createAtlas } from "./atlas.js";
import { FEELS, BPM_BANDS, LEVELS, FAMILY_TINT, feelById, familyById, styleName, shade } from "./taxonomy.js";
import { loadCatalog, loadModel, modelReady, embed, search, webSearch, creditLine } from "./search.js";
import { loadSound, soundReady, neighbours, profileHTML, LENSES, bpmOf, organise, beatAt } from "./sound.js";
import { haptic, pressable, pressRing, HOLD, SLOP, FORCE } from "./gestures.js";
import * as social from "./social.js";

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
const buzz = (ms = 6) => haptic(ms >= 8 ? "select" : ms <= 4 ? "detent" : "tick");
const wide = () => geo.W >= 900;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const base = new URLSearchParams(location.search).get("catalog") ?? document.body.dataset.catalog ?? "./";
// The sheet is two paired widgets: the player (now playing) and one of three views below it.
// track = the playing/selected song's details, similar = its by-ear neighbours, library = every
// track the filters keep. Next/prev walk the list a song was started from (state.queue).
const VIEWS = ["track", "similar", "library", "community"];
const state = { view: "library", queue: "library", lens: "feel", q: "", feels: new Set(), bands: new Set(), gs: new Map(), cc0: false, picksOnly: false, sel: null, picks: new Set(JSON.parse(localStorage.getItem("sa-picks") || "[]")), radio: null, plist: null };
// Radio and playlists are queues too: state.radio = "ear" | "crowd" (endless), state.plist = a community playlist.
const playedIds = new Set();
let org = null, lensFn = null, atlasIds = "", sim = [], simSeed = null;
let all = [], byId = new Map(), why = new Map(), nbrs = [], result = { hits: [], ranked: false }, qv = null, like = null, share = null, webBusy = false;

// --- elements ---------------------------------------------------------------------------------
const canvas = $("#atlas"), sheet = $("#sheet"), rail = $("#rail"), body = $("#body"), q = $("#q"), chips = $("#chips"), audio = $("#audio");
const toast = (msg, ms = 2400) => { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), ms); };

// --- bottom sheet with spring physics -----------------------------------------------------------
const sh = { y: innerHeight, v: 0, target: "peek", raf: 0, drag: null };
// Geometry is measured once per resize, never per frame: reading layout inside rAF forces a style
// recalc + layout every frame (it was ~15% of each playback frame).
const geo = { H: innerHeight, W: innerWidth, top: 40, sat: 0, sab: 0, dock: 250, rail: 0 };
// The sort + filter rail rides the sheet's top edge, over the canvas: one transform for both.
const setSheetY = (y) => { sheet.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`; rail.style.transform = wide() ? "" : `translate3d(0, ${(y - geo.rail).toFixed(2)}px, 0)`; };
const inset = Object.assign(document.createElement("div"), { style: "position:fixed;visibility:hidden;pointer-events:none;top:0;height:env(safe-area-inset-top,0px);width:env(safe-area-inset-bottom,0px)" });
document.body.appendChild(inset);
function measure() { geo.H = innerHeight; geo.W = innerWidth; geo.sat = inset.offsetHeight; geo.sab = inset.offsetWidth; geo.top = $(".top").getBoundingClientRect().bottom + 4; geo.left = sheet.getBoundingClientRect().left; geo.dock = body.offsetTop; geo.rail = wide() ? 0 : rail.offsetHeight; }
// Peek shows the dock (search + filters), the player and the view switch: everything above the list.
const snaps = () => { const H = geo.H; return { peek: H - geo.dock - 4 - geo.sab, half: Math.round(H * 0.5), full: 72 + geo.sat }; };
function sheetTo(name, v = 0) { if (wide()) return; if (sh.target !== name) buzz(4); sh.target = name; sh.v = v; if (!sh.raf) sh.raf = requestAnimationFrame(sheetStep); atlasRefit(); }
let shLast = 0;
function sheetStep(now) {
  sh.raf = 0;
  const dt = Math.min(32, now - (shLast || now)) / 1000; shLast = now;
  const goal = snaps()[sh.target];
  if (reduced) { sh.y = goal; sh.v = 0; }
  else { const k = 520, c = 2 * Math.sqrt(k) * 0.92; const a = -k * (sh.y - goal) - c * sh.v; sh.v += a * dt; sh.y += sh.v * dt; } // slightly under-damped spring
  setSheetY(sh.y);
  sheet.style.setProperty("--open", Math.max(0, Math.min(1, (snaps().peek - sh.y) / (snaps().peek - snaps().full))).toFixed(3));
  if (Math.abs(sh.y - goal) > 0.4 || Math.abs(sh.v) > 4) sh.raf = requestAnimationFrame(sheetStep); else { sh.y = goal; setSheetY(goal); shLast = 0; }
}
function sheetPointer() {
  const grabs = [$(".grab"), $("#player"), $(".dock")];
  const down = (e) => {
    if (wide() || e.target.closest("button, input, .scrub, .filt")) return;
    sh.drag = { x0: e.clientX, player: !!e.target.closest("#player"), y0: e.clientY, s0: sh.y, t: performance.now(), y: e.clientY, v: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId); cancelAnimationFrame(sh.raf); sh.raf = 0;
  };
  const move = (e) => {
    const d = sh.drag; if (!d) return;
    const now = performance.now(), dy = e.clientY - d.y0; if (Math.abs(dy) > 4) d.moved = true;
    d.v = ((e.clientY - d.y) / Math.max(1, now - d.t)) * 1000; d.y = e.clientY; d.t = now;
    const S = snaps(); let y = d.s0 + dy; if (y < S.full) y = S.full - (S.full - y) * 0.25; if (y > S.peek) y = S.peek + (y - S.peek) * 0.25; // rubber band
    sh.y = y; setSheetY(y);
  };
  const up = (e) => {
    const d = sh.drag; sh.drag = null; if (!d) return;
    // Swipe the player sideways: next / previous, the title sliding out the way it was thrown.
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (d.player && Math.abs(dx) > 56 && Math.abs(dx) > 1.6 * Math.abs(dy)) { sheetTo(sh.target); haptic("select"); const pt = $("#pt"); pt.classList.remove("sw-l", "sw-r"); void pt.offsetWidth; pt.classList.add(dx < 0 ? "sw-l" : "sw-r"); return step(dx < 0 ? 1 : -1); }
    if (!d.moved) return sheetTo(sh.target === "peek" ? "half" : sh.target === "half" ? "full" : "half");
    const S = snaps(), proj = sh.y + d.v * 0.18; // project the fling
    const name = Object.entries(S).sort((a, b) => Math.abs(a[1] - proj) - Math.abs(b[1] - proj))[0][0];
    sheetTo(name, d.v);
  };
  for (const g of grabs) { g.addEventListener("pointerdown", down); g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up); }
  // Pull the list down from its top to lower the sheet.
  let ty = null;
  body.addEventListener("touchstart", (e) => { ty = body.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  body.addEventListener("touchmove", (e) => { if (heldGesture) return; if (ty !== null && e.touches[0].clientY - ty > 70 && sh.target !== "peek") { ty = null; sheetTo(sh.target === "full" ? "half" : "peek"); } }, { passive: true });
}

// --- atlas --------------------------------------------------------------------------------------
const A = createAtlas({
  canvas,
  region: () => {
    const top = geo.top;
    if (wide()) return { x: 0, y: top, w: geo.left, h: geo.H - top };
    const bottom = snaps()[sh.target]; return { x: 0, y: top, w: geo.W, h: Math.max(140, bottom - top - geo.rail) };
  },
  onHold: (phase, n, x, y) => {
    if (phase === "arm") return pressRing.arm(x, y, n?.level === 4 ? tone(n.t) : n ? colorOfNode(n) : null);
    if (phase === "cancel") return pressRing.hide();
    if (phase === "move") { pressRing.move(x, y); if (au && n?.level === 4 && n.t !== au.t) audition(n.t); return; }
    if (phase === "end") return au ? endAudition(n?.level === 4) : pressRing.hide();
    // fire: a track auditions; an emotion filters to itself; any other ring zooms to its wedge.
    if (n?.level === 4) return audition(n.t);
    pressRing.hide(); if (!n) return;
    haptic("keep");
    if (n.level === 1) { toggleGroup(n.feel); state.view = "library"; like = null; const nm = grp(n.feel)?.name ?? n.feel; toast(groupOn(n.feel) ? `Only ${nm.toLowerCase()} · hold again to undo` : `${nm} filter off`); return run({ fly: true }); }
    A.focus(n.id); if (n.level >= 1) scrollToGroup(n.feel);
  },
  onDetent: () => haptic("detent"),
  onTap: (n) => {
    if (!n) { if (A.focusId !== "root") A.focus(A.graph.byId.get(A.focusId)?.parent?.id ?? "root"); return; } // empty tap steps out
    buzz(5);
    if (n.level === 4) return select(n.id, { play: true, fly: true, view: "track" });
    A.focus(n.id === A.focusId ? n.parent?.id ?? "root" : n.id);
    if (n.level >= 1) scrollToGroup(n.feel);
  },
});
const colorOfNode = (n) => (org ? grp(n.feel)?.night : feelById[n.feel]?.night) ?? null;

// --- hold to listen ------------------------------------------------------------------------------
// Hold a dot or a row and it plays from its body while you hold; the ring under your finger and the
// phone's motor both keep its beat. Slide across the map to audition whatever dot is under you.
// Let go on a track to keep it (it carries on from where you were listening); slide off into empty
// space, or scroll the list, to cancel and go back to what was playing.
const aud2 = new Audio(); aud2.preload = "auto";
let au = null, heldGesture = false, pendingSeek = null;
function audition(t) {
  if (!t || au?.t === t) return;
  if (!au) { au = { resume: !audio.paused, t: null, raf: 0, ph: 1 }; audio.pause(); }
  au.t = t; heldGesture = true; haptic("tick");
  aud2.src = streamUrl(t);
  aud2.addEventListener("loadedmetadata", () => { if (au?.t !== t) return; const d = aud2.duration || t.dur || 60; aud2.currentTime = Math.max(0, Math.min(d * 0.33, d - 20)); aud2.play().catch(() => {}); }, { once: true });
  pressRing.fire(tone(t)); A.focusId = t.id; // its pill names it on the map
  if (!au.raf) au.raf = requestAnimationFrame(feelBeat);
}
function feelBeat() {
  if (!au) return; au.raf = requestAnimationFrame(feelBeat);
  if (aud2.paused || reduced) return;
  const b = beatAt(aud2.currentTime, au.t); if (!b) return;
  pressRing.pulse(Math.exp(-b.ph * 5) * b.acc);
  if (b.ph < au.ph && b.acc >= 0.45) haptic(b.acc >= 0.7 ? "bar" : "beat"); // a new beat started
  au.ph = b.ph;
}
function endAudition(keepIt) {
  if (!au) return pressRing.hide();
  const { t, resume } = au, at = aud2.currentTime; cancelAnimationFrame(au.raf); au = null; pressRing.hide(); aud2.pause();
  if (keepIt && t) {
    haptic("keep");
    if (t.id === state.sel) { audio.currentTime = at; audio.play().catch(() => {}); return; }
    pendingSeek = at; return select(t.id, { play: true, keepScroll: true, from: state.view === "track" ? null : state.view });
  }
  haptic("cancel"); A.focusId = state.sel ?? "root";
  if (resume) audio.play().catch(() => {});
}
audio.addEventListener("loadedmetadata", () => { if (pendingSeek != null) { audio.currentTime = pendingSeek; pendingSeek = null; } });
pressable(body, ".trk", {
  color: (el) => tone(byId.get(el.dataset.id)),
  onFire: (el) => { el.classList.add("held"); audition(byId.get(el.dataset.id)); },
  onEnd: (el, e, cancelled) => { el.classList.remove("held"); endAudition(!cancelled); },
});

let refitT = 0;
// A selected track with neighbours frames its whole "sounds like" constellation, not just itself.
const focusSel = (ms) => { if (!nbrs.length) return A.focus(state.sel, ms); A.flyToIds([state.sel, ...nbrs.slice(0, 6).map((n) => n.t.id)], ms); A.focusId = state.sel; };
function atlasRefit() { clearTimeout(refitT); refitT = setTimeout(() => { if (state.sel) focusSel(600); else if (result.ranked) A.flyToIds(result.hits.slice(0, 40).map((h) => h.t.id), 600); else A.focus(A.focusId, 600); }, 30); }

// --- sort + filters: one dense rail riding the sheet's top edge ----------------------------------
// The pill names the sort; hold it (or press hard) and slide to pick another, or tap it for the menu.
// The chips beside it are the CURRENT sort's groups, so filters always speak the sort's language:
// Emotions filter by emotion, Tempo by tempo band, Key by Camelot number. Filters set under another
// sort stay on and fold into one "+N" chip that clears them.
const orgs = {}; const orgFor = (id) => (id === "feel" ? null : (orgs[id] ??= organise(id, FEELS, familyById)));
const groupSet = (lens = state.lens) => (lens === "feel" ? state.feels : (state.gs.get(lens) ?? state.gs.set(lens, new Set()).get(lens)));
const groupOn = (gid) => groupSet().has(gid);
const toggleGroup = (gid) => toggle(groupSet(), gid);
function keepFn() {
  const on = [...state.gs].filter(([k, v]) => v.size && k !== "feel"); if (!on.length) return null;
  return (t) => on.every(([k, v]) => v.has(orgFor(k).of(t)));
}
const otherFilters = () => (state.lens === "feel" ? 0 : state.feels.size) + state.bands.size + [...state.gs].reduce((n, [k, v]) => n + (k === state.lens ? 0 : v.size), 0);
const sortBtn = $("#sortbtn"), sortMenu = $("#sortmenu");
function setLens(id, save = true) {
  const L = LENSES.find((x) => x.id === id) ?? LENSES[0]; state.lens = L.id;
  const changed = save && (org?.id ?? "feel") !== L.id;
  lensFn = L.color ?? null; org = organise(L.id, FEELS, familyById); if (org) org.id = L.id; tintCache.clear();
  A.setLens(lensFn);
  renderPlayer(); // the player, its glow and the queue dot take the playing track's colour under the new sort
  $("#sortname").textContent = L.name; sortBtn.classList.toggle("dim", !soundReady());
  renderChips(); $("#rail .filt").scrollLeft = 0;
  if (save) saveHash();
  if (changed) { atlasIds = ""; run({ fly: false, scroll: true }).then(() => (state.sel ? focusSel(700) : A.fitAll(700))); }
}
// The sort menu. Opened by a hold it tracks the same finger: slide to an item, let go to choose
// (a detent tick per item). Opened by a tap it stays until you tap an item or anywhere else.
const sm = { open: false, held: false, hot: null, t: 0, p0: 0, x: 0, y: 0, down: false };
function openSort(held) {
  if (!soundReady()) return toast("Listening data is still loading");
  sm.open = true; sm.held = held; sm.hot = null;
  sortMenu.innerHTML = LENSES.map((L) => `<button role="menuitem" data-lens="${L.id}" class="${L.id === state.lens ? "on" : ""}"><b>${L.name}</b><small>${L.id === "feel" ? "how it makes you feel" : esc(L.legend ?? "")}</small></button>`).join("");
  sortMenu.hidden = false; void sortMenu.offsetWidth; sortMenu.classList.add("on"); sortBtn.classList.add("open"); haptic(held ? "press" : "select");
}
function closeSort() { sm.open = false; sm.hot = null; sortMenu.classList.remove("on"); sortBtn.classList.remove("open"); setTimeout(() => { if (!sm.open) sortMenu.hidden = true; }, 180); }
function hotAt(x, y) {
  const b = document.elementFromPoint(x, y)?.closest?.("#sortmenu [data-lens]") ?? null;
  if (b !== sm.hot) { sm.hot?.classList.remove("hot"); b?.classList.add("hot"); if (b) haptic("detent"); sm.hot = b; }
}
sortBtn.addEventListener("pointerdown", (e) => {
  if (e.button > 0) return; sm.down = true; sm.x = e.clientX; sm.y = e.clientY; sm.p0 = e.pressure; sm.fired = false;
  sortBtn.setPointerCapture(e.pointerId);
  sm.t = setTimeout(() => { sm.fired = true; if (sm.open) closeSort(); openSort(true); }, HOLD);
});
sortBtn.addEventListener("pointermove", (e) => {
  if (!sm.down) return;
  if (!sm.fired && e.pointerType !== "mouse" && sm.p0 > 0 && e.pressure - sm.p0 > FORCE) { clearTimeout(sm.t); sm.fired = true; openSort(true); } // pressed harder
  if (sm.fired) hotAt(e.clientX, e.clientY);
  else if (Math.hypot(e.clientX - sm.x, e.clientY - sm.y) > SLOP) clearTimeout(sm.t); // a scroll of the rail, not a press
});
const sortUp = (e) => {
  if (!sm.down) return; sm.down = false; clearTimeout(sm.t);
  if (sm.fired) { const b = sm.hot; if (b) { closeSort(); if (b.dataset.lens !== state.lens) { haptic("keep"); setLens(b.dataset.lens); } } else sm.held = false; return; } // let go on nothing: the menu stays for a tap
  if (e.type === "pointercancel" || Math.hypot(e.clientX - sm.x, e.clientY - sm.y) > SLOP) return;
  sm.open ? closeSort() : openSort(false);
};
sortBtn.addEventListener("pointerup", sortUp); sortBtn.addEventListener("pointercancel", sortUp);
sortBtn.addEventListener("contextmenu", (e) => e.preventDefault());
sortMenu.addEventListener("click", (e) => { const b = e.target.closest("[data-lens]"); if (!b) return; closeSort(); if (b.dataset.lens !== state.lens) { buzz(4); setLens(b.dataset.lens); } });
document.addEventListener("pointerdown", (e) => { if (sm.open && !e.target.closest("#sortmenu, #sortbtn")) closeSort(); }, true);

function renderChips() {
  restPulse();
  const lens = state.lens, O = orgFor(lens), on = groupSet(lens), n = {};
  for (const t of all) { const k = O ? O.of(t) : t.feel; n[k] = (n[k] ?? 0) + 1; }
  const groups = O ? O.groups : FEELS;
  const other = otherFilters();
  chips.innerHTML = groups.filter((G) => n[G.id]).map((G) => `<button class="chip feel ${on.has(G.id) ? "on" : ""}" data-g="${esc(G.id)}" style="--c:${G.night}"><i></i>${esc(G.id === "none" ? "Unmeasured" : G.name)}<small>${n[G.id]}</small></button>`).join("") +
    (other ? `<button class="chip x" data-other="1" title="Filters set under other sorts">+${other}<span>×</span></button>` : "") +
    `<span class="sep"></span><button class="chip ${state.cc0 ? "on" : ""}" data-cc0="1">CC0</button><button class="chip ${state.picksOnly ? "on" : ""}" data-picks="1">♥<small>${state.picks.size}</small></button>`;
}
chips.addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return; buzz(4);
  state.view = "library"; // the filtered list is the answer to a filter tap
  if (b.dataset.g) toggleGroup(b.dataset.g);
  if (b.dataset.other) { if (state.lens !== "feel") state.feels.clear(); state.bands.clear(); for (const [k, v] of state.gs) if (k !== state.lens) v.clear(); }
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
  const facets = { feels: state.feels, bands: state.bands, cc0: state.cc0, picks: state.picksOnly ? state.picks : null, keep: keepFn() };
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
  renderChips(); renderViews(); renderBody(scroll); saveHash();
  if (fly) { if (result.ranked || filtered) A.flyToIds(result.hits.slice(0, result.ranked ? 40 : 400).map((h) => h.t.id)); else A.focus("root"); }
}
q.addEventListener("input", () => { like = null; state.view = "library"; clearTimeout(debounce); debounce = setTimeout(() => run({ fly: true }), 180); });
q.addEventListener("focus", () => { warmModel(); if (!wide()) sheetTo("full"); }); // the keyboard takes the bottom; results go above it
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
    <span class="du">${mmss(t.dur)}</span><span class="hv ${state.picks.has(t.id) ? "on" : ""}" data-heart="${esc(t.id)}" role="button" aria-label="Like">${ICON.heart}${social.room.likes[t.id] ? `<small>${social.compact(social.room.likes[t.id])}</small>` : ""}</span></button>`;
};
let animateRows = true;
function renderBody(scroll = true) {
  animateRows = scroll; // a scroll-to-top render is a new result set; in-place re-renders (pick, select) stay still
  const hits = result.hits;
  const sel = state.sel && byId.get(state.sel);
  if (state.view === "track" && sel) return paint(cardHTML(sel), scroll);
  if (state.view === "similar" && sel) return paint(similarHTML(), scroll);
  if (state.view === "community") return paint(communityHTML(), scroll);
  let html = "";
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
  paint(html, scroll);
}
function paint(html, scroll) { body.innerHTML = html; restPulse(); if (scroll) body.scrollTop = 0; }
// Similar: one flat by-ear list around a seed. The seed stays put while you play through its list,
// so rows never reshuffle under your thumb; "Re-centre" re-seeds on whatever is playing now.
function similarHTML() {
  const seed = byId.get(simSeed), cur = byId.get(state.sel);
  if (!seed?.f) return `<div class="sum"><b>Sounds like “${esc(cur.title)}”</b></div><div class="empty">This track has no listening profile, so there is nothing to compare by ear.<button class="web" data-act="describe">Find tracks described like it<small>semantic match on its title and tags</small></button></div>`;
  return `<div class="sum"><b>Sounds like “${esc(seed.title)}”</b><span>${sim.length} · by ear</span></div>
    ${simSeed !== state.sel ? `<button class="more" data-act="reseed">Re-centre on “${esc(cur.title)}”</button>` : ""}
    <section class="grp" style="--c:${tone(seed)}"><h3><i></i>By ear<small>timbre · tempo · key · texture</small></h3>${[seed, ...sim.map((n) => n.t)].map((t, i) => rowHTML(t, i, i ? sim[i - 1].why : "the seed")).join("")}</section>`;
}
// Community: who is here, what they're playing, the radio, playlists people published, and the charts.
function communityHTML() {
  const R = social.room, rows = (ids, why) => ids.map((id) => byId.get(id)).filter(Boolean).map((t, i) => rowHTML(t, i, why(t))).join("");
  if (!R.on) return `<div class="sum"><b>Community</b></div><div class="empty">The shared layer is offline here (local build or no connection). Likes and playlists still work as your own picks.</div>`;
  const nowIds = R.now.map(([id]) => id), cnt = Object.fromEntries(R.now);
  const liked = Object.entries(R.likes).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
  const pl = R.playlists.map((p) => `<div class="pl-card ${state.plist?.id === p.id ? "on" : ""}" data-pl="${p.id}"><button class="pl-go" data-plplay="${p.id}" aria-label="Play ${esc(p.name)}">${ICON.play}</button>
    <span class="tt"><b>${esc(p.name)}</b><small>${p.tracks.length} tracks · ${p.plays} plays${p.own ? " · yours" : ""}</small></span>
    <span class="hv ${p.liked ? "on" : ""}" data-plheart="${p.id}" role="button" aria-label="Like playlist">${ICON.heart}${p.likes ? `<small>${p.likes}</small>` : ""}</span>${p.own ? `<button class="pl-x" data-plx="${p.id}" aria-label="Unpublish">×</button>` : ""}</div>`).join("");
  return `<div class="sum"><b>Community</b><span>${social.compact(R.views)} views · ${social.compact(R.visitors)} listeners · ${social.compact(R.plays)} plays</span></div>
    <section class="room"><div class="live-big"><i></i><b>${R.here}</b> here now<span>${R.listening} listening</span></div>
      <div class="radio-row"><button data-radio="ear" class="${state.radio === "ear" ? "on" : ""}"><b>By-ear radio</b><small>${state.sel ? `endless, from “${esc(byId.get(state.sel)?.title)}”` : "endless, drifting by sound"}</small></button><button data-radio="crowd" class="${state.radio === "crowd" ? "on" : ""}"><b>Crowd radio</b><small>what people here love and play</small></button></div></section>
    ${nowIds.length ? `<section class="grp" style="--c:#4fd69a"><h3><i></i>Playing right now<small>${R.listening} listening</small></h3>${rows(nowIds, (t) => `${cnt[t.id]} listening now`)}</section>` : ""}
    <section class="grp" style="--c:#ffbf4d"><h3><i></i>Community playlists<small>${R.playlists.length}</small></h3>
      <form class="pub" id="pub"><input id="pubname" maxlength="60" placeholder="${state.picks.size ? `Name a playlist of your ${state.picks.size} ${state.picks.size === 1 ? "pick" : "picks"}…` : "Heart some tracks to publish a playlist"}" ${state.picks.size ? "" : "disabled"} /><button ${state.picks.size ? "" : "disabled"}>Publish</button></form>
      ${pl || `<div class="empty">No playlists yet. Publish your picks and be the first.</div>`}</section>
    ${liked.length ? `<section class="grp" style="--c:#ff86b8"><h3><i></i>Most liked</h3>${rows(liked, (t) => `♥ ${R.likes[t.id]}`)}</section>` : ""}
    ${R.top.length ? `<section class="grp" style="--c:#6ea8ff"><h3><i></i>Most played</h3>${rows(R.top.slice(0, 20).map(([id]) => id), (t) => `${R.top.find(([id]) => id === t.id)[1]} plays`)}</section>` : ""}`;
}
function renderLive() {
  const R = social.room, el = $("#live"); if (!el) return;
  el.hidden = !R.on;
  el.innerHTML = `<i></i><b>${R.here}</b><span>here</span><span class="sep"></span><b>${social.compact(R.views)}</b><span>views</span>`;
  el.title = `${R.here} here now, ${R.listening} listening · ${R.views.toLocaleString()} views · ${R.visitors.toLocaleString()} listeners`;
}
let roomT = 0;
social.onRoom(() => { renderLive(); renderPlayer(); clearTimeout(roomT); roomT = setTimeout(() => { if (state.view === "community" || state.view === "track") { const st = body.scrollTop; renderBody(false); body.scrollTop = st; } }, 120); });
function startRadio(kind) {
  state.radio = state.radio === kind ? null : kind; state.plist = null; buzz(8);
  radioTrail.length = 0; if (state.sel) radioTrail.push(state.sel);
  if (state.radio) { state.queue = "radio"; toast(kind === "ear" ? "By-ear radio: it keeps going, one neighbour at a time" : "Crowd radio: what the room loves"); if (!state.sel || audio.paused || kind === "crowd") step(1); }
  else { state.queue = "library"; toast("Radio off"); }
  renderViews(); renderBody(false); renderPlayer();
}
function playPlaylist(id) {
  const p = social.room.playlists.find((x) => x.id === id); if (!p) return;
  const ids = p.tracks.filter((x) => byId.has(x)); if (!ids.length) return toast("None of these tracks are in this catalogue");
  state.plist = { id: p.id, name: p.name, ids }; state.radio = null; state.queue = "playlist"; social.playlistPlayed(p.id);
  toast(`Playing “${p.name}”`); select(ids[0], { play: true, fly: true, keepScroll: true }); renderBody(false); saveHash();
}
function renderViews() {
  const has = !!state.sel, nav = $("#views");
  if (!has && state.view !== "library" && state.view !== "community") state.view = "library";
  nav.querySelectorAll("[data-view]").forEach((b) => { const v = b.dataset.view; b.classList.toggle("on", v === state.view); b.classList.toggle("queue", (v === state.queue || (v === "community" && ["radio", "playlist"].includes(state.queue))) && has); b.disabled = v !== "library" && v !== "community" && !has; b.setAttribute("aria-selected", v === state.view); });
  nav.style.setProperty("--k", VIEWS.indexOf(state.view));
  $("#vn").textContent = result.hits.length.toLocaleString();
}
let lastView = "library";
function setView(v, scroll = true) {
  if (!VIEWS.includes(v) || (v !== "library" && v !== "community" && !state.sel)) return;
  if (v === "community") social.loadPlaylists();
  if (v === "similar" && !simSeed) reseed();
  const d = VIEWS.indexOf(v) - VIEWS.indexOf(lastView); lastView = state.view = v;
  renderViews(); renderBody(scroll); saveHash();
  if (d && !reduced) { body.classList.remove("in-l", "in-r"); void body.offsetWidth; body.classList.add(d > 0 ? "in-r" : "in-l"); } // slide in from the side it lives on
  if (!wide() && sh.target === "peek") sheetTo("half");
}
function reseed() { const t = byId.get(state.sel); simSeed = t?.id ?? null; sim = t && soundReady() && t.f ? neighbours(t, all, 40) : []; }
$("#views").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b && !b.disabled) { buzz(4); setView(b.dataset.view); } });
{ // swipe the body sideways to move between views
  let x0 = null, y0 = 0;
  body.addEventListener("touchstart", (e) => { heldGesture = false; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  body.addEventListener("touchend", (e) => { if (x0 === null || heldGesture) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) setView(VIEWS[VIEWS.indexOf(state.view) + (dx < 0 ? 1 : -1)]); }, { passive: true });
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
    ${nbrs.length ? `<button class="tease" data-act="similar"><b>Sounds like</b><span>${nbrs.slice(0, 3).map((n) => `<em style="--c:${tone(n.t)}">${esc(n.t.title)}</em>`).join("")}</span><small>see ${Math.max(nbrs.length, sim.length)}+ →</small></button>` : ""}
    ${t.tags?.length ? `<div class="tags">${t.tags.slice(0, 8).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
    ${t.desc ? `<p class="desc">${esc(t.desc)}</p>` : ""}
    <div class="lic"><span class="badge">${esc(t.license)}</span><code>${esc(creditLine(t))}</code></div>
    <div class="acts"><button data-act="similar">More like this</button><button data-act="credit">Copy credit</button><button data-act="pick" class="${state.picks.has(t.id) ? "on" : ""}">${state.picks.has(t.id) ? "♥ Picked" : "♥ Pick"}</button>${t.sourceUrl ? `<a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>` : ""}</div>
  </article>`;
}
function scrollToGroup(feel) { if (state.view !== "library") setView("library", false); const g = body.querySelector(`.grp[data-feel="${feel}"]`); if (g) { if (!wide() && sh.target === "peek") sheetTo("half"); body.scrollTo({ top: g.offsetTop - 8, behavior: reduced ? "auto" : "smooth" }); } }

body.addEventListener("click", async (e) => {
  const heart = e.target.closest("[data-heart]");
  if (heart) { e.stopPropagation(); return pick(heart.dataset.heart); }
  const row = e.target.closest(".trk");
  if (row) { buzz(5); const id = row.dataset.id; return id === state.sel ? togglePlay() : select(id, { play: true, fly: true, keepScroll: true, from: state.view }); }
  const h = e.target.closest("[data-focus]"); if (h) { buzz(4); return A.focus(h.dataset.focus); }
  const desc = e.target.closest(".desc"); if (desc) return desc.classList.toggle("open");
  const more = e.target.closest("[data-more]"); if (more) { more.outerHTML = (result.hits.filter((x) => grpOf(x.t) === more.dataset.more).slice(result.ranked ? 40 : 30).map((x, i) => rowHTML(x.t, i)).join("")); return; }
  if (e.target.closest("#web")) return searchWeb();
  const ph = e.target.closest("[data-plheart]"); if (ph) { e.stopPropagation(); buzz(8); const p = social.room.playlists.find((x) => x.id === ph.dataset.plheart); return p && social.likePlaylist(p.id, !p.liked); }
  const pp = e.target.closest("[data-plplay]"); if (pp) { buzz(5); return playPlaylist(pp.dataset.plplay); }
  const px = e.target.closest("[data-plx]"); if (px) { buzz(5); await social.unpublish(px.dataset.plx).catch(() => {}); return toast("Playlist unpublished"); }
  const rb = e.target.closest("[data-radio]"); if (rb) return startRadio(rb.dataset.radio);
  const act = e.target.closest("[data-act]")?.dataset.act, t = state.sel && byId.get(state.sel);
  if (!act || !t) return;
  if (act === "pick") pick(t.id);
  if (act === "credit") { await copy(creditLine(t)); toast("Credit line copied"); }
  if (act === "similar" && t.f && soundReady()) return setView("similar");
  if (act === "reseed") { reseed(); return renderBody(true); }
  if (act === "similar" || act === "describe") { if (!t.f) { warmModel(); if (!t.v) return toast("Semantic search is still loading"); } like = t; q.value = ""; state.view = "library"; run({ fly: true }); toast(t.f ? `Tracks that sound like “${t.title}”` : `Tracks described like “${t.title}”`); }
});

function pick(id) {
  buzz(8);
  const on = !state.picks.has(id);
  on ? state.picks.add(id) : state.picks.delete(id);
  localStorage.setItem("sa-picks", JSON.stringify([...state.picks]));
  social.like(id, on); // your picks are your likes; the count is everyone's
  renderChips(); renderBody(false); renderPlayer(); saveHash();
}

// --- player -------------------------------------------------------------------------------------
// ccMixter serves mp3s only with its own Referer, so deployed builds stream them through /api/ccm
// (tools/sound-atlas-api/ccm.js). Catalogue paths are relative to the catalogue.
const CCM = "https://ccmixter.org/content/";
const proxied = !/^(localhost|127\.|\[::1\])/.test(location.hostname) && location.protocol === "https:";
const streamUrl = (t) => (proxied && t.audio.startsWith(CCM) ? "/api/ccm?p=" + encodeURIComponent(t.audio.slice(CCM.length)) : new URL(t.audio, new URL(base, location.href)).href);
function select(id, { play = false, fly = false, keepScroll = false, from = null, view = null } = {}) {
  const t = byId.get(id); if (!t) return;
  const changed = state.sel !== id;
  state.sel = id; A.focusId = id;
  if (from === "library" || from === "similar") { state.queue = from; state.radio = null; state.plist = null; } // started from a list: that list is the queue
  else if (from === null && view) state.queue = "library";
  if (view) state.view = lastView = view;
  if (changed && state.queue !== "similar") reseed();
  if (changed) { audio.src = streamUrl(t); audio.load(); }
  if (play) audio.play().catch((e) => { if (e.name !== "AbortError") toast("Tap ▶ to play"); });
  if (changed) {
    nbrs = soundReady() ? neighbours(t, all, 8) : [];
    const top = nbrs[0]?.score || 1;
    A.setLinks(nbrs.length ? id : null, nbrs.map((n) => ({ id: n.t.id, w: Math.max(0, (n.score / top - 0.6) / 0.4) })));
  }
  if (fly) focusSel();
  A.setPlaying(playState());
  renderViews(); const st = body.scrollTop; renderBody(false); if (keepScroll) body.scrollTop = st; else body.scrollTop = 0;
  renderPlayer(); saveHash();
  if (!wide() && sh.target === "peek" && !play) sheetTo("half");
}
function togglePlay() { if (!state.sel) { const first = result.hits[0]?.t; return first && select(first.id, { play: true, fly: true }); } audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
function step(d) {
  if (state.radio && d > 0) { // radio only goes forward; back walks what it already played
    const t = social.radioNext({ kind: state.radio, cur: byId.get(state.sel), all: search(all, { feels: state.feels, bands: state.bands, cc0: state.cc0 }).hits.map((h) => h.t), byId, playedIds, neighbours });
    if (t) { radioTrail.push(t.id); return select(t.id, { play: true, fly: true, keepScroll: true }); }
  }
  if (state.radio && d < 0 && radioTrail.length > 1) { radioTrail.pop(); return select(radioTrail.at(-1), { play: true, fly: true, keepScroll: true }); }
  if (state.plist) { const L = state.plist.ids, i = L.indexOf(state.sel); return select(L[(i + d + L.length) % L.length], { play: true, fly: true, keepScroll: true }); }
  stepList(d);
}
const radioTrail = [];
function stepList(d) { const list = state.queue === "similar" && simSeed ? [simSeed, ...sim.map((n) => n.t.id)] : result.hits.map((h) => h.t.id), i = list.indexOf(state.sel); const n = list[(i + d + list.length) % list.length]; if (n) select(n, { play: true, fly: true, keepScroll: true }); }
function renderPlayer() {
  const t = state.sel && byId.get(state.sel), p = $("#player");
  p.style.setProperty("--c", t ? tone(t) : "#5fd3dc"); $("#views").style.setProperty("--c", t ? tone(t) : "#5fd3dc");
  $("#pt").innerHTML = t ? `<b>${esc(t.title)}</b><small>${esc(t.author)}${bpmOf(t) ? ` · ${bpmOf(t)} bpm` : ""}${t.f?.camelot ? ` · ${t.f.camelot}` : ""}</small>` : `<b>Sound Atlas</b><small>${all.length.toLocaleString()} free tracks · CC0 / CC BY</small>`;
  $("#pp").innerHTML = audio.paused ? ICON.play : ICON.pause;
  $("#ph").classList.toggle("on", !!t && state.picks.has(t.id));
  const lk = t && social.room.likes[t.id]; $("#ph").dataset.n = lk ? social.compact(lk) : "";
  const here = t && social.room.now.find(([id]) => id === t.id)?.[1]; // people (you included) on this track right now
  $("#pt small")?.insertAdjacentHTML("beforeend", here > 1 ? ` · <em class="with">${here - 1} with you</em>` : "");
  $("#pr").classList.toggle("on", !!state.radio); $("#pr").title = state.radio ? `${state.radio === "ear" ? "By-ear" : "Crowd"} radio on` : "Radio";
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
    const G = grpOf(t), dots = [...document.querySelectorAll(`.grp[data-feel="${G}"] h3 i, .chip[data-g="${G}"] i`)], eq = [...body.querySelectorAll(".trk.sel .eq i")];
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
audio.addEventListener("play", () => { if (state.sel) { playedIds.add(state.sel); social.played(state.sel); } social.pulse(); });
audio.addEventListener("pause", () => social.pulse());
audio.addEventListener("play", syncPlay); audio.addEventListener("pause", syncPlay); audio.addEventListener("loadedmetadata", tick);
audio.addEventListener("ended", () => step(1));
audio.addEventListener("error", () => { if (audio.src && state.sel) toast("This one won't stream here; open its source ↗"); });
$("#pp").onclick = (e) => { e.stopPropagation(); buzz(5); togglePlay(); };
$("#pn").onclick = (e) => { e.stopPropagation(); step(1); };
$("#pv").onclick = (e) => { e.stopPropagation(); step(-1); };
$("#ph").onclick = (e) => { e.stopPropagation(); if (state.sel) pick(state.sel); };
$("#ps").onclick = (e) => { e.stopPropagation(); shareLink(); };
$("#pr").onclick = (e) => { e.stopPropagation(); startRadio(state.radio ?? "ear"); };
$("#live").onclick = () => { buzz(5); setView("community"); };
// Motion: the map dances to the playing beat (labels step aside while it does). Remembered per device;
// hidden when the system asks for reduced motion, which already keeps the map still.
{ const mb = $("#motion"), on = localStorage.getItem("sa-motion") !== "0";
  const set = (v) => { A.setMotion(v); mb.setAttribute("aria-pressed", String(v)); localStorage.setItem("sa-motion", v ? "1" : "0"); };
  set(on); mb.hidden = reduced;
  mb.onclick = () => { const v = !A.motion; set(v); haptic("select"); toast(v ? "Motion on · labels hide while the map dances" : "Motion off · labels stay"); }; }
$("#body").addEventListener("submit", async (e) => {
  if (e.target.id !== "pub") return; e.preventDefault();
  const name = $("#pubname").value.trim(); if (!name || !state.picks.size) return toast("Name it first");
  try { const id = await social.publish(name, [...state.picks]); buzz(8); toast(`Published “${name}”`); state.plist = null; renderBody(false); history.replaceState(null, "", location.pathname + location.search + "#pl=" + id); } catch (err) { toast(err.message === "limit" ? "20 playlists per listener" : "Couldn't publish right now"); }
});
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
  if (state.gs.get("tempo")?.size) h.set("b", [...state.gs.get("tempo")].join(","));
  const gq = [...state.gs].filter(([k, v]) => k !== "tempo" && v.size).map(([k, v]) => `${k}:${[...v].join(".")}`).join(";"); if (gq) h.set("g", gq);
  if (state.cc0) h.set("cc0", "1");
  if (state.picks.size) h.set("p", [...state.picks].join(","));
  if (state.sel) h.set("t", state.sel);
  if (state.lens !== "feel") h.set("l", state.lens);
  if (state.view !== "library") h.set("v", state.view);
  if (state.plist) h.set("pl", state.plist.id);
  return h.toString();
}
let hashT = 0;
function saveHash() { clearTimeout(hashT); hashT = setTimeout(() => history.replaceState(null, "", location.pathname + location.search + (hashOf() ? "#" + hashOf() : "")), 250); }
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  q.value = h.get("q") ?? "";
  for (const f of (h.get("f") ?? "").split(",").filter((x) => feelById[x])) state.feels.add(f);
  // b= (tempo bands) and g= (other sorts' groups) are the contextual filters; old b= links land in the tempo sort's filter
  const tb = (h.get("b") ?? "").split(",").filter((x) => BPM_BANDS.some((B) => B.id === x)); if (tb.length) state.gs.set("tempo", new Set(tb));
  for (const part of (h.get("g") ?? "").split(";")) { const [k, v] = part.split(":"); if (k && v && LENSES.some((L) => L.id === k)) state.gs.set(k, new Set(v.split("."))); }
  state.cc0 = h.get("cc0") === "1";
  if (LENSES.some((L) => L.id === h.get("l"))) state.lens = h.get("l");
  if (VIEWS.includes(h.get("v"))) state.view = h.get("v");
  const shared = (h.get("p") ?? "").split(",").filter((id) => byId.has(id));
  if (shared.length) { shared.forEach((id) => state.picks.add(id)); state.picksOnly = true; toast(`${shared.length} shared picks`); }
  pendingPlist = h.get("pl");
  return h.get("t");
}
let pendingPlist = null;
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
{ const ro = new ResizeObserver(() => { measure(); if (!wide() && !sh.drag) sheetTo(sh.target); atlasRefit(); }); ro.observe($(".top")); ro.observe($(".dock")); ro.observe(rail); } // fonts load, lens row fills in
addEventListener("resize", () => { measure(); if (!wide()) { sh.y = snaps()[sh.target]; setSheetY(sh.y); } else { sheet.style.transform = rail.style.transform = ""; } atlasRefit(); });
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
  const t = readHash(), v0 = state.view; setLens(state.lens, false);
  await run({ fly: !!(state.q || state.feels.size || [...state.gs.values()].some((s) => s.size) || state.picksOnly) });
  if (t && byId.has(t)) select(t, { fly: true, view: v0 === "library" ? "track" : v0 }); else renderViews();
  if (state.q) warmModel(); else if (!matchMedia("(pointer: coarse)").matches) setTimeout(warmModel, 2500); // phones load the model on first search focus
  renderPlayer();
  social.join(() => ({ track: state.sel, playing: !audio.paused })).then(async () => {
    renderBody(false);
    if (pendingPlist) { await social.loadPlaylists(); if (social.room.playlists.some((p) => p.id === pendingPlist)) { setView("community"); const p = social.room.playlists.find((x) => x.id === pendingPlist); state.plist = { id: p.id, name: p.name, ids: p.tracks.filter((x) => byId.has(x)) }; toast(`“${p.name}” · tap ▶ to play`); renderBody(false); } }
  });
  window.__sa = { social, startRadio, playPlaylist, A, state, get all() { return all; }, get result() { return result; }, audio, modelReady, sheetTo, select, run, setView };
})();
