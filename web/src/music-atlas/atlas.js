// Sound Atlas renderer: the Taste Atlas radial taxonomy (oss/taste-skill/examples/taste-atlas,
// root -> 01 feel -> 02 family -> 03 style -> 04 track) redrawn on <canvas> so ~1.5k tracks pan,
// pinch and fly at 60 fps on a phone. Tracks sit in the outer band of their style's wedge, slow on
// the inside, fast on the outside, so BPM reads as distance from the centre.
import { FEELS, FAMILIES, FAMILY_TINT, feelById, shade } from "./taxonomy.js";
import { pose, seedOf, tuft, tuftOf, zoomDamp } from "./dance.js";

const ROWS = 7, SPACING = 15, GAP_FEEL = 5, GAP_STYLE = 1.4, DOT = 4.4;
const TAU = Math.PI * 2;
// Samsung TVs (Tizen 6.5 = Chromium 85) predate ctx.roundRect (Chromium 99); one numeric radius is all we use.
const C2D = globalThis.CanvasRenderingContext2D?.prototype;
if (C2D && !C2D.roundRect) C2D.roundRect = function (x, y, w, h, r) { r = Math.min(+r || 0, w / 2, h / 2); this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); };
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
    st.rm = R4 + 14 + (Math.ceil(st.tracks.length / st.cols) - 1) * SPACING * 0.46; // the tuft's middle row: it spreads about this
    slot += st.cols;
  }
  const angle = (n) => (n.level === 4 ? n.a : n.level === 3 ? (n.a0 + n.a1) / 2 : (angle(n.children[0]) + angle(n.children[n.children.length - 1])) / 2);
  for (const n of byId.values()) if (n.level > 0 && n.level < 4) { n.a = angle(n); n.x = Math.cos(n.a) * radii[n.level]; n.y = Math.sin(n.a) * radii[n.level]; }
  return { root, byId, leaves, styles, R4, radii, step, outer: R4 + 14 + ROWS * SPACING, colors: org?.byId ?? null };
}

// A TV's dancing tracks on the GPU: each dot's undanced position, radius, seed, colour and group upload once per dot
// set (`load`), and the vertex shader applies place()'s dance per frame from its group's pose (`dance`), so a frame costs
// no per-dot JS. QN85B traces: ~1.8k 2D-canvas paths took ~9 ms a frame to flush, and per-dot JS ~9 ms more.
// Returns null when the shaders don't build (callers keep the 2D path).
const GROUPS = 16;
// A track's radial offset from its tuft's middle row, at its current (bloomed) radius: the tuft spreads about it.
const rowOff = (n) => (n.parent?.rm && n.r ? (n.r - n.parent.rm) * ((n.pr ?? Math.hypot(n.px ?? n.x, n.py ?? n.y)) / n.r) : 0);
function glDance(gl) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, `precision highp float;
attribute vec4 p; attribute vec4 c; attribute vec4 q; // q: undanced parent x, y; group index; offset from the tuft's middle row
uniform vec4 m; uniform vec2 u; uniform vec4 A[${GROUPS}]; uniform vec4 B[${GROUPS}]; uniform vec4 C[${GROUPS}]; uniform float dpos;
varying float r; varying vec4 col;
const float TAU = 6.2831853;
float rnd(float s, float n) { return fract(sin(s * 9301.17 + n * 49.297) * 43758.5453); }
float wrp(float d) { return d - TAU * floor(d / TAU + 0.5); }
void main() {
  int i = int(q.z); vec4 P = A[i], Q = B[i], T = C[i]; // P: k, da, spread, ac; Q: hop, jit, tw, step; T: the tuft's k, da, stretch
  // dance.js tufts: rows spread about the tuft's middle row, columns about the stalk's angle (as atlas.js place())
  float a0 = atan(p.y, p.x), ap = atan(q.y, q.x), st = T.z * (0.8 + 0.4 * p.w);
  float a = ap + wrp(a0 - ap) * (1.0 + 0.35 * st) + T.y + wrp(a0 - P.w) * P.z;
  float rr = (length(p.xy) - q.w) * T.x + q.w * (1.0 + st) + Q.x * (p.w < 0.5 ? 1.0 : -0.6);
  vec2 w = vec2(cos(a), sin(a)) * rr + (vec2(rnd(p.w, Q.w), rnd(p.w + 0.37, Q.w)) - 0.5) * 2.0 * Q.y;
  vec2 v = w * m.xy + m.zw;
  gl_Position = vec4(v.x / u.x * 2.0 - 1.0, 1.0 - v.y / u.y * 2.0, 0.0, 1.0);
  r = p.z * (1.0 + 0.6 * Q.z * (0.5 + 0.5 * sin(TAU * (dpos / 4.0 + p.w)))) * m.x;
  gl_PointSize = 2.0 * r + 1.0; col = c;
}`));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, "precision mediump float; varying float r; varying vec4 col;" +
    "void main() { float q = length((gl_PointCoord - 0.5) * (2.0 * r + 1.0)); gl_FragColor = col * clamp(r + 0.5 - q, 0.0, 1.0); }"));
  gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const U = (k) => gl.getUniformLocation(pr, k), uM = U("m"), uU = U("u"), uA = U("A"), uB = U("B"), uC = U("C"), uD = U("dpos");
  const aP = gl.getAttribLocation(pr, "p"), aC = gl.getAttribLocation(pr, "c"), aQ = gl.getAttribLocation(pr, "q");
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  for (const k of [aP, aC, aQ]) gl.enableVertexAttribArray(k);
  gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 48, 0); gl.vertexAttribPointer(aC, 4, gl.FLOAT, false, 48, 16); gl.vertexAttribPointer(aQ, 4, gl.FLOAT, false, 48, 32);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0, 0, 0, 0);
  const rgb = new Map(), probe = document.createElement("canvas").getContext("2d");
  const parse = (c) => { // any CSS colour -> [r, g, b, a] in 0..1, via the 2D canvas's own normalisation
    let v = rgb.get(c); if (v) return v;
    probe.fillStyle = "#000"; probe.fillStyle = c; const s = probe.fillStyle;
    v = s[0] === "#" ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).concat(1) : s.match(/[\d.]+/g).map(Number).map((x, i) => (i < 3 ? x / 255 : x));
    if (v.length < 4) v.push(1); rgb.set(c, v); return v;
  };
  const pa = new Float32Array(GROUPS * 4), pb = new Float32Array(GROUPS * 4), pc = new Float32Array(GROUPS * 4);
  let count = 0, groups = [], src = null;
  return {
    get src() { return src; },
    clear() { gl.clear(gl.COLOR_BUFFER_BIT); },
    // set: { b: Map("colour|alpha" -> nodes) } with each node's undanced px, py and base radius br; parents hold still.
    load(set, seedOf) {
      src = set; groups = []; let n = 0; for (const ns of set.b.values()) n += ns.length;
      const f = new Float32Array(n * 12); let o = 0;
      for (const [k, ns] of set.b) {
        const i = k.lastIndexOf("|"), al = +k.slice(i + 1); if (al < 0.02) continue; const c = parse(k.slice(0, i)), a = al * c[3];
        for (const d of ns) {
          let gi = groups.indexOf(d.feel); if (gi < 0) { gi = groups.length; groups.push(d.feel); }
          f.set([d.px, d.py, d.br, (d.seed ??= seedOf(d.id)), c[0] * a, c[1] * a, c[2] * a, a, d.parent?.vx ?? 0, d.parent?.vy ?? 0, Math.min(gi, GROUPS - 1), rowOff(d)], o); o += 12;
        }
      }
      count = o / 12; gl.bufferData(gl.ARRAY_BUFFER, f.subarray(0, o), gl.STATIC_DRAW);
    },
    dance(t, w, h, poses, dpos) {
      pa.fill(0); pb.fill(0); pc.fill(0);
      for (let i = 0; i < groups.length && i < GROUPS; i++) {
        const P = poses?.get(groups[i]); if (!P) { pc[i * 4] = 1; continue; }
        const T = P.T; // a tuft spring, when the dance has one; else the arm's own pose
        pa.set([P.k, P.da, P.spread, P.ac], i * 4); pb.set([P.hop, P.jit, P.tw, P.step], i * 4); pc.set(T ? [T.y, T.a, (T.spread || 0) + (P.open || 0)] : [P.k, P.da, 0], i * 4);
      }
      gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform4f(uM, t.a, t.d, t.e, t.f); gl.uniform2f(uU, w, h); gl.uniform4fv(uA, pa); gl.uniform4fv(uB, pb); gl.uniform4fv(uC, pc); gl.uniform1f(uD, dpos);
      gl.drawArrays(gl.POINTS, 0, count);
    },
  };
}

