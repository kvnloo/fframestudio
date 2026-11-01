// ff-unmute camera keyframe overrides: a studio working copy of hud::camera's KEYS.
// Pure data helpers shared by the command store, the inspector and voice intents.
// The imported source sidecar (metadata.procedural) is never mutated; overrides
// live beside it and are only written to Rust by tools/procedural_overrides.py
// into an isolated copy. Nothing here renders or claims a rendered result.
export const OVERRIDE_SCHEMA = 'fframestudio.procedural-overrides/0';
export const CAMERA_FIELDS = Object.freeze(['time_s', 'look_y', 'zoom', 'tilt_x', 'tilt_y', 'roll', 'dx', 'blur']);
export const EVENT_KINDS = Object.freeze(['bar', 'kick', 'clap', 'token']);
// Camera keys feed hud::track (flat's tracker boxes) and hud::shot (lens), not the
// music: score synthesis, analysis and generated.rs stay valid.
export const CAMERA_STAGES = Object.freeze([
  Object.freeze({ id: 'rust', label: 'Rust rebuild · hud + flat + lens' }),
  Object.freeze({ id: 'flat', label: 'flat pass · tracker boxes follow hud::camera' }),
  Object.freeze({ id: 'lens', label: 'lens pass · camera projection' }),
]);
export const CAMERA_SKIPPED = Object.freeze(['music/synth.py', 'music/analyze.py', 'music/gen_hud.py']);
// Studio editing limits (not upstream invariants): hud::camera clamps zoom to >= 1,
// so lower values would be silently ignored by the film.
const LIMITS = { zoom: [1, 20], blur: [0, 20] };
const fail = (m) => { throw Error(m); };
// Rust f32::round is half away from zero; for positive time it is half-up.
export const frameOf = (seconds, fps) => Math.floor(seconds * fps + 0.5);

