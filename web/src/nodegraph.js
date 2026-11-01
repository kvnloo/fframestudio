// Node graph with magnetic, gooey port connections.
// Interaction reference: @mrblackstudio, x.com/mrblackstudio/status/2116825570252112336
// (frame ledger in docs/research/node-graph-interaction-20261101.md). Behaviour, not code, is
// borrowed: ports only attract cables of their own type, a translucent halo grows out of the
// target port and joins the cable tip with a metaball neck, release collapses the halo and
// fires a ring, and a pulled-out cable stays tethered until the neck tears.

const SVG = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = t => (t = clamp(t), t * t * (3 - 2 * t));
const easeOut = t => 1 - (1 - clamp(t)) ** 3;
const easeIn = t => clamp(t) ** 2;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const polar = (c, a, r) => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
const f = n => Math.round(n * 100) / 100;
const el = (tag, attrs = {}, parent) => { const n = document.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent?.append(n); return n; };

// Type colours. The first four match the reference; the rest cover ComfyUI's core socket types.
export const TYPE_COLORS = {
  video: '#dfe46f', audio: '#e5735f', control: '#a9b4dc', data: '#cfcfcf',
  MODEL: '#a9b4dc', CLIP: '#dfe46f', VAE: '#e5735f', CONDITIONING: '#f0a66a', LATENT: '#e48bbd',
  IMAGE: '#86d4b0', MASK: '#cfcfcf', CONTROL_NET: '#8fb8f0', CLIP_VISION: '#c2a6f0', '*': '#cfcfcf',
};
export const colorOf = type => TYPE_COLORS[type] || TYPE_COLORS['*'];

// Tunables measured from the reference (R = halo radius ≈ 1.05 × port row spacing).
export const FEEL = {
  R: 27,                 // halo radius, px at zoom 1
  attract: 3.0,          // halo starts growing at this many R from the port (frame 43)
  capture: 1.7,          // halo is full and joined to the tip by a neck inside this many R (frames 548–571)
  release: 1.95,         // captured tip escapes beyond this (hysteresis, no flicker between ports)
  hold: 0.58,            // once the pointer is inside the halo, the tip rests at this fraction of its offset
  tipR: 0.3,             // tip blob radius in R
  tear: 2.05,            // a pulled-out cable's neck tears beyond this many R
  collapseMs: 130, ringMs: 430, sparkMs: 300, retractMs: 220,
};

// Outline of two circles joined by a metaball neck (after Hiroyuki Sato's paper.js metaball).
// Returns an SVG path string, or null when the circles are too far apart to join.
export function metaballPath(c1, r1, c2, r2, { v = 0.5, handle = 2.4, maxDist = r1 + r2 * 3 } = {}) {
  const d = dist(c1, c2);
  if (r1 <= 0 || r2 <= 0 || d > maxDist) return null;
  const circle = (c, r) => `M${f(c.x - r)} ${f(c.y)}a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-r * 2)} 0Z`;
  if (d <= Math.abs(r1 - r2)) return r1 >= r2 ? circle(c1, r1) : circle(c2, r2);
  let u1 = 0, u2 = 0;
  if (d < r1 + r2) {
    u1 = Math.acos(clamp((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d), -1, 1));
    u2 = Math.acos(clamp((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d), -1, 1));
  }
  const ab = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const spread = Math.acos(clamp((r1 - r2) / d, -1, 1));
  const a1 = ab + u1 + (spread - u1) * v, a2 = ab - u1 - (spread - u1) * v;
  const a3 = ab + Math.PI - u2 - (Math.PI - u2 - spread) * v, a4 = ab - Math.PI + u2 + (Math.PI - u2 - spread) * v;
  const p1a = polar(c1, a1, r1), p1b = polar(c1, a2, r1), p2a = polar(c2, a3, r2), p2b = polar(c2, a4, r2);
  let k = Math.min(v * handle, dist(p1a, p2a) / (r1 + r2));
  k *= Math.min(1, (d * 2) / (r1 + r2));
  const h1 = polar(p1a, a1 - Math.PI / 2, r1 * k), h2 = polar(p2a, a3 + Math.PI / 2, r2 * k);
  const h3 = polar(p2b, a4 - Math.PI / 2, r2 * k), h4 = polar(p1b, a2 + Math.PI / 2, r1 * k);
  const span2 = ((a3 - a4) % TAU + TAU) % TAU, span1 = TAU - (((a1 - a2) % TAU + TAU) % TAU);
  const P = p => `${f(p.x)} ${f(p.y)}`;
  return `M${P(p1a)}C${P(h1)} ${P(h2)} ${P(p2a)}A${f(r2)} ${f(r2)} 0 ${span2 > Math.PI ? 1 : 0} 0 ${P(p2b)}`
    + `C${P(h3)} ${P(h4)} ${P(p1b)}A${f(r1)} ${f(r1)} 0 ${span1 > Math.PI ? 1 : 0} 0 ${P(p1a)}Z`;
}