export function createAtlas({ canvas, region, onTap, onDown, onCamera, onHold, onDetent, onFeel, onLayer, lite = false }) {
  // Two layers: `layer` caches the static atlas (bands, edges, dots, nodes, labels) and is only
  // redrawn when the camera, data or an animation changes it; playback then costs one blit plus
  // the beat ring and pills per frame.
  const screen = canvas.getContext("2d"), layer = document.createElement("canvas"), lctx = layer.getContext("2d");
  let ctx = screen, layerKey = "", gen = 0;
  // A TV dancing: the map holds still on this canvas and only the tracks redraw, on a clear canvas laid over it, so the
  // compositor never re-rasters the full-screen map (QN85B probe: 16.9 ms frames split vs 23.2 ms blitting one canvas).
  const fly = lite ? document.createElement("canvas") : null, fctx = fly?.getContext("2d");
  if (fly) { fly.className = "atlas-fly"; fly.setAttribute("aria-hidden", "true"); canvas.after(fly); }
  // The dancing dots themselves go to WebGL points under that overlay: as ~1.8k 2D-canvas paths the QN85B spent ~9 ms a
  // frame flushing them plus a GPU finish (play2 trace: 193 frames drawn in 5 s). 2D stays the fallback.
  const glc = fly ? document.createElement("canvas") : null;
  const gl = glc && glc.getContext("webgl", { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  const gp = gl && glDance(gl);
  if (gp) { glc.className = "atlas-fly"; glc.setAttribute("aria-hidden", "true"); canvas.after(glc); }
  let flyOn = false, step = false;
  let dots = null, g = layout([]), dpr = 1, W = 0, H = 0, theme = "dark";
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
  // `motion` is the owner's toggle; `lblK` fades canvas labels out while the map is actually dancing.
  let dk = 0, poses = null, tufts = new Map(), dpos = 0, motion = true, lblK = 1, danceK = 0;
  // Formation: the leaves fly onto a QR code's dark modules (the TV's pairing code, drawn with the map's own
  // dots on a light plate so phone cameras read it), the rest of the map fades out. `fe` is the eased mix.
  let form = null, fe = 0;
  const DECAY = { drive: 8, lift: 6.5, play: 6, groove: 5, calm: 3.5, wonder: 3, sad: 2, shadow: 3.2 };
  // Memoised on the node per theme: drawStatic asks for ~2k colours a frame, and on a TV (Mali-G51) the
  // string-key lookup showed up in the CPU profile. setTracks builds fresh nodes, so no stale entries.
  const colN = (n) => { if (n.cT === theme) return n.cC; n.cT = theme; return (n.cC = colRaw(n)); };
  const colRaw = (n) => { if (!n.tint) return col(n.feel); const k = theme + n.feel + n.tint; let c = tints.get(k); if (!c) tints.set(k, (c = shade(col(n.feel), n.tint))); return c; };
  const col = (feel) => { const F = feel && (g.colors?.[feel] ?? feelById[feel]); return F ? (theme === "dark" ? F.night : F.color) : pal().mute; };

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 3); W = r.width; H = r.height;
    canvas.width = layer.width = Math.round(W * dpr); canvas.height = layer.height = Math.round(H * dpr);
    if (fly) { fly.width = canvas.width; fly.height = canvas.height; flyOn = false; layerKey = ""; }
    if (gp) { glc.width = canvas.width; glc.height = canvas.height; }
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
    if (form && !assignForm()) form = null;
    gen++; applyLit(); kick();
  }
  function applyLit() {
    const on = lit ? new Set() : null;
    if (lit) for (const id of lit) { for (let n = g.byId.get(id); n; n = n.parent) on.add(n.id); }
    for (const n of g.byId.values()) n.target = !on || on.has(n.id) ? 1 : n.level === 4 ? 0.1 : 0.22;
  }
  function setLit(ids) { lit = ids ? new Set(ids) : null; applyLit(); kick(); }
  let backdrop = false;
  function setBackdrop(v) { backdrop = !!v; layerKey = ""; kick(); }
  function setFeatured(ids) { featured = ids.slice(0, 8); kick(); }
  // The sound arriving is an event: the ring that drew in while it loaded lets go outward (M5).
  let landT = -1e9;
  function setPlaying(p) { if (playing?.loading && p && !p.loading && !p.paused && p.id === playing.id) landT = performance.now(); playing = p; kick(); }
  // Layers: the playing track's stems as rings around its dot, from LAYER_S zoom in (all the way in).
  // fn(id) -> { lanes: [{ k, name, color, env, on }] } | null; onLayer(k) when a ring is tapped.
  let layersOf = null, rings = null;
  const LAYER_S = 5.2, LAYER_FULL = 8, RING0 = 30, RING_W = 13;
  function setLayers(fn) { layersOf = fn; kick(); }
  const layerK = () => clamp((cam.s - LAYER_S) / (LAYER_FULL - LAYER_S), 0, 1);
  function zoomOn(id, s = 9, ms) { const n = g.byId.get(id); if (!n) return; focusId = id; flyTo({ x: n.x, y: n.y, s }, ms); }
  function ringAt(x, y) { if (!rings) return null; const d = Math.hypot(x - rings.x, y - rings.y), i = Math.floor((d - RING0 + RING_W / 2) / RING_W); return i >= 0 && i < rings.lanes.length ? rings.lanes[i].k : null; }
  function setTheme(t) { theme = t; if (form) form.eyes = null; gen++; kick(); }
  // QR modules (dark cells of an N x N matrix) -> one leaf each, matched by angle round the centre so every feel
  // keeps its wedge and the morph reads as the ring folding into a square. Too few leaves: false, caller falls back.
  function assignForm() {
    for (const n of g.leaves) n.fm = null;
    form.eyes = null;
    const { cells, N } = form, K = cells.length, L = g.leaves.length; if (L < K) return false;
    const ang = (c) => Math.atan2(c[1] - N / 2 + 0.5, c[0] - N / 2 + 0.5);
    const cs = cells.slice().sort((a, b) => ang(a) - ang(b)), ls = g.leaves.slice().sort((a, b) => Math.atan2(Math.sin(a.a), Math.cos(a.a)) - Math.atan2(Math.sin(b.a), Math.cos(b.a)));
    cs.forEach((c, i) => { ls[Math.floor((i * L) / K)].fm = c; });
    return true;
  }
  function setFormation(cells, N) {
    if (!cells) { if (form) form.on = false; kick(); return true; }
    // Finder patterns stay solid (third field): scanners find a code by those rings' 1:1:3:1:1 runs, which dots break.
    const fz = (v) => v < 7 || v >= N - 7;
    cells = cells.map(([x, y]) => [x, y, (x < 7 || y < 7) && fz(x) && fz(y) ? 1 + (x >= 7 ? 1 : 0) + (y >= 7 ? 2 : 0) : 0]); // 1 TL, 2 TR, 3 BL
    form = { cells, N, on: true, k: form?.k ?? 0 };
    if (!assignForm()) { form = null; return false; }
    gen++; kick(); return true;
  }
  // Screen square for the code: centred in the free region; world coordinates follow the live camera.
  function formGeom() {
    const r = R(), { cx, cy } = centre(), S = Math.min(r.w, r.h) * 0.62, m = S / form.N, s = cam.s;
    return { m, S, sx0: cx - S / 2, sy0: cy - S / 2, wx: (sx) => cam.x + (sx - cx) / s, wy: (sy) => cam.y + (sy - cy) / s, r: (m * 0.42) / s,
      c: form.N / 2 - 0.5, t: reduced ? 0 : (performance.now() / 2600) * TAU };
  }
  // The three finder eyes, drawn in screen space: a rounded ring and a round pupil, each in one feel's hue. Along any
  // line through the centre they keep QR's 1:1:3:1:1 light/dark runs, which is all a scanner looks for.
  // Each eye takes the hue of the wedge it sits in (nearest data dot), skipping Sad's deliberately muted grey-blue.
  function eyeHue(x, y) {
    const hit = (form.eyes ??= {})[x + "," + y]; if (hit) return hit;
    let best = null, bd = 1e9;
    for (const n of g.leaves) { const c = n.fm; if (!c || c[2] || n.feel === "sad") continue; const d = (c[0] - x) ** 2 + (c[1] - y) ** 2; if (d < bd) { bd = d; best = n; } }
    return (form.eyes[x + "," + y] = best ? colN(best) : pal().ink);
  }
  function drawFinders(F) {
    const a = clamp(fe * 1.6 - 0.6, 0, 1); if (!a) return;
    const m = F.m, z = 0.75 + 0.25 * easeOutBack(a), { cx: ox, cy: oy } = centre();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = a;
    [[0, 0], [form.N - 7, 0], [0, form.N - 7]].forEach(([x, y], i) => {
      const cx = F.sx0 + (x + 3.5) * m, cy = F.sy0 + (y + 3.5) * m, h = 3 * m * z;
      ctx.strokeStyle = ctx.fillStyle = eyeHue(x + 3, y + 3);
      ctx.lineWidth = m * z; ctx.beginPath(); ctx.roundRect(cx - h, cy - h, 2 * h, 2 * h, m * 1.6 * z); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 1.5 * m * z, 0, TAU); ctx.fill();
    });
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * (ox - cam.x * cam.s), dpr * (oy - cam.y * cam.s));
  }
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
  const fireHold = () => { if (!hold || hold.on) return; hold.on = true; pan = null; vel = null; const n0 = hit(hold.lx, hold.ly); loupe = n0?.level === 4 ? openLoupe({ x: hold.lx, y: hold.ly }) : null; if (loupe) loupe.n = n0; kick(); onHold?.("fire", n0, hold.cx, hold.cy); };
  // A loupe under the held finger (M2). A fingertip covers ~40 dots at the overview zoom, so a held slide steers
  // a crosshair at 1/m of the finger's speed and a lens 100 px above the finger (clear of the press ring) shows that neighbourhood m times
  // larger (m spreads the dots to >= 12 px apart). The song auditioned is the one nearest the crosshair, the one
  // drawn under the lens's centre: what you see in the lens is what you hear.
  const LENS_R = 54, LENS_UP = 100;
  let loupe = null;
  const leafNear = (w, rad) => { let best = null, bd = rad; for (const n of g.byId.values()) if (n.level === 4 && (n.al ?? 1) > 0.5) { const d = Math.hypot(n.x - w.x, n.y - w.y); if (d < bd) { bd = d; best = n; } } return best; };
  const openLoupe = (p) => {
    const w = toWorld(p.x, p.y), near = [];
    for (const n of g.byId.values()) if (n.level === 4 && Math.abs(n.x - w.x) < 40 / cam.s && Math.abs(n.y - w.y) < 40 / cam.s) near.push(n);
    let nn = Infinity; for (const a of near) for (const b of near) if (a !== b) nn = Math.min(nn, Math.hypot(a.x - b.x, a.y - b.y));
    const m = clamp(12 / ((Number.isFinite(nn) ? nn : 99) * cam.s), 1, 10);
    if (m < 1.5) return null; // already roomy (zoomed in): the plain hold is precise enough
    return { m, p0: p, w0: w, w, p };
  };
  const loupeAt = () => { const r = R(); return { x: clamp(loupe.p.x, r.x + LENS_R + 4, r.x + r.w - LENS_R - 4), y: Math.max(r.y + LENS_R + 4, loupe.p.y - LENS_UP) }; };
  function drawLoupe() {
    if (!loupe) return; const L = loupeAt(), k = cam.s * loupe.m, c = ctx, P = pal();
    c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = 1;
    c.beginPath(); c.arc(L.x, L.y, LENS_R, 0, TAU); c.fillStyle = P.bg; c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 18; c.fill(); c.shadowBlur = 0;
    c.save(); c.clip();
    const reach = (LENS_R + 6) / k, cur = loupe.n;
    for (const n of g.byId.values()) {
      if (n.level !== 4 || Math.abs(n.x - loupe.w.x) > reach || Math.abs(n.y - loupe.w.y) > reach) continue;
      const x = L.x + (n.x - loupe.w.x) * k, y = L.y + (n.y - loupe.w.y) * k;
      c.globalAlpha = (n.al ?? 1) > 0.5 ? 1 : 0.25; c.fillStyle = col(n.feel); c.beginPath(); c.arc(x, y, n === cur ? 6 : 4, 0, TAU); c.fill();
      if (n === cur) { c.globalAlpha = 1; c.strokeStyle = P.ink; c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, 9.5, 0, TAU); c.stroke(); }
    }
    c.restore();
    c.globalAlpha = 0.5; c.strokeStyle = P.ink; c.lineWidth = 1; c.beginPath(); c.moveTo(L.x - 5, L.y); c.lineTo(L.x + 5, L.y); c.moveTo(L.x, L.y - 5); c.lineTo(L.x, L.y + 5); c.stroke();
    c.globalAlpha = 0.9; c.lineWidth = 1.5; c.strokeStyle = cur ? col(cur.feel) : P.mute; c.beginPath(); c.arc(L.x, L.y, LENS_R, 0, TAU); c.stroke();
    c.restore();
  }
  // Zoom detents: a tick each time the zoom crosses into the next ring's level of detail.
  const DET = [0.42, 0.95, 2.6, 5]; let det = -1;
  // Borders you can feel (M4): while a finger or a fling moves the map, the song nearest the view's centre
  // (within 24 px) names the feel you are over; crossing into another feel is reported once (the app ticks).
  // Empty space between feels names none, so a border is a single crossing, not a buzz along it.
  let feelHere = null;
  const feelEdge = () => {
    if (!onFeel) return; let best = null, bd = 24 / cam.s;
    for (const n of g.byId.values()) if (n.level === 4 && (n.al ?? 1) > 0.5) { const d = Math.abs(n.x - cam.x) + Math.abs(n.y - cam.y); if (d < bd) { bd = d; best = n; } }
    if (best && best.feel !== feelHere) { if (feelHere) onFeel(best.feel); feelHere = best.feel; }
  };
  const detent = () => { const d = DET.filter((x) => cam.s >= x).length; if (det >= 0 && d !== det) onDetent?.(d); det = d; };
  const toWorld = (sx, sy) => { const { cx, cy } = centre(); return { x: (sx - cx) / cam.s + cam.x, y: (sy - cy) / cam.s + cam.y }; };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); tween = null; vel = null;
    if (pts.size === 1) { const p = local(e); pan = { p, cam: { ...cam } }; moved = false; samples = [{ t: performance.now(), ...p }];
      if (onDown && pts.size === 1) onDown(hit(p.x, p.y)); // contact: the app can start fetching what's under the finger
      if (onHold) { hold = { lx: p.x, ly: p.y, cx: e.clientX, cy: e.clientY, p0: e.pressure, on: false, armed: false }; hold.a = setTimeout(() => { if (hold && !hold.on) { hold.armed = true; onHold("arm", hit(hold.lx, hold.ly), hold.cx, hold.cy); } }, 110); hold.t = setTimeout(fireHold, HOLD_MS); } }
    if (pts.size === 2) { dropHold(); det = DET.filter((x) => cam.s >= x).length; const [a, b] = [...pts.values()]; const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.s, w: toWorld(m.x, m.y) }; pan = null; moved = true; }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (hold?.on) { const p = local(e);
      if (loupe) { loupe.p = p; loupe.w = { x: loupe.w0.x + (p.x - loupe.p0.x) / (cam.s * loupe.m), y: loupe.w0.y + (p.y - loupe.p0.y) / (cam.s * loupe.m) }; const n = leafNear(loupe.w, (LENS_R * 0.8) / (cam.s * loupe.m)); loupe.n = n; kick(); onHold("move", n, e.clientX, e.clientY); return; }
      onHold("move", hit(p.x, p.y), e.clientX, e.clientY); return; }
    if (hold) { const p = local(e); if (Math.hypot(p.x - hold.lx, p.y - hold.ly) > 6) dropHold(); else if (e.pointerType !== "mouse" && hold.p0 > 0 && e.pressure - hold.p0 > FORCE) { clearTimeout(hold.t); fireHold(); return; } }
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { cx, cy } = centre();
      cam.s = clamp(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 0.05, 12);
      cam.x = pinch.w.x - (m.x - cx) / cam.s; cam.y = pinch.w.y - (m.y - cy) / cam.s; // pinch point stays under the fingers
      detent(); feelEdge(); kick(); onCamera?.(); return;
    }
    if (!pan) return;
    const p = local(e), dx = p.x - pan.p.x, dy = p.y - pan.p.y;
    if (!moved && Math.hypot(dx, dy) > 6) moved = true;
    if (moved) {
      cam.x = pan.cam.x - dx / cam.s; cam.y = pan.cam.y - dy / cam.s; if (moved) feelEdge();
      samples.push({ t: performance.now(), ...p }); if (samples.length > 6) samples.shift();
      kick(); onCamera?.();
    }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e); pts.delete(e.pointerId);
    if (hold?.on) { const h = hold, lp = loupe; hold = null; loupe = null; kick(); clearTimeout(h.t); onHold("end", e.type === "pointercancel" ? null : lp ? lp.n : hit(p.x, p.y), e.clientX, e.clientY); pan = null; return; }
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
      } else { lastTap = now; const k = onLayer && ringAt(p.x, p.y); if (k) onLayer(k); else onTap?.(hit(p.x, p.y)); }
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
    for (const g of tags) if (sx >= g.l && sx <= g.r && sy >= g.t && sy <= g.b) return g.n; // names first: they are what you aim at
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
  let lastFit = 0; const tags = [];
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
      if (Math.hypot(vel.x, vel.y) * cam.s < 0.01) vel = null; busy = true; onCamera?.(); feelEdge();
    }
    // The map is the room above the sheet, one body with it (M6): as the sheet rises the map shrinks in the
    // same frame, about the free region's centre, by the side that limits a fit (the width on a phone at rest).
    { const r = R(), fit = Math.min(r.w, r.h); if (lastFit && Math.abs(fit - lastFit) > 0.5 && !tween && !pinch) { cam.s = clamp(cam.s * fit / lastFit, 0.015, 12); /* below the pinch floor: a 140 px map still holds the whole map */ busy = true; onCamera?.(); } lastFit = fit; }
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
    if (form) {
      const t = form.on ? 1 : 0; form.k += (t - form.k) * (reduced ? 1 : 1 - Math.exp(-dt / 420));
      if (Math.abs(t - form.k) < 0.002) form.k = t; else busy = true;
      if (!form.on && form.k === 0) { for (const n of g.leaves) n.fm = null; form = null; gen++; busy = true; }
    }
    fe = form ? easeIO(form.k) : 0;
    const live = !!(motion && playing && !playing.paused && !reduced);
    dk += ((live ? 1 : 0) - dk) * (1 - Math.exp(-dt / 260));
    if (!live && dk < 0.003) dk = 0;
    const dm = (1 - fe) * dk * zoomDamp(cam.s, Math.min(W, H) * 0.95 / (2 * (g.outer + 30))); // vs the whole-map scale: zoomed in, settle and stop forcing redraws
    lblK = lite ? 1 - fe : (1 - clamp(dm * 4, 0, 1)) * (1 - fe); // dancing: labels step aside; paused, motion off or zoomed in: back (a TV's skeleton holds still, so its labels stay)
    const settled = !busy; // nothing but the dance moves this frame
    danceK = clamp(dm * 4, 0, 1);
    if (dm < 0.003) { poses = null; tufts.clear(); } else { poses = dancePoses(dm, dt / 1000); busy = true; }
    // ...and it steps every other frame: the tracks' JS is ~11 ms a frame on the QN85B's CPU, so stepping every frame
    // dropped every other one anyway (24 ms frames); stepping on alternate frames holds the screen at 60 fps (16.8 ms).
    if (fly && !gp && poses && settled && flyOn && (step = !step)) { kick(); return; } // (the GPU path needs no skipping)
    place(bt);
    draw(now, bt, busy, settled);
    if (busy || glow || (playing && (!playing.paused || playing.loading)) || performance.now() - landT < 460) kick();
  }

  function dancePoses(dm, dts) {
    const b = playing?.beat?.(); if (!b) return null;
    const pn = g.byId.get(playing.id), c = pn?.t?.f?.camelot, lensId = org?.id ?? "feel";
    const tune = { bpm: 60 / b.len, key: c ? +String(c).slice(0, -1) : null };
    dpos = b.i + b.ph;
    const out = new Map();
    for (const f of g.root.children) {
      // The playing track's group leads at full size; the rest are its chorus at 0.4, so the eye finds the lead.
      const gi = org?.byId?.[f.feel]?.i ?? 0, p = pose(lensId, f.feel, gi, dpos, tune), m = dm * (!pn || pn.feel === f.feel ? 1 : 0.4);
      const k = 1 + (p.k - 1) * m, da = p.da * m, T = tufts.get(f.feel) ?? tufts.set(f.feel, tuft(null, k, da)).get(f.feel), sp = tuftOf(lensId, f.feel, gi, tune.bpm);
      tuft(T, k, da, dts, sp.hz, sp.zeta);
      // hop and jit are screen px in dance.js: in world px they'd vanish at the whole-map scale (~0.1)
      out.set(f.feel, { k, da, spread: p.spread * m, hop: (p.hop * m) / cam.s, jit: (p.jit * m) / cam.s, tw: p.tw * m, open: p.open * m, ac: f.a, step: Math.floor(dpos * 4), T });
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
    // The GPU dances a TV's tracks (glDance): only the few the 2D overlay draws (web rings, the playing and focused
    // track) need JS positions; the rest keep their last ones, which only the pills read.
    const lean = gp && dots && gp.src === dots && flyOn && poses;
    for (const n of g.byId.values()) {
      if (lean && n.level === 4 && n.t.src !== "web" && n.id !== playing?.id && n.id !== focusId) continue;
      const x = n.dx * gl[n.level], y = n.dy * gl[n.level], P = poses && (lite ? n.level === 4 : n.level > 0) ? poses.get(n.feel) : null;
      if (!P) { n.vx = x; n.vy = y; n.va = n.a; n.vr = 1; continue; }
      if (n.px !== x || n.py !== y) { n.px = x; n.py = y; n.pr = Math.hypot(x, y); n.pa = Math.atan2(y, x); if (n.level === 4) { n.ap = Math.atan2(n.parent.dy, n.parent.dx); n.ro = rowOff(n); } }
      const T = n.level === 4 ? P.T : null; // tracks swing on their tuft's spring, not rigidly with the arm
      let r = n.pr * P.k, a = n.pa + P.da + wrap(n.pa - P.ac) * P.spread;
      if (T) { // the tuft: rows spread about its middle row, columns fan about the stalk (glDance mirrors this)
        const st = ((T.spread || 0) + (P.open || 0)) * (0.8 + 0.4 * (n.seed ??= seedOf(n.id)));
        r = (n.pr - n.ro) * T.y + n.ro * (1 + st);
        a = n.ap + wrap(n.pa - n.ap) * (1 + 0.35 * st) + T.a + wrap(n.pa - P.ac) * P.spread;
      }
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
    if (!fe) return;
    const F = formGeom();
    for (const n of g.leaves) {
      const c = n.fm; if (!c) continue;
      const s = (n.seed ??= seedOf(n.id)), k = easeIO(clamp(form.k * 1.5 - s * 0.5, 0, 1)); // staggered, so it pours in
      n.vx += (F.wx(F.sx0 + (c[0] + 0.5) * F.m) - n.vx) * k; n.vy += (F.wy(F.sy0 + (c[1] + 0.5) * F.m) - n.vy) * k;
    }
  }

  function draw(now, bt, busy, settled) {
    const key = [cam.x, cam.y, cam.s, W, H, dpr, gen, focusId, hoverId].join("|");
    // Moving frames draw straight to the screen (caching them would raster twice); once settled the
    // static layer is cached and later frames (playback pulse) only blit it.
    if (fly && poses && settled) { // a TV dancing: the still skeleton (glow, bands, edges, nodes, labels) stays put; only the tracks redraw (QN85B: the skeleton was ~60 of 70 ms a frame)
      if (key + "|base" !== layerKey) { const pz = poses; poses = null; ctx = screen; drawStatic(bt, "base"); poses = pz; layerKey = key + "|base"; }
      ctx = fctx; fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fly.width, fly.height); flyOn = true;
      drawStatic(bt, "dots"); if (fe < 0.05) drawOverlay(bt); drawLoupe();
      ctx = screen; return;
    }
    if (flyOn) { fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fly.width, fly.height); flyOn = false; gp?.clear(); }
    if (busy) { ctx = screen; drawStatic(bt); layerKey = ""; }
    else {
      if (key !== layerKey) { ctx = lctx; drawStatic(bt); ctx = screen; layerKey = key; }
      screen.setTransform(1, 0, 0, 1, 0, 0); screen.globalAlpha = 1; if (backdrop) screen.clearRect(0, 0, canvas.width, canvas.height); screen.drawImage(layer, 0, 0);
    }
    if (fe < 0.05) drawOverlay(bt); // the beat ring and pills would sit on the code
    drawLoupe();
  }
  const grow = (bt, lvl) => clamp(easeOutBack(clamp((bt - lvl * 0.11) / 0.75, 0, 1)), 0, 1.2);

  function drawStatic(bt, part = "all") { // part: "base" (everything but the tracks), "dots" (only the tracks) or "all"
    const P = pal(), { cx, cy } = centre(), s = cam.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
    if (part !== "dots") {
    if (backdrop) { ctx.clearRect(0, 0, W, H); ctx.globalAlpha = 0.62; } // a video plays under the map (M8): veil it, don't hide it
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    // Soft vignette glow behind the ring.
    const gx = cx - cam.x * s, gy = cy - cam.y * s, gr = Math.max(60, g.outer * s * 1.05);
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    grad.addColorStop(0, theme === "dark" ? "rgba(95,211,220,.06)" : "rgba(47,111,214,.05)"); grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
    const F = fe ? formGeom() : null, fo = 1 - fe; // fo: everything that isn't the code fades out
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cx - cam.x * s), dpr * (cy - cam.y * s));
    const gr4 = (lvl) => grow(bt, lvl);
    const X = (n) => n.vx, Y = (n) => n.vy;
    const vx0 = cam.x - cx / s - 40, vx1 = cam.x + (W - cx) / s + 40, vy0 = cam.y - cy / s - 40, vy1 = cam.y + (H - cy) / s + 40;
    if (part !== "dots") {
    // Style bands: a tinted annular sector under each style's tracks.
    const inner = g.R4 + 6, outer = g.outer + 2;
    for (const st of g.styles) {
      const a = (st.al ?? 1) * gr4(3) * fo; if (a < 0.02) continue;
      ctx.globalAlpha = a * (st.id === focusId || st.id === hoverId ? 0.22 : 0.09);
      ctx.fillStyle = colN(st);
      const b0 = angOf(st.feel, st.a0 - g.step * 0.6), b1 = angOf(st.feel, st.a1 + g.step * 0.6), bk = kOf(st.feel) * gr4(4);
      ctx.beginPath(); ctx.arc(0, 0, outer * bk, b0, b1); ctx.arc(0, 0, inner * bk, b1, b0, true); ctx.closePath(); ctx.fill();
    }
    // Edges.
    ctx.lineCap = "round";
    for (const n of g.byId.values()) {
      if (n.level === 0 || n.level === 4) continue;
      const p = n.parent, a = Math.min(n.al ?? 1, p.al ?? 1) * fo; if (a < 0.02) continue;
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
        // Far ends hold at rest while the map dances (two dancing endpoints made the arcs the loudest motion on screen).
        const x1 = poses && m.px != null ? m.px : X(m), y1 = poses && m.py != null ? m.py : Y(m), bx = (x0 + x1) * 0.22, by = (y0 + y1) * 0.22; // control point pulled to the hub
        // de Casteljau split at linkK draws the arc in from the source.
        const k = linkK, ax = x0 + (bx - x0) * k, ay = y0 + (by - y0) * k, cx2 = bx + (x1 - bx) * k, cy2 = by + (y1 - by) * k;
        ctx.globalAlpha = (0.25 + 0.6 * w) * fo * (1 - 0.6 * danceK); ctx.strokeStyle = (lens && lens(m.t)) || colN(m); ctx.lineWidth = (1 + 1.6 * w) / Math.max(s, 0.35);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(ax, ay, ax + (cx2 - ax) * k, ay + (cy2 - ay) * k); ctx.stroke();
      }
    }
    }
    if (part !== "base") {
    // Tracks. Dim ones are grey; lit ones carry their feel colour (or the lens colour).
    const g4 = gr4(4);
    // Batched: one path per colour and alpha step instead of a fill per dot (~1.8k dots).
    let buckets = new Map(), rings = [];
    const keep = part === "dots" ? dots && dots.key === layerKey && dots : null, rec = part === "dots" && !keep ? (dots = { key: layerKey, b: new Map(), rings: [] }) : null;
    const onGpu = gp && ctx === fctx; // the GPU dances the dots (glDance); only the few web-source rings stay on the 2D overlay
    if (keep && onGpu) for (const n of keep.rings) rings.push(n.vx, n.vy, n.br * n.vr);
    else if (keep) { // QN85B: the per-dot colour key and Map lookup were ~4 of the ~13 ms a dancing frame took
      for (const [k, ns] of keep.b) { const b = []; for (const n of ns) b.push(n.vx, n.vy, n.br * n.vr); buckets.set(k, b); }
      for (const n of keep.rings) rings.push(n.vx, n.vy, n.br * n.vr);
    } else for (const n of g.leaves) {
      const x = n.vx, y = n.vy; if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const a0 = n.al ?? 1, fm = F && n.fm, a = !F ? a0 : fm ? a0 + (1 - a0) * fe : a0 * fo; if (a < 0.02) continue;
      const on = a > 0.5;
      let r = (n.t.src === "shortlist" && on ? DOT * 1.25 : DOT) * (0.6 + 0.4 * a) * n.vr;
      // QR modules glow in their feel colour on the dark ground (an inverted code: light modules, no plate). Data dots
      // ripple out from the centre as they land, then hold still (a per-frame ripple redraws the whole map: 40 ms frames on the QN85B); finder dots melt into the drawn finder eyes (drawFinders).
      if (fm) { if (fm[2]) r *= 1 - fe; else r += (F.r * (0.8 + 0.2 * Math.sin(F.t - Math.hypot(fm[0] - F.c, fm[1] - F.c) * 0.55)) - r) * fe; }
      // Under a lens, unmeasured tracks go neutral.
      const k = (on || fm ? (lens ? lens(n.t) ?? P.mute : colN(n)) : P.dim) + "|" + (fm ? (fm[2] ? Math.round((1 - fe) * 8) / 8 : 1) : on ? Math.round(a * 8) / 8 : 0.55);
      let b = buckets.get(k); if (!b) buckets.set(k, (b = []));
      b.push(x, y, r);
      if (n.t.src === "web" && on && !fm) rings.push(x, y, r);
      if (rec) { n.br = r / n.vr; let ns = rec.b.get(k); if (!ns) rec.b.set(k, (ns = [])); ns.push(n); if (n.t.src === "web" && on && !fm) rec.rings.push(n); }
    }
    // Dots under ~2.5 device px can't read as round (least of all from a sofa), and squares of the same area
    // rasterise far cheaper than arcs: on a TV the zoomed-out map is all such dots, ~1.8k a frame while dancing.
    const tiny = 2.5 / (s * dpr);
    if (onGpu) { if (gp.src !== dots) gp.load(dots, seedOf); gp.dance(ctx.getTransform(), glc.width, glc.height, poses, dpos); }
    else for (const [k, b] of buckets) {
      const [c, a] = k.split("|"); if (+a < 0.02) continue; ctx.beginPath();
      for (let i = 0; i < b.length; i += 3) {
        const r = b[i + 2];
        if (r < tiny) { const h = r * 0.886; ctx.rect(b[i] - h, b[i + 1] - h, h * 2, h * 2); } // same area as the disc
        else { ctx.moveTo(b[i] + r, b[i + 1]); ctx.arc(b[i], b[i + 1], r, 0, TAU); }
      }
      ctx.globalAlpha = +a;
      ctx.fillStyle = c; ctx.fill();
    }
    if (F) drawFinders(F);
    if (rings.length) { ctx.globalAlpha = 0.9; ctx.strokeStyle = P.ink; ctx.lineWidth = 1 / Math.max(s, 0.5); ctx.beginPath(); for (let i = 0; i < rings.length; i += 3) { ctx.moveTo(rings[i] + rings[i + 2], rings[i + 1]); ctx.arc(rings[i], rings[i + 1], rings[i + 2], 0, TAU); } ctx.stroke(); }
    }
    if (part !== "dots") {
    // Structural nodes.
    for (const n of g.byId.values()) {
      if (n.level === 4) continue;
      const a = (n.al ?? 1) * clamp(gr4(n.level), 0, 1) * fo; if (a < 0.02) continue;
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
    tags.length = 0; const away = [];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
    const sx = (n) => cx + (X(n) - cam.x) * s, sy = (n) => cy + (Y(n) - cam.y) * s;
    ctx.lineJoin = "round"; ctx.textBaseline = "middle";
    for (const n of g.byId.values()) {
      if (n.level === 0 || n.level === 4) continue;
      const a = (n.al ?? 1) * clamp(gr4(n.level) * 1.2 - 0.2, 0, 1) * fo;
      const minS = [0, 0, 0.42, 0.95][n.level], fade = clamp((s - minS) / (minS * 0.35 + 0.05), 0, 1);
      // feel names are the legend (M3): they hold through the dance and, off-screen, pin to the nearest edge as a compass tag
      const k = n.level === 1 ? Math.max(lblK, 0.9) : lblK;
      if (a * fade * k < 0.05) continue;
      let x = sx(n), y = sy(n);
      if (x < -120 || x > W + 120 || y < -40 || y > H + 40) { if (n.level === 1 && s >= 1.2) away.push(n); continue; }
      ctx.globalAlpha = a * fade * k;
      const ux = Math.cos(n.va), uy = Math.sin(n.va);
      if (n.level === 1) { ctx.font = "13px 'Archivo Black', sans-serif"; text(n.name.toUpperCase(), x + ux * 38 * Math.min(1, 0.55 + s), y + uy * 30 * Math.min(1, 0.55 + s), ux, col(n.feel), P.bg, n); }
      else if (n.level === 2) { ctx.font = "600 12px 'Instrument Sans', sans-serif"; text(n.name, x + ux * 18, y + uy * 18, ux, P.ink, P.bg); }
      else { ctx.font = "11px 'IBM Plex Mono', monospace"; text(n.name, x + ux * 14, y + uy * 14, ux, P.mute, P.bg); }
    }
    // Compass: a feel with no song on screen points the way to its nearest song, from the edge of the free map.
    // Hubs all sit near the centre, so aim at songs, not hubs; a tag that would overlap a nearer one is dropped.
    if (away.length) {
      const r = R(), mx = r.x + r.w / 2, my = r.y + r.h / 2, near = new Map();
      for (const L of g.leaves) { const d = (X(L) - cam.x) ** 2 + (Y(L) - cam.y) ** 2, b = near.get(L.feel); if (!b || d < b.d) near.set(L.feel, { L, d }); }
      ctx.font = "10px 'Archivo Black', sans-serif"; const put = [];
      for (const n of away.map((n) => ({ n, b: near.get(n.feel) })).filter((o) => o.b).sort((a, b) => a.b.d - b.b.d)) {
        const qx = sx(n.b.L), qy = sy(n.b.L); if (qx > r.x && qx < r.x + r.w && qy > r.y && qy < r.y + r.h) continue; // it is on screen already
        const dx = qx - mx, dy = qy - my, k = Math.min((r.w / 2 - 44) / Math.abs(dx || 1e-6), (r.h / 2 - 14) / Math.abs(dy || 1e-6));
        const px = mx + dx * k, py = my + dy * k, lab = (dx < 0 ? "‹ " : "") + n.n.name.toUpperCase() + (dx >= 0 ? " ›" : ""), w2 = ctx.measureText(lab).width / 2 + 6;
        if (put.some((o) => Math.abs(o.x - px) < o.w + w2 && Math.abs(o.y - py) < 18)) continue;
        put.push({ x: px, y: py, w: w2 }); ctx.globalAlpha = 0.8; text(lab, px, py, 0, col(n.n.feel), P.bg, n.n);
      }
    }
    }
  }

  // A held filter chip lights its group: light leaves the hub, runs out along the group's own arm (feel -> family ->
  // style) and each track lights as the front reaches it; the rest of the map dims under it. Let go: it fades.
  // Overlay only (the cached map layer is untouched), drawn on the danced positions so it rides the beat.
  let glow = null;
  function setGlow(gid) {
    const now = performance.now();
    if (gid) { const f = g.byId.get("f:" + gid); glow = { gid, f, t0: now, out: 0, k: 0, k0: 0 }; }
    else if (glow) glow.out = glow.out || now;
    kick();
  }
  function drawGlow(P) {
    const now = performance.now(), G = glow, f = G.f, sm = (x) => x * x * (3 - 2 * x);
    G.k = G.out ? Math.max(0, G.k0 * (1 - (now - G.out) / 480)) : Math.min(1, (now - G.t0) / 320);
    if (G.out && G.k <= 0) { glow = null; return; }
    if (!G.out) G.k0 = G.k;
    const k = sm(G.k), reach = g.outer + 30, run = reduced ? 1 : clamp((now - G.t0) / 1100, 0, 1), R = reach * (1 - Math.pow(1 - run, 4)) + 1; // a slow ease-out front
    const s = cam.s, px = 1 / s, c = f ? colN(f) : P.ink, FE = 90; // FE: the front's feather, world px
    // the rest of the map steps back a little, in screen space
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 0.32 * k; ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    // a quiet light at the hub where it starts
    const hr = 34 * px, hub = ctx.createRadialGradient(0, 0, 0, 0, 0, hr); hub.addColorStop(0, c); hub.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = k * 0.45; ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(0, 0, hr, 0, TAU); ctx.fill();
    if (f) {
      const nodes = subtree(f).map((id) => g.byId.get(id)), arms = nodes.filter((n) => n.level < 4), leaves = nodes.filter((n) => n.level === 4 && (n.al ?? 1) > 0.5);
      // the arms take the light through a feathered radial edge, so the front has no hard line
      const fr = ctx.createRadialGradient(0, 0, Math.max(0, R - FE), 0, 0, R + 1); fr.addColorStop(0, c); fr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.lineCap = "round"; ctx.strokeStyle = R > FE ? fr : c;
      for (const [w, a] of [[4.5, 0.1], [1.5, 0.6]]) { // a faint bloom under a fine line
        ctx.globalAlpha = a * k; ctx.lineWidth = w * px; ctx.beginPath();
        for (const n of arms) {
          const p = n.parent, x = n.vx, y = n.vy;
          if (p.level === 0) { ctx.moveTo(0, 0); ctx.lineTo(x, y); continue; }
          const rm = (Math.hypot(p.vx, p.vy) + Math.hypot(x, y)) / 2;
          ctx.moveTo(p.vx, p.vy); ctx.bezierCurveTo(Math.cos(p.va) * rm, Math.sin(p.va) * rm, Math.cos(n.va) * rm, Math.sin(n.va) * rm, x, y);
        }
        ctx.stroke();
      }
      // tracks ease in as the front passes them (four alpha steps keep it to a few batched paths)
      const steps = [[], [], [], []];
      for (const n of leaves) { const d = (R - Math.hypot(n.vx, n.vy)) / FE; if (d > 0) steps[Math.min(3, Math.floor(sm(Math.min(1, d)) * 4))].push(n); }
      ctx.fillStyle = c;
      steps.forEach((list, i) => {
        if (!list.length) return; const a = k * (i + 1) / 4;
        ctx.globalAlpha = 0.12 * a; ctx.beginPath(); for (const n of list) { const r = DOT * 2 * n.vr; ctx.moveTo(n.vx + r, n.vy); ctx.arc(n.vx, n.vy, r, 0, TAU); } ctx.fill();
        ctx.globalAlpha = 0.7 * a; ctx.beginPath(); for (const n of list) { const r = DOT * 1.05 * n.vr; ctx.moveTo(n.vx + r, n.vy); ctx.arc(n.vx, n.vy, r, 0, TAU); } ctx.fill();
      });
    }
    ctx.restore();
  }
  function drawOverlay(bt) {
    const P = pal(), { cx, cy } = centre(), s = cam.s, g4 = grow(bt, 4);
    const X = (n) => n.vx, Y = (n) => n.vy;
    const sx = (n) => cx + (X(n) - cam.x) * s, sy = (n) => cy + (Y(n) - cam.y) * s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cx - cam.x * s), dpr * (cy - cam.y * s));
    if (glow) { drawGlow(P); ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cx - cam.x * s), dpr * (cy - cam.y * s)); }
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
      const rr = DOT + 4.5, ago = performance.now() - landT;
      if (playing.loading && !reduced) { // asked, not yet heard: a ring draws in toward the dot, again and again
        const k = (performance.now() % 700) / 700;
        ctx.globalAlpha = 0.25 + 0.6 * k; ctx.strokeStyle = c; ctx.lineWidth = 2 * px;
        ctx.beginPath(); ctx.arc(x, y, rr + (1 - k) * (1 - k) * 22 * px, 0, TAU); ctx.stroke();
      }
      if (ago < 460 && !reduced) { // heard: it lets go, outward, once
        const k = ago / 460;
        ctx.globalAlpha = 0.85 * (1 - k); ctx.strokeStyle = c; ctx.lineWidth = (2.6 - 1.6 * k) * px;
        ctx.beginPath(); ctx.arc(x, y, rr + (1 - (1 - k) ** 3) * 30 * px, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.lineWidth = 2.6 * px; ctx.strokeStyle = P.line; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(playing.progress?.() ?? 0, 0, 1)); ctx.stroke();
      ctx.fillStyle = P.ink; ctx.beginPath(); ctx.arc(x, y, DOT * 0.55, 0, TAU); ctx.fill();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.textBaseline = "middle";
    drawRings(P, sx, sy);
    // Track pills: playing, focused and the top results, when zoomed in enough to place them.
    const pills = lblK < 0.05 ? [] : [...new Set([rings ? null : playing?.id, rings ? null : focusId, ...(links && linkK > 0.9 ? links.list.slice(0, 5).map((l) => l.id) : []), ...(s > 0.7 ? featured : [])])].map((id) => g.byId.get(id)).filter((n) => n?.level === 4);
    ctx.font = "italic 14px 'Instrument Serif', serif"; // track titles: the work itself
    const placed = [];
    for (const n of pills) {
      const x = sx(n), y = sy(n), rg = R(); if (x < -20 || x > W + 20 || y < rg.y || y > rg.y + rg.h) continue; // stay in the free region, off the chips and sheet
      const label = n.t.title.length > 30 ? n.t.title.slice(0, 29) + "…" : n.t.title, w = ctx.measureText(label).width + 16, h = 22;
      let bx = x + 10, by = y - h - 6; if (bx + w > W - 6) bx = x - w - 10; if (by < rg.y + 4) by = y + 8;
      if (placed.some((p) => bx < p.x + p.w && bx + w > p.x && by < p.y + p.h && by + h > p.y)) continue;
      placed.push({ x: bx, y: by, w, h });
      ctx.globalAlpha = Math.max(0.35, n.al ?? 1) * lblK; ctx.fillStyle = P.panel; ctx.strokeStyle = colN(n); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, w, h, 11); ctx.fill(); ctx.stroke();
      ctx.fillStyle = P.ink; ctx.textAlign = "left"; ctx.fillText(label, bx + 8, by + h / 2 + 0.5);
    }
  }
  // Each layer is a ring; one turn = the whole song from 12 o'clock, tick length = that layer's loudness.
  // The played part is solid, the rest faint, a muted layer fades out; a hand marks the playhead.
  const ranges = new Map(); // env string -> [lo, hi], so each frame skips re-scanning ~500 samples per lane
  const envRange = (env) => { let r = ranges.get(env); if (!r) { const xs = [...env].map(Number), lo = Math.min(...xs); ranges.set(env, (r = [lo, Math.max(lo + 1, ...xs)])); } return r; };
  function drawRings(P, sx, sy) {
    rings = null;
    const k = layerK(), pn = playing && g.byId.get(playing.id), L = k > 0 && pn && layersOf?.(pn.id);
    if (!L?.lanes?.length) return;
    const x = sx(pn), y = sy(pn), prog = clamp(playing.progress?.() ?? 0, 0, 1), now = -Math.PI / 2 + TAU * prog;
    rings = { x, y, lanes: L.lanes };
    ctx.lineCap = "butt";
    L.lanes.forEach((ln, i) => {
      const r = RING0 + i * RING_W, env = ln.env, [lo, hi] = envRange(env), N = Math.min(env.length, Math.max(48, Math.round(r * 2.2))), step = env.length / N;
      ctx.globalAlpha = k * 0.12; ctx.strokeStyle = ln.color; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.lineWidth = Math.max(1.2, (TAU * r / N) * 0.62);
      for (const played of [true, false]) {
        ctx.globalAlpha = k * (ln.on ? (played ? 1 : 0.3) : 0.08); ctx.beginPath();
        for (let j = 0; j < N; j++) {
          const f = j / N; if ((f < prog) !== played) continue;
          let v = 0; for (let q = Math.floor(j * step); q < Math.min(env.length, Math.floor((j + 1) * step) || 1); q++) v = Math.max(v, +env[q]);
          if (v <= lo && lo === 0) continue;
          const a = -Math.PI / 2 + TAU * (f + 0.5 / N), h = (RING_W - 3) * (0.12 + 0.88 * (v - lo) / (hi - lo)) / 2, c = Math.cos(a), s2 = Math.sin(a);
          ctx.moveTo(x + c * (r - h), y + s2 * (r - h)); ctx.lineTo(x + c * (r + h), y + s2 * (r + h));
        }
        ctx.stroke();
      }
    });
    const rOut = RING0 + L.lanes.length * RING_W;
    ctx.globalAlpha = k; ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x + Math.cos(now) * (RING0 - 6), y + Math.sin(now) * (RING0 - 6)); ctx.lineTo(x + Math.cos(now) * (rOut - 2), y + Math.sin(now) * (rOut - 2)); ctx.stroke();
    // Legend to the left of the rings, inner lane at the bottom like the rings themselves (mono: a measurement).
    ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textBaseline = "middle";
    const lx = x - rOut - 10, n = L.lanes.length;
    L.lanes.forEach((ln, i) => {
      const ly = y + ((n - 1) / 2 - i) * 14;
      ctx.globalAlpha = k * (ln.on ? 1 : 0.35); text(ln.name.split(" ")[0].toLowerCase(), lx - 10, ly, -1, ln.color, P.bg); // short names keep the legend on screen
      ctx.fillStyle = ln.color; ctx.beginPath(); ctx.arc(lx - 3, ly, 3, 0, TAU); ctx.fill();
    });
  }
  function text(str, x, y, ux, fill, halo, node) {
    ctx.textAlign = Math.abs(ux) < 0.3 ? "center" : ux > 0 ? "left" : "right";
    if (node) { const w = ctx.measureText(str).width, l = ctx.textAlign === "center" ? x - w / 2 : ctx.textAlign === "left" ? x : x - w; tags.push({ n: node, l: l - 8, r: l + w + 8, t: y - 16, b: y + 16 }); } // a feel's name is a 32 px target
    ctx.strokeStyle = halo; ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.strokeText(str, x, y); ctx.fillStyle = fill; ctx.fillText(str, x, y);
  }

  let hoverId = null;
  canvas.addEventListener("pointermove", (e) => { if (e.pointerType !== "mouse" || pan) return; const p = local(e), h = hit(p.x, p.y); const id = h?.id ?? null; canvas.style.cursor = h ? "pointer" : "grab"; if (id !== hoverId) { hoverId = id; kick(); } });

  resize();
  return {
    get graph() { return g; }, get cam() { return cam; },
    setMotion(v) { motion = !!v; kick(); }, get motion() { return motion; }, get labels() { return lblK; }, get tags() { return tags.map((g) => ({ id: g.n.id, feel: g.n.feel, x: (g.l + g.r) / 2, y: (g.t + g.b) / 2 })); },
    setFormation, get formation() { return !!form?.on; },
    setTracks, setGlow, get glow() { return glow && { gid: glow.gid, k: glow.k }; }, setLit, setFeatured, setPlaying, setTheme, setLens, setLinks, setLayers, zoomOn, focus, flyToIds, fitAll, kick, resize,
    flyCam(c, ms) { flyTo({ ...c }, ms); }, get layerK() { return layerK(); },
    get region() { return R(); }, setBackdrop,
    get loupe() { return loupe && { ...loupeAt(), m: loupe.m, id: loupe.n?.id ?? null, cross: loupe.w }; },
    // Is this node's dot at least m px inside the free region, on screen right now?
    screenOf(id) { const n = g.byId.get(id); if (!n) return null; const { cx, cy } = centre(); return { x: cx + (n.vx - cam.x) * cam.s, y: cy + (n.vy - cam.y) * cam.s }; },
    inView(id, m = 0) { const p = this.screenOf(id), r = R(); return !!p && p.x >= r.x + m && p.x <= r.x + r.w - m && p.y >= r.y + m && p.y <= r.y + r.h - m; },
    get focusId() { return focusId; }, set focusId(v) { focusId = v; kick(); },
  };
}