export function isCameraSource(p) {
  return p?.family === 'ff-unmute' && Array.isArray(p.camera_keyframes) && p.camera_keyframes.length > 1;
}
export function sourceKeys(p) {
  if (!isCameraSource(p)) fail('Camera overrides need an imported ff-unmute source');
  return p.camera_keyframes.map((k) => Object.fromEntries(CAMERA_FIELDS.map((f) => [f, k[f]])));
}
export function cameraKeys(metadata) {
  return metadata?.proceduralOverrides?.camera_keyframes || sourceKeys(metadata?.procedural);
}
export function validateCameraKeys(keys, p) {
  const n = p.camera_keyframes.length, end = p.total_frames / p.fps;
  if (!Array.isArray(keys) || keys.length !== n) fail(`Camera overrides must keep the source's ${n} keys`);
  keys.forEach((k, i) => {
    if (!k || typeof k !== 'object' || Object.keys(k).length !== CAMERA_FIELDS.length) fail(`Camera key ${i + 1}: unexpected fields`);
    for (const f of CAMERA_FIELDS) if (typeof k[f] !== 'number' || !Number.isFinite(k[f])) fail(`Camera key ${i + 1}: ${f} must be a finite number`);
    for (const [f, [lo, hi]] of Object.entries(LIMITS)) if (k[f] < lo || k[f] > hi) fail(`Camera key ${i + 1}: ${f} must be ${lo}–${hi}`);
  });
  if (keys[0].time_s !== 0) fail('Camera key 1 is pinned at 0 s');
  for (let i = 1; i < n; i++) if (!(keys[i].time_s - keys[i - 1].time_s >= 1e-3)) fail(`Camera key ${i + 1} must come after key ${i}`);
  if (keys[n - 1].time_s > end) fail(`Camera keys must end by ${end} s`);
  return keys;
}
export function validateOverrides(o, p) {
  if (!o || o.schema !== OVERRIDE_SCHEMA || o.family !== 'ff-unmute') fail('Invalid procedural overrides');
  if (!isCameraSource(p)) fail('Procedural overrides have no ff-unmute source');
  if (o.base?.lib_sha256 !== (p.source_sha256?.['hud/src/lib.rs'] ?? null)) fail('Procedural overrides belong to another source revision');
  validateCameraKeys(o.camera_keyframes, p);
  return o;
}
// Exact source seconds for the 1-based nth event. Bars are the authored 4/4 grid
// at generated BPM; kicks are measured onsets; claps/tokens are score timestamps.
export function eventSeconds(p, kind, index) {
  if (!EVENT_KINDS.includes(kind) || !Number.isSafeInteger(index) || index < 1) fail('Choose a bar, kick, clap or token number');
  const end = p.total_frames / p.fps;
  if (kind === 'bar') {
    if (!(p.bpm > 0)) fail('Source has no score tempo');
    const t = ((index - 1) * 4 * 60) / p.bpm;
    return t < end ? t : fail(`Bar ${index} is past the end of the film`);
  }
  const t = p.event_seconds?.[kind]?.[index - 1];
  return Number.isFinite(t) ? t : fail(`No ${kind} ${index} in this source`);
}
export function eventCount(p, kind) {
  if (kind === 'bar') return p.bpm > 0 ? Math.ceil((p.total_frames / p.fps) / ((4 * 60) / p.bpm)) : 0;
  return p.event_seconds?.[kind]?.length || 0;
}
export function nearestEvent(p, t, kind) {
  let best = null;
  for (let i = 1; i <= eventCount(p, kind); i++) {
    const s = eventSeconds(p, kind, i);
    if (!best || Math.abs(s - t) < Math.abs(best.seconds - t)) best = { kind, index: i, seconds: s };
  }
  return best;
}
// Returns new overrides; never mutates the source sidecar or prior overrides.
export function editCamera(metadata, { key, changes = {}, snap, reset = false }) {
  const p = metadata?.procedural, source = sourceKeys(p);
  const keys = cameraKeys(metadata).map((k) => ({ ...k }));
  if (!Number.isSafeInteger(key) || key < 0 || key >= keys.length) fail('Unknown camera key');
  for (const f of Object.keys(changes)) if (!CAMERA_FIELDS.includes(f)) fail(`Unsupported camera field: ${f}`);
  if ((snap || 'time_s' in changes) && key === 0) fail('Camera key 1 is pinned at 0 s');
  if (reset) keys[key] = { ...source[key] };
  Object.assign(keys[key], changes);
  if (snap) keys[key].time_s = eventSeconds(p, snap.kind, snap.index);
  validateCameraKeys(keys, p);
  const same = keys.every((k, i) => CAMERA_FIELDS.every((f) => k[f] === source[i][f]));
  if (same) return undefined; // back to source: drop the override entirely
  return {
    schema: OVERRIDE_SCHEMA, family: 'ff-unmute',
    base: { source_revision: p.source_revision ?? null, lib_sha256: p.source_sha256?.['hud/src/lib.rs'] ?? null },
    camera_keyframes: keys,
    stages: CAMERA_STAGES.map((s) => s.id),
  };
}
export function changedCells(metadata) {
  const p = metadata?.procedural, o = metadata?.proceduralOverrides;
  if (!o || !isCameraSource(p)) return [];
  const source = sourceKeys(p);
  return o.camera_keyframes.flatMap((k, i) => CAMERA_FIELDS.filter((f) => k[f] !== source[i][f]).map((f) => ({ key: i, field: f, before: source[i][f], after: k[f] })));
}
// Mirror of hud::camera (Catmull–Rom over clamped neighbours) in f64. Used only
// for an explanatory curve; the film itself is Rust f32 and is not rendered here.
export function sampleCamera(keys, t) {
  const n = keys.length;
  let i = 0;
  for (let j = 0; j < n - 1; j++) if (keys[j].time_s <= t) i = j;
  const k = (j) => keys[Math.max(0, Math.min(n - 1, j))];
  const [a, b, c, d] = [k(i - 1), k(i), k(i + 1), k(i + 2)];
  const u = Math.max(0, Math.min(1, (t - b.time_s) / Math.max(c.time_s - b.time_s, 1e-3)));
  const cat = (f) => 0.5 * (2 * b[f] + (-a[f] + c[f]) * u + (2 * a[f] - 5 * b[f] + 4 * c[f] - d[f]) * u * u + (-a[f] + 3 * b[f] - 3 * c[f] + d[f]) * u * u * u);
  const out = Object.fromEntries(CAMERA_FIELDS.slice(1).map((f) => [f, cat(f)]));
  out.zoom = Math.max(1, out.zoom);
  return out;
}