// Where the cable tip is drawn for a pointer near a candidate port, and how big that port's halo is.
// Pure, so tests can pin the feel without a browser.
export function magnet(pointer, port, captured, feel = FEEL) {
  const R = feel.R, d = dist(pointer, port);
  const inside = captured ? d <= R * feel.release : d <= R * feel.capture;
  const grow = smooth((R * feel.attract - d) / (R * feel.attract - R * feel.capture));
  if (inside) {
    const off = { x: pointer.x - port.x, y: pointer.y - port.y }, m = Math.hypot(off.x, off.y) || 1;
    // Outside the disc the tip stays near the pointer on a neck; inside it settles toward the port.
    const reach = m > R ? m - (m - R) * 0.12 : Math.min(m * feel.hold, R * 0.62);
    return { captured: true, halo: R, tip: { x: port.x + off.x / m * reach, y: port.y + off.y / m * reach } };
  }
  return { captured: false, halo: R * grow, tip: lerp(pointer, port, 0.14 * grow * grow) };
}

export const compatible = (a, b) => a && b && a.node !== b.node && a.dir !== b.dir && a.type === b.type;

// Damped spring toward a moving target; dt in seconds.
// Fixed 240 Hz substeps keep semi-implicit Euler stable when a frame is long (w·h must stay < 2).
export function spring(s, target, dt, w = 34, z = 0.62) {
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) for (const k of ['x', 'y']) {
    const a = -w * w * (s[k] - target[k]) - 2 * z * w * s.v[k];
    s.v[k] += a * h; s[k] += s.v[k] * h;
  }
  return s;
}
const springAt = p => ({ x: p.x, y: p.y, v: { x: 0, y: 0 } });

