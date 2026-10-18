import { createHash } from 'node:crypto';
import { emptySignals, validateProfile } from '../web/src/taste/profile.js';
import { toAgentWebCollection } from '../web/src/taste/social-references.js';

/** PR #57 is OPEN, not deployed/qualified. Only this legacy envelope is accepted.
 * Domains and terms are deliberately dropped, never forwarded or persisted.
 * v1 has no per-visual-signal evidence counts: all visual signals remain unknown.
 */
export function fromAgentWeb(body) {
  const keys = (v, allowed) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !allowed.includes(k)) || allowed.some(k => !Object.hasOwn(v, k))) throw Error('Invalid AgentWeb contract');
  };
  keys(body, ['profile']);
  const p = body.profile;
  keys(p, ['schema', 'sourceCount', 'itemCount', 'sources', 'topDomains', 'topTerms', 'styleSignals', 'updatedAt']);
  const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000;
  if (p.schema !== 'taste.profile.v1' || !count(p.sourceCount) || !count(p.itemCount) || !Array.isArray(p.sources) || p.sources.length > 16 || !Array.isArray(p.styleSignals) || p.styleSignals.length > 8 || (p.updatedAt !== null && (typeof p.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(p.updatedAt)))) throw Error('Invalid AgentWeb contract');
  for (const source of p.sources) {
    keys(source, ['source', 'itemCount']);
    if (!['x_bookmarks', 'collection'].includes(source.source) || !count(source.itemCount)) throw Error('Invalid source counts');
  }
  for (const [key, max] of [['topDomains', 8], ['topTerms', 12]]) if (!Array.isArray(p[key]) || p[key].length > max || p[key].some(s => typeof s !== 'string' || s.length > 253)) throw Error('Invalid transient terms');
  for (const signal of p.styleSignals) {
    keys(signal, ['name', 'score']);
    if (!['minimal', 'motion', 'editorial', 'brutalist', 'playful', 'dense', 'premium', 'experimental'].includes(signal.name) || !Number.isFinite(signal.score) || signal.score < 0 || signal.score > 1) throw Error('Invalid style signal');
  }
  if (p.sources.reduce((n, s) => n + s.itemCount, 0) !== p.itemCount) throw Error('Invalid total count');
  return validateProfile({ schema: 'fframestudio.taste-profile/1', revision: createHash('sha256').update(JSON.stringify(p)).digest('hex'), signals: emptySignals(), provenance: { sourceCount: p.sourceCount, itemCount: p.itemCount } });
}
export function agentWebAdapter({ enabled = false, baseURL, token, fetcher = fetch } = {}) {
  if (!enabled || !baseURL || !token) return {
    async getProfile() { return { state: 'disconnected' }; },
    async importCollection() { return { state: 'disconnected' }; },
  };
  const base = new URL(baseURL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('AgentWeb requires a fixed HTTPS origin');
  const endpoint = new URL('/api/taste/profile', base);
  const importEndpoint = new URL('/api/taste/import/collection', base);
  const importCollection = async (references) => {
    // User-submitted data is never fetched as URLs by the service. Validate
    // again on the bridge: browser validation is not an access-control gate.
    const collection = toAgentWebCollection(references);
    try {
      const r = await fetcher(importEndpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
          'Content-Type': 'application/json' },
        body: JSON.stringify(collection), redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (r.status === 401 || r.status === 403) return { state: 'unauthorized' };
      if (r.status === 404) return { state: 'disconnected' };
      if (r.status === 400 || r.status === 413) return { state: 'invalid' };
      if (!r.ok) return { state: 'offline' };
      // No need to expose or store the POST response, which may include
      // aggregate terms and domains. Re-read through the safe GET projection.
      await r.body?.cancel();
      return await adapter.getProfile();
    } catch { return { state: 'offline' }; }
  };
  const adapter = { importCollection, async getProfile() {
    try {
      const r = await fetcher(endpoint, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (r.status === 401 || r.status === 403) return { state: 'unauthorized' };
      if (r.status === 404) return { state: 'disconnected' };
      if (!r.ok) return { state: 'offline' };
      // Bound streamed bytes before parsing untrusted service output.
      let size = 0; const chunks = [];
      for await (const chunk of r.body) {
        size += chunk.byteLength;
        if (size > 65536) throw Error('Profile response too large');
        chunks.push(chunk);
      }
      try { return { state: 'ready', profile: fromAgentWeb(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }; }
      catch { return { state: 'invalid' }; }
    } catch { return { state: 'offline' }; }
  } };
  return adapter;
}
