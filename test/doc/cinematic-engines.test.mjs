import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { readCatalog, selectCandidates, validateCatalog } from '../../tools/cinematic-catalog.mjs';

const data = readCatalog();
const changed = mutate => {
  const copy = structuredClone(data);
  mutate(copy.engines[0], copy);
  return copy;
};

test('catalog tracks all 19 candidates without claiming integration', () => {
  assert.equal(data.engines.length, 19);
  assert.deepEqual(data.engines.map(x => x.id), [
    'fframes', 'fosfora', 'motion-canvas', 'ossia-score', 'theatre', 'postprocessing',
    'shader-park', 'otio', 'ocio', 'effectcraft', 'filmcraft', 'natron', 'blender',
    'cables', 'hydra', 'ghost-arcade', 'rust-motion', 'remotion', 'cinetic',
  ]);
  assert.ok(data.engines.every(x => x.status === 'research'));
  assert.equal(validateCatalog(data), data);
});

test('tiers and capabilities narrow research in stable order without mutation', () => {
  const before = structuredClone(data);
  assert.deepEqual(selectCandidates(data, { tier: 'now' }).map(x => x.id), ['fframes', 'fosfora']);
  assert.ok(selectCandidates(data, { feature: 'color' }).some(x => x.id === 'ocio'));
  assert.deepEqual(selectCandidates(data, { tier: 'now', feature: 'color' }), []);
  assert.deepEqual(selectCandidates(data, { tier: 'next', feature: 'camera' }), []);
  assert.deepEqual(selectCandidates(data), data.engines);
  for (const tier of ['soon', '', null]) assert.throws(() => selectCandidates(data, { tier }), /Unsupported tier/);
  for (const feature of ['hollywood', '', null]) assert.throws(() => selectCandidates(data, { feature }), /Unsupported feature/);
  assert.deepEqual(data, before);
});

test('reject duplicate IDs, case-insensitive duplicate repos and unverified runtime claims', () => {
  assert.throws(() => validateCatalog(changed((e, c) => { c.engines[1].id = e.id; })), /Duplicate/);
  assert.throws(() => validateCatalog(changed((e, c) => { c.engines[1].repo = e.repo.toUpperCase(); })), /Duplicate GitHub repo/);
  assert.throws(() => validateCatalog(changed(e => { e.status = 'integrated'; })), /Cannot claim/);
});

test('reject malformed catalogs, entries, links, tiers, fits and invented or repeated features', () => {
  for (const value of [null, {}, { schema: data.schema, engines: [] }, { ...data, schema: 'future' }]) {
    assert.throws(() => validateCatalog(value), /Invalid cinematic catalog/);
  }
  for (const value of [null, [], 'fframes']) {
    assert.throws(() => validateCatalog({ ...data, engines: [value] }), /Invalid engine entry/);
  }
  const mutations = [
    [e => { e.id = ['fframes']; }, /invalid engine id/],
    [e => { e.repo = 'not-github-url'; }, /Invalid GitHub/],
    [e => { e.repo = '../fframes'; }, /Invalid GitHub/],
    [e => { e.repo = 'owner/..'; }, /Invalid GitHub/],
    [e => { e.repo = ['dmtrKovalenko/fframes']; }, /Invalid GitHub/],
    [e => { e.tier = 'shipping'; }, /Unknown tier/],
    [e => { e.fit = 'embedded'; }, /Unknown tier/],
    [e => { e.role = ' '; }, /Missing role/],
    [e => { e.features = ['raytraced-hollywood']; }, /Invalid feature/],
    [e => { e.features.push(e.features[0]); }, /Invalid feature/],
    [e => { e.features = []; }, /Invalid feature/],
    [e => { e.first_probe = 'soon'; }, /Missing testable/],
  ];
  for (const [mutate, error] of mutations) assert.throws(() => validateCatalog(changed(mutate)), error);
});

