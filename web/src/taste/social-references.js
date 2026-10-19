// Explicitly supplied reference links only. Never fetches, scrapes, stores or logs them.
// The normalized collection can be sent to AgentWeb only after a separate user action.
export const SOCIAL_REFERENCES_SCHEMA = 'fframestudio.social-references/1';
export const MAX_SOCIAL_REFERENCES_BYTES = 65536;
const PROVIDERS = new Set(['x', 'pinterest', 'youtube', 'collection']);
const exact = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k)) &&
  keys.every(k => Object.hasOwn(value, k));
const string = (value, limit) => typeof value === 'string' &&
  value.length > 0 && value.length <= limit && value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value);
const videoId = id => /^[A-Za-z0-9_-]{11}$/.test(id);

function canonicalURL(raw, provider) {
  if (!string(raw, 2048)) throw Error('Invalid reference URL');
  let u;
  try { u = new URL(raw); } catch { throw Error('Invalid reference URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port)
    throw Error('References must be public HTTPS URLs without credentials');
  const host = u.hostname.toLowerCase();
  if (provider === 'youtube') {
    let id;
    if (host === 'youtu.be') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length === 1) id = parts[0];
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else if (/^\/(shorts|live)\/[^/]+\/?$/.test(u.pathname)) id = u.pathname.split('/')[2];
    }
    if (!videoId(id || '')) throw Error('Only individual YouTube video URLs are supported');
    return 'https://www.youtube.com/watch?v=' + id;
  }
  if (provider === 'pinterest' && !['pinterest.com','www.pinterest.com','pin.it'].includes(host))
    throw Error('Expected a Pinterest pin or board link');
  if (provider === 'x' && !['x.com','www.x.com','twitter.com','www.twitter.com'].includes(host))
    throw Error('Expected an X post link');
  if (provider === 'collection' && (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ||
      host.endsWith('.local') || host.includes('..')))
    throw Error('Expected a public HTTPS reference link');
  if (!u.pathname || u.pathname === '/') throw Error('A concrete reference path is required');
  if (u.pathname.length > 360) throw Error('Reference path too long');
  u.search = '';
  u.hash = '';
  return u.href;
}

export function normalizeSocialReferences(value) {
  if (!exact(value, ['schema','provider','collectionId','items']) ||
      value.schema !== SOCIAL_REFERENCES_SCHEMA || !PROVIDERS.has(value.provider) ||
      !string(value.collectionId, 48) || !/^[A-Za-z0-9_-]+$/.test(value.collectionId) ||
      !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 50)
    throw Error('Invalid social references file');
  const items = [], seen = new Set();
  for (const item of value.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !Object.keys(item).every(k => ['url','title','creator','tags'].includes(k)) ||
        !Object.hasOwn(item, 'url'))
      throw Error('Invalid social reference item');
    if (item.title !== undefined && !string(item.title, 200)) throw Error('Invalid reference title');
    if (item.creator !== undefined && !string(item.creator, 100)) throw Error('Invalid reference creator');
    if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.length > 8 ||
        !item.tags.every(t => string(t, 32) && /^[a-z0-9 _-]+$/i.test(t))))
      throw Error('Invalid reference tags');
    const url = canonicalURL(item.url, value.provider);
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ url, ...(item.title ? { title: item.title } : {}),
      ...(item.creator ? { creator: item.creator } : {}),
      ...(item.tags?.length ? { tags: [...new Set(item.tags)] } : {}) });
  }
  return { schema: SOCIAL_REFERENCES_SCHEMA, provider: value.provider,
    collectionId: value.collectionId, items };
}

export function parseSocialReferences(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SOCIAL_REFERENCES_BYTES)
    throw Error('Reference file limit is 64 KiB');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Error('Invalid reference JSON'); }
  return normalizeSocialReferences(parsed);
}

export function toAgentWebCollection(reference) {
  const normalized = normalizeSocialReferences(reference);
  return { collectionId: normalized.provider + '-' + normalized.collectionId,
    items: normalized.items.map(x => ({ ...x })) };
}
