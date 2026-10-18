#!/usr/bin/env node
// Research catalog only: no plugins installed and no engines launched.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TIERS = ['now', 'next', 'evaluate'];
const FEATURES = new Set(['procedural', 'timeline', 'audio-reactive', 'shader', 'camera', 'color', 'compositing']);
const FITS = new Set(['native', 'adapter', 'external', 'reference']);
const timestamp = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const pinnedSource = (value, engine) => {
  const prefix = `https://github.com/${engine.repo}/blob/${engine.upstream.revision}/`;
  if (typeof value !== 'string' || !value.startsWith(prefix) ||
      !/^[^?#\s]+(?:#L\d+(?:-L\d+)?)?$/.test(value.slice(prefix.length))) return false;
  // URL normalization must not turn a supposedly pinned path into a different revision or repository.
  try { return new URL(value).href === value; } catch { return false; }
};

export function validateCatalog(data) {
  if (data?.schema !== 'fframestudio.cinematic-catalog/1' || !Array.isArray(data.engines) || !data.engines.length) {
    throw new Error('Invalid cinematic catalog schema or empty engines');
  }
  const seen = new Set();
  const repos = new Set();
  for (const engine of data.engines) {
    if (!engine || typeof engine !== 'object' || Array.isArray(engine)) {
      throw new Error('Invalid engine entry');
    }
    if (typeof engine.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(engine.id) || seen.has(engine.id)) {
      throw new Error('Duplicate/invalid engine id: ' + engine.id);
    }
    seen.add(engine.id);
    if (typeof engine.repo !== 'string' ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(engine.repo) ||
        engine.repo.split('/')[0].includes('--') || ['.', '..'].includes(engine.repo.split('/')[1])) {
      throw new Error('Invalid GitHub repo for ' + engine.id);
    }
    const repoKey = engine.repo.toLowerCase();
    if (repos.has(repoKey)) throw new Error('Duplicate GitHub repo: ' + engine.repo);
    repos.add(repoKey);
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
        !engine.features.every(x => FEATURES.has(x)) || new Set(engine.features).size !== engine.features.length) {
      throw new Error('Invalid feature vocabulary for ' + engine.id);
    }
    const upstream = engine.upstream;
    if (!timestamp(engine.checked_at) || engine.evidence_url !== `https://api.github.com/repos/${engine.repo}` ||
        !upstream || typeof upstream.revision !== 'string' || !/^[a-f0-9]{40}$/.test(upstream.revision) ||
        upstream.commit_url !== `https://github.com/${engine.repo}/commit/${upstream.revision}` ||
        !timestamp(upstream.last_commit_at) || Date.parse(upstream.last_commit_at) > Date.parse(engine.checked_at) ||
        !Number.isSafeInteger(upstream.stars) || upstream.stars < 0) {
      throw new Error('Invalid upstream verification for ' + engine.id);
    }
    // Preserve GitHub's raw SPDX result, including NOASSERTION or null; notes are not legal approval.
    if (!(upstream.license_spdx === null || nonempty(upstream.license_spdx)) ||
        !nonempty(upstream.license_note) || !pinnedSource(upstream.license_url, engine)) {
      throw new Error('Invalid license evidence for ' + engine.id);
    }
    const evidence = engine.feature_evidence;
    if (!evidence || Array.isArray(evidence) || typeof evidence !== 'object' ||
        Object.keys(evidence).length !== engine.features.length ||
        !engine.features.every(feature => Object.hasOwn(evidence, feature) &&
          nonempty(evidence[feature]?.quote) && pinnedSource(evidence[feature]?.url, engine)) ||
        !nonempty(engine.limitations)) {
      throw new Error('Missing pinned capability evidence or limitations for ' + engine.id);
    }
    if (typeof engine.first_probe !== 'string' || engine.first_probe.length < 20) {
      throw new Error('Missing testable first probe for ' + engine.id);
    }
  }
  return data;
}

export function selectCandidates(data, { tier, feature } = {}) {
  validateCatalog(data);
  if (tier !== undefined && !TIERS.includes(tier)) throw new Error('Unsupported tier: ' + tier);
  if (feature !== undefined && !FEATURES.has(feature)) throw new Error('Unsupported feature: ' + feature);
  return data.engines.filter(e =>
    (!tier || e.tier === tier) && (!feature || e.features.includes(feature)));
}

export function readCatalog(file = new URL('../projects/cinematic-engines.json', import.meta.url)) {
  return validateCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 4) throw new Error('Usage: cinematic-catalog.mjs [now|next|evaluate] [capability]');
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
