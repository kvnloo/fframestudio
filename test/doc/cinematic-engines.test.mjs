import test from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog, selectCandidates, validateCatalog } from '../../tools/cinematic-catalog.mjs';

const data = readCatalog();

test('catalog tracks 18 OSS candidates without claiming integration', () => {
  assert.equal(data.engines.length, 18);
  assert.ok(data.engines.every(x => x.status === 'research'));
  for (const id of ['fframes', 'fosfora', 'motion-canvas', 'remotion']) {
    assert.ok(data.engines.some(x => x.id === id));
  }
});

test('tiers and capabilities narrow research in stable order', () => {
  assert.deepEqual(selectCandidates(data, { tier: 'now' }).map(x => x.id), ['fframes', 'fosfora']);
  assert.ok(selectCandidates(data, { feature: 'color' }).some(x => x.id === 'ocio'));
  assert.deepEqual(selectCandidates(data, { tier: 'now', feature: 'color' }), []);
});

test('reject duplicates and unverified claims of working adapters', () => {
  const duplicate = structuredClone(data);
  duplicate.engines[1].id = 'fframes';
  assert.throws(() => validateCatalog(duplicate), /Duplicate/);
  const claim = structuredClone(data);
  claim.engines[0].status = 'integrated';
  assert.throws(() => validateCatalog(claim), /Cannot claim/);
});

test('reject malformed links and invented capabilities', () => {
  const malformed = structuredClone(data);
  malformed.engines[0].repo = 'not-github-url';
  assert.throws(() => validateCatalog(malformed), /Invalid GitHub/);
  const invented = structuredClone(data);
  invented.engines[0].features = ['raytraced-hollywood'];
  assert.throws(() => validateCatalog(invented), /Invalid feature/);
});
