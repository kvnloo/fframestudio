// Aggregate-only vocabulary: no free-form text, source identifiers or URLs.
export const SIGNALS = {
  palette: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
  typography: { enum: ['Instrument Sans', 'Archivo Black', 'Instrument Serif', 'IBM Plex Mono'] },
  framing: { enum: ['wide', 'centered', 'close'] },
  motion: { type: 'number', minimum: 0, maximum: 100 },
  pacing: { type: 'number', minimum: 0, maximum: 100 },
  transition: { enum: ['cut', 'dissolve', 'match'] },
  density: { type: 'number', minimum: 0, maximum: 100 },
  soundtrack: { enum: ['calm', 'propulsive', 'playful', 'dramatic'] },
};
export const KEYS = Object.keys(SIGNALS);
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const count = { type: 'integer', minimum: 0, maximum: 1000000 };
const confidence = { type: 'number', minimum: 0, maximum: 1 };
const revision = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' };
const provenance = object({ sourceCount: count, itemCount: count });
export const dialsSchema = object(SIGNALS);
// Partial direction/brand constraints share the same bounded vocabulary.
export const constraintsSchema = { ...dialsSchema, required: [] };
export const profileSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...object({
    schema: { const: 'fframestudio.taste-profile/1' }, revision,
    signals: object(Object.fromEntries(KEYS.map(k => [k, object({
      value: { anyOf: [SIGNALS[k], { type: 'null' }] }, evidenceCount: count, confidence,
    })]))),
    provenance,
  }),
};
export const applicationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...object({
    schema: { const: 'fframestudio.taste-application/1' }, profileRevision: revision,
    scope: { enum: ['user', 'brand', 'project', 'task'] },
    scopeRevisions: { ...object({ user: revision, brand: revision, project: revision, task: revision }), required: ['user'] },
    intensity: { type: 'integer', minimum: 0, maximum: 100 },
    enabledSignals: { type: 'array', maxItems: 8, uniqueItems: true, items: { enum: KEYS } },
    changedSignals: { type: 'array', maxItems: 8, uniqueItems: true, items: { enum: KEYS } },
    dials: dialsSchema, provenance,
    timestamp: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' },
  }),
};
export function validateSchema(value, schema, path = 'taste') {
  const fail = () => { throw Error(`Invalid aggregate ${path}`); };
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { validateSchema(value, s, path); return true; } catch { return false; } })) fail();
    return value;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  const type = schema.type;
  if (type === 'null' && value !== null) fail();
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    if ((schema.required || []).some(k => !Object.hasOwn(value, k))) fail();
    for (const k of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, k)) fail();
      validateSchema(value[k], schema.properties[k], `${path}.${k}`);
    }
  }
  if (type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems || 0) || value.length > schema.maxItems) fail();
    if (schema.uniqueItems && new Set(value).size !== value.length) fail();
    value.forEach(v => validateSchema(v, schema.items, path));
  }
  if (type === 'string' && (typeof value !== 'string' || (schema.pattern && !new RegExp(schema.pattern).test(value)))) fail();
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value)) || value < schema.minimum || value > schema.maximum) fail();
  }
  return value;
}
export function validateProfile(profile) {
  validateSchema(profile, profileSchema);
  if (profile.provenance.sourceCount > profile.provenance.itemCount || (profile.provenance.sourceCount === 0 && profile.provenance.itemCount !== 0)) throw Error('Invalid aggregate provenance');
  for (const s of Object.values(profile.signals)) {
    if (s.evidenceCount > profile.provenance.itemCount || (s.value === null && (s.confidence !== 0 || s.evidenceCount !== 0)) || (s.value !== null && s.evidenceCount === 0)) throw Error('Invalid aggregate evidence');
  }
  return profile;
}
export function validateApplication(receipt) {
  validateSchema(receipt, applicationSchema);
  if (!Number.isFinite(Date.parse(receipt.timestamp)) || new Date(receipt.timestamp).toISOString() !== receipt.timestamp) throw Error('Invalid aggregate timestamp');
  return receipt;
}
export function parseProfile(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 32768) throw Error('Aggregate profile limit is 32 KiB');
  return structuredClone(validateProfile(JSON.parse(text)));
}
export const emptySignals = () => Object.fromEntries(KEYS.map(k => [k, { value: null, evidenceCount: 0, confidence: 0 }]));
export const DEFAULT_DIALS = Object.freeze({ palette: ['#ecebe7'], typography: 'Archivo Black', framing: 'centered', motion: 40, pacing: 50, transition: 'cut', density: 40, soundtrack: 'calm' });

