import test from 'node:test';
import assert from 'node:assert/strict';
import { metaballPath, magnet, compatible, graphFromWorkflow, spring, FEEL } from '../../web/src/nodegraph.js';
import fs from 'node:fs';

const R = FEEL.R, port = { x: 100, y: 100 };

test('halo is absent far away, grows on approach and is full once captured', () => {
  const far = magnet({ x: 100 - R * 3.2, y: 100 }, port, false);
  const near = magnet({ x: 100 - R * 2.2, y: 100 }, port, false);
  const caught = magnet({ x: 100 - R * 1.4, y: 100 }, port, false);
  assert.equal(far.halo, 0); assert.equal(far.captured, false);
  assert.ok(near.halo > 0 && near.halo < R, 'partial halo while approaching');
  assert.equal(caught.captured, true); assert.equal(caught.halo, R);
});

test('capture has hysteresis so the snap target does not flicker', () => {
  const p = { x: 100 - R * 1.85, y: 100 };
  assert.equal(magnet(p, port, false).captured, false);
  assert.equal(magnet(p, port, true).captured, true);
});

test('inside the disc the tip rests toward the port, never past 0.62 R', () => {
  for (const d of [0.2, 0.5, 0.9]) {
    const m = magnet({ x: 100 + R * d, y: 100 }, port, true);
    assert.ok(Math.hypot(m.tip.x - 100, m.tip.y - 100) <= R * 0.62 + 1e-9);
  }
});

test('metaball joins nearby circles, collapses when nested and tears when far', () => {
  const joined = metaballPath({ x: 0, y: 0 }, R, { x: R * 1.5, y: 0 }, R * 0.3);
  assert.match(joined, /^M.*C.*A.*C.*A.*Z$/);
  assert.ok(!/NaN/.test(joined));
  assert.match(metaballPath({ x: 0, y: 0 }, R, { x: 2, y: 0 }, R * 0.3), /^M-?\d.*a/);
  assert.equal(metaballPath({ x: 0, y: 0 }, R, { x: R * 5, y: 0 }, R * 0.3), null);
});

test('ports only accept their own type, opposite direction, other node', () => {
  const a = { node: 'a', dir: 'out', type: 'LATENT' };
  assert.ok(compatible(a, { node: 'b', dir: 'in', type: 'LATENT' }));
  assert.ok(!compatible(a, { node: 'b', dir: 'in', type: 'IMAGE' }));
  assert.ok(!compatible(a, { node: 'b', dir: 'out', type: 'LATENT' }));
  assert.ok(!compatible(a, { node: 'a', dir: 'in', type: 'LATENT' }));
});

test('springs stay stable through long frames', () => {
  const s = { x: 0, y: 0, v: { x: 0, y: 0 } };
  for (let i = 0; i < 30; i++) spring(s, { x: 100, y: 0 }, 0.2, 60, 0.9);
  assert.ok(Math.abs(s.x - 100) < 1);
});

test('every shipped ComfyUI template becomes a typed graph whose links are all compatible', () => {
  const dir = new URL('../../bridge/generation/comfy-templates/', import.meta.url);
  for (const f of fs.readdirSync(dir)) {
    const { workflow } = JSON.parse(fs.readFileSync(new URL(f, dir)));
    const g = graphFromWorkflow(workflow);
    assert.equal(g.nodes.length, Object.keys(workflow).length, f);
    const ports = new Map(g.nodes.flatMap(n => [...n.inputs.map(p => [n.id + ':in:' + p.id, p]), ...n.outputs.map(p => [n.id + ':out:' + p.id, p])]));
    for (const l of g.links) {
      const o = ports.get(l.from[0] + ':out:' + l.from[1]), i = ports.get(l.to[0] + ':in:' + l.to[1]);
      assert.ok(o && i && o.type === i.type, `${f}: ${JSON.stringify(l)}`);
    }
    for (const n of g.nodes) for (const l of g.links.filter(l => l.to[0] === n.id)) {
      const src = g.nodes.find(m => m.id === l.from[0]); assert.ok(src.x < n.x, `${f}: left-to-right ${l.from[0]}→${n.id}`);
    }
  }
});
