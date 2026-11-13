// Sound Atlas app: the radial atlas above, a spring bottom sheet with results, track card and player
// below (a side panel on wide screens). State lives in the URL hash so it survives redirects such as
// Vercel's protection-bypass 307, which drops the query string.
import { createAtlas } from "./atlas.js";
import { FEELS, BPM_BANDS, LEVELS, FAMILY_TINT, feelById, familyById, styleName, shade } from "./taxonomy.js";
import { loadCatalog, loadModel, modelReady, embed, search, webSearch, creditLine, prep } from "./search.js";
import { loadSound, soundReady, neighbours, tuneMatch, profileHTML, meterColor, ord, LENSES, lensStops, bpmOf, organise, beatAt } from "./sound.js";
import { haptic, pressable, pressRing, HOLD, SLOP, FORCE } from "./gestures.js";
import * as social from "./social.js";
import * as cast from "./cast.js";
import { slugIndex, readPath } from "./links.js";
import { party, join as joinParty, leave as leaveParty, heard, onEnded as partyEnded, setNudge, drift, rid as roomId } from "./party.js";
import { renderSVG, encode as qrEncode } from "./uqr.js";
import * as browse from "./browse.js";
import { loadLayers, layersOf, layerCount, STEMS, laneColor, createMixer, stemUrl, lenders } from "./layers.js";

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
const state = { view: "library", queue: "library", lens: "feel", q: "", feels: new Set(), bands: new Set(), gs: new Map(), cc0: false, picksOnly: false, sel: null, picks: new Set(JSON.parse(localStorage.getItem("sa-picks") || "[]")), radio: null, plist: null,
  browse: "feel", open: null, recent: JSON.parse(localStorage.getItem("sa-recent") || "[]") }; // browse: Library's mode (browse.MODES); open: an artist/album/genre page
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
const geo = { H: innerHeight, W: innerWidth, top: 40, sat: 0, sab: 0, dock: 250, views: 210, rail: 0 };
// The sort + filter rail rides the sheet's top edge, over the canvas: one transform for both.
const setSheetY = (y) => { sheet.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`; rail.style.transform = wide() ? "" : `translate3d(0, ${(y - geo.rail).toFixed(2)}px, 0)`; };
const inset = Object.assign(document.createElement("div"), { style: "position:fixed;visibility:hidden;pointer-events:none;top:0;height:env(safe-area-inset-top,0px);width:env(safe-area-inset-bottom,0px)" });
document.body.appendChild(inset);
// A zoomed element's rect in viewport px. Chromium before 128 (a TV's Tizen 6.5 is 85) reports it unzoomed, so on a TV
// (panel zoom 1.65) the map took the panel's left edge as x 740 instead of 1221 and squeezed into the left third.
const zrect = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el), z = +cs.zoom || 1; const k = z !== 1 && Math.abs(r.width - parseFloat(cs.width)) < 1 ? z : 1; return { left: r.left * k, bottom: r.bottom * k }; };
function measure() { geo.H = innerHeight; geo.W = innerWidth; geo.sat = inset.offsetHeight; geo.sab = inset.offsetWidth; geo.top = zrect($(".top")).bottom + 4; geo.left = zrect(sheet).left; geo.dock = body.offsetTop; geo.views = $("#views").offsetTop; geo.rail = wide() ? 0 : rail.offsetHeight; }
// Peek shows the dock (search + filters) and the player; the view switch waits below the edge until you raise the sheet.
const snaps = () => { const H = geo.H; return { peek: H - geo.views - geo.sab, half: Math.round(H * 0.5), full: 72 + geo.sat }; };
// The player's density follows the pane, three steps (style.css): compact at peek (and while searching: the results
// need the room), plus radio/cast/share at half, a full now-playing widget at full. It flips as a drag crosses into
// a snap's catchment, not after release, and the re-layout is FLIPped relative to the sheet (which is mid-spring),
// so each control glides from where it was.
const DENSITY = { peek: 0, find: 0, half: 1, full: 2, side: 2 };
const FLIP = ["#pv", "#pp", "#pn", "#pt", "#ph", "#pr", "#pc", "#ps", "#pm", "#player .scrub", "#views", "#body"];
const snapFor = (name) => (wide() ? "side" : name === "full" && document.activeElement === q ? "find" : name);
function setSnap(name) {
  const was = sheet.dataset.snap; if (was === name) return;
  if (reduced || !was || DENSITY[was] === DENSITY[name]) { sheet.dataset.snap = name; return; }
  const els = FLIP.map((s) => $(s)).filter(Boolean), s0 = sheet.getBoundingClientRect(), r0 = els.map((e) => e.getBoundingClientRect());
  sheet.dataset.snap = name;
  const s1 = sheet.getBoundingClientRect();
  els.forEach((e, i) => {
    const a = r0[i], b = e.getBoundingClientRect(); if (!b.width) return;
    if (!a.width) return e.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: 70, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
    const text = e.id === "pt" || e.id === "pm", wideEl = text || e.id === "body" || e.id === "views" || e.classList.contains("scrub");
    const dx = a.left - s0.left - (b.left - s1.left), dy = a.top - s0.top - (b.top - s1.top), sx = wideEl ? 1 : a.width / b.width, sy = wideEl ? 1 : a.height / b.height;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01) return;
    e.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: "0 0", ...(text ? { opacity: 0.35 } : {}) }, { transform: "none", transformOrigin: "0 0", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.22, 1.18, .36, 1)" });
  });
}
function sheetTo(name, v = 0) { setSnap(snapFor(name)); if (wide()) return; if (sh.target !== name) buzz(4); sh.target = name; sh.v = v; if (!sh.raf) sh.raf = requestAnimationFrame(sheetStep); atlasRefit(); }
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
  // The Sort + filter rail rides the sheet's top edge and reads as its header, so a vertical drag there moves the
  // sheet too. Its chips still scroll sideways (touch-action: pan-x) and still tap: the drag only claims the
  // pointer after 8 px of mostly-vertical travel, and then eats the click the chip would get on release.
  const grabs = [$(".grab"), $("#player"), $(".dock"), rail];
  const eatClick = () => { const f = (e) => { e.stopPropagation(); e.preventDefault(); }; addEventListener("click", f, { capture: true, once: true }); setTimeout(() => removeEventListener("click", f, { capture: true }), 450); };
  const grabbed = (on) => sheet.classList.toggle("grabbed", on);
  const down = (e) => {
    const onRail = e.currentTarget === rail;
    if (wide() || sh.drag || (onRail ? e.target.closest("#sortmenu, #sortbtn") || sm.open : e.target.closest("button, input, .scrub, .filt"))) return; // the Sort pill keeps its own hold-and-slide
    sh.drag = { x0: e.clientX, player: !!e.target.closest("#player"), y0: e.clientY, s0: sh.y, t: performance.now(), y: e.clientY, v: 0, moved: false, rail: onRail, pending: onRail };
    if (onRail) return;
    e.currentTarget.setPointerCapture(e.pointerId); cancelAnimationFrame(sh.raf); sh.raf = 0; grabbed(true);
  };
  const move = (e) => {
    const d = sh.drag; if (!d) return;
    if (d.pending) {
      const ax = Math.abs(e.clientX - d.x0), ay = Math.abs(e.clientY - d.y0);
      if (heldGesture || (ax > 8 && ax > ay)) { sh.drag = null; return; } // a held chip, or a sideways swipe: the row scrolls
      if (ay < 8) return;
      d.pending = false; d.y0 = d.y = e.clientY; d.s0 = sh.y; d.t = performance.now();
      e.target.setPointerCapture?.(e.pointerId); cancelAnimationFrame(sh.raf); sh.raf = 0; grabbed(true); eatClick();
    }
    const now = performance.now(), dy = e.clientY - d.y0; if (Math.abs(dy) > 4) d.moved = true;
    d.v = ((e.clientY - d.y) / Math.max(1, now - d.t)) * 1000; d.y = e.clientY; d.t = now;
    const S = snaps(); let y = d.s0 + dy; if (y < S.full) y = S.full - (S.full - y) * 0.25; if (y > S.peek) y = S.peek + (y - S.peek) * 0.25; // rubber band
    sh.y = y; setSheetY(y);
    // The player's density steps at the midpoints between snaps, with a detent tick, so the controls grow under
    // the finger instead of popping in after release.
    const near = y > (S.peek + S.half) / 2 ? "peek" : y > (S.half + S.full) / 2 ? "half" : "full", snap = snapFor(near);
    if (DENSITY[sheet.dataset.snap] !== DENSITY[snap]) { setSnap(snap); haptic("detent"); }
  };
  const up = (e) => {
    const d = sh.drag; sh.drag = null; if (!d) return;
    grabbed(false);
    if (d.rail && d.pending) return; // a tap on a chip stays a tap
    if (d.rail && !d.moved) return sheetTo(sh.target);
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
  canvas, lite: cast.isTV,
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
    A.focus(n.id); showNode(n);
  },
  onDetent: () => haptic("detent"),
  onCamera: () => layerCam(),
  onLayer: (k) => { buzz(6); mixAct("solo", k); },
  onTap: (n) => {
    if (!n) { if (A.focusId !== "root") { const up = A.graph.byId.get(A.focusId)?.parent ?? A.graph.root; A.focus(up.id); showNode(up); } return; } // empty tap steps out
    buzz(5);
    if (n.level === 4) return select(n.id, { play: true, fly: true, view: "track" });
    const to = n.id === A.focusId ? n.parent ?? A.graph.root : n;
    A.focus(to.id); showNode(to);
  },
});
const colorOfNode = (n) => (org ? grp(n.feel)?.night : feelById[n.feel]?.night) ?? null;

// --- layers (stems) ------------------------------------------------------------------------------
// Two halves of one view: zoomed all the way in on the playing track, its layers ring its dot; the
// Track pane lists the same layers with mute / solo. Scrolling the pane to Layers zooms the map in
// (and back out when you scroll away); zooming the map all the way in brings the pane to Layers.
const mixer = createMixer(audio, stemUrl);
// A borrowed lane takes its lender's colour, so a remix reads on the map as two songs' hues.
const lanesOf = (id) => { const L = layersOf(id), t = byId.get(id); if (!L || !t) return null; const on = mixer.id === id; return L.stems.map((s) => { const from = on ? mixer.lent(s.k) : null, u = from && byId.get(from.id); return { ...s, share: s.on, name: STEMS[s.k]?.name ?? s.k, from: u, color: laneColor(tone(u ?? t), s.k), on: !on || mixer.audible(s.k) }; }); };
const beatOf = (u) => ({ bpm: u?.f?.beat?.bpm || bpmOf(u), down: u?.f?.beat?.down ?? 0 });
// Swap walks lane k through the songs that can lend it, closest by ear first, then gives it back.
function swapLane(t, k) {
  const pool = all.filter((u) => layersOf(u.id)?.stems.some((s) => s.k === k));
  const ranked = soundReady() && t.f ? neighbours(t, pool, pool.length).map((n) => n.t) : pool;
  const list = lenders(t, k, ranked, beatOf).slice(0, 8), cur = mixer.lent(k), i = cur ? list.findIndex((x) => x.id === cur.id) : -1;
  const next = list[i + 1] ?? null;
  if (!list.length) return toast(`No split song can lend its ${(STEMS[k]?.name ?? k).toLowerCase()} at this tempo yet`);
  mixer.borrow(k, next);
  const u = next && byId.get(next.id), b = u && beatOf(u);
  toast(next ? `${STEMS[k]?.name} from “${u.title}” · ${Math.round(b.bpm)}→${Math.round(beatOf(t).bpm)} bpm` : `${STEMS[k]?.name} back from the original`);
}
A.setLayers((id) => { const lanes = lanesOf(id); return lanes && { lanes }; });
function mixAct(op, k) {
  const id = state.sel, L = id && layersOf(id); if (!L) return;
  if (mixer.id !== id) mixer.load(id, L);
  if (op === "swap") swapLane(byId.get(id), k); else if (op === "solo") mixer.toggleSolo(k); else if (op === "mute") mixer.toggleMute(k); else mixer.reset();
  if (audio.paused && op !== "reset") audio.play().catch(() => {});
  const lane = STEMS[k]?.name ?? "";
  if (op !== "swap") toast(op === "reset" || !mixer.changed ? "Full mix" : mixer.solo ? `Only ${lane.toLowerCase()}` : `${lane} ${mixer.muted(k) ? "muted" : "back in"}`);
  paintLayers(); A.kick();
}
function layersHTML(t) {
  const lanes = lanesOf(t.id);
  if (!lanes) return layerCount() ? `<section class="layers none"><h4>Layers</h4><p>Not split yet. Layers appear here and on the map as the splitter works through the catalogue (${layerCount()} so far).</p></section>` : "";
  return `<section class="layers"><h4>Layers<small>${lanes.length} · ⇄ borrow from a neighbour</small><button data-lmix="reset" class="${mixer.id === t.id && mixer.changed ? "" : "off"}">Full mix</button></h4>
    ${lanes.map((l) => `<div class="lane${l.on ? "" : " out"}${mixer.id === t.id && mixer.solo === l.k ? " solo" : ""}" style="--l:${l.color}"><i></i><b>${esc(l.name)}${l.from ? `<em>from ${esc(l.from.title)}</em>` : ""}</b>${envSVG(l.env)}<small>${Math.round(l.share * 100)}%</small><button data-lmix="mute" data-k="${l.k}" aria-label="Mute ${esc(l.name)}">M</button><button data-lmix="solo" data-k="${l.k}" aria-label="Solo ${esc(l.name)}">S</button><button data-lmix="swap" data-k="${l.k}" class="${l.from ? "on" : ""}" aria-label="Swap ${esc(l.name)} for a similar song's" title="Borrow this layer from a similar song">⇄</button></div>`).join("")}
  </section>`;
}
// Envelope sparkline, stretched to the lane's own range so a steady drum part still shows its shape.
const envSVG = (env) => { const N = 96, st = env.length / N, xs = [...env].map(Number), lo = Math.min(...xs), hi = Math.max(lo + 1, ...xs); let d = "M0 10"; for (let j = 0; j < N; j++) { let v = 0; for (let q = Math.floor(j * st); q < Math.max(Math.floor(j * st) + 1, Math.floor((j + 1) * st)); q++) v = Math.max(v, xs[q] ?? 0); const y = (10 - 0.6 - 9.4 * (v - lo) / (hi - lo)).toFixed(1); d += `L${j} ${y}L${j + 1} ${y}`; } return `<svg class="env" viewBox="0 0 ${N} 10" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L${N} 10Z"/></svg>`; };
function paintLayers() { const el = body.querySelector(".layers"), t = state.sel && byId.get(state.sel); if (el && t) { el.outerHTML = layersHTML(t); watchLayers(); } }
let layerIO = null, layerHome = null, layerAuto = 0;
function watchLayers() {
  layerIO?.disconnect(); const el = body.querySelector(".layers:not(.none)"); if (!el || cast.isTV) return; // a TV pane never scrolls: Layers would always count as in view and zoom the map onto one song
  layerIO = new IntersectionObserver(([e]) => {
    const id = state.sel; if (!id || performance.now() < layerAuto) return;
    if (e.isIntersecting && A.layerK < 1) { layerHome = { ...A.cam }; layerAuto = performance.now() + 900; A.zoomOn(id); }
    else if (!e.isIntersecting && layerHome && A.layerK >= 1) { const h = layerHome; layerHome = null; layerAuto = performance.now() + 900; A.flyCam(h); }
  }, { root: body, threshold: 0.35 });
  layerIO.observe(el);
}
let layerDeep = false;
function layerCam() {
  const deep = A.layerK >= 1 && !!(state.sel && layersOf(state.sel));
  if (deep && !layerDeep && performance.now() > layerAuto && state.view === "track") {
    const el = body.querySelector(".layers:not(.none)");
    if (el) { layerAuto = performance.now() + 900; if (!wide() && sh.target === "peek") sheetTo("half"); body.scrollTo({ top: body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - 8, behavior: reduced ? "auto" : "smooth" }); }
  }
  if (!deep && layerDeep) layerHome = null; // you zoomed out yourself: nothing to restore
  layerDeep = deep;
}

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
// While you tune, it frames the songs your settings matched instead.
const focusSel = (ms) => { const ids = tune?.rows?.length ? tune.rows.map((r) => r.t.id) : nbrs.slice(0, 6).map((n) => n.t.id); if (!ids.length) return A.focus(state.sel, ms); A.flyToIds([state.sel, ...ids], ms); A.focusId = state.sel; };
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
// Lens names wear their lens's colours. Text colours are lifted to >= 64% lightness so the darkest stops
// (deep blue, brown, slate) still read on the dark rail. "Emotions" has 8 letters, one per emotion, in ring order.
const inkC = (c) => shade(c).replace(/(\d+)%\)$/, (_, l) => `${Math.max(64, +l)}%)`);
const lensGlow = (id) => { const s = lensStops(id, FEELS); return inkC(s[Math.floor(s.length / 2)]); }; // the halo a lit row casts
const lensInk = (id) => `linear-gradient(90deg,${lensStops(id, FEELS).map(inkC).join(",")})`;
function paintLensName(el, L) {
  if (L.id === "feel") { el.classList.remove("lensink"); el.innerHTML = [...L.name].map((ch, i) => `<span style="color:${inkC(FEELS[i % FEELS.length].night)}">${esc(ch)}</span>`).join(""); return; }
  el.textContent = L.name; el.classList.add("lensink"); el.style.setProperty("--lens", lensInk(L.id));
}
function setLens(id, save = true) {
  const L = LENSES.find((x) => x.id === id) ?? LENSES[0]; state.lens = L.id;
  const changed = save && (org?.id ?? "feel") !== L.id;
  lensFn = L.color ?? null; org = organise(L.id, FEELS, familyById); if (org) org.id = L.id; tintCache.clear();
  A.setLens(lensFn);
  renderPlayer(); // the player, its glow and the queue dot take the playing track's colour under the new sort
  paintLensName($("#sortname"), L); sortBtn.classList.toggle("dim", !soundReady());
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
  sortMenu.innerHTML = LENSES.map((L) => { const sub = L.id === "feel" ? "how it makes you feel" : esc(L.legend ?? ""), ink = lensInk(L.id);
    return `<button role="menuitem" data-lens="${L.id}" class="${L.id === state.lens ? "on" : ""}" style="--fill:${ink};--glow:${lensGlow(L.id)};--lens:${ink}"><i class="fill"></i><i class="bleed lensink" aria-hidden="true">${sub}</i><b>${L.name}</b><small class="lensink">${sub}</small></button>`; }).join("");
  sortMenu.hidden = false; sortMenu.classList.remove("picking"); const onB = sortMenu.querySelector("button.on"); if (onB) bloom(onB, null, null, true); void sortMenu.offsetWidth; sortMenu.classList.add("on"); sortBtn.classList.add("open"); haptic(held ? "press" : "select");
}
// The chosen sort's colour bleeds out of its coloured subtext and becomes the row's glass fill. The fill starts as
// exactly the subtext's box, so its row-wide gradient is squeezed into the same colours the letters wear, then
// expands to the row (transform only). A pre-blurred copy of the letters swells and fades as the colour leaves
// them, and the letters turn ink once the tint is under them. The row already chosen when the menu opens sits
// filled with no motion. (x, y: the finger, unused since the colour comes from the text, kept for callers.)
function bloom(b, x, y, still = false) {
  // Layout px (offset*), not rects: the menu is still scaling in when it opens, so rects read ~14% small.
  const f = b.querySelector(".fill"), s = b.querySelector("small"), bl = b.querySelector(".bleed"), W = b.offsetWidth, H = b.offsetHeight; if (!f || !s) return;
  const sx = s.offsetLeft - 2, sy = s.offsetTop - 1, sw = s.offsetWidth + 4, sh = s.offsetHeight + 2;
  if (bl) Object.assign(bl.style, { left: `${s.offsetLeft}px`, top: `${s.offsetTop}px` });
  clearTimeout(b._ink); b.classList.remove("lit", "inked", "bleeding"); b.classList.toggle("still", still);
  f.style.transform = still ? "" : `translate(${sx}px, ${sy}px) scale(${(sw / W).toFixed(4)}, ${(sh / H).toFixed(4)})`;
  void f.offsetWidth; f.style.transform = ""; b.classList.add("lit");
  if (still) b.classList.add("inked"); else { b.classList.add("bleeding"); b._ink = setTimeout(() => b.classList.contains("lit") && b.classList.add("inked"), 150); }
}
function lightRow(b, x, y) {
  if (b === sm.hot) return; sm.hot?.classList.remove("hot", "lit", "inked"); sm.hot = b;
  sortMenu.classList.toggle("picking", !!b && !b.classList.contains("on"));
  if (b) { b.classList.add("hot"); if (!b.classList.contains("on")) bloom(b, x, y); haptic("detent"); }
}
const pickLens = (b, then) => setTimeout(() => { closeSort(); then(); }, 260); // let the fill land before the menu folds
function closeSort() { sm.open = false; sm.hot = null; sortMenu.classList.remove("on"); sortBtn.classList.remove("open"); setTimeout(() => { if (!sm.open) sortMenu.hidden = true; }, 180); }
function hotAt(x, y) {
  const b = document.elementFromPoint(x, y)?.closest?.("#sortmenu [data-lens]") ?? null;
  lightRow(b, x, y);
}
// A held finger that strays AWAY px past the menu (and the button it came from) dismisses it; a wobble on the border doesn't.
const AWAY = 24, outBy = (r, x, y) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
const away = (x, y) => Math.min(outBy(sortMenu.getBoundingClientRect(), x, y), outBy(sortBtn.getBoundingClientRect(), x, y)) > AWAY;
sortBtn.addEventListener("pointerdown", (e) => {
  if (e.button > 0) return; sm.down = true; sm.x = e.clientX; sm.y = e.clientY; sm.p0 = e.pressure; sm.fired = false;
  sortBtn.setPointerCapture(e.pointerId); sortBtn.classList.add("arming");
  sm.a = setTimeout(() => sm.down && pressRing.arm(sm.x, sm.y), 110); // the same arming ring a held row shows
  sm.t = setTimeout(() => { sm.fired = true; pressRing.fire(); if (sm.open) closeSort(); openSort(true); }, HOLD);
});
sortBtn.addEventListener("pointermove", (e) => {
  if (!sm.down) return;
  if (!sm.fired && e.pointerType !== "mouse" && sm.p0 > 0 && e.pressure - sm.p0 > FORCE) { clearTimeout(sm.t); sm.fired = true; openSort(true); } // pressed harder
  if (sm.fired && sm.open && away(e.clientX, e.clientY)) { sm.down = false; pressRing.hide(); sortBtn.classList.remove("arming"); return closeSort(); } // slid off without choosing: let it go
  if (sm.fired) hotAt(e.clientX, e.clientY);
  else if (Math.hypot(e.clientX - sm.x, e.clientY - sm.y) > SLOP) { clearTimeout(sm.t); clearTimeout(sm.a); pressRing.hide(); sortBtn.classList.remove("arming"); } // a scroll of the rail, not a press
});
const sortUp = (e) => {
  if (!sm.down) return; sm.down = false; clearTimeout(sm.t); clearTimeout(sm.a); pressRing.hide(); sortBtn.classList.remove("arming");
  if (sm.fired) { const b = sm.hot; if (b) pickLens(b, () => { if (b.dataset.lens !== state.lens) { haptic("keep"); setLens(b.dataset.lens); } }); else sm.held = false; return; } // let go on nothing: the menu stays for a tap
  if (e.type === "pointercancel" || Math.hypot(e.clientX - sm.x, e.clientY - sm.y) > SLOP) return;
  sm.open ? closeSort() : openSort(false);
};
sortBtn.addEventListener("pointerup", sortUp); sortBtn.addEventListener("pointercancel", sortUp);
sortBtn.addEventListener("contextmenu", (e) => e.preventDefault());
sortMenu.addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-lens]"); if (b) lightRow(b, e.clientX, e.clientY); }); // a tap fills from the fingertip
sortMenu.addEventListener("click", (e) => { const b = e.target.closest("[data-lens]"); if (!b) return; if (b !== sm.hot) lightRow(b, e.clientX, e.clientY); pickLens(b, () => { if (b.dataset.lens !== state.lens) { buzz(4); setLens(b.dataset.lens); } }); });
document.addEventListener("pointerdown", (e) => { if (sm.open && !e.target.closest("#sortmenu, #sortbtn")) closeSort(); }, true);

