#!/usr/bin/env node
// Research catalog only: no plugins installed and no engines launched.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TIERS = ['now', 'next', 'evaluate'];
const FEATURES = new Set(['procedural', 'timeline', 'audio-reactive', 'shader', 'camera', 'color', 'compositing']);
const FITS = new Set(['native', 'adapter', 'external', 'reference']);

export function validateCatalog(data) {
  if (data?.schema !== 'fframestudio.cinematic-catalog/1' || !Array.isArray(data.engines) || !data.engines.length) {
    throw new Error('Invalid cinematic catalog schema or empty engines');
  }
  const seen = new Set();
  for (const engine of data.engines) {
    if (!/^[a-z][a-z0-9-]*$/.test(engine.id || '') || seen.has(engine.id)) {
      throw new Error('Duplicate/invalid engine id: ' + engine.id);
    }
    seen.add(engine.id);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(engine.repo || '')) {
      throw new Error('Invalid GitHub repo for ' + engine.id);
    }
    if (!TIERS.includes(engine.tier) || !FITS.has(engine.fit)) {
      throw new Error('Unknown tier/fit for ' + engine.id);
    }
    if (engine.status !== 'research') {
      throw new Error('Cannot claim ' + engine.id + ' is integrated without a tested adapter');
    }
    if (typeof engine.role !== 'string' || !engine.role.trim()) {
      throw new Error('Missing role for ' + engine.id);
    }
    if (!Array.isArray(engine.features) || !engine.features.length ||
        !engine.features.every(x => FEATURES.has(x))) {
      throw new Error('Invalid feature vocabulary for ' + engine.id);
    }
    if (typeof engine.first_probe !== 'string' || engine.first_probe.length < 20) {
      throw new Error('Missing testable first probe for ' + engine.id);
    }
  }
  return data;
}

export function selectCandidates(data, { tier, feature } = {}) {
  validateCatalog(data);
  if (tier && !TIERS.includes(tier)) throw new Error('Unsupported tier: ' + tier);
  if (feature && !FEATURES.has(feature)) throw new Error('Unsupported feature: ' + feature);
  return data.engines.filter(e =>
    (!tier || e.tier === tier) && (!feature || e.features.includes(feature)));
}

export function readCatalog(file = new URL('../projects/cinematic-engines.json', import.meta.url)) {
  return validateCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [tier, feature] = process.argv.slice(2);
    for (const e of selectCandidates(readCatalog(), { tier, feature })) {
      console.log(e.tier.padEnd(9) + ' ' + e.id.padEnd(16) +
        ' https://github.com/' + e.repo + ' [' + e.status + ']');
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