// Overlay order is user -> brand -> project -> task; brand locks win last.
export function resolveScopes(user, { brand, project, task, constraints = {} } = {}) {
  validateProfile(user);
  for (const p of [brand, project, task].filter(Boolean)) validateProfile(p);
  validateSchema(constraints, constraintsSchema);
  const signals = structuredClone(user.signals);
  let scope = 'user';
  for (const [name, p] of [['brand', brand], ['project', project], ['task', task]]) {
    if (!p) continue;
    for (const k of KEYS) if (p.signals[k].value !== null) signals[k] = structuredClone(p.signals[k]);
    scope = name;
  }
  const scopeRevisions = { user: user.revision }, unique = new Map([[user.revision, user]]);
  for (const [name, p] of [['brand', brand], ['project', project], ['task', task]]) if (p) { scopeRevisions[name] = p.revision; unique.set(p.revision, p); }
  const provenance = [...unique.values()].reduce((total, p) => ({ sourceCount: total.sourceCount + p.provenance.sourceCount, itemCount: total.itemCount + p.provenance.itemCount }), { sourceCount: 0, itemCount: 0 });
  return { signals, scope, constraints: structuredClone(constraints), scopeRevisions, provenance };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mix = (a, b, w) => Math.round(a + (b - a) * w);
function mixColour(a, b, w) {
  return '#' + [1, 3, 5].map(i => mix(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), w).toString(16).padStart(2, '0')).join('');
}
export function previewTaste(profile, project, { strength = 65, enabled = KEYS, on = true, scopes = {} } = {}) {
  if (!Number.isInteger(strength) || strength < 0 || strength > 100 || typeof on !== 'boolean' || !Array.isArray(enabled) || enabled.some(k => !KEYS.includes(k)) || new Set(enabled).size !== enabled.length) throw Error('Invalid Taste controls');
  const resolved = resolveScopes(profile, scopes);
  const current = project.metadata?.tasteDirection || {};
  validateSchema(current, constraintsSchema);
  const before = structuredClone({ ...DEFAULT_DIALS, ...current });
  // Use the actual shared style as the starting typography/ink where no direction is declared.
  const style = Object.values(project.videos?.[0]?.styles || {})[0];
  if (!current.palette && /^#[\da-f]{6}$/i.test(style?.color)) before.palette = [style.color];
  if (!current.typography && SIGNALS.typography.enum.includes(style?.fontFamily)) before.typography = style.fontFamily;
  const dials = structuredClone(before), changes = [];
  for (const k of KEYS) {
    const signal = resolved.signals[k], weight = (on && enabled.includes(k) ? strength / 100 : 0) * signal.confidence;
    if (signal.value !== null && weight > 0) {
      if (typeof signal.value === 'number') dials[k] = mix(before[k], signal.value, weight);
      else if (k === 'palette') dials[k] = signal.value.map((c, i) => mixColour(before.palette[i % before.palette.length], c, weight));
      else if (weight >= 0.35) dials[k] = signal.value;
    }
    if (Object.hasOwn(resolved.constraints, k)) dials[k] = structuredClone(resolved.constraints[k]);
    if (!same(before[k], dials[k])) changes.push({ signal: k, before: before[k], after: dials[k], reason: Object.hasOwn(resolved.constraints, k) ? 'Brand constraint (authoritative)' : `Taste × ${strength}% × ${Math.round(signal.confidence * 100)}% confidence`, evidenceCount: signal.evidenceCount });
  }
  return { before, dials, changes, scope: resolved.scope, scopeRevisions: resolved.scopeRevisions, provenance: resolved.provenance, enabledSignals: KEYS.filter(k => enabled.includes(k)), intensity: on ? strength : 0 };
}
export function tasteReceipt(profile, preview, timestamp) {
  return validateApplication({ schema: 'fframestudio.taste-application/1', profileRevision: profile.revision, scope: preview.scope, scopeRevisions: structuredClone(preview.scopeRevisions), intensity: preview.intensity, enabledSignals: preview.enabledSignals, changedSignals: preview.changes.map(c => c.signal), dials: structuredClone(preview.dials), provenance: structuredClone(preview.provenance), timestamp });
}