function renderChips() {
  restPulse();
  const lens = state.lens, O = orgFor(lens), on = groupSet(lens), n = {};
  for (const t of all) { const k = O ? O.of(t) : t.feel; n[k] = (n[k] ?? 0) + 1; }
  const groups = O ? O.groups : FEELS;
  const other = otherFilters();
  chips.innerHTML = groups.filter((G) => n[G.id]).map((G) => `<button class="chip feel ${on.has(G.id) ? "on" : ""}" data-g="${esc(G.id)}" style="--c:${G.night}"><i></i>${esc(G.id === "none" ? "Unmeasured" : G.name)}<small>${n[G.id]}</small></button>`).join("") +
    (other ? `<button class="chip x" data-other="1" title="Filters set under other sorts">+${other}<span>×</span></button>` : "") +
    "";
  // Pinned outside the scroller so they never slide offscreen behind 8+ groups.
  $("#pins").innerHTML = `<button class="chip ${state.picksOnly ? "on" : ""}" data-picks="1" aria-label="Only tracks you liked" title="Only tracks you liked">♥ Liked<small>${state.picks.size}</small></button><button class="chip ${state.cc0 ? "on" : ""}" data-cc0="1" aria-label="Only CC0: no credit needed" title="CC0: use without crediting anyone">No credit</button>`;
}
const onChip = (e) => {
  const b = e.target.closest(".chip"); if (!b) return; buzz(4);
  state.view = "library"; // the filtered list is the answer to a filter tap
  if (b.dataset.g) toggleGroup(b.dataset.g);
  if (b.dataset.other) { if (state.lens !== "feel") state.feels.clear(); state.bands.clear(); for (const [k, v] of state.gs) if (k !== state.lens) v.clear(); }
  if (b.dataset.cc0) state.cc0 = !state.cc0;
  if (b.dataset.picks) state.picksOnly = !state.picksOnly;
  like = null; run({ fly: true });
};
chips.addEventListener("click", onChip); $("#pins").addEventListener("click", onChip);
// Hold (or press hard on) a filter chip: its tracks light up on the map, the light running out from the hub along
// that group's arm. Letting go fades it; the hold never toggles the filter (pressable swallows the click).
pressable(chips, ".chip.feel", { color: (el) => el.style.getPropertyValue("--c"), onFire: (el) => A.setGlow(el.dataset.g), onEnd: () => A.setGlow(null) });
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
  const pool = like?.f || result.ranked ? search(all, facets).hits.map((h) => h.t) : result.hits.map((h) => h.t), ids = pool.length + ":" + (pool[0]?.id ?? "") + (pool[pool.length - 1]?.id ?? "") + (org?.id ?? "feel");
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
q.addEventListener("blur", () => setSnap(snapFor(sh.target))); // done searching: the full player comes back
q.addEventListener("keydown", (e) => { if (e.key === "Enter") { q.blur(); run({ fly: true }); if (state.q) searchWeb(true); } if (e.key === "Escape") { q.value = ""; like = null; run({ fly: true }); q.blur(); } });
$("#clear").onclick = () => { q.value = ""; like = null; run({ fly: true }); };

