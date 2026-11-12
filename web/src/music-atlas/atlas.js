// Sound Atlas renderer: the Taste Atlas radial taxonomy (oss/taste-skill/examples/taste-atlas,
// root -> 01 feel -> 02 family -> 03 style -> 04 track) redrawn on <canvas> so ~1.5k tracks pan,
// pinch and fly at 60 fps on a phone. Tracks sit in the outer band of their style's wedge, slow on
// the inside, fast on the outside, so BPM reads as distance from the centre.
import { FEELS, FAMILIES, FAMILY_TINT, feelById, shade } from "./taxonomy.js";
import { pose, seedOf } from "./dance.js";

const ROWS = 7, SPACING = 15, GAP_FEEL = 5, GAP_STYLE = 1.4, DOT = 4.4;
const TAU = Math.PI * 2;
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x) => { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// `org` (sound.js organise) swaps ring 1 for a measurement (Camelot number, tempo band...), with its
// own sub-rings; null keeps the feel taxonomy. Leaves keep their track id either way, so switching
// organisation morphs every dot to its new wedge.
export function layout(tracks, org = null) {
  const root = { id: "root", level: 0, name: "Sound Atlas", children: [], a: 0, x: 0, y: 0 };
  const byId = new Map([["root", root]]);
  const node = (id, level, name, parent, extra) => {
    let n = byId.get(id);
    if (!n) { n = { id, level, name, parent, children: [], ...extra }; byId.set(id, n); parent.children.push(n); }
    return n;
  };
  const groups = new Map();
  const keyOf = org ? (t) => { const [a, b] = org.path(t); return `${org.of(t)}|${a[0]}|${b[0]}`; } : (t) => `${t.feel}|${t.family}|${t.style}`;
  for (const t of tracks) { const k = keyOf(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const styles = [];
  const add = (top, topName, l2, l2name, l3, l3name, list, tint) => {
    const fn = node("f:" + top, 1, topName, root, { feel: top });
    const fa = node(`a:${top}:${l2}`, 2, l2name, fn, { feel: top, family: l2, tint });
    const st = node(`s:${top}:${l2}:${l3}`, 3, l3name, fa, { feel: top, family: l2, style: l3, tint });
    list.sort((a, b) => (a.bpm ?? 999) - (b.bpm ?? 999) || a.title.localeCompare(b.title));
    st.tracks = list; styles.push(st);
  };
  if (org) {
    const rows = [...groups.values()].map((list) => { const t = list[0], [a, b] = org.path(t), G = org.byId[org.of(t)]; return { G, a, b, list }; });
    rows.sort((x, y) => x.G.i - y.G.i || x.a[2] - y.a[2] || String(x.a[0]).localeCompare(y.a[0]) || x.b[2] - y.b[2] || String(x.b[0]).localeCompare(y.b[0]));
    for (const r of rows) add(r.G.id, r.G.name, r.a[0], r.a[1], r.b[0], r.b[1], r.list, r.a[3]);
  } else for (const F of FEELS) for (const Fa of FAMILIES) for (const [sid, sname] of Fa.styles) {
    const list = groups.get(`${F.id}|${Fa.id}|${sid}`);
    if (list) add(F.id, F.name, Fa.id, Fa.name, sid, sname, list, FAMILY_TINT[Fa.id]);
  }
  let slots = 0, last = null;
  for (const st of styles) { st.cols = Math.max(1, Math.ceil(st.tracks.length / ROWS)); slots += st.cols + (st.feel !== last ? GAP_FEEL : GAP_STYLE); last = st.feel; }
  const step = TAU / Math.max(slots, 1);
  const R4 = Math.max(240, (slots * SPACING) / TAU);
  const radii = [0, R4 * 0.3, R4 * 0.55, R4 * 0.8, R4];
  const leaves = [];
  let slot = 0; last = null;
  for (const st of styles) {
    slot += st.feel !== last ? GAP_FEEL : GAP_STYLE; last = st.feel;
    st.a0 = -Math.PI / 2 + slot * step; st.a1 = st.a0 + (st.cols - 1) * step;
    st.tracks.forEach((t, k) => {
      const row = Math.floor(k / st.cols), col = k % st.cols, a = st.a0 + col * step, r = R4 + 14 + row * SPACING * 0.92;
      const leaf = { id: t.id, level: 4, name: t.title, t, parent: st, children: [], feel: st.feel, tint: st.tint, a, r, x: Math.cos(a) * r, y: Math.sin(a) * r };
      byId.set(t.id, leaf); st.children.push(leaf); leaves.push(leaf);
    });
    slot += st.cols;
  }
  const angle = (n) => (n.level === 4 ? n.a : n.level === 3 ? (n.a0 + n.a1) / 2 : (angle(n.children[0]) + angle(n.children[n.children.length - 1])) / 2);
  for (const n of byId.values()) if (n.level > 0 && n.level < 4) { n.a = angle(n); n.x = Math.cos(n.a) * radii[n.level]; n.y = Math.sin(n.a) * radii[n.level]; }
  return { root, byId, leaves, styles, R4, radii, step, outer: R4 + 14 + ROWS * SPACING, colors: org?.byId ?? null };
}

export function createAtlas({ canvas, region, onTap, onCamera, onHold, onDetent }) {
  // Two layers: `layer` caches the static atlas (bands, edges, dots, nodes, labels) and is only
  // redrawn when the camera, data or an animation changes it; playback then costs one blit plus
  // the beat ring and pills per frame.
  const screen = canvas.getContext("2d"), layer = document.createElement("canvas"), lctx = layer.getContext("2d");
  let ctx = screen, layerKey = "", gen = 0;
  let g = layout([]), dpr = 1, W = 0, H = 0, theme = "dark";
  const cam = { x: 0, y: 0, s: 0.3 };
  let lens = null, links = null, linkK = 1;
  const wedge = { id: null, g: null, a0: 0, a1: 0 };
  let tween = null, vel = null, lit = null, focusId = "root", featured = [], playing = null, bloom0 = performance.now(), raf = 0, last = performance.now();
  const pal = () => (theme === "dark"
    ? { bg: "#0d1112", ink: "#ece8df", mute: "#8f8a80", dim: "#39403f", line: "#2a3033", panel: "rgba(16,21,22,.86)" }
    : { bg: "#f4f2ed", ink: "#1b1a17", mute: "#8a857a", dim: "#cfcbc1", line: "#dedad1", panel: "rgba(250,249,246,.9)" });
  // A node's colour: its ring-1 hue, shifted by its ring-2 tint (cached; the renderer batches by string).
  const tints = new Map();
  // Motion encodes energy: a beat's glow decays fast for driving feels and lingers for dark, slow ones.
  // Dance: while a track plays, every ring-1 group moves to its beat in the current sort's vocabulary
  // (dance.js). `dk` fades the dance in on play and out on pause; `poses` is this frame's per-group pose.
  let dk = 0, poses = null, dpos = 0;
  const DECAY = { drive: 8, lift: 6.5, play: 6, groove: 5, calm: 3.5, wonder: 3, sad: 2, shadow: 3.2 };
  const colN = (n) => { if (!n.tint) return col(n.feel); const k = theme + n.feel + n.tint; let c = tints.get(k); if (!c) tints.set(k, (c = shade(col(n.feel), n.tint))); return c; };
  const col = (feel) => { const F = feel && (g.colors?.[feel] ?? feelById[feel]); return F ? (theme === "dark" ? F.night : F.color) : pal().mute; };

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 3); W = r.width; H = r.height;
    canvas.width = layer.width = Math.round(W * dpr); canvas.height = layer.height = Math.round(H * dpr);
    gen++; kick();
  }
  new ResizeObserver(resize).observe(canvas);

  // --- data ---------------------------------------------------------------------------------
  let org = null;
  function setTracks(tracks, o = org) {
    org = o; tints.clear();
    const old = g.byId, first = old.size <= 1;
    g = layout(tracks, org);
    for (const n of g.byId.values()) {
      const o = old.get(n.id);
      if (first) { n.dx = n.x; n.dy = n.y; n.al = 0; continue; } // first load: the bloom does the motion
      // Morph: survivors glide from where they were; newcomers grow out of their parent.
      const from = o ?? (n.parent && old.get(n.parent.id)) ?? n.parent ?? n;
      n.dx = from.dx ?? from.x ?? 0; n.dy = from.dy ?? from.y ?? 0; n.al = o ? o.al : 0;
    }
    gen++; applyLit(); kick();
  }
  function applyLit() {
    const on = lit ? new Set() : null;
    if (lit) for (const id of lit) { for (let n = g.byId.get(id); n; n = n.parent) on.add(n.id); }
    for (const n of g.byId.values()) n.target = !on || on.has(n.id) ? 1 : n.level === 4 ? 0.1 : 0.22;
  }
  function setLit(ids) { lit = ids ? new Set(ids) : null; applyLit(); kick(); }
  function setFeatured(ids) { featured = ids.slice(0, 8); kick(); }
  function setPlaying(p) { playing = p; kick(); }
  function setTheme(t) { theme = t; gen++; kick(); }
  // Lens: recolour lit tracks by a measurement (key, tempo, brightness...) instead of their feel.
  function setLens(fn) { lens = fn; gen++; kick(); }
  // Links: "sounds like" arcs from one track to its neighbours, drawn in over ~0.6 s.
  function setLinks(from, list) { links = from && list?.length ? { from, list, t0: performance.now() } : null; gen++; kick(); }

  // --- camera -------------------------------------------------------------------------------
  const R = () => region?.() ?? { x: 0, y: 0, w: W, h: H };
  function boxOf(ids, pad = 0.86, max = 5) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) { const n = g.byId.get(id); if (!n) continue; const r = n.level === 4 ? 16 : 40; x0 = Math.min(x0, n.x - r); y0 = Math.min(y0, n.y - r); x1 = Math.max(x1, n.x + r); y1 = Math.max(y1, n.y + r); }
    if (!isFinite(x0)) { const o = g.outer + 30; x0 = y0 = -o; x1 = y1 = o; }
    const r = R(), s = clamp(Math.min((r.w * pad) / (x1 - x0), (r.h * pad) / (y1 - y0)), 0.05, max);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s };
  }
  const subtree = (n, out = []) => { out.push(n.id); n.children.forEach((c) => subtree(c, out)); return out; };
  // Screen centre of the free region, in canvas px: the camera point sits there.
  const centre = () => { const r = R(); return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 }; };
  function flyTo(to, ms = 820) {
    vel = null;
    if (reduced) ms = 1;
    const from = { ...cam }, dist = Math.hypot(to.x - from.x, to.y - from.y) * Math.min(from.s, to.s);
    tween = { t0: performance.now(), ms, from, to, dip: clamp(dist / 900, 0, 1) * 0.28 };
    kick();
  }
  function focus(id, ms) {
    const n = g.byId.get(id) ?? g.root; focusId = n.id;
    if (n.level === 4) {
      const s = Math.max(cam.s, 2.6);
      return flyTo({ x: n.x, y: n.y, s }, ms);
    }
    flyTo(boxOf(n.level === 0 ? [] : subtree(n), 0.9, n.level === 3 ? 4 : 2.4), ms);
  }
  const flyToIds = (ids, ms) => { focusId = "root"; flyTo(boxOf(ids, 0.84, 3.2), ms); };
  const fitAll = (ms = 1) => { focusId = "root"; flyTo(boxOf([], 0.95), ms); };

  // --- gestures -----------------------------------------------------------------------------
  const pts = new Map(); let pan = null, pinch = null, moved = false, lastTap = 0, samples = [];
  // Hold (or press harder): onHold("arm"|"fire"|"move"|"end"|"cancel", node, clientX, clientY).
  // While a hold is live the finger scrubs instead of panning.
  let hold = null;
  const HOLD_MS = 420, FORCE = 0.22;
  const dropHold = () => { if (!hold) return; clearTimeout(hold.t); clearTimeout(hold.a); if (hold.armed && !hold.on) onHold?.("cancel"); hold = null; };
  const fireHold = () => { if (!hold || hold.on) return; hold.on = true; pan = null; vel = null; onHold?.("fire", hit(hold.lx, hold.ly), hold.cx, hold.cy); };
  // Zoom detents: a tick each time the zoom crosses into the next ring's level of detail.
  const DET = [0.42, 0.95, 2.6, 5]; let det = -1;
  const detent = () => { const d = DET.filter((x) => cam.s >= x).length; if (det >= 0 && d !== det) onDetent?.(d); det = d; };
  const toWorld = (sx, sy) => { const { cx, cy } = centre(); return { x: (sx - cx) / cam.s + cam.x, y: (sy - cy) / cam.s + cam.y }; };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); tween = null; vel = null;
    if (pts.size === 1) { const p = local(e); pan = { p, cam: { ...cam } }; moved = false; samples = [{ t: performance.now(), ...p }];
      if (onHold) { hold = { lx: p.x, ly: p.y, cx: e.clientX, cy: e.clientY, p0: e.pressure, on: false, armed: false }; hold.a = setTimeout(() => { if (hold && !hold.on) { hold.armed = true; onHold("arm", hit(hold.lx, hold.ly), hold.cx, hold.cy); } }, 110); hold.t = setTimeout(fireHold, HOLD_MS); } }
    if (pts.size === 2) { dropHold(); det = DET.filter((x) => cam.s >= x).length; const [a, b] = [...pts.values()]; const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.s, w: toWorld(m.x, m.y) }; pan = null; moved = true; }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (hold?.on) { const p = local(e); onHold("move", hit(p.x, p.y), e.clientX, e.clientY); return; }
    if (hold) { const p = local(e); if (Math.hypot(p.x - hold.lx, p.y - hold.ly) > 6) dropHold(); else if (e.pointerType !== "mouse" && hold.p0 > 0 && e.pressure - hold.p0 > FORCE) { clearTimeout(hold.t); fireHold(); return; } }
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { cx, cy } = centre();
      cam.s = clamp(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 0.05, 12);
      cam.x = pinch.w.x - (m.x - cx) / cam.s; cam.y = pinch.w.y - (m.y - cy) / cam.s; // pinch point stays under the fingers
      detent(); kick(); onCamera?.(); return;
    }
    if (!pan) return;
    const p = local(e), dx = p.x - pan.p.x, dy = p.y - pan.p.y;
    if (!moved && Math.hypot(dx, dy) > 6) moved = true;
    if (moved) {
      cam.x = pan.cam.x - dx / cam.s; cam.y = pan.cam.y - dy / cam.s;
      samples.push({ t: performance.now(), ...p }); if (samples.length > 6) samples.shift();
      kick(); onCamera?.();
    }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e); pts.delete(e.pointerId);
    if (hold?.on) { const h = hold; hold = null; clearTimeout(h.t); onHold("end", e.type === "pointercancel" ? null : hit(p.x, p.y), e.clientX, e.clientY); pan = null; return; }
    dropHold();
    if (pinch) { if (pts.size < 2) { pinch = null; pan = null; } return; }
    if (pan && moved && samples.length > 1) {
      const a = samples[0], b = samples[samples.length - 1], dt = Math.max(16, b.t - a.t);
      if (performance.now() - b.t < 80) vel = { x: -(b.x - a.x) / dt / cam.s, y: -(b.y - a.y) / dt / cam.s }; // world px per ms, flung
      kick();
    } else if (pan && !moved && e.type === "pointerup") {
      const now = performance.now();
      if (now - lastTap < 280) { // double tap: zoom in around the finger
        const w = toWorld(p.x, p.y); lastTap = 0;
        const s = clamp(cam.s * 2.2, 0.05, 12), { cx, cy } = centre();
        flyTo({ x: w.x - (p.x - cx) / s, y: w.y - (p.y - cy) / s, s }, 420);
      } else { lastTap = now; onTap?.(hit(p.x, p.y)); }
    }
    pan = null;
  };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); tween = null; vel = null;
    const p = local(e), w = toWorld(p.x, p.y), { cx, cy } = centre();
    cam.s = clamp(cam.s * Math.exp(-e.deltaY * 0.0016), 0.05, 12);
    cam.x = w.x - (p.x - cx) / cam.s; cam.y = w.y - (p.y - cy) / cam.s; detent(); kick(); onCamera?.();
  }, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // a long press is ours, not the browser's

  function hit(sx, sy) {
    const w = toWorld(sx, sy); let best = null, bd = Infinity;
    for (const n of g.byId.values()) {
      if (n.level === 0 || (n.al ?? 1) < 0.2) continue;
      const rad = n.level === 4 ? Math.max(DOT + 4, 14 / cam.s) : (n.level === 1 ? 30 : n.level === 2 ? 18 : 14) / Math.min(cam.s, 1.4);
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < rad && d / rad < bd) { bd = d / rad; best = n; }
    }
    return best;
  }

  // --- render -------------------------------------------------------------------------------
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    const dt = clamp(now - last, 0, 64); last = now; // rAF timestamps can predate performance.now() at kick time
    let busy = false;
    if (tween) {
      const k = clamp((now - tween.t0) / tween.ms, 0, 1), e = easeIO(k), { from, to, dip } = tween;
      cam.s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e) * (1 - dip * Math.sin(Math.PI * e)); // arc: pull out mid-flight
      cam.x = from.x + (to.x - from.x) * e; cam.y = from.y + (to.y - from.y) * e;
      if (k >= 1) tween = null; busy = true; onCamera?.();
    } else if (vel) {
      cam.x += vel.x * dt; cam.y += vel.y * dt;
      const decay = Math.exp(-dt / 260); vel.x *= decay; vel.y *= decay;
      if (Math.hypot(vel.x, vel.y) * cam.s < 0.01) vel = null; busy = true; onCamera?.();
    }
    const kA = 1 - Math.exp(-dt / 110), kP = 1 - Math.exp(-dt / 150);
    for (const n of g.byId.values()) {
      const t = n.target ?? 1;
      if (Math.abs((n.al ?? 0) - t) > 0.004) { n.al = (n.al ?? 0) + (t - (n.al ?? 0)) * kA; busy = true; } else n.al = t;
      if (Math.abs(n.dx - n.x) + Math.abs(n.dy - n.y) > 0.05) { n.dx += (n.x - n.dx) * kP; n.dy += (n.y - n.dy) * kP; busy = true; } else { n.dx = n.x; n.dy = n.y; }
    }
    const bt = reduced ? 1 : (now - bloom0) / 1000;
    if (bt < 1.4) busy = true;
    const lk = links ? clamp((now - links.t0) / (reduced ? 1 : 650), 0, 1) : 1;
    if (lk < 1) busy = true;
    linkK = easeIO(lk);
    const live = !!(playing && !playing.paused && !reduced);
    dk += ((live ? 1 : 0) - dk) * (1 - Math.exp(-dt / 260));
    if (!live && dk < 0.003) { dk = 0; poses = null; } else { poses = dancePoses(); busy = true; }
    place(bt);
    draw(now, bt, busy);
    if (busy || (playing && !playing.paused)) kick();
  }

  function dancePoses() {
    const b = playing?.beat?.(); if (!b) return null;
    const pn = g.byId.get(playing.id), c = pn?.t?.f?.camelot, lensId = org?.id ?? "feel";
    const tune = { bpm: 60 / b.len, key: c ? +String(c).slice(0, -1) : null };
    dpos = b.i + b.ph;
    const out = new Map();
    for (const f of g.root.children) {
      const p = pose(lensId, f.feel, org?.byId?.[f.feel]?.i ?? 0, dpos, tune), m = dk * (pn && pn.feel === f.feel ? 1.3 : 1);
      out.set(f.feel, { k: 1 + (p.k - 1) * m, da: p.da * m, spread: p.spread * m, hop: p.hop * m, jit: p.jit * m, tw: p.tw * m, ac: f.a, step: Math.floor(dpos * 4) });
    }
    return out;
  }
  const wrap = (d) => d - TAU * Math.round(d / TAU);
  const angOf = (gid, a) => { const P = poses?.get(gid); return P ? a + P.da + wrap(a - P.ac) * P.spread : a; };
  const kOf = (gid) => poses?.get(gid)?.k ?? 1;
  const rnd = (s, n) => { const x = Math.sin(s * 9301.17 + n * 49.297) * 43758.5453; return x - Math.floor(x); };
  // Every node's drawn position this frame (vx, vy): its morph position, grown by the bloom, then danced.
  // Leaves also get vr, a radius multiplier for twinkles. Hit-testing keeps the undanced layout.
  function place(bt) {
    const gl = [0, 1, 2, 3, 4].map((l) => grow(bt, l));
    for (const n of g.byId.values()) {
      const x = n.dx * gl[n.level], y = n.dy * gl[n.level], P = poses && n.level > 0 ? poses.get(n.feel) : null;
      if (!P) { n.vx = x; n.vy = y; n.va = n.a; n.vr = 1; continue; }
      let r = Math.hypot(x, y) * P.k, a = Math.atan2(y, x);
      a += P.da + wrap(a - P.ac) * P.spread;
      n.va = n.a == null ? a : n.a + P.da + wrap(n.a - P.ac) * P.spread; n.vr = 1;
      let jx = 0, jy = 0;
      if (n.level === 4) {
        const s = (n.seed ??= seedOf(n.id));
        if (P.hop) r += P.hop * (s < 0.5 ? 1 : -0.6);
        if (P.jit) { jx = (rnd(s, P.step) - 0.5) * 2 * P.jit; jy = (rnd(s + 0.37, P.step) - 0.5) * 2 * P.jit; }
        if (P.tw) n.vr = 1 + 0.6 * P.tw * (0.5 + 0.5 * Math.sin(TAU * (dpos / 4 + s)));
      }
      n.vx = Math.cos(a) * r + jx; n.vy = Math.sin(a) * r + jy;
    }
  }

  function draw(now, bt, busy) {
    const key = [cam.x, cam.y, cam.s, W, H, dpr, gen, focusId, hoverId].join("|");
    // Moving frames draw straight to the screen (caching them would raster twice); once settled the
    // static layer is cached and later frames (playback pulse) only blit it.
    if (busy) { ctx = screen; drawStatic(bt); layerKey = ""; }
    else {
      if (key !== layerKey) { ctx = lctx; drawStatic(bt); ctx = screen; layerKey = key; }
      screen.setTransform(1, 0, 0, 1, 0, 0); screen.globalAlpha = 1; screen.drawImage(layer, 0, 0);
    }
    drawOverlay(bt);
  }
  const grow = (bt, lvl) => clamp(easeOutBack(clamp((bt - lvl * 0.11) / 0.75, 0, 1)), 0, 1.2);

  function drawStatic(bt) {
    const P = pal(), { cx, cy } = centre(), s = cam.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    // Soft vignette glow behind the ring.
    const gx = cx - cam.x * s, gy = cy - cam.y * s, gr = Math.max(60, g.outer * s * 1.05);
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    grad.addColorStop(0, theme === "dark" ? "rgba(95,211,220,.06)" : "rgba(47,111,214,.05)"); grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cx - cam.x * s), dpr * (cy - cam.y * s));
    const gr4 = (lvl) => grow(bt, lvl);
    const X = (n) => n.vx, Y = (n) => n.vy;
    const vx0 = cam.x - cx / s - 40, vx1 = cam.x + (W - cx) / s + 40, vy0 = cam.y - cy / s - 40, vy1 = cam.y + (H - cy) / s + 40;
    // Style bands: a tinted annular sector under each style's tracks.
    const inner = g.R4 + 6, outer = g.outer + 2;
    for (const st of g.styles) {
      const a = (st.al ?? 1) * gr4(3); if (a < 0.02) continue;
      ctx.globalAlpha = a * (st.id === focusId || st.id === hoverId ? 0.22 : 0.09);
      ctx.fillStyle = colN(st);
      const b0 = angOf(st.feel, st.a0 - g.step * 0.6), b1 = angOf(st.feel, st.a1 + g.step * 0.6), bk = kOf(st.feel) * gr4(4);
      ctx.beginPath(); ctx.arc(0, 0, outer * bk, b0, b1); ctx.arc(0, 0, inner * bk, b1, b0, true); ctx.closePath(); ctx.fill();
    }
    // Edges.
    ctx.lineCap = "round";
    for (const n of g.byId.values()) {
      if (n.level === 0 || n.level === 4) continue;
      const p = n.parent, a = Math.min(n.al ?? 1, p.al ?? 1); if (a < 0.02) continue;
      ctx.globalAlpha = a * (p.level === 0 ? 0.28 : 0.6); ctx.strokeStyle = colN(n); ctx.lineWidth = (a > 0.5 && lit ? 2 : 1.2) / Math.max(s, 0.35);
      ctx.beginPath();
      if (p.level === 0) { ctx.moveTo(0, 0); ctx.lineTo(X(n), Y(n)); }
      else { const rm = (Math.hypot(X(p), Y(p)) + Math.hypot(X(n), Y(n))) / 2; ctx.moveTo(X(p), Y(p)); ctx.bezierCurveTo(Math.cos(p.va) * rm, Math.sin(p.va) * rm, Math.cos(n.va) * rm, Math.sin(n.va) * rm, X(n), Y(n)); }
      ctx.stroke();
    }
    // Sounds-like links: chords bent toward the centre, so cross-feel neighbours visibly span the ring.
    const ln = links && g.byId.get(links.from);
    if (ln) {
      const x0 = X(ln), y0 = Y(ln);
      for (const { id, w } of links.list) {
        const m = g.byId.get(id); if (!m) continue;
        const x1 = X(m), y1 = Y(m), bx = (x0 + x1) * 0.22, by = (y0 + y1) * 0.22; // control point pulled to the hub
        // de Casteljau split at linkK draws the arc in from the source.
        const k = linkK, ax = x0 + (bx - x0) * k, ay = y0 + (by - y0) * k, cx2 = bx + (x1 - bx) * k, cy2 = by + (y1 - by) * k;
        ctx.globalAlpha = 0.25 + 0.6 * w; ctx.strokeStyle = (lens && lens(m.t)) || colN(m); ctx.lineWidth = (1 + 1.6 * w) / Math.max(s, 0.35);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(ax, ay, ax + (cx2 - ax) * k, ay + (cy2 - ay) * k); ctx.stroke();
      }
    }
    // Tracks. Dim ones are grey; lit ones carry their feel colour (or the lens colour).
    const g4 = gr4(4);
    // Batched: one path per colour and alpha step instead of a fill per dot (~1.8k dots).
    const buckets = new Map(), rings = [];
    for (const n of g.leaves) {
      const x = n.vx, y = n.vy; if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const a = n.al ?? 1; if (a < 0.02) continue;
      const on = a > 0.5, r = (n.t.src === "shortlist" && on ? DOT * 1.25 : DOT) * (0.6 + 0.4 * a) * n.vr;
      // Under a lens, unmeasured tracks go neutral.
      const k = (on ? (lens ? lens(n.t) ?? P.mute : colN(n)) : P.dim) + "|" + (on ? Math.round(a * 8) / 8 : 0.55);
      let b = buckets.get(k); if (!b) buckets.set(k, (b = []));
      b.push(x, y, r);
      if (n.t.src === "web" && on) rings.push(x, y, r);
    }
    for (const [k, b] of buckets) {
      const [c, a] = k.split("|"); ctx.globalAlpha = +a; ctx.fillStyle = c; ctx.beginPath();
      for (let i = 0; i < b.length; i += 3) { ctx.moveTo(b[i] + b[i + 2], b[i + 1]); ctx.arc(b[i], b[i + 1], b[i + 2], 0, TAU); }
      ctx.fill();
    }
    if (rings.length) { ctx.globalAlpha = 0.9; ctx.strokeStyle = P.ink; ctx.lineWidth = 1 / Math.max(s, 0.5); ctx.beginPath(); for (let i = 0; i < rings.length; i += 3) { ctx.moveTo(rings[i] + rings[i + 2], rings[i + 1]); ctx.arc(rings[i], rings[i + 1], rings[i + 2], 0, TAU); } ctx.stroke(); }
    // Structural nodes.
    for (const n of g.byId.values()) {
      if (n.level === 4) continue;
      const a = (n.al ?? 1) * clamp(gr4(n.level), 0, 1); if (a < 0.02) continue;
      const x = X(n), y = Y(n), c = colN(n), k = Math.max(s, 0.45), sel = n.id === focusId || n.id === hoverId;
      ctx.globalAlpha = a;
      if (n.level === 0) { ctx.fillStyle = P.ink; ctx.beginPath(); ctx.arc(0, 0, 7 / Math.max(s, 0.6), 0, TAU); ctx.fill(); continue; }
      const r = (n.level === 1 ? 26 : n.level === 2 ? 11 : 7.5) / Math.min(k, 1.6) * Math.min(1, 0.55 + s);
      ctx.fillStyle = P.bg; ctx.strokeStyle = c; ctx.lineWidth = (sel ? 3 : 1.8) / Math.min(k, 1.6);
      ctx.beginPath();
      if (n.level === 2) ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.55); else ctx.arc(x, y, r, 0, TAU);
      ctx.fill(); ctx.stroke();
      if (n.level === 1) { ctx.globalAlpha = a * 0.22; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, TAU); ctx.fill(); }
    }
    // Labels in screen space at a constant size.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
    const sx = (n) => cx + (X(n) - cam.x) * s, sy = (n) => cy + (Y(n) - cam.y) * s;
    ctx.lineJoin = "round"; ctx.textBaseline = "middle";
    for (const n of g.byId.values()) {
      if (n.level === 0 || n.level === 4) continue;
      const a = (n.al ?? 1) * clamp(gr4(n.level) * 1.2 - 0.2, 0, 1);
      const minS = [0, 0, 0.42, 0.95][n.level], fade = clamp((s - minS) / (minS * 0.35 + 0.05), 0, 1);
      if (a * fade < 0.05) continue;
      const x = sx(n), y = sy(n); if (x < -120 || x > W + 120 || y < -40 || y > H + 40) continue;
      ctx.globalAlpha = a * fade;
      const ux = Math.cos(n.va), uy = Math.sin(n.va);
      if (n.level === 1) { ctx.font = "13px 'Archivo Black', sans-serif"; text(n.name.toUpperCase(), x + ux * 38 * Math.min(1, 0.55 + s), y + uy * 30 * Math.min(1, 0.55 + s), ux, col(n.feel), P.bg); }
      else if (n.level === 2) { ctx.font = "600 12px 'Instrument Sans', sans-serif"; text(n.name, x + ux * 18, y + uy * 18, ux, P.ink, P.bg); }
      else { ctx.font = "11px 'IBM Plex Mono', monospace"; text(n.name, x + ux * 14, y + uy * 14, ux, P.mute, P.bg); }
    }
  }

  function drawOverlay(bt) {
    const P = pal(), { cx, cy } = centre(), s = cam.s, g4 = grow(bt, 4);
    const X = (n) => n.vx, Y = (n) => n.vy;
    const sx = (n) => cx + (X(n) - cam.x) * s, sy = (n) => cy + (Y(n) - cam.y) * s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cx - cam.x * s), dpr * (cy - cam.y * s));
    // Playing track, scored like a metre: every beat ripples its dot, each bar's downbeat lights its
    // lineage (style -> family -> feel), and a four-bar phrase lights its wedge and breathes the ring. Phase comes
    // from the measured downbeat (sound.js beatAt), so pulses land on the kick, not just the tempo.
    const pn = playing && g.byId.get(playing.id);
    if (pn) {
      const x = pn.vx, y = pn.vy, c = colN(pn), px = 1 / s;
      const b = playing.paused || reduced ? null : playing.beat?.(), env = b ? Math.exp(-b.ph * (DECAY[pn.t.feel] ?? 5)) : 0;
      if (b) {
        ctx.globalAlpha = env * (0.25 + 0.45 * b.acc); ctx.strokeStyle = c; ctx.lineWidth = 2 * px;
        ctx.beginPath(); ctx.arc(x, y, DOT + 3 + (1 - Math.exp(-b.ph * 3)) * (10 + 10 * b.acc) * Math.max(px * 2, 0.6), 0, TAU); ctx.stroke();
        if (b.acc >= 0.7) { // bar: light the track's lineage, style -> family -> feel -> centre, each in its own tint
          ctx.lineCap = "round";
          for (let n = pn.parent; n && n.level > 0; n = n.parent) {
            const p = n.parent, nx = n.vx, ny = n.vy, qx = p.vx || 0, qy = p.vy || 0;
            ctx.globalAlpha = env * (0.35 + 0.4 * b.acc); ctx.strokeStyle = colN(n); ctx.lineWidth = (1.4 + 1.8 * b.acc) * px;
            ctx.beginPath(); ctx.moveTo(qx, qy);
            if (p.level === 0) ctx.lineTo(nx, ny);
            else { const rm = (Math.hypot(qx, qy) + Math.hypot(nx, ny)) / 2; ctx.bezierCurveTo(Math.cos(p.va) * rm, Math.sin(p.va) * rm, Math.cos(n.va) * rm, Math.sin(n.va) * rm, nx, ny); }
            ctx.stroke();
          }
        }
        if (b.acc === 1) { // phrase: the whole wedge answers
          if (wedge.id !== pn.feel || wedge.g !== g) { let a0 = Infinity, a1 = -Infinity; for (const st of g.styles) if (st.feel === pn.feel) { a0 = Math.min(a0, st.a0); a1 = Math.max(a1, st.a1); } Object.assign(wedge, { id: pn.feel, g, a0, a1 }); }
          ctx.globalAlpha = env * 0.6; ctx.strokeStyle = col(pn.feel); ctx.lineWidth = 3 * px;
          ctx.beginPath(); ctx.arc(0, 0, (g.outer + 8) * g4 * kOf(pn.feel), angOf(pn.feel, wedge.a0 - g.step * 0.6), angOf(pn.feel, wedge.a1 + g.step * 0.6)); ctx.stroke();
          ctx.globalAlpha = env * 0.18; ctx.lineWidth = 1.5 * px; ctx.beginPath(); ctx.arc(0, 0, g.R4 * (0.98 + 0.04 * (1 - env)) * g4, 0, TAU); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1; ctx.lineWidth = 2.6 * px; ctx.strokeStyle = P.line;
      const rr = DOT + 4.5; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(playing.progress?.() ?? 0, 0, 1)); ctx.stroke();
      ctx.fillStyle = P.ink; ctx.beginPath(); ctx.arc(x, y, DOT * 0.55, 0, TAU); ctx.fill();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.textBaseline = "middle";
    // Track pills: playing, focused and the top results, when zoomed in enough to place them.
    const pills = [...new Set([playing?.id, focusId, ...(links && linkK > 0.9 ? links.list.slice(0, 5).map((l) => l.id) : []), ...(s > 0.7 ? featured : [])])].map((id) => g.byId.get(id)).filter((n) => n?.level === 4);
    ctx.font = "italic 14px 'Instrument Serif', serif"; // track titles: the work itself
    const placed = [];
    for (const n of pills) {
      const x = sx(n), y = sy(n), rg = R(); if (x < -20 || x > W + 20 || y < rg.y || y > rg.y + rg.h) continue; // stay in the free region, off the chips and sheet
      const label = n.t.title.length > 30 ? n.t.title.slice(0, 29) + "…" : n.t.title, w = ctx.measureText(label).width + 16, h = 22;
      let bx = x + 10, by = y - h - 6; if (bx + w > W - 6) bx = x - w - 10; if (by < rg.y + 4) by = y + 8;
      if (placed.some((p) => bx < p.x + p.w && bx + w > p.x && by < p.y + p.h && by + h > p.y)) continue;
      placed.push({ x: bx, y: by, w, h });
      ctx.globalAlpha = Math.max(0.35, n.al ?? 1); ctx.fillStyle = P.panel; ctx.strokeStyle = colN(n); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, w, h, 11); ctx.fill(); ctx.stroke();
      ctx.fillStyle = P.ink; ctx.textAlign = "left"; ctx.fillText(label, bx + 8, by + h / 2 + 0.5);
    }
  }
  function text(str, x, y, ux, fill, halo) {
    ctx.textAlign = Math.abs(ux) < 0.3 ? "center" : ux > 0 ? "left" : "right";
    ctx.strokeStyle = halo; ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.strokeText(str, x, y); ctx.fillStyle = fill; ctx.fillText(str, x, y);
  }

  let hoverId = null;
  canvas.addEventListener("pointermove", (e) => { if (e.pointerType !== "mouse" || pan) return; const p = local(e), h = hit(p.x, p.y); const id = h?.id ?? null; canvas.style.cursor = h ? "pointer" : "grab"; if (id !== hoverId) { hoverId = id; kick(); } });

  resize();
  return {
    get graph() { return g; }, get cam() { return cam; },
    setTracks, setLit, setFeatured, setPlaying, setTheme, setLens, setLinks, focus, flyToIds, fitAll, kick, resize,
    get focusId() { return focusId; }, set focusId(v) { focusId = v; kick(); },
  };
}