test('require timestamped GitHub metadata and immutable upstream evidence for each capability', () => {
  const mutations = [
    e => { delete e.checked_at; },
    e => { e.checked_at = 'not-a-date'; },
    e => { e.checked_at = '2026-02-30T00:00:00Z'; },
    e => { e.evidence_url = 'https://example.com'; },
    e => { delete e.upstream; },
    e => { e.upstream.revision = 'main'; },
    e => { e.upstream.commit_url = 'https://github.com/other/repo/commit/' + e.upstream.revision; },
    e => { e.upstream.last_commit_at = '9999-01-01T00:00:00Z'; },
    e => { e.upstream.last_commit_at = 'yesterday'; },
    e => { e.upstream.stars = -1; },
    e => { e.upstream.stars = 1.5; },
    e => { e.upstream.stars = '2834'; },
  ];
  for (const mutate of mutations) assert.throws(() => validateCatalog(changed(mutate)), /Invalid upstream/);
  const missingEvidence = [
    e => { delete e.feature_evidence; },
    e => { delete e.feature_evidence.shader; },
    e => { e.feature_evidence.color = e.feature_evidence.shader; },
    e => { e.feature_evidence.shader.quote = ''; },
    e => { e.feature_evidence.shader.url = e.feature_evidence.shader.url.replace(e.upstream.revision, 'main'); },
    e => { e.feature_evidence.shader.url = e.feature_evidence.shader.url.replace('github.com/', 'github.com.evil/'); },
    e => { e.feature_evidence.shader.url += '?ref=main'; },
    e => { e.feature_evidence.shader.url = e.feature_evidence.shader.url.replace('/blob/' + e.upstream.revision + '/', '/blob/' + e.upstream.revision + '/../main/'); },
    e => { e.feature_evidence.shader.url = e.feature_evidence.shader.url.replace('/blob/' + e.upstream.revision + '/', '/blob/' + e.upstream.revision + '/%2e%2e/main/'); },
    e => { delete e.limitations; },
  ];
  for (const mutate of missingEvidence) assert.throws(() => validateCatalog(changed(mutate)), /Missing pinned capability/);
});

test('preserve license uncertainty and split-license caveats instead of inventing SPDX results', () => {
  const byId = Object.fromEntries(data.engines.map(e => [e.id, e]));
  assert.equal(byId.cables.upstream.license_spdx, null);
  for (const id of ['ossia-score', 'blender', 'remotion']) assert.equal(byId[id].upstream.license_spdx, 'NOASSERTION');
  assert.equal(byId.hydra.upstream.license_spdx, 'AGPL-3.0');
  assert.equal(byId.cinetic.role, 'technique');
  assert.equal(byId.cinetic.upstream.license_spdx, 'MIT');
  assert.match(byId.cinetic.upstream.license_note, /Remotion/);
  assert.match(byId.theatre.upstream.license_note, /AGPL-3.0/);
  assert.match(byId['ghost-arcade'].limitations, /legacy 1.9/);
  for (const mutate of [
    e => { delete e.upstream.license_spdx; },
    e => { e.upstream.license_spdx = ''; },
    e => { e.upstream.license_note = ''; },
    e => { e.upstream.license_url = 'https://github.com/' + e.repo + '/blob/main/LICENSE'; },
  ]) assert.throws(() => validateCatalog(changed(mutate)), /Invalid license evidence/);
});

test('CLI resolves catalog outside the repository and fails loudly on invalid or extra arguments', () => {
  const cli = fileURLToPath(new URL('../../tools/cinematic-catalog.mjs', import.meta.url));
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
  const selected = run(['now', 'shader']);
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(selected.stdout.trim().split('\n').map(line => line.trim().split(/\s+/)[1]), ['fframes', 'fosfora']);
  assert.equal(run([]).stdout.trim().split('\n').length, 19);
  assert.equal(run(['now', 'color']).stdout, '');
  for (const args of [['soon'], ['now', 'unknown'], ['now', 'shader', 'ignored']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Unsupported|Usage/);
  }
});