const ai = $("#ai");
function warmModel() {
  if (modelReady()) return;
  loadModel((s) => { ai.dataset.state = s; ai.title = { loading: "Loading semantic search…", ready: "Semantic search on", off: "Semantic search unavailable; matching words only" }[s]; if (s === "ready") { if (state.q) run({ fly: true, scroll: false }); toast("Semantic search ready"); } }).catch(() => {});
}

async function searchWeb(auto = false) {
  if (webBusy || !state.q) return; webBusy = true; renderBody(false);
  try {
    const got = await webSearch(state.q, all);
    if (got.length) { all = [...all, ...got]; got.forEach((t) => byId.set(t.id, t)); A.setTracks(all); }
    if (got.length) toast(`+${got.length} from across the web (Openverse)`);
    else if (!auto || !result.hits?.length) toast("No new CC0 / CC BY songs on Openverse for that"); // after Enter, local matches already answer
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
    <span class="tt"><b>${esc(t.title)}</b><small>${t.f ? `${bpmOf(t)} bpm · ${t.f.camelot} · ` : t.bpm ? `${t.bpm} bpm · ` : ""}${esc(styleName(t.family, t.style))} · ${esc(t.author)}${t.src === "web" ? ` · ${esc(t.provider)}` : ""}</small>${(reason ?? why.get(t.id)) ? `<em class="why">${esc(reason ?? why.get(t.id))}</em>` : ""}</span>
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
  if (state.view === "library" && (state.browse !== "feel" || state.open)) return paint(browseHTML(), scroll);
  let html = browseBar();
  const sn = scope && !like && !state.q && A.graph.byId.get(scope);
  if (sn) return paint(html + scopeHTML(sn, hits), scroll); // a scoped page opens on its own heading
  const label = like ? `Sounds like “${esc(like.title)}”` : state.q ? `“${esc(state.q)}”` : state.feels.size || state.bands.size || state.cc0 || state.picksOnly ? "Filtered" : "Every track";
  html += `<div class="sum"><b>${label}</b><span>${hits.length.toLocaleString()} ${hits.length === 1 ? "track" : "tracks"}${result.ranked ? (like?.f ? " · by ear" : qv || like ? " · semantic" : " · words") : ""}</span></div>`;
  // Group by feel (the atlas's first ring); ranked searches keep their order inside each group and
  // order groups by their best hit, so the strongest vibe comes first.
  if (!state.q && !like) html += mineHTML();
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
    const subs = new Map(); for (const t of g.rows) { const [id, name, tint] = sub(t), e = subs.get(id) ?? { name, tint, n: 0, node: `a:${g.f}:${id}` }; e.n++; subs.set(id, e); }
    const styles = [...subs.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((e) => `<span data-scope="${esc(e.node)}" style="--t:${tinted(g.f, e.tint)}"><i></i>${esc(e.name)}</span>`).join("");
    html += `<section class="grp" data-feel="${g.f}" style="--c:${F.night}"><h3 data-focus="f:${g.f}"><i></i>${F.name}<small>${g.rows.length}${bpms.length ? ` · ${Math.min(...bpms)}–${Math.max(...bpms)} bpm` : ""}</small><em class="subs">${styles}</em></h3>
      ${g.rows.slice(0, g.open ? 400 : LIM).map((t, i) => rowHTML(t, i)).join("")}${more > 0 ? `<button class="more" data-more="${g.f}">Show ${more} more ${F.name.toLowerCase()} tracks</button>` : ""}</section>`;
  }
  if (!hits.length) html += `<div class="empty">Nothing in the catalogue matches. ${state.q ? "Try the open web below, or fewer filters." : "Try fewer filters."}</div>`;
  if (state.q) html += `<button class="web ${webBusy ? "busy" : ""}" id="web">${webBusy ? "Searching the open web…" : `Search the open web for “${esc(state.q)}”`}<small>Openverse · Jamendo, Freesound, Wikimedia · CC0 / CC BY only</small></button>`;
  if (state.q || like) html += mineHTML();
  html += `<footer class="src">${sourcesLine()}</footer>`;
  paint(html, scroll);
}
// Re-painting the view you're already on (steering, releasing a meter, liking) must not look like
// arriving: entrances stay off and the card's colour, spectrum and meter ticks glide from old to new.
const GLIDE = [".card", ".spec i", ".mt .mb > i:not(.tg)", ".bb i"];
const painted = new Set();
function paint(html, scroll) {
  // A track's card and spectrum enter once; coming back to its view (a tab switch) shows them settled.
  const key = state.view + "|" + (state.sel ?? ""), seen = painted.has(key); painted.add(key);
  const same = !scroll && body.dataset.v === state.view, was = same && GLIDE.map((s) => [...body.querySelectorAll(s)].map((el) => el.style.cssText));
  body.innerHTML = html; body.dataset.v = state.view; body.classList.toggle("calm", same || seen);
  if (was) GLIDE.forEach((s, g) => { const els = [...body.querySelectorAll(s)]; if (els.length !== was[g].length) return;
    const now = els.map((el) => el.style.cssText); els.forEach((el, i) => { el.style.cssText = was[g][i]; }); body.offsetWidth; els.forEach((el, i) => { el.style.cssText = now[i]; }); });
  restPulse(); if (scroll) body.scrollTop = 0; watchLayers(); fitSubs();
}
// A feel heading shows as many of its styles as fit beside its name, whole, and drops the rest (they are
// a tap away on the feel's page): a swatch cut in half, or slid under the name, can't be read or tapped.
function fitSubs() {
  for (const em of body.querySelectorAll(".grp h3 em.subs")) {
    const ss = [...em.children]; ss.forEach((s) => { s.hidden = false; });
    // Right-aligned, so overflow runs out the left edge (scrollWidth can't see it): compare the first one's edge.
    const fits = () => ss[0].getBoundingClientRect().left >= em.getBoundingClientRect().left - 0.5;
    for (let i = ss.length - 1; i > 0 && !fits(); i--) ss[i].hidden = true;
  }
}
// --- browse: artists, albums, genres, recent (browse.js) -----------------------------------------------
// Lists come from what the search and filters keep; a page's songs are its play order, so Play, Shuffle
// and tapping a row queue that page (a playlist queue: next/prev stay inside it).
const browseBar = () => `<nav class="bmodes" role="tablist" aria-label="Browse by">${browse.MODES.map(([id, name]) => `<button role="tab" data-browse="${id}" class="${state.browse === id && !state.open ? "on" : ""}" aria-selected="${state.browse === id}">${name}</button>`).join("")}</nav>`;
const keptTracks = () => result.hits.map((h) => h.t);
const totalTime = (ts) => { const m = Math.round(ts.reduce((n, t) => n + (t.dur || 0), 0) / 60); return !m ? "" : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const initials = (s) => String(s).replace(/^the\s+/i, "").split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
const artLink = (t) => browse.artistsOf(t).map((a) => `<a class="aref" data-open="a:${esc(browse.keyOf(a))}">${esc(a)}</a>`).join(", ");
const pageBtns = (n) => `<span class="bplay"><button data-bplay="play">${ICON.play}Play</button><button data-bplay="shuffle"><svg viewBox="0 0 20 20"><path d="M3 6h3l7 8h4M3 14h3l2-2.3M11 8.3 13 6h4M15 4l2 2-2 2M15 12l2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Shuffle</button></span><small>${n}</small>`;
function browseHTML() {
  const kept = keptTracks(), d = browse.detail(state.open, kept);
  if (state.open && d) {
    const c = tone(d.tracks[0]);
    const head = `<div class="bhead" style="--c:${c}"><button class="bback" data-back aria-label="Back">‹ ${esc(browse.MODES.find(([id]) => id === state.browse)?.[1] ?? "Library")}</button>
      ${d.kind === "al" ? `<div class="cover" style="--c:${c}">${d.art ? `<img src="${esc(d.art)}" alt="" />` : `<b>${esc(initials(d.name))}</b>`}</div>` : d.kind === "a" ? `<div class="avatar" style="--c:${c}">${esc(initials(d.name))}</div>` : ""}
      <h2>${esc(d.name)}</h2><p>${d.kind === "al" && d.artist !== "Various artists" ? `<a class="aref" data-open="a:${esc(browse.keyOf(d.artist))}">${esc(d.artist)}</a> · ${esc(d.sub.split(" · ").slice(1).join(" · "))}` : esc(d.sub)}</p>
      <div class="bacts">${pageBtns(totalTime(d.tracks))}</div></div>`;
    const groups = d.groups ?? [{ tracks: d.tracks }];
    return head + `<div data-blist>${groups.map((g, gi) => `<section class="grp" style="--c:${tone(g.tracks[0])}">${g.name ? `<h3 ${g.open ? `data-open="${esc(g.open)}"` : ""}><i></i>${esc(g.name)}<small>${g.tracks.length}${g.sub ? " · " + esc(g.sub) : ""}</small>${g.open ? "<em>album →</em>" : ""}</h3>` : ""}${g.tracks.map((t, i) => rowHTML(t, gi * 20 + i)).join("")}</section>`).join("")}</div>`;
  }
  let html = browseBar();
  if (state.browse === "artists") {
    const A = browse.artists(kept);
    html += `<div class="sum"><b>Artists</b><span>${A.length.toLocaleString()}</span></div><div class="blist">${A.map((a) => `<button class="bi" data-open="a:${esc(a.key)}" style="--c:${tone(a.tracks[0])}"><span class="avatar">${esc(initials(a.name))}</span><span class="tt"><b>${esc(a.name)}</b><small>${a.tracks.length} song${a.tracks.length === 1 ? "" : "s"}${a.albums ? ` · ${a.albums} album${a.albums === 1 ? "" : "s"}` : ""}</small></span><i class="chev">›</i></button>`).join("")}</div>`;
  }
  if (state.browse === "albums") {
    const L = browse.albums(kept);
    html += `<div class="sum"><b>Albums</b><span>${L.length.toLocaleString()}</span></div>`;
    html += L.length ? `<div class="agrid">${L.map((a) => `<button class="at" data-open="al:${esc(a.key)}" style="--c:${tone(a.tracks[0])}"><span class="cover">${a.art ? `<img src="${esc(a.art)}" alt="" loading="lazy" />` : `<b>${esc(initials(a.name))}</b>`}</span><b>${esc(a.name)}</b><small>${esc(a.artist)}</small></button>`).join("")}</div>`
      : `<div class="empty">The free catalogue is all singles, so there are no albums yet. Albums show up when you bring your own music with album tags (files, Plex or Spotify).</div>` + mineHTML();
  }
  if (state.browse === "genres") {
    const G = browse.genres(kept);
    html += `<div class="sum"><b>Genres</b><span>${G.reduce((n, f) => n + f.styles.length, 0)} styles</span></div>${G.map((f) => `<section class="grp" style="--c:${tone(f.styles[0].tracks[0])}"><h3><i></i>${esc(f.name)}<small>${f.n}</small></h3><div class="gchips">${f.styles.map((g) => `<button data-open="g:${esc(g.key)}" style="--c:${tone(g.tracks[0])}"><i></i>${esc(g.name)}<small>${g.tracks.length}</small></button>`).join("")}</div></section>`).join("")}`;
  }
  if (state.browse === "recent") {
    const R = state.recent.map((id) => byId.get(id)).filter(Boolean);
    html += `<div class="sum"><b>Recently played</b><span>${R.length}</span></div>`;
    html += R.length ? `<div class="bacts">${pageBtns("")}</div><div data-blist><section class="grp">${R.map((t, i) => rowHTML(t, i)).join("")}</section></div>` : `<div class="empty">Songs you play land here, newest first, on this device.</div>`;
  }
  return html;
}
const pageIds = () => (state.open ? browse.detail(state.open, keptTracks())?.tracks.map((t) => t.id) : state.browse === "recent" ? state.recent.filter((id) => byId.has(id)) : null) ?? [];
const pageName = () => (state.open ? browse.detail(state.open, keptTracks())?.name : "Recently played");
function playPage(id, shuffle = false) { // queue this page and play from id (or the top, or shuffled)
  let ids = pageIds(); if (!ids.length) return;
  if (shuffle) ids = browse.shuffled(ids);
  state.plist = { id: "page:" + (state.open ?? state.browse), name: pageName(), ids }; state.radio = null; state.queue = "playlist";
  if (shuffle) toast(`Shuffling “${state.plist.name}”`);
  select(id ?? ids[0], { play: true, fly: true, keepScroll: true });
}
function openPage(open) { state.view = lastView = "library"; state.open = open; if (open.startsWith("a:") && state.browse === "feel") state.browse = "artists"; if (open.startsWith("al:") && state.browse === "feel") state.browse = "albums"; if (open.startsWith("g:") && state.browse === "feel") state.browse = "genres"; renderViews(); renderBody(true); saveHash(); if (!wide() && sh.target === "peek") sheetTo("half"); }
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
    <span class="tt"><b>${esc(p.name)}</b><small>${p.tracks.length} track${p.tracks.length === 1 ? "" : "s"} · ${p.plays} play${p.plays === 1 ? "" : "s"}${p.own ? " · yours" : ""}</small></span>
    <span class="hv ${p.liked ? "on" : ""}" data-plheart="${p.id}" role="button" aria-label="Like playlist">${ICON.heart}${p.likes ? `<small>${p.likes}</small>` : ""}</span>${p.own ? `<button class="pl-x" data-plx="${p.id}" aria-label="Unpublish">×</button>` : ""}</div>`).join("");
  return `<div class="sum"><b>Community</b><span>${social.compact(R.views)} views · ${social.compact(R.visitors)} listeners · ${social.compact(R.plays)} plays</span></div>
    <section class="room"><div class="live-big"><i></i><b>${R.here}</b> here now<span>${R.listening} listening</span></div>
      <div class="radio-row"><button data-radio="ear" class="${state.radio === "ear" ? "on" : ""}"><b>By-ear radio</b><small>${state.sel ? `from “${esc(byId.get(state.sel)?.title)}”, endless` : "endless, drifting by sound"}</small></button><button data-radio="crowd" class="${state.radio === "crowd" ? "on" : ""}"><b>Crowd radio</b><small>what people here love and play</small></button></div></section>
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
  el.innerHTML = `<i></i><b>${R.here}</b><span>here</span><span class="sep"></span><b>${social.compact(R.views)}</b><span>visits</span>`;
  el.title = `${R.here} here now, ${R.listening} listening · ${R.views.toLocaleString()} views · ${R.visitors.toLocaleString()} listeners`;
}
let roomT = 0;
social.onRoom(() => { renderLive(); renderPlayer(); clearTimeout(roomT); roomT = setTimeout(() => { if (tuning) return; if (state.view === "community" || state.view === "track") { const st = body.scrollTop; renderBody(false); body.scrollTop = st; } }, 120); });
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
  body.addEventListener("touchstart", (e) => { heldGesture = false; if (e.target.closest("input")) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  body.addEventListener("touchend", (e) => { if (x0 === null || heldGesture) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) setView(VIEWS[VIEWS.indexOf(state.view) + (dx < 0 ? 1 : -1)]); }, { passive: true });
}
const sourcesLine = () => { const n = {}; for (const t of all) n[t.src] = (n[t.src] ?? 0) + 1; return `Sources: ${[["shortlist", "Glide shortlist"], ["incompetech", "Incompetech"], ["ccmixter", "ccMixter"], ["web", "Openverse"], ["mine", "yours"]].filter(([k]) => n[k]).map(([k, v]) => `${v} ${n[k].toLocaleString()}`).join(" · ")}. Catalogue tracks are CC0 and CC BY only; no NC, ND or SA; your own music stays on this device. Credit CC BY tracks with the line on each card.`; };

function cardHTML(t) {
  const F = feelById[t.feel], c = tone(t);
  const rows = [
    [F.name, F.ask + (t.feelGuess ? " · inferred" : "")],
    [familyById[t.family]?.name, ""],
    [styleName(t.family, t.style), [t.bpm ? `${t.bpm} bpm` : "", t.dur ? mmss(t.dur) : ""].filter(Boolean).join(" · ")],
    [`<em>${esc(t.title)}</em>`, artLink(t) + (t.album ? ` · <a class="aref" data-open="al:${esc(browse.albums([t])[0].key)}">${esc(t.album)}</a>` : "")],
  ];
  return `<article class="card" style="--c:${c}">
    <div class="lin">${LEVELS.map((L, i) => `<div class="lv"><b>0${i + 1}</b><span class="k">${L}</span><span class="v">${i === 3 ? rows[i][0] : esc(rows[i][0])}</span>${rows[i][1] ? `<span class="s">${i === 3 ? rows[i][1] : esc(rows[i][1])}</span>` : ""}</div>`).join("")}</div>
    ${profileHTML(t, tune ? tune.p : null)}
    ${tuneHTML(t)}
    ${layersHTML(t)}
    ${nbrs.length ? `<button class="tease" data-act="similar"><b>Sounds like</b><span>${nbrs.slice(0, 3).map((n) => `<em style="--c:${tone(n.t)}">${esc(n.t.title)}</em>`).join("")}</span><small>see ${Math.max(nbrs.length, sim.length)}+ →</small></button>` : ""}
    ${t.tags?.length ? `<div class="tags">${t.tags.slice(0, 8).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
    ${t.desc ? `<p class="desc">${esc(t.desc)}</p>` : ""}
    <div class="lic"><span class="badge">${esc(t.license)}</span><code>${esc(creditLine(t))}</code></div>
    <div class="acts"><button data-act="similar">More like this</button><button data-act="credit">Copy credit</button><button data-act="pick" class="${state.picks.has(t.id) ? "on" : ""}">${state.picks.has(t.id) ? "♥ Picked" : "♥ Pick"}</button>${t.sourceUrl ? `<a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>` : ""}</div>
  </article>`;
}
// --- tune: the Track pane's meters steer what plays ----------------------------------------------
// Drag a meter and the now-playing song becomes the one that measures closest to your settings,
// picking up at the same point in its own run; the dim tick on each meter is where the playing song
// really sits, the bright knob is what you asked for. The next-closest wait underneath, and the map
// draws chords from the playing dot to them. Tapping any other song by hand ends the tune.
let tune = null, tuneT = 0, tuning = false, tunePaint = false; // tune = { seed, p: { meter: target pct }, rows }
function tuneHTML(t) {
  if (!tune?.rows) return "";
  const next = tune.rows.filter((r) => r.t.id !== t.id).slice(0, 5);
  return `<section class="tunes"><h4>Next closest<small>to your settings</small><button data-act="untune">Reset</button></h4>
    ${next.length ? next.map((r, i) => rowHTML(r.t, i, r.why)).join("") : `<div class="empty">Nothing else measures like that yet.</div>`}</section>`;
}
function retune() {
  const seed = byId.get(tune?.seed); if (!seed) return;
  tune.rows = tuneMatch(seed, tune.p, all, 6, { withSeed: true });
  const best = tune.rows[0]?.t;
  if (best && best.id !== state.sel) {
    const frac = audio.duration ? audio.currentTime / audio.duration : 0;
    pendingSeek = best.dur ? Math.min(frac * best.dur, Math.max(0, best.dur - 15)) : null;
    buzz(10); toast(`Now playing “${best.title}” · ${tune.rows[0].why}`);
    select(best.id, { play: true, keepScroll: true, tuned: true });
  } else paintTune();
  const cur = byId.get(state.sel);
  A.setLinks(cur.id, tune.rows.filter((r) => r.t !== cur).map((r, i) => ({ id: r.t.id, w: 1 - i * 0.12 })));
  focusSel(700);
}
// Mid-drag, the card can't be rebuilt (it would drop the slider under your thumb): patch in place.
function paintTune() {
  const t = byId.get(state.sel); if (!t) return;
  const el = body.querySelector(".tunes"), html = tuneHTML(t);
  // the list enters once; later retunes swap it in place
  if (el) el.outerHTML = html.replace('class="tunes', 'class="tunes still'); else body.querySelector(".snd")?.insertAdjacentHTML("afterend", html);
  const hint = body.querySelector(".meters .hint"); if (hint) hint.textContent = "Your settings steer what plays · dim tick = this song";
  body.querySelector(".meters")?.classList.add("tuning");
  for (const inp of body.querySelectorAll("input.tune")) { const p = t.p?.[inp.dataset.k], tick = inp.parentElement.querySelector("i:not(.tg)"); if (p != null && tick) tick.style.left = `${(p * 100).toFixed(1)}%`; }
  const top = body.querySelector(".card .lin .lv:last-child .v"); if (top) top.innerHTML = `<em>${esc(t.title)}</em>`;
}
function untune() {
  tune = null; const t = byId.get(state.sel); if (!t) return;
  const top = nbrs[0]?.score || 1;
  A.setLinks(nbrs.length ? t.id : null, nbrs.map((n) => ({ id: n.t.id, w: Math.max(0, (n.score / top - 0.6) / 0.4) })));
  const st = body.scrollTop; renderBody(false); body.scrollTop = st; focusSel(600);
}
body.addEventListener("pointerdown", (e) => { if (e.target.closest("input.tune")) tuning = true; });
addEventListener("pointerup", () => {
  if (!tuning) return; tuning = false; buzz(6);
  clearTimeout(tuneT); if (tune) retune();
  if (tunePaint) { tunePaint = false; const st = body.scrollTop; renderBody(false); body.scrollTop = st; }
});
body.addEventListener("input", (e) => {
  const inp = e.target.closest("input.tune"), t = state.sel && byId.get(state.sel); if (!inp || !t?.p) return;
  if (!tune) tune = { seed: t.id, p: Object.fromEntries(Object.entries(t.p).filter(([, v]) => v != null)), rows: null };
  const k = inp.dataset.k, v = inp.value / 100; tune.p[k] = v;
  const mb = inp.parentElement; let g = mb.querySelector(".tg"); if (!g) { g = document.createElement("i"); g.className = "tg"; mb.prepend(g); }
  g.style.left = `${v * 100}%`;
  const kc = meterColor(k, v); if (kc) mb.parentElement.style.setProperty("--k", kc);
  const b = mb.parentElement.querySelector(".mw b"), p0 = Math.round((t.p[k] ?? v) * 100), p1 = Math.round(v * 100);
  if (b) b.textContent = p0 === p1 ? `${ord(p0)} pct` : `${ord(p0)} → ${ord(p1)} pct`;
  clearTimeout(tuneT); tuneT = setTimeout(retune, 260); // a pause in the drag is enough to change the song
});

// A family or style (Rock & Pop, Indie…) scopes the list to its own songs under its own heading; a feel jumps to its
// group; the root clears the scope. The map and the list always name the same place.
let scope = null;
const scopeTracks = (n) => (n.level === 3 ? n.tracks : n.children.flatMap((c) => c.tracks ?? []));
function showNode(n) {
  const was = scope; scope = n && n.level >= 2 ? n.id : null;
  if (scope) { if (!wide() && sh.target === "peek") sheetTo("half"); state.view = "library"; state.browse = "feel"; state.open = null; renderViews(); renderBody(true);
    const hd = body.querySelector(".bhead.scope"); if (hd) body.scrollTop = hd.offsetTop - 10; return; } // open on its heading, the mode bar just above
  if (was) { if (state.view === "library") renderBody(true); }
  if (n?.level === 1) scrollToGroup(n.feel);
}
function scopeHTML(n, hits) {
  const ids = new Set(scopeTracks(n).map((t) => t.id)), rows = hits.filter((h) => ids.has(h.t.id)).map((h) => h.t);
  const top = n.parent?.level === 2 ? n.parent.parent : n.parent, F = grp(n.feel), bpms = rows.map((t) => t.bpm).filter(Boolean);
  const path = [top?.name, n.level === 3 ? n.parent.name : null].filter(Boolean).map(esc).join(" · ");
  const kids = n.level === 2 && n.children.length > 1 ? `<em class="subs scopes">${n.children.map((c) => `<span data-scope="${esc(c.id)}" style="--t:${tinted(n.feel, c.tint)}"><i></i>${esc(c.name)}</span>`).join("")}</em>` : "";
  return `<div class="bhead scope" style="--c:${F?.night ?? "var(--ink)"}"><button class="bback" data-scope="${esc(n.parent?.id ?? "root")}" aria-label="Back to ${esc(n.parent?.name ?? "every track")}">‹ ${esc(n.parent?.name ?? "Every track")}</button>
    <h2>${esc(n.name)}</h2><p>${path ? `${path} · ` : ""}${rows.length} ${rows.length === 1 ? "song" : "songs"}${bpms.length ? ` · ${Math.min(...bpms)}–${Math.max(...bpms)} bpm` : ""}</p>${kids}</div>
    <section class="grp scoped" data-scope-id="${esc(n.id)}" style="--c:${F?.night ?? "var(--ink)"}">
    ${rows.length ? rows.map((t, i) => rowHTML(t, i)).join("") : `<div class="empty">No ${esc(n.name)} tracks match these filters.</div>`}</section>`;
}
function scrollToGroup(feel) { if (state.view !== "library") setView("library", false); const g = body.querySelector(`.grp[data-feel="${feel}"]`); if (g) { if (!wide() && sh.target === "peek") sheetTo("half"); body.scrollTo({ top: g.offsetTop - 8, behavior: reduced ? "auto" : "smooth" }); } }

body.addEventListener("click", async (e) => {
  const heart = e.target.closest("[data-heart]");
  if (heart) { e.stopPropagation(); return pick(heart.dataset.heart); }
  const op = e.target.closest("[data-open]"); if (op) { e.stopPropagation(); buzz(5); return openPage(op.dataset.open); }
  const bm = e.target.closest("[data-browse]"); if (bm) { buzz(4); state.browse = bm.dataset.browse; state.open = null; renderBody(true); return saveHash(); }
  if (e.target.closest("[data-back]")) { buzz(4); state.open = null; renderBody(true); return saveHash(); }
  const bp = e.target.closest("[data-bplay]"); if (bp) { buzz(5); return playPage(null, bp.dataset.bplay === "shuffle"); }
  const row = e.target.closest(".trk");
  if (row && row.closest("[data-blist]")) { buzz(5); return row.dataset.id === state.sel && state.plist?.id?.startsWith("page:") ? togglePlay() : playPage(row.dataset.id); }
  if (row) { buzz(5); const id = row.dataset.id; return id === state.sel ? togglePlay() : select(id, { play: true, fly: true, keepScroll: true, from: state.view, tuned: !!row.closest(".tunes") }); }
  const sc = e.target.closest("[data-scope]"); if (sc) { e.stopPropagation(); buzz(4); const n = A.graph.byId.get(sc.dataset.scope) ?? A.graph.root; A.focus(n.id); return showNode(n); }
  const h = e.target.closest("[data-focus]"); if (h) { buzz(4); return A.focus(h.dataset.focus); }
  const desc = e.target.closest(".desc"); if (desc) return desc.classList.toggle("open");
  const more = e.target.closest("[data-more]"); if (more) { more.outerHTML = (result.hits.filter((x) => grpOf(x.t) === more.dataset.more).slice(result.ranked ? 40 : 30).map((x, i) => rowHTML(x.t, i)).join("")); return; }
  if (e.target.closest("#web")) return searchWeb();
  const mn = e.target.closest("[data-mine]"); if (mn) { buzz(5); return mn.dataset.mine === "regrant" ? mineDo("your folder", (B, p) => B.regrantFolder(p).then((r) => ((mine.regrant = false), r))) : mineMenu(); }
  const mp = e.target.closest("[data-mpl]"); if (mp) { buzz(5); return playMine(mp.dataset.mpl); }
  const ph = e.target.closest("[data-plheart]"); if (ph) { e.stopPropagation(); buzz(8); const p = social.room.playlists.find((x) => x.id === ph.dataset.plheart); return p && social.likePlaylist(p.id, !p.liked); }
  const pp = e.target.closest("[data-plplay]"); if (pp) { buzz(5); return playPlaylist(pp.dataset.plplay); }
  const px = e.target.closest("[data-plx]"); if (px) { buzz(5); await social.unpublish(px.dataset.plx).catch(() => {}); return toast("Playlist unpublished"); }
  const rb = e.target.closest("[data-radio]"); if (rb) return startRadio(rb.dataset.radio);
  const lm = e.target.closest("[data-lmix]"); if (lm) { buzz(5); return mixAct(lm.dataset.lmix, lm.dataset.k); }
  const act = e.target.closest("[data-act]")?.dataset.act, t = state.sel && byId.get(state.sel);
  if (!act || !t) return;
  if (act === "pick") pick(t.id);
  if (act === "credit") { await copy(creditLine(t)); toast("Credit line copied"); }
  if (act === "similar" && t.f && soundReady()) return setView("similar");
  if (act === "reseed") { reseed(); return renderBody(true); }
  if (act === "untune") { buzz(5); return untune(); }
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

// --- your own music (byom.js, loaded on first use; never on the TV) -----------------------------------
const byom = () => import("./byom.js");
const mine = { plists: [], regrant: false, busy: "" };
const mineIds = () => all.filter((t) => t.src === "mine").map((t) => t.id);
function addMine({ tracks, playlists }, from) {
  for (const t of tracks) { const o = byId.get(t.id); if (o?.src === "mine") Object.assign(o, { audio: t.audio, art: t.art }); } // a rescan mints fresh blob URLs
  const fresh = tracks.filter((t) => !byId.has(t.id)).map(prep);
  if (fresh.length) { all = [...all, ...fresh]; fresh.forEach((t) => byId.set(t.id, t)); A.setTracks(all); $("#count").textContent = all.length.toLocaleString(); }
  const have = new Set(mine.plists.map((p) => p.id)); mine.plists.push(...playlists.filter((p) => p.ids.length && !have.has(p.id)));
  const need = fresh.filter((t) => !t.noEmbed); // Spotify's terms bar its data from ML models: words only
  if (need.length && modelReady()) embed(need.map((t) => t._text)).then((vs) => vs.forEach((v, i) => (need[i].v = v))).catch(() => {});
  if (from) toast(fresh.length ? `+${fresh.length.toLocaleString()} of your tracks from ${from}` : `Nothing new from ${from}`);
  run({ fly: !!fresh.length, scroll: false });
}
async function mineDo(kind, fn) {
  if (mine.busy) return toast("Still loading your music…");
  mine.busy = kind; renderBody(false);
  const prog = (n, of) => { mine.busy = `${kind} · ${n.toLocaleString()}${of ? " of " + of.toLocaleString() : ""}`; const b = body.querySelector(".minecta small"); if (b) b.textContent = "Loading " + mine.busy + "…"; };
  try { addMine(await fn(await byom(), prog), kind); } catch (e) { if (e.name !== "AbortError") toast(e.message); }
  mine.busy = ""; renderBody(false);
}
function pickFiles(B, prog) { // phones and browsers without folder handles: a file picker, kept in IndexedDB
  return new Promise((ok, no) => {
    const i = Object.assign(document.createElement("input"), { type: "file", multiple: true, accept: "audio/*,.m3u,.m3u8,.xspf,.flac,.opus" });
    if (!matchMedia("(pointer: coarse)").matches) i.webkitdirectory = true; // desktop Firefox/Safari: a whole folder
    i.onchange = () => (i.files.length ? B.addFiles(i.files, prog).then(ok, no) : no(Object.assign(new Error(""), { name: "AbortError" })));
    i.click();
  });
}
async function mineMenu() {
  const B = await byom(), s = await B.sources(), any = s.dir || s.files || s.plex || s.spotify;
  const m = document.createElement("div"); m.className = "castmenu";
  m.innerHTML = `<div class="cm"><b>Bring your own music</b>
    <button data-m="files"><i>▤</i><span>${B.canKeepFolder() ? "A music folder" : "Music files"}<small>${B.canKeepFolder() ? "Your VLC or music folder · playlists come along" : "Pick songs and .m3u / .xspf playlists"}</small></span></button>
    <button data-m="plex"><i>▶</i><span>Plex<small>${s.plex ? "Signed in · tap to reload" : "Sign in with plex.tv · streams from your server"}</small></span></button>
    <button data-m="spotify" ${B.SPOTIFY_ID ? "" : "disabled"}><i>●</i><span>Spotify<small>${!B.SPOTIFY_ID ? "Coming soon" : s.spotify ? "Signed in · tap to reload" : "Liked songs and playlists · plays in Spotify (Premium)"}</small></span></button>
    ${any ? `<button data-m="forget" class="ghost">Forget my music on this device</button>` : ""}</div>`;
  document.body.append(m); requestAnimationFrame(() => m.classList.add("on"));
  const close = () => { m.classList.remove("on"); setTimeout(() => m.remove(), 250); };
  m.onclick = (e) => {
    const b = e.target.closest("button"); if (!b && e.target !== m) return; close(); if (!b) return; buzz(5);
    navigator.storage?.persist?.().catch(() => {}); // a library shouldn't be evicted under storage pressure
    const k = b.dataset.m;
    if (k === "files") mineDo("your files", (B, p) => (B.canKeepFolder() ? B.addFolder(p) : pickFiles(B, p))); // the picker must open inside this tap
    const tab = k === "plex" && !s.plex ? window.open("about:blank", "_blank") : null; // opened inside the tap, or popup blockers eat it
    if (k === "plex") mineDo("Plex", async (B, p) => { if (!s.plex) { toast("Sign in on the Plex tab, then come back"); await B.plexSignIn((u) => (tab ? (tab.location.href = u) : window.open(u, "_blank"))); } return B.plexLibrary((await B.kv.get("plex")).token, p); });
    if (k === "spotify") s.spotify ? mineDo("Spotify", (B, p) => B.spotifyLibrary(p)) : B.spotifySignIn();
    if (k === "forget") forgetMine(B);
  };
}
async function forgetMine(B) {
  for (const k of ["files", "plex", "spotify"]) await B.forget(k);
  if (state.sel && byId.get(state.sel)?.src === "mine") { audio.pause(); state.sel = null; }
  all = all.filter((t) => t.src !== "mine"); byId = new Map(all.map((t) => [t.id, t])); mine.plists = []; mine.regrant = false;
  A.setTracks(all); $("#count").textContent = all.length.toLocaleString(); toast("Your music is gone from this device"); run({ fly: true });
}
const mineHTML = () => {
  if (cast.isTV) return "";
  const n = mineIds().length, sub = mine.busy ? `Loading ${mine.busy}…` : mine.regrant ? "Tap to allow your music folder again" : n ? "Add more: a folder, Plex or Spotify" : "Your files or VLC folder, Plex or Spotify";
  return `<section class="mine"><button class="pcta minecta ${mine.busy ? "busy" : ""}" data-mine="${mine.regrant ? "regrant" : "menu"}"><i></i><span><b>${n ? `Your music · ${n.toLocaleString()}` : "Bring your own music"}</b><small>${sub}</small></span></button>
    ${n ? `<div class="mpls"><button data-mpl="all">All yours<small>${n}</small></button>${mine.plists.map((p) => `<button data-mpl="${esc(p.id)}">${esc(p.name)}<small>${p.ids.length}</small></button>`).join("")}</div>` : ""}</section>`;
};
function playMine(id) {
  const p = id === "all" ? { id: "all", name: "Your music", ids: mineIds() } : mine.plists.find((x) => x.id === id); if (!p) return;
  const ids = p.ids.filter((x) => byId.has(x)); if (!ids.length) return toast("None of these songs loaded");
  state.plist = { id: "mine:" + p.id, name: p.name, ids }; state.radio = null; state.queue = "playlist";
  toast(`Playing “${p.name}”`); select(ids[0], { play: true, fly: true, keepScroll: true }); renderBody(false);
}
// Spotify audio never reaches this page: it plays on your Spotify Connect device; the queue rides along.
async function spotifyGo(t) {
  const L = state.plist?.ids ?? [t.id], i = Math.max(0, L.indexOf(t.id)), uris = L.slice(i, i + 50).map((x) => byId.get(x)).filter((x) => x?.provider === "spotify").map((x) => x.uri);
  try { const B = await byom(), dev = await B.spotifyPlay(uris.length ? uris : [t.uri]); spotify.on = true; toast(`Playing on ${dev}`); } catch (e) { toast(e.message); }
  renderPlayer();
}
const spotify = { on: false };

// --- player -------------------------------------------------------------------------------------
// ccMixter serves mp3s only with its own Referer, so deployed builds stream them through /api/ccm
// (tools/sound-atlas-api/ccm.js). Catalogue paths are relative to the catalogue.
const CCM = "https://ccmixter.org/content/";
const proxied = !/^(localhost|127\.|\[::1\])/.test(location.hostname) && location.protocol === "https:";
const streamUrl = (t) => (proxied && t.audio.startsWith(CCM) ? "/api/ccm?p=" + encodeURIComponent(t.audio.slice(CCM.length)) : new URL(t.audio, new URL(base, document.baseURI)).href);
function select(id, { play = false, fly = false, keepScroll = false, from = null, view = null, tuned = false } = {}) {
  const t = byId.get(id); if (!t) return;
  if (!tuned && tune && id !== state.sel) tune = null; // picking a song by hand ends the tune
  const changed = state.sel !== id;
  state.sel = id; A.focusId = id;
  if (from === "library" || from === "similar") { state.queue = from; state.radio = null; state.plist = null; } // started from a list: that list is the queue
  else if (from === null && view) state.queue = "library";
  if (view) state.view = lastView = view;
  if (changed && state.queue !== "similar") reseed();
  if (changed && spotify.on && t.provider !== "spotify") { spotify.on = false; byom().then((B) => B.spotifyPause()); }
  if (changed && t.src === "mine" && cast.send.on) { cast.stop(); toast("Your own music plays on this device; the TV has the shared catalogue"); }
  if (changed) { if (t.audio) { audio.src = streamUrl(t); audio.load(); } else { audio.pause(); audio.removeAttribute("src"); audio.load(); } }
  if (play && t.provider === "spotify") spotifyGo(t);
  else if (play) audio.play().catch((e) => { if (e.name !== "AbortError") toast("Tap ▶ to play"); });
  if (changed) {
    nbrs = soundReady() ? neighbours(t, all, 8) : [];
    const top = nbrs[0]?.score || 1;
    A.setLinks(nbrs.length ? id : null, nbrs.map((n) => ({ id: n.t.id, w: Math.max(0, (n.score / top - 0.6) / 0.4) })));
  }
  if (fly) focusSel();
  A.setPlaying(playState());
  renderViews(); if (tuned && tuning) { tunePaint = true; paintTune(); } else { const st = body.scrollTop; renderBody(false); if (keepScroll) body.scrollTop = st; else body.scrollTop = 0; }
  renderPlayer(); saveHash();
  if (!wide() && sh.target === "peek" && !play) sheetTo("half");
}
function togglePlay() { if (!state.sel) { const first = result.hits[0]?.t; return first && select(first.id, { play: true, fly: true }); } const cur = byId.get(state.sel); if (cur?.provider === "spotify") return spotify.on ? (spotify.on = false, byom().then((B) => B.spotifyPause()), renderPlayer()) : spotifyGo(cur); audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
function step(d) {
  if (state.radio && d > 0) { // radio only goes forward; back walks what it already played
    const t = social.radioNext({ kind: state.radio, cur: byId.get(state.sel), all: search(all, { feels: state.feels, bands: state.bands, cc0: state.cc0 }).hits.map((h) => h.t), byId, playedIds, neighbours });
    if (t) { radioTrail.push(t.id); return select(t.id, { play: true, fly: true, keepScroll: true }); }
  }
  if (state.radio && d < 0 && radioTrail.length > 1) { radioTrail.pop(); return select(radioTrail[radioTrail.length - 1], { play: true, fly: true, keepScroll: true }); }
  if (state.plist) { const L = state.plist.ids, i = L.indexOf(state.sel); return select(L[(i + d + L.length) % L.length], { play: true, fly: true, keepScroll: true }); }
  stepList(d);
}
const radioTrail = [];
function stepList(d) { const list = state.queue === "similar" && simSeed ? [simSeed, ...sim.map((n) => n.t.id)] : result.hits.map((h) => h.t.id), i = list.indexOf(state.sel); const n = list[(i + d + list.length) % list.length]; if (n) select(n, { play: true, fly: true, keepScroll: true }); }
function renderPlayer() {
  const t = state.sel && byId.get(state.sel), p = $("#player");
  p.style.setProperty("--c", t ? tone(t) : "#5fd3dc"); $("#views").style.setProperty("--c", t ? tone(t) : "#5fd3dc");
  const pt = $("#pt"), fresh = (t?.id ?? null) !== renderPlayer.id; renderPlayer.id = t?.id ?? null;
  if (fresh) nowPlaying(t);
  if (fresh && !reduced && !pt.classList.contains("sw-l") && !pt.classList.contains("sw-r")) { pt.classList.remove("in"); void pt.offsetWidth; pt.classList.add("in"); }
  pt.innerHTML = t ? `<b>${esc(t.title)}</b><small>${bpmOf(t) ? `${bpmOf(t)} bpm · ` : ""}${t.f?.camelot ? `${t.f.camelot} · ` : ""}${esc(t.author)}</small>` : `<b>Tap a dot</b><small>to hear it</small>`; // the header already names the app and the count; #pt is ~80 px wide at 360
  // The comfortable player's detail line (hidden at peek): what kind of song this is and whether you may use it.
  const F = t && feelById[t.feel], sty = t && styleName(t.family, t.style);
  $("#pm").innerHTML = t ? [F && `<span class="f"><i></i>${esc(F.name)}</span>`, sty && `<span>${esc(sty)}</span>`, t.dur && `<span>${mmss(t.dur)}</span>`, t.license && `<span class="cc">${esc(t.license)}</span>`].filter(Boolean).join("") : `<span>Drag the map to wander · search a vibe</span>`;
  $("#pp").innerHTML = audio.paused ? ICON.play : ICON.pause;
  $("#ph").classList.toggle("on", !!t && state.picks.has(t.id));
  const lk = t && social.room.likes[t.id]; $("#ph").dataset.n = lk ? social.compact(lk) : "";
  const here = t && social.room.now.find(([id]) => id === t.id)?.[1]; // people (you included) on this track right now
  $("#pt small")?.insertAdjacentHTML("afterbegin", here > 1 ? `<em class="with">${here - 1} with you</em> · ` : ""); // lead: the tail of this line is ellipsized on phones
  $("#pr").classList.toggle("on", !!state.radio); $("#pr").title = state.radio ? `${state.radio === "ear" ? "By-ear" : "Crowd"} radio on` : "Radio";
}
const bar = $("#bar"), thumb = $("#thumb"), tc = $("#tc"); let scrubK = null; // while scrubbing, the finger (not the audio) places the thumb
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
  const d = audio.duration, c = scrubK != null && d ? scrubK * d : audio.currentTime;
  const k = d ? c / d : 0; bar.style.transform = `scaleX(${k})`; thumb.style.transform = `translate3d(${(k * 100).toFixed(2)}%, 0, 0)`; // compositor-only
  const label = `${mmss(c)} / ${mmss(d)}`; if (label !== tc.textContent) tc.textContent = label; // text changes re-layout: once a second, not per frame
  if (!audio.paused) { beatFrame(); requestAnimationFrame(tick); }
}
const syncPlay = () => { A.setPlaying(playState()); renderPlayer(); if (audio.paused) restPulse(); const r = body.querySelector(".trk.sel"); if (r) { const t = byId.get(state.sel); r.classList.toggle("playing", !audio.paused); r.querySelector(".pl").innerHTML = !audio.paused ? `<span class="eq"><i></i><i></i><i></i></span>` : ICON.play; r.style.setProperty("--beat", (60 / (t?.bpm || 100)).toFixed(3) + "s"); } tick(); };
audio.addEventListener("play", () => { if (state.sel) { playedIds.add(state.sel); social.played(state.sel); if (state.recent[0] !== state.sel) { state.recent = browse.remember(state.recent, state.sel); localStorage.setItem("sa-recent", JSON.stringify(state.recent)); } } social.pulse(); });
audio.addEventListener("pause", () => social.pulse());
audio.addEventListener("play", syncPlay); audio.addEventListener("pause", syncPlay); audio.addEventListener("loadedmetadata", tick);
audio.addEventListener("ended", () => partyEnded(() => step(1))); // in a room, whoever set the song picks the next
for (const k of ["play", "pause", "seeked", "loadstart"]) audio.addEventListener(k, () => heard(k)); // what you do leads the room
audio.addEventListener("error", () => { if (audio.src && state.sel) toast("This one won't stream here; open its source ↗"); });
$("#pp").onclick = (e) => { e.stopPropagation(); buzz(5); togglePlay(); };
$("#pn").onclick = (e) => { e.stopPropagation(); step(1); };
$("#pv").onclick = (e) => { e.stopPropagation(); step(-1); };
$("#ph").onclick = (e) => { e.stopPropagation(); if (state.sel) pick(state.sel); };
$("#ps").onclick = (e) => { e.stopPropagation(); shareLink(); };
$("#pr").onclick = (e) => { e.stopPropagation(); startRadio(state.radio ?? "ear"); };
$("#pc").onclick = (e) => { e.stopPropagation(); buzz(5); castMenu(); };
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
{ // scrub: the thumb tracks the finger every move; the stream seeks once, on release (a seek per move stutters)
  const sc = $(".scrub"); let on = false;
  const tr = sc.querySelector(".track"), at = (e) => { const r = tr.getBoundingClientRect(); scrubK = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); tick(); };
  sc.addEventListener("pointerdown", (e) => { e.stopPropagation(); on = true; sc.setPointerCapture(e.pointerId); sc.classList.add("on"); at(e); });
  sc.addEventListener("pointermove", (e) => on && at(e));
  const off = (e) => { if (on && e.type === "pointerup" && audio.duration) audio.currentTime = scrubK * audio.duration; on = false; scrubK = null; sc.classList.remove("on"); tick(); };
  sc.addEventListener("pointerup", off); sc.addEventListener("pointercancel", off);
}
addEventListener("keydown", (e) => {
  if (e.target === q) return;
  if (cast.isTV) { // TV remote: OK / play-pause keys, channel or up/down for songs, left/right to seek
    if (tvQRDismiss()) { e.preventDefault(); return; } // first press (Back included) only clears the pairing code
    const k = { 13: " ", 415: " ", 19: " ", 10252: " ", 417: "ArrowDown", 412: "ArrowUp", 427: "ArrowDown", 428: "ArrowUp" }[e.keyCode]; if (k && k !== e.key) { e.preventDefault(); if (k === " ") return togglePlay(); return step(k === "ArrowDown" ? 1 : -1); }
    if (e.key === "Enter") { e.preventDefault(); return togglePlay(); }
  }
  if (e.key === "/") { e.preventDefault(); q.focus(); }
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  if (e.key === "ArrowDown" || e.key === "j") step(1);
  if (e.key === "ArrowUp" || e.key === "k") step(-1);
  if (e.key === "ArrowRight" && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
  if (e.key === "Escape") { A.focus("root"); showNode(null); }
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
  if (state.sel && !(pretty && !share?.base)) h.set("t", state.sel); // deployed: the path names the song
  if (state.lens !== "feel") h.set("l", state.lens);
  if (state.view !== "library") h.set("v", state.view);
  if (state.plist && !state.plist.id.startsWith("page:")) h.set("pl", state.plist.id);
  if (state.view === "library" && state.browse !== "feel") h.set("br", state.browse);
  if (state.view === "library" && state.open) h.set("bo", state.open);
  return h.toString();
}
let hashT = 0;
function saveHash() { clearTimeout(hashT); hashT = setTimeout(() => history.replaceState(null, "", urlPath() + location.search + (hashOf() ? "#" + hashOf() : "")), 250); }
// --- pretty links: /song/<title>-by-<artist>, /room/<code> (links.js; the deploy rewrites them to the app) --
const pretty = !!document.querySelector("base[href='/']"); // the deployed bundle; the lab page keeps hash links
let slugs = { bySlug: new Map(), byId: new Map() };
const prettyOn = () => pretty && !share?.base; // a protected deploy's entry link only carries a hash through
function urlPath() {
  if (!prettyOn()) return location.pathname;
  if (party.on) return "/room/" + party.room;
  const s = state.sel && slugs.byId.get(state.sel); return s ? "/song/" + s : "/";
}
function songLink(t) {
  if (prettyOn()) return `${location.origin}/song/${slugs.byId.get(t.id)}`;
  return (share?.base ?? location.origin + location.pathname) + "#t=" + encodeURIComponent(t.id);
}
const roomLink = (code) => (prettyOn() ? `${location.origin}/room/${code}` : (share?.base ?? location.origin + location.pathname) + "#room=" + code);
const appLink = () => (prettyOn() ? location.origin + "/" : share?.base ?? location.origin + location.pathname);
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
  if (browse.MODES.some(([id]) => id === h.get("br"))) state.browse = h.get("br");
  if (/^(a|al|g):/.test(h.get("bo") ?? "")) state.open = h.get("bo");
  const shared = (h.get("p") ?? "").split(",").filter((id) => byId.has(id));
  if (shared.length) { shared.forEach((id) => state.picks.add(id)); toast(`${shared.length} shared picks · tap ♥ Liked to see them`); } // the full atlas still loads
  pendingPlist = h.get("pl"); pendingRoom = h.get("room");
  const p = readPath(location.pathname); // a pretty link names the song, room or playlist in its path
  if (p?.kind === "room") pendingRoom = p.k;
  if (p?.kind === "playlist") pendingPlist = p.k;
  if (p?.kind === "song") return slugs.bySlug.get(p.k)?.id ?? h.get("t");
  return h.get("t");
}
let pendingPlist = null, pendingRoom = null;
// --- share sheet: QR code, copy, the system share sheet, and "Listen together" -------------------------
const qr = (text) => renderSVG(text, { border: 2, pixelSize: 8, whiteColor: "#ece8df", blackColor: "#0d1112" });
const bare = (u) => u.replace(/^https?:\/\//, "");
function sheetUI(cls, html) {
  document.querySelector(".shm")?.close();
  const m = document.createElement("div"); m.className = `shm ${cls}`; m.innerHTML = `<div class="shc" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(m); requestAnimationFrame(() => m.classList.add("on"));
  m.close = () => { m.classList.remove("on"); setTimeout(() => m.remove(), 260); };
  m.addEventListener("click", (e) => { if (e.target === m) m.close(); });
  return m;
}
async function sendLink(url, title, what) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  await copy(url); toast(`${what} copied`);
}
function shareLink() {
  const t = state.sel && byId.get(state.sel), url = t ? songLink(t) : appLink(), title = t ? `${t.title} · Sound Atlas` : "Sound Atlas";
  buzz(8);
  const m = sheetUI("share", `
    <div class="shq" aria-label="QR code for the link">${qr(url)}</div>
    <div class="shn"><b>${esc(t ? t.title : "Sound Atlas")}</b><small>${esc(t ? t.author : `${all.length.toLocaleString()} free songs by feel`)}</small></div>
    <button class="shu" data-a="copy" title="Copy link">${esc(bare(url))}</button>
    <div class="sha"><button data-a="copy">Copy link</button>${navigator.share ? `<button data-a="send">Share…</button>` : ""}</div>
    <button class="pcta" data-a="party"><i></i><span><b>${party.on ? `Room ${party.room.toUpperCase()} · invite` : "Listen together"}</b><small>${party.on ? `${party.peers} speaker${party.peers === 1 ? "" : "s"} in sync` : "Every phone in the room plays this in sync, like one speaker system"}</small></span></button>`);
  m.onclick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return; buzz(5);
    if (a === "copy") { await copy(url); toast(t ? `Link to “${t.title}” copied` : "Link copied"); m.close(); }
    if (a === "send") { m.close(); sendLink(url, title, "Link"); }
    if (a === "party") { if (!party.on) await startParty(roomId()); roomSheet(); }
  };
}

