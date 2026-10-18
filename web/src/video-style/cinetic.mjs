// Safe, offline interchange for Leonxlnx/cinetic pick.py --json output.
// Metadata-only: we do not execute a cinetic recipe or claim renderer parity.
import { VIDEO_STYLE_PRESETS } from './components.mjs';

export const CINETIC_PLAN_SCHEMA = 'fframestudio.cinetic-plan/1';
const CATEGORIES = new Set([
  'opening_hook', 'transition', 'camera', 'typography_motion', 'ui_choreography',
  'data_and_numbers', 'product_demo', 'logo_and_end_card', 'color_and_light',
  'texture_and_finish', 'layout_and_composition', 'pacing_structure',
  'micro_interaction', 'depth_and_3d',
]);
const FORMATS = new Set(['launch', 'feature', 'loop', 'sting', 'walkthrough', 'vertical']);
const ENERGIES = new Set(['calm', 'medium', 'high', 'any']);
const ROLES = new Set(['workhorse', 'accent', 'signature']);
const EXACT = (o, names) => Object.keys(o).every(k => names.includes(k)) &&
  names.every(k => Object.hasOwn(o, k));
const PREFERRED = Object.freeze({
  typography_motion: 'headline-reveal',
  opening_hook: 'headline-reveal',
  transition: 'foreground-fly-through',
  ui_choreography: 'ui-action-result',
  product_demo: 'ui-action-result',
});

export function parseCineticPicks(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 131072)
    throw Error('Cinetic plan exceeds 128 KiB');
  const source = JSON.parse(input);
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !EXACT(source, ['seed', 'format', 'energy', 'category', 'picks']))
    throw Error('Unsupported cinetic picker envelope');
  if (!Number.isSafeInteger(source.seed) ||
      (source.format !== null && !FORMATS.has(source.format)) ||
      !ENERGIES.has(source.energy) ||
      (source.category !== null && !CATEGORIES.has(source.category)))
    throw Error('Invalid cinetic plan settings');
  if (!Array.isArray(source.picks) || !source.picks.length || source.picks.length > 32)
    throw Error('Invalid cinetic pick count');

  const seen = new Set();
  const picks = source.picks.map((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p) ||
        !EXACT(p, ['id','name','category','role']) ||
        typeof p.id !== 'string' || !/^[a-z][a-z0-9-]{1,100}$/.test(p.id) ||
        typeof p.name !== 'string' || !p.name.trim() ||
        p.name.length > 120 || /[\u0000-\u001f<>]/.test(p.name) ||
        !CATEGORIES.has(p.category) || !ROLES.has(p.role) ||
        (source.category !== null && p.category !== source.category) ||
        seen.has(p.id))
      throw Error('Invalid or duplicate cinetic pick at ' + i);
    seen.add(p.id);

    const suggested = PREFERRED[p.category] || null;
    // The category-level match is only a creative starting point. The named
    // cinetic technique itself is not translated or implemented by FrameStudio.
    const suggestion = suggested && Object.hasOwn(VIDEO_STYLE_PRESETS, suggested)
      ? { component: suggested, fidelity: 'conceptual-only' } : null;
    return { sourceId: p.id, name: p.name, category: p.category, role: p.role,
      status: suggestion ? 'suggested' : 'needs-implementation', suggestion };
  });
  return {
    schema: CINETIC_PLAN_SCHEMA,
    provenance: { repo: 'Leonxlnx/cinetic', tool: 'pick.py', seed: source.seed,
      format: source.format, energy: source.energy, category: source.category },
    picks,
  };
}
