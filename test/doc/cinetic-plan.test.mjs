import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCineticPicks, CINETIC_PLAN_SCHEMA } from '../../web/src/video-style/cinetic.mjs';
import { instantiate, evaluateRecipe } from '../../web/src/video-style/components.mjs';

const sample = () => ({ seed: 41, format: 'launch', energy: 'high', category: null,
  picks: [
    { id: 'tr-velocity-handoff-cut', name: 'Velocity handoff cut', category: 'transition', role: 'workhorse' },
    { id: 'ty-kinetic-type', name: 'Animated typography', category: 'typography_motion', role: 'accent' },
    { id: 'ca-orbit-move', name: '3D orbit', category: 'camera', role: 'signature' },
  ],
});
const parse = value => parseCineticPicks(JSON.stringify(value));
const mutate = fn => { const v = sample(); fn(v); return v; };

test('accepts real picker envelope without executing or copying code', () => {
  const plan = parse(sample());
  assert.equal(plan.schema, CINETIC_PLAN_SCHEMA);
  assert.deepEqual(plan.provenance, { repo: 'Leonxlnx/cinetic', tool: 'pick.py',
    seed: 41, format: 'launch', energy: 'high', category: null });
  assert.deepEqual(plan.picks.map(x => x.status), ['suggested', 'suggested', 'needs-implementation']);
  assert.deepEqual(plan.picks.map(x => x.suggestion?.component ?? null), [
    'foreground-fly-through', 'headline-reveal', null,
  ]);
  assert.ok(plan.picks.every(x => !Object.hasOwn(x, 'recipe')));
});

test('importing a plan is pure and preserves metadata without claiming parity', () => {
  const original = sample(), input = JSON.stringify(original);
  const a = parseCineticPicks(input), b = parseCineticPicks(input);
  assert.deepEqual(a, b);
  assert.deepEqual(original, sample());
  for (const p of a.picks.filter(p => p.suggestion)) {
    assert.equal(p.suggestion.fidelity, 'conceptual-only');
    const local = instantiate(p.suggestion.component);
    assert.ok(evaluateRecipe(local, 0).layers.length > 0);
  }
});

test('rejects invalid envelope, secret fields and malicious names', () => {
  assert.throws(() => parse(mutate(v => { v.apiKey = 'do-not-copy'; })), /envelope/);
  assert.throws(() => parse(mutate(v => { v.picks[0].token = 'redacted'; })), /Invalid/);
  assert.throws(() => parse(mutate(v => { v.picks[0].name = '<script>'; })), /Invalid/);
  assert.throws(() => parse(mutate(v => { v.picks[0].id = '../escape'; })), /Invalid/);
  assert.throws(() => parse(mutate(v => { v.picks[1].id = v.picks[0].id; })), /duplicate/);
  assert.throws(() => parse(mutate(v => { v.energy = 'unlimited'; })), /settings/);
  assert.throws(() => parse(mutate(v => { v.category = 'logo_and_end_card'; })), /Invalid/);
  assert.throws(() => parse(mutate(v => { v.picks[0].role = 'owner'; })), /Invalid/);
  assert.throws(() => parse(mutate(v => { v.picks[0].category = 'executor'; })), /Invalid/);
  assert.throws(() => parse(mutate(v => { v.picks = []; })), /count/);
  assert.throws(() => parseCineticPicks('x'.repeat(131073)), /128 KiB/);
});

test('local CLI reports imported suggestions from a valid file, rejects extra args', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ffs-cinetic-'));
  const cli = fileURLToPath(new URL('../../tools/import-cinetic-plan.mjs', import.meta.url));
  try {
    const file = path.join(dir, 'picks.json');
    writeFileSync(file, JSON.stringify(sample()));
    const ok = spawnSync(process.execPath, [cli, file], { encoding: 'utf8', cwd: dir });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).picks[0].sourceId, 'tr-velocity-handoff-cut');
    const bad = spawnSync(process.execPath, [cli, file, file], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /Usage/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