// --- listen together (party.js) ----------------------------------------------------------------------------
const partyHooks = {
  sid: social.sid, audio, current: () => state.sel,
  apply: (st) => { if (byId.has(st.t)) select(st.t, { play: st.playing, fly: true, keepScroll: true }); },
  onChange: () => renderParty(), blocked: () => toast("Tap ▶ to hear the room", 4000),
};
async function startParty(code) {
  try { await joinParty(code, partyHooks); haptic("keep"); saveHash(); renderParty(); }
  catch { toast("Couldn't reach the room right now"); }
}
function renderParty() {
  let b = $("#party");
  if (!b) { b = document.createElement("button"); b.id = "party"; b.className = "live party"; b.setAttribute("aria-label", "Listen together room"); $(".row1").insertBefore(b, $("#live")); b.onclick = () => { buzz(5); roomSheet(); }; }
  b.hidden = !party.on;
  if (party.on) b.innerHTML = `<i></i><b>${party.room.toUpperCase()}</b><span class="sep"></span>${party.peers}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4v12M3 7v6M11 6v8M15 8v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const rs = document.querySelector(".shm.room .shs"); if (rs) rs.textContent = roomStatus();
}
const roomStatus = () => { const d = drift(); return `${party.peers} speaker${party.peers === 1 ? "" : "s"} in the room${d != null && !audio.paused ? ` · this one within ${d} ms` : ""}`; };
function roomSheet() {
  if (!party.on) return;
  const url = roomLink(party.room), code = party.room.toUpperCase();
  const m = sheetUI("room", `
    <div class="sht">Listen together</div>
    <div class="shq" aria-label="QR code to join">${qr(url)}</div>
    <div class="rcode">${code.slice(0, 3)}<span>${code.slice(3)}</span></div>
    <p class="shs">${roomStatus()}</p>
    <label class="nudge"><span>Speaker delay</span><input type="range" min="-300" max="300" step="10" value="${party.nudge}" /><output>${party.nudge > 0 ? "+" : ""}${party.nudge} ms</output></label>
    <small class="nhelp">On a Bluetooth speaker and it sounds late? Slide right until it lines up.</small>
    <div class="sha"><button data-a="copy">Copy invite</button>${navigator.share ? `<button data-a="send">Share…</button>` : ""}<button data-a="leave" class="ghost">Leave</button></div>`);
  const r = m.querySelector("input"), o = m.querySelector("output");
  r.oninput = () => { const v = +r.value; o.textContent = `${v > 0 ? "+" : ""}${v} ms`; setNudge(v); if (v % 50 === 0) buzz(3); };
  const live = setInterval(() => { if (!m.isConnected) return clearInterval(live); renderParty(); }, 1000);
  m.onclick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return; buzz(5);
    if (a === "copy") { await copy(url); toast(`Invite to room ${code} copied`); }
    if (a === "send") sendLink(url, `Listen together · Sound Atlas room ${code}`, "Invite");
    if (a === "leave") { leaveParty(); m.close(); saveHash(); toast("Left the room"); }
  };
}
// Arriving on a room link: joining needs a tap (browsers start sound only inside one).
function joinPrompt(code) {
  const m = sheetUI("join", `
    <div class="sht">Listen together</div>
    <div class="rcode">${code.slice(0, 3).toUpperCase()}<span>${code.slice(3).toUpperCase()}</span></div>
    <p class="shs">Join and this phone becomes one of the room's speakers, playing the same song in sync.</p>
    <div class="sha"><button data-a="join" class="go">Join the room</button><button data-a="no" class="ghost">Not now</button></div>`);
  m.onclick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return; buzz(5); m.close();
    if (a === "join") { await startParty(code); if (party.on) toast(`In room ${code.toUpperCase()} · ${party.peers} speaker${party.peers === 1 ? "" : "s"}`); }
    else saveHash();
  };
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const t = Object.assign(document.createElement("textarea"), { value: text }); document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}

// --- boot ---------------------------------------------------------------------------------------
{ const ro = new ResizeObserver(() => { measure(); if (!wide() && !sh.drag) sheetTo(sh.target); atlasRefit(); }); ro.observe($(".top")); ro.observe($(".dock")); ro.observe(rail); }  // fonts load, lens row fills in
// The player changes height with its density step: re-measure so peek still ends at the view switch. Only the
// sheet re-aims; the map stays put (a title wrapping to two lines must not move the camera).
new ResizeObserver(() => fitSubs()).observe(body);
new ResizeObserver(() => { measure(); if (!wide() && !sh.drag && !sh.raf) sh.raf = requestAnimationFrame(sheetStep); }).observe($("#player"));
addEventListener("resize", () => { measure(); if (!wide()) { sh.y = snaps()[sh.target]; setSheetY(sh.y); } else { sheet.style.transform = rail.style.transform = ""; } atlasRefit(); });
// Phones get the whole screen: browsers only grant fullscreen inside a user gesture, so a tap
// anywhere asks for it. Skipped when installed (the manifest already launches fullscreen). Leaving it
// (back gesture / swipe) is respected on the spot; the hint comes back with the next touch, so the tap
// after that restores fullscreen. "Never mind" turns it off on this device. The hint's text lets taps through.
if (!cast.isTV && matchMedia("(pointer: coarse)").matches && !matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches && document.documentElement.requestFullscreen) {
  const off = () => localStorage.getItem("sa-fs") === "no";
  const fsHint = (delay, armNow) => {
    if (off() || document.fullscreenElement || $(".fsh")) return;
    const hint = document.createElement("div"); hint.className = "fsh";
    hint.innerHTML = `<span>Tap anywhere to go fullscreen</span><button type="button">Never mind</button>`; document.body.append(hint);
    const done = () => { removeEventListener("click", go, true); removeEventListener("pointerup", go, true); hint.classList.remove("on"); setTimeout(() => hint.remove(), 400); };
    const go = (e) => { if (hint.contains(e.target)) return; done(); if (!document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {}); };
    hint.querySelector("button").onclick = (e) => { e.stopPropagation(); buzz(5); localStorage.setItem("sa-fs", "no"); done(); };
    // centred on the open map: below the header, above the Sort/filter rail (which sits mid-screen on phones)
    setTimeout(() => {
      if (!hint.isConnected) return; const a = $(".top").getBoundingClientRect().bottom, z = rail.getBoundingClientRect().top;
      hint.style.top = `${Math.round((a + z) / 2 - hint.offsetHeight / 2)}px`; hint.classList.add("on"); if (!armNow) arm();
    }, delay);
    const arm = () => { addEventListener("click", go, true); addEventListener("pointerup", go, true); }; // a drag on the atlas never makes a click
    if (armNow) arm();
  };
  fsHint(700, true); // after the sheet (and the rail riding on it) has risen into place
  // Left fullscreen: the next touch (once that gesture ends) brings the hint back; it doesn't go fullscreen itself.
  const back = () => { removeEventListener("pointerdown", back, true); addEventListener("pointerup", () => fsHint(350), { capture: true, once: true }); };
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && !off()) addEventListener("pointerdown", back, true); else removeEventListener("pointerdown", back, true); });
}

// --- casting: phone -> TV (cast.js) ---------------------------------------------------------------
function castMenu() {
  if (cast.send.on) return cast.stop();
  const m = document.createElement("div"); m.className = "castmenu"; const tv = cast.savedTV();
  m.innerHTML = `<div class="cm"><b>Play on a TV</b>
    <button data-c="samsung"><i>▣</i><span>${esc(tv?.name ?? "Samsung TV")}<small>${tv ? "Smart View · paired" : "Smart View · pair once"}</small></span></button>
    <button data-c="google" ${cast.castSDKReady() ? "" : "disabled"}><i>⌁</i><span>Chromecast · Google TV<small>${cast.castSDKReady() ? "Picks a Cast screen" : window.chrome ? "Loading Cast…" : "Needs Chrome"}</small></span></button>
    ${airplay.can ? `<button data-c="airplay" ${airplay.avail ? "" : "disabled"}><i>◭</i><span>Apple TV · AirPlay<small>${airplay.on ? "Playing over AirPlay · pick again to switch" : airplay.avail ? "Picks an AirPlay TV or speaker" : "No AirPlay screen found"}</small></span></button>` : ""}
    ${tv ? `<button data-c="forget" class="ghost">Forget ${esc(tv.name ?? "this TV")}</button>` : ""}</div>`;
  document.body.append(m); requestAnimationFrame(() => m.classList.add("on"));
  const close = () => { m.classList.remove("on"); setTimeout(() => m.remove(), 250); };
  m.onclick = (e) => {
    const b = e.target.closest("button"); if (!b && e.target !== m) return; close(); if (!b) return; buzz(5);
    if (b.dataset.c === "samsung") cast.castSamsung(); // Smart View: the Sound Atlas TV app
    if (b.dataset.c === "google") cast.castGoogle(); // must start inside this tap: it opens the Cast picker
    if (b.dataset.c === "airplay") airplayPick(); // also inside the tap: Safari only opens its picker on a gesture
    if (b.dataset.c === "forget") { cast.forgetTV(); toast("TV forgotten"); }
  };
}
// Apple TV (and any AirPlay 2 TV or speaker, the QN85B included): Safari and iOS browsers route this page's
// audio there with their own picker; Now Playing (Media Session) puts the song and artwork on the TV screen.
// tvOS has no web view, so the map itself reaches an Apple TV only by mirroring the iPhone.
const airplay = { can: !!window.WebKitPlaybackTargetAvailabilityEvent && !!audio.webkitShowPlaybackTargetPicker, avail: false, on: false };
if (airplay.can) {
  audio.setAttribute("x-webkit-airplay", "allow");
  audio.addEventListener("webkitplaybacktargetavailabilitychanged", (e) => { airplay.avail = e.availability === "available"; });
  audio.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", () => {
    airplay.on = !!audio.webkitCurrentPlaybackTargetIsWireless; $("#pc").classList.toggle("on", airplay.on || cast.send.on);
    toast(airplay.on ? "Playing over AirPlay" : "Back on this phone");
  });
}
function airplayPick() {
  if (!state.sel) { const first = result.hits[0]?.t; if (first) select(first.id, { fly: true }); } // the picker needs a source
  audio.webkitShowPlaybackTargetPicker();
}
if ("mediaSession" in navigator) { // lock screens, Now Playing on Apple TV / AirPlay speakers, TV remotes, headsets
  const ms = navigator.mediaSession, on = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { /* action unsupported here */ } };
  on("play", () => audio.play().catch(() => {})); on("pause", () => audio.pause());
  on("nexttrack", () => step(1)); on("previoustrack", () => step(-1));
  on("seekto", (d) => { if (isFinite(d.seekTime)) audio.currentTime = d.seekTime; });
}
function nowPlaying(t) {
  if (!t || !window.MediaMetadata || !navigator.mediaSession) return;
  const icon = new URL("sound-atlas-icon.png", share?.base ?? location.origin + "/").href;
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.author ?? "", album: t.album || "Sound Atlas", artwork: [{ src: icon, sizes: "512x512", type: "image/png" }] });
}
function castFollow(tv, tage) { // the TV moved on by itself: the phone (muted) catches up
  if (tv.t && tv.t !== state.sel && byId.has(tv.t)) select(tv.t, { play: tv.playing, fly: true, keepScroll: true });
  const pos = (tv.pos ?? 0) + (tv.playing ? tage / 1000 : 0);
  if (Math.abs(audio.currentTime - pos) > 3 && isFinite(pos)) audio.currentTime = pos;
  if (tv.playing && audio.paused) audio.play().catch(() => {}); else if (!tv.playing && !audio.paused) audio.pause();
}
function tvApply(cmd, cage) { // the phone said play this, here
  if (cmd.t && cmd.t !== state.sel && byId.has(cmd.t)) select(cmd.t, { fly: true, view: "track" });
  const pos = (cmd.pos ?? 0) + (cmd.playing ? cage / 1000 : 0), go = () => { if (isFinite(pos) && Math.abs(audio.currentTime - pos) > 1.5) audio.currentTime = pos; };
  if (audio.readyState >= 1) go(); else audio.addEventListener("loadedmetadata", go, { once: true });
  if (cmd.playing) audio.play().catch((e) => { if (e.name !== "AbortError") toast("The TV blocked autoplay · press OK on the remote"); }); else audio.pause();
}
// On a fresh TV the map's own dots first assemble into the pairing QR (atlas formation); any remote key, a
// click or a phone pairing releases them back into the map, and the code shrinks to a corner chip.
const tvQR = { on: false, done: false };
function tvQRDismiss() {
  if (!tvQR.on) return false;
  tvQR.on = false; A.setFormation(null);
  const el = $("#tvcode"); if (el) { el.classList.remove("nodes"); el.classList.add("mini"); el.dataset.k = ""; if (tvBadge.last) tvBadge(tvBadge.last); }
  return true;
}
function tvBadge(st) { // unpaired: say how to cast here; QR = pairing link for the phone
  const { room, linked, ok } = st; tvBadge.last = st;
  const el = $("#tvcode") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "tvcode", className: "tvcode" }));
  el.classList.toggle("on", !linked);
  if (linked) tvQRDismiss();
  const key = `${room}|${ok}`; if (el.dataset.k === key) return; el.dataset.k = key;
  if (!room) { el.innerHTML = `<b>Sound Atlas TV</b><span>No cast room in the link.</span>`; return; }
  const p = new URLSearchParams(location.search), link = `${share?.base ?? location.origin + location.pathname}#tvpair=${[room, p.get("ip") ?? "", p.get("app") ?? "", p.get("name") ?? "TV"].join("~")}`;
  if (!tvQR.done && (tvQR.done = true) && !linked) { // only on the first status: never re-forms over a session in use
    const m = qrEncode(link, { ecc: "M", border: 0 }), cells = [];
    m.data.forEach((row, y) => row.forEach((on, x) => { if (on) cells.push([x, y]); }));
    tvQR.on = A.setFormation(cells, m.size); // false: too few songs to draw it, the panel keeps its own QR
    if (tvQR.on) { A.fitAll(600); addEventListener("pointerdown", () => tvQRDismiss(), { capture: true, once: true }); }
  }
  el.classList.toggle("nodes", tvQR.on);
  const hint = !ok ? "Reconnecting…" : tvQR.on ? "Scan the code on screen · any button to explore" : el.classList.contains("mini") ? "Cast code" : "or scan to pair this phone";
  el.innerHTML = `<div class="qr"></div><div><b>Cast from your phone</b><span>Open Sound Atlas on your phone, tap <em>Cast</em>, pick this TV and enter</span><code>${room.toUpperCase()}</code><small>${hint}</small></div>`;
  if (!tvQR.on) el.querySelector(".qr").innerHTML = qr(link);
}
if (cast.isTV) document.documentElement.classList.add("tv", "tv-" + cast.tvKind);