export class NodeGraph {
  // graph: { nodes: [{ id, title, icon, x, y, w, h, body, inputs: [{ id, type, label, y }], outputs: [...] }],
  //          links: [{ from: [nodeId, portId], to: [nodeId, portId] }] }
  constructor(root, graph, { feel = {}, onChange = () => {}, readOnly = false } = {}) {
    this.root = root; this.feel = { ...FEEL, ...feel }; this.onChange = onChange; this.readOnly = readOnly;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.view = { x: 0, y: 0, k: 1 }; this.fx = []; this.drag = null;
    root.classList.add('ng'); root.tabIndex = 0;
    root.innerHTML = '';
    this.world = Object.assign(document.createElement('div'), { className: 'ng-world' });
    this.wires = el('svg', { class: 'ng-wires', 'aria-hidden': 'true' });
    this.layer = Object.assign(document.createElement('div'), { className: 'ng-nodes' });
    this.top = el('svg', { class: 'ng-fx', 'aria-hidden': 'true' });
    this.world.append(this.wires, this.layer, this.top); root.append(this.world);
    this.load(graph);
    root.addEventListener('pointerdown', e => this.down(e));
    root.addEventListener('pointermove', e => this.move(e));
    root.addEventListener('pointerup', e => this.up(e));
    root.addEventListener('pointercancel', e => this.up(e, true));
    root.addEventListener('wheel', e => this.wheel(e), { passive: false });
    this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(root);
    this.tick = this.tick.bind(this); this.last = performance.now(); this.raf = requestAnimationFrame(this.tick);
  }
  // Halo radius in world units. Zoomed far out (ComfyUI templates in a narrow pane) it keeps a usable
  // on-screen size instead of shrinking with the graph.
  get R() { return this.feel.R * Math.max(1, 0.75 / this.view.k); }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.root.innerHTML = ''; }

  load(graph) {
    this.nodes = new Map(); this.ports = new Map(); this.layer.innerHTML = ''; this.wires.innerHTML = '';
    for (const n of graph.nodes) this.addNode(n);
    this.links = [];
    for (const l of graph.links || []) this.link(this.port(...l.from), this.port(...l.to), false);
    this.fit();
  }
  port(node, id) { return this.ports.get(node + ':' + id); }
  addNode(spec) {
    const n = { ...spec, w: spec.w || 180, el: document.createElement('div') };
    const rows = Math.max(spec.inputs?.length || 0, spec.outputs?.length || 0);
    n.h = spec.h || Math.max(78, 46 + rows * 24);
    n.el.className = 'ng-node'; n.el.dataset.node = n.id;
    n.el.innerHTML = `<header class="ng-head"><span class="ng-icon" aria-hidden="true">${spec.icon || '◇'}</span><span class="ng-title"></span><span class="ng-grip" aria-hidden="true">⠿</span></header><div class="ng-body"></div>`;
    n.el.querySelector('.ng-title').textContent = spec.title;
    const body = n.el.querySelector('.ng-body');
    if (spec.body instanceof Node) body.append(spec.body); else if (spec.body) body.innerHTML = spec.body;
    n.el.setAttribute('role', 'group'); n.el.setAttribute('aria-label', spec.title);
    for (const dir of ['inputs', 'outputs']) (spec[dir] || []).forEach((p, i) => {
      const port = { ...p, node: n.id, dir: dir === 'inputs' ? 'in' : 'out', i, el: document.createElement('button') };
      port.dy = p.y ?? (44 + i * 24);
      port.el.className = 'ng-port'; port.el.type = 'button';
      port.el.style.setProperty('--c', colorOf(p.type));
      port.el.dataset.port = p.id; port.el.dataset.dir = port.dir; port.el.dataset.type = p.type;
      port.el.title = `${p.label || p.id} · ${p.type}`;
      port.el.setAttribute('aria-label', `${spec.title} ${port.dir === 'in' ? 'input' : 'output'} ${p.label || p.id} (${p.type})`);
      port.el.style.top = port.dy + 'px';
      port.el.style.left = port.dir === 'in' ? '0' : '100%';
      n.el.append(port.el); this.ports.set(n.id + ':' + p.id, port);
    });
    n.el.style.width = n.w + 'px'; n.el.style.height = n.h + 'px';
    this.nodes.set(n.id, n); this.layer.append(n.el); this.place(n);
    return n;
  }
  place(n) { n.el.style.transform = `translate(${n.x}px,${n.y}px)`; }
  at(p) { const n = this.nodes.get(p.node); return { x: n.x + (p.dir === 'in' ? 0 : n.w), y: n.y + p.dy }; }

  // Links own an animated cable: two spring control handles lag their targets, which gives the
  // reference's little overshoot wiggle whenever an end moves quickly.
  link(a, b, announce = true) {
    if (!compatible(a, b)) return null;
    const [out, inp] = a.dir === 'out' ? [a, b] : [b, a];
    this.links = this.links.filter(l => l.to !== inp); // an input takes one cable
    const l = { from: out, to: inp, path: el('path', { class: 'ng-wire', stroke: colorOf(out.type) }, this.wires) };
    const A = this.at(out), B = this.at(inp);
    l.h1 = springAt(this.handle(A, B, 1)); l.h2 = springAt(this.handle(A, B, -1));
    this.links.push(l); this.sync();
    if (announce) this.onChange(this.toJSON());
    return l;
  }
  unlink(l) { l.path.remove(); this.links = this.links.filter(x => x !== l); this.sync(); this.onChange(this.toJSON()); }
  handle(A, B, side) {
    const c = Math.max(36, Math.abs(B.x - A.x) * 0.5, Math.abs(B.y - A.y) * 0.32);
    return side > 0 ? { x: A.x + c, y: A.y } : { x: B.x - c, y: B.y };
  }
  sync() {
    for (const p of this.ports.values()) p.el.classList.toggle('linked', this.links.some(l => l.from === p || l.to === p));
  }
  toJSON() { return { links: this.links.map(l => ({ from: [l.from.node, l.from.id], to: [l.to.node, l.to.id] })) }; }

  // ── view ──
  fitView(pad = 24) {
    const r = this.root.getBoundingClientRect(); if (!r.width || !this.nodes.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.nodes.values()) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
    const k = clamp(Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0)), 0.35, 1.25);
    this.view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k }; this.fit();
  }
  fit() { this.world.style.transform = `translate(${this.view.x}px,${this.view.y}px) scale(${this.view.k})`; }
  local(e) { const r = this.root.getBoundingClientRect(); return { x: (e.clientX - r.left - this.view.x) / this.view.k, y: (e.clientY - r.top - this.view.y) / this.view.k }; }
  wheel(e) {
    e.preventDefault();
    const r = this.root.getBoundingClientRect(), k = clamp(this.view.k * Math.exp(-e.deltaY * 0.0015), 0.35, 3);
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    this.view.x = sx - (sx - this.view.x) * k / this.view.k; this.view.y = sy - (sy - this.view.y) * k / this.view.k; this.view.k = k; this.fit();
  }

  // ── input ──
  down(e) {
    if (e.button !== 0) return;
    const portEl = e.target.closest('.ng-port'), head = e.target.closest('.ng-head');
    const p = this.local(e);
    if (portEl && !this.readOnly) {
      const node = portEl.closest('.ng-node').dataset.node, port = this.port(node, portEl.dataset.port);
      const held = port.dir === 'in' && this.links.find(l => l.to === port);
      e.preventDefault(); this.root.setPointerCapture(e.pointerId);
      // Pull an existing cable off an input: it stays tethered to its port until the neck tears.
      const fixed = held ? held.from : port;
      if (held) { held.path.remove(); this.links = this.links.filter(x => x !== held); this.sync(); }
      this.drag = { kind: 'wire', fixed, tether: held ? port : null, torn: false, was: held || null,
        pointer: p, tip: springAt(held ? this.at(port) : p), target: null, halo: 0, haloAt: null, haloR: springAt({ x: 0, y: 0 }),
        h1: springAt(this.at(fixed)), h2: springAt(p), path: el('path', { class: 'ng-wire live', stroke: colorOf(fixed.type) }, this.wires) };
      const A = this.at(fixed); this.drag.h1 = springAt(held ? held.h1 : this.handle(A, p, fixed.dir === 'out' ? 1 : -1));
      this.drag.h2 = springAt(held ? held.h2 : A);
      this.root.classList.add('ng-dragging');
      for (const n of this.nodes.values()) n.el.classList.toggle('ng-dim', ![...this.ports.values()].some(q => q.node === n.id && (q === fixed || compatible(fixed, q))));
      if (held) this.drag.haloR.x = this.R; // the tether halo appears at full size (frame 619)
      return;
    }
    if (head) {
      const n = this.nodes.get(head.closest('.ng-node').dataset.node);
      e.preventDefault(); this.root.setPointerCapture(e.pointerId);
      this.drag = { kind: 'node', n, dx: p.x - n.x, dy: p.y - n.y }; n.el.classList.add('ng-lift');
      this.layer.append(n.el); return;
    }
    if (e.target === this.root || e.target === this.world || e.target.closest('.ng-wires')) {
      this.root.setPointerCapture(e.pointerId);
      this.drag = { kind: 'pan', sx: e.clientX - this.view.x, sy: e.clientY - this.view.y };
    }
  }
  move(e) {
    const d = this.drag;
    if (!d) {
      const portEl = e.target.closest?.('.ng-port');
      this.root.classList.toggle('ng-aim', !!portEl && !this.readOnly);
      return;
    }
    if (d.kind === 'pan') { this.view.x = e.clientX - d.sx; this.view.y = e.clientY - d.sy; this.fit(); return; }
    const p = this.local(e);
    if (d.kind === 'node') { d.n.x = p.x - d.dx; d.n.y = p.y - d.dy; this.place(d.n); return; }
    d.pointer = p;
  }
  up(e, cancel = false) {
    const d = this.drag; this.drag = null;
    this.root.classList.remove('ng-dragging');
    for (const n of this.nodes.values()) n.el.classList.remove('ng-dim', 'ng-lift');
    if (!d || d.kind !== 'wire') return;
    const target = cancel ? null : d.target || (!d.torn && d.tether) || null;
    if (target) {
      const l = this.link(d.fixed, target, !(d.was && target === d.tether));
      if (l) { l.h1 = d.fixed.dir === 'out' ? d.h1 : d.h2; l.h2 = d.fixed.dir === 'out' ? d.h2 : d.h1; }
      this.fx.push({ kind: 'snap', at: this.at(target), from: { x: d.tip.x, y: d.tip.y }, halo: Math.max(d.haloR.x, this.R * 0.6), type: target.type, t: 0, l });
      target.el.animate?.([{ transform: 'translate(-50%,-50%) scale(1.35)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 320, easing: 'cubic-bezier(.2,1.6,.4,1)' });
      d.path.remove();
      if (d.was && target !== d.tether) this.onChange(this.toJSON());
    } else {
      if (d.was) this.onChange(this.toJSON());
      this.fx.push({ kind: 'retract', d, t: 0, from: { x: d.tip.x, y: d.tip.y } });
    }
    this.halo?.remove(); this.halo = null;
  }

  // ── frame loop ──
  tick(now) {
    const dt = Math.min(0.033, (now - this.last) / 1000); this.last = now;
    const R = this.R;
    for (const l of this.links) {
      const A = this.at(l.from), B = this.at(l.to);
      spring(l.h1, this.handle(A, B, 1), dt, 26, 0.5); spring(l.h2, this.handle(A, B, -1), dt, 26, 0.5);
      l.path.setAttribute('d', `M${f(A.x)} ${f(A.y)}C${f(l.h1.x)} ${f(l.h1.y)} ${f(l.h2.x)} ${f(l.h2.y)} ${f(B.x)} ${f(B.y)}`);
    }
    const d = this.drag;
    if (d?.kind === 'wire') {
      let goal = d.pointer, haloGoal = 0, haloAt = null;
      if (d.tether && !d.torn) {
        haloAt = this.at(d.tether);
        if (dist(d.pointer, haloAt) > R * this.feel.tear) { d.torn = true; this.pop(haloAt, d.tether.type, d.tip); }
        else haloGoal = R;
      }
      if (!d.tether || d.torn) {
        let best = null, bestD = Infinity;
        for (const q of this.ports.values()) {
          if (!compatible(d.fixed, q)) continue;
          const dd = dist(d.pointer, this.at(q)) - (q === d.target ? R * 0.4 : 0);
          if (dd < bestD) { bestD = dd; best = q; }
        }
        if (best && bestD < R * this.feel.attract) {
          const m = magnet(d.pointer, this.at(best), d.target === best, { ...this.feel, R });
          goal = m.tip; haloGoal = m.halo; haloAt = this.at(best);
          d.target = m.captured ? best : null;
          d.near = best;
        } else { d.target = null; d.near = null; }
      }
      spring(d.tip, goal, dt, d.target ? 42 : 60, d.target ? 0.55 : 0.9);
      if (haloAt && d.haloAt && dist(haloAt, d.haloAt) > 1) d.haloR.x = 0; // a new port grows its own halo
      d.haloAt = haloAt || d.haloAt;
      d.haloR.x += (haloGoal - d.haloR.x) * (1 - Math.exp(-dt * 22));
      const A = this.at(d.fixed), T = { x: d.tip.x, y: d.tip.y }, out = d.fixed.dir === 'out';
      spring(d.h1, out ? this.handle(A, T, 1) : { x: A.x - Math.max(36, Math.abs(T.x - A.x) * 0.5), y: A.y }, dt, 20, 0.42);
      spring(d.h2, out ? this.handle(A, T, -1) : { x: T.x + Math.max(36, Math.abs(T.x - A.x) * 0.5), y: T.y }, dt, 20, 0.42);
      d.path.setAttribute('d', `M${f(A.x)} ${f(A.y)}C${f(d.h1.x)} ${f(d.h1.y)} ${f(d.h2.x)} ${f(d.h2.y)} ${f(T.x)} ${f(T.y)}`);
      this.drawHalo(d.haloAt, d.haloR.x, T, (d.target || d.near || d.tether || d.fixed).type, true);
    }
    this.drawFx(dt);
    this.raf = requestAnimationFrame(this.tick);
  }
  drawHalo(c, r, tip, type, withTip) {
    if (!this.halo) {
      this.halo = el('g', { class: 'ng-halo' }, this.top);
      this.haloShape = el('path', {}, this.halo); this.tipDot = el('circle', { class: 'ng-tip', r: 3.6 }, this.halo);
    }
    const color = colorOf(type); this.halo.style.setProperty('--c', color);
    const R = this.R;
    const shape = c && r > 0.6 ? metaballPath(c, r, tip, R * this.feel.tipR * clamp(r / R * 1.4), { maxDist: Math.max(r + R * this.feel.tipR * 3, R * this.feel.tear) }) : null;
    const circle = c && r > 0.6 ? metaballPath(c, r, c, 0.01) : '';
    this.haloShape.setAttribute('d', shape || circle || '');
    this.tipDot.setAttribute('cx', f(tip.x)); this.tipDot.setAttribute('cy', f(tip.y));
    this.tipDot.style.display = withTip ? '' : 'none';
  }
  pop(at, type, tip) {
    // The neck tearing leaves a small droplet that shrinks back into the port.
    this.fx.push({ kind: 'drop', at, tip: { x: tip.x, y: tip.y }, type, t: 0 });
  }
  drawFx(dt) {
    const F = this.feel, R = this.R, ms = dt * 1000;
    this.fx = this.fx.filter(x => {
      x.t += this.reduced ? ms * 4 : ms;
      x.g ||= el('g', { class: 'ng-burst' }, this.top);
      x.g.style.setProperty('--c', colorOf(x.type || x.d?.fixed.type));
      if (x.kind === 'snap') {
        // 1) tip and halo collapse into the port (≈4 frames), 2) a ring travels out and fades,
        // 3) two short sparks leave tangentially (red snap, frames 573–576).
        const c1 = clamp(x.t / F.collapseMs), tip = lerp(x.from, x.at, easeOut(c1));
        const hr = x.halo * (1 - easeIn(c1) * 0.62);
        if (!x.blob) { x.blob = el('path', { class: 'ng-halo-shape' }, x.g); x.ring = el('circle', { class: 'ng-ring' }, x.g); x.sparks = [0, 1].map(() => el('path', { class: 'ng-spark' }, x.g)); x.spin = Math.random() * TAU; }
        x.blob.setAttribute('d', c1 < 1 ? (metaballPath(x.at, hr, tip, R * F.tipR, { maxDist: R * 4 }) || '') : '');
        const rt = clamp((x.t - F.collapseMs * 0.7) / F.ringMs);
        x.ring.setAttribute('cx', x.at.x); x.ring.setAttribute('cy', x.at.y);
        x.ring.setAttribute('r', f(R * (0.4 + 0.78 * easeOut(rt))));
        x.ring.style.opacity = rt <= 0 ? 0 : f(0.9 * (1 - rt) ** 1.4);
        x.ring.style.strokeWidth = f(2.6 - 1.4 * rt);
        const st = clamp((x.t - F.collapseMs) / F.sparkMs);
        x.sparks.forEach((s, i) => {
          const a = x.spin + i * Math.PI, r0 = R * (1.05 + 0.6 * easeOut(st)), len = 0.22 * (1 - st);
          const p0 = polar(x.at, a - len, r0), p1 = polar(x.at, a + len, r0);
          s.setAttribute('d', st > 0 && st < 1 ? `M${f(p0.x)} ${f(p0.y)}A${f(r0)} ${f(r0)} 0 0 1 ${f(p1.x)} ${f(p1.y)}` : '');
          s.style.opacity = f(1 - st);
        });
        if (x.t > F.collapseMs + F.ringMs + 60) { x.g.remove(); return false; }
        return true;
      }
      if (x.kind === 'drop') {
        const t = clamp(x.t / 200);
        x.c ||= el('circle', { class: 'ng-halo-shape' }, x.g);
        const p = lerp(x.at, x.tip, 0.5 * (1 - easeOut(t)));
        x.c.setAttribute('cx', p.x); x.c.setAttribute('cy', p.y); x.c.setAttribute('r', f(R * (1 - easeOut(t)) * 0.9));
        if (t >= 1) { x.g.remove(); return false; }
        return true;
      }
      if (x.kind === 'retract') {
        // Dropped in empty space: the cable reels back into the port it came from.
        const t = clamp(x.t / F.retractMs), A = this.at(x.d.fixed), T = lerp(x.from, A, easeIn(t));
        const H1 = lerp(x.d.h1, A, easeIn(t)), H2 = lerp(x.d.h2, A, easeIn(t));
        x.d.path.setAttribute('d', `M${f(A.x)} ${f(A.y)}C${f(H1.x)} ${f(H1.y)} ${f(H2.x)} ${f(H2.y)} ${f(T.x)} ${f(T.y)}`);
        x.d.path.style.opacity = f(1 - t * 0.6);
        if (t >= 1) { x.d.path.remove(); x.g.remove(); return false; }
        return true;
      }
      return false;
    });
  }
}

// Convert a ComfyUI API-format workflow ({ id: { class_type, inputs } }) into a laid-out graph.
// Socket types come from object_info when available; otherwise a link's type is inferred from
// well-known input names so the colour rule still holds for core templates.
const NAME_TYPES = { model: 'MODEL', clip: 'CLIP', vae: 'VAE', positive: 'CONDITIONING', negative: 'CONDITIONING', conditioning: 'CONDITIONING', latent_image: 'LATENT', samples: 'LATENT', latent: 'LATENT', images: 'IMAGE', image: 'IMAGE', pixels: 'IMAGE', mask: 'MASK', control_net: 'CONTROL_NET', clip_vision: 'CLIP_VISION' };
export function graphFromWorkflow(workflow, objectInfo = {}) {
  const ids = Object.keys(workflow), outs = new Map(), links = [];
  const outType = (id, slot) => objectInfo[workflow[id].class_type]?.output?.[slot];
  for (const id of ids) for (const [name, v] of Object.entries(workflow[id].inputs || {})) {
    if (!Array.isArray(v) || v.length !== 2 || !(String(v[0]) in workflow)) continue;
    const type = outType(String(v[0]), v[1]) || NAME_TYPES[name] || name.toUpperCase();
    const key = String(v[0]);
    if (!outs.has(key)) outs.set(key, new Map());
    outs.get(key).set(v[1], type);
    links.push({ from: [key, 'o' + v[1]], to: [id, name], type });
  }
  // Depth = longest path from a source, so data flows left to right.
  const depth = {}, visit = (id, seen = new Set()) => {
    if (id in depth) return depth[id];
    if (seen.has(id)) return 0; seen.add(id);
    const ups = links.filter(l => l.to[0] === id).map(l => visit(l.from[0], seen) + 1);
    return (depth[id] = ups.length ? Math.max(...ups) : 0);
  };
  ids.forEach(id => visit(id));
  // Pull each node right to sit just before its nearest consumer (sources no longer pile up in column 0).
  for (let changed = true; changed;) {
    changed = false;
    for (const id of ids) {
      const downs = links.filter(l => l.from[0] === id).map(l => depth[l.to[0]] - 1);
      if (downs.length && Math.min(...downs) > depth[id]) { depth[id] = Math.min(...downs); changed = true; }
    }
  }
  const specs = new Map(ids.map(id => {
    const w = workflow[id];
    const inputs = links.filter(l => l.to[0] === id).map(l => ({ id: l.to[1], label: l.to[1], type: l.type }));
    const outputs = [...(outs.get(id) || new Map())].sort((a, b) => a[0] - b[0]).map(([slot, type]) => ({ id: 'o' + slot, label: type.toLowerCase(), type }));
    const widgets = Object.entries(w.inputs || {}).filter(([, v]) => !Array.isArray(v)).slice(0, 3);
    const body = widgets.map(([k, v]) => `<div class="ng-widget"><span>${escapeHTML(k)}</span><b>${escapeHTML(String(v).slice(0, 28))}</b></div>`).join('');
    const h = Math.max(78, 46 + Math.max(inputs.length, outputs.length) * 24, 40 + widgets.length * 20);
    return [id, { id, title: w._meta?.title || w.class_type, icon: '◇', w: 200, h, inputs, outputs, body, col: depth[id] }];
  }));
  // Rows: right to left, each column ordered by where its consumers sit (barycentre), packed by height.
  const maxCol = Math.max(...ids.map(id => depth[id])), cy = {};
  for (let c = maxCol; c >= 0; c--) {
    const col = [...specs.values()].filter(n => n.col === c);
    const key = n => { const ys = links.filter(l => l.from[0] === n.id && l.to[0] in cy).map(l => cy[l.to[0]]); return ys.length ? ys.reduce((a, b) => a + b) / ys.length : ids.indexOf(n.id) * 1e-3; };
    col.sort((a, b) => key(a) - key(b));
    const total = col.reduce((t, n) => t + n.h + 28, -28);
    let y = Math.max(40, 40 + (col.length > 1 ? 0 : key(col[0]) - col[0].h / 2 - 40));
    if (col.length > 1) y = Math.max(40, (col.reduce((t, n) => t + key(n), 0) / col.length) - total / 2);
    for (const n of col) { n.x = 40 + c * 250; n.y = y; cy[n.id] = y + n.h / 2; y += n.h + 28; }
  }
  const nodes = [...specs.values()].map(({ col, ...n }) => n);
  return { nodes, links: links.map(({ from, to }) => ({ from, to })) };
}
const escapeHTML = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