(async function boot() {
  measure(); sheetPointer();
  sh.y = innerHeight; sheetTo("peek");
  const cat = await loadCatalog(base).catch((e) => { body.innerHTML = `<div class="empty">Could not load the catalogue (${esc(e.message)}).</div>`; throw e; });
  share = await fetch(base + "share.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  all = cat.tracks; byId = new Map(all.map((t) => [t.id, t])); slugs = slugIndex(all);
  await loadSound(base, all); // optional: measured tempo/key/texture + CLAP neighbours
  loadLayers(base).then(() => { if (state.view === "track" && state.sel) renderBody(false); A.kick(); }); // optional: stems
  $("#count").textContent = all.length.toLocaleString();
  await document.fonts?.ready;
  A.setTracks(all); A.fitAll(1);
  if (!cast.isTV && new URLSearchParams(location.search).get("state") === "sa-spotify") await byom().then((B) => B.spotifyReturn()).then(() => (mine.spotifyNew = true), (e) => toast(e.message));
  const t = readHash(), v0 = state.view; setLens(state.lens, false);
  await run({ fly: !!(state.q || state.feels.size || [...state.gs.values()].some((s) => s.size) || state.picksOnly) });
  if (t && byId.has(t)) select(t, { fly: true, view: v0 === "library" ? "track" : v0 }); else renderViews();
  if (state.q) warmModel(); else if (!cast.isTV && !matchMedia("(pointer: coarse)").matches) setTimeout(warmModel, 2500); // TVs never search: no model on a 2 GB set; // phones load the model on first search focus
  renderPlayer();
  if (cast.isTV) { if (state.view === "library") setView("track", false); cast.receive({ sid: social.sid, audio, current: () => state.sel, apply: tvApply, next: () => step(1), onStatus: tvBadge }); }
  else cast.attach({ sid: social.sid, audio, current: () => state.sel, follow: castFollow, toast, haptic, onChange: () => { $("#pc").classList.toggle("on", cast.send.on); $("#pc").title = cast.send.on ? `Casting to ${cast.send.name} · tap to stop` : "Play on a TV"; } });
  if (!cast.isTV && pendingRoom && /^[a-z0-9]{6}$/i.test(pendingRoom)) joinPrompt(pendingRoom.toLowerCase()); // a TV's #room= is its cast room, not a Listen together invite
  social.join(() => ({ track: state.sel, playing: !audio.paused })).then(async () => {
    renderBody(false);
    if (pendingPlist) { await social.loadPlaylists(); if (social.room.playlists.some((p) => p.id === pendingPlist)) { setView("community"); const p = social.room.playlists.find((x) => x.id === pendingPlist); state.plist = { id: p.id, name: p.name, ids: p.tracks.filter((x) => byId.has(x)) }; toast(`“${p.name}” · tap ▶ to play`); renderBody(false); } }
  });
  if (!cast.isTV) byom().then(async (B) => {
    const s = await B.sources(); if (!(s.dir || s.files || s.plex || s.spotify)) return;
    const r = await B.restore(); mine.regrant = r.needsFolder; addMine(r, mine.spotifyNew ? "Spotify" : null); r.errors.forEach((m) => toast(m));
  }).catch((e) => toast("Your music: " + e.message));
  window.__sa = { party, mine, addMine, slugs: () => slugs, social, startRadio, playPlaylist, A, state, get all() { return all; }, get result() { return result; }, audio, mixer, modelReady, sheetTo, select, run, setView };
})();
