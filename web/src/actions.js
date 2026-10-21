// Shared action contract. Frame values are integer project frames.
import { applicationSchema } from './taste/profile.js';
const str = { type: 'string', minLength: 1 }, int = { type: 'integer', minimum: 0 };
const positive = { type: 'integer', minimum: 1 }, bool = { type: 'boolean' };
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const clip = { clipId: str, videoId: str };
const rational = object({ num: positive, den: positive }, ['num', 'den']);
const definitions = {
  add: object({ videoId: str, clip: object({ id:str, name:{type:'string'}, duration:positive, mediaId:{type:['string','null']}, sourceIn:int, speed:rational, start:int, thumb:{type:['string','null']}, text:{type:'object'}, textOverrides:{type:'object'}, styleId:str, beatLock:bool, attached:{type:'array',items:{type:'object'}}, metadata:{type:'object'} }, ['id','duration']), index: int }, ['clip']),
  select: object(clip, ['clipId']),
  move: object({ ...clip, index: int }, ['clipId', 'index']),
  trim: object({ ...clip, sourceIn: int, duration: positive }, ['clipId']),
  split: object({ ...clip, at: positive, newId: str }, ['clipId', 'at', 'newId']),
  replace: object({ ...clip, mediaId: { type: ['string', 'null'] }, sourceIn: int }, ['clipId', 'mediaId']),
  'edit-text': object({ ...clip, field: str, value: { type: ['string', 'array'], items: { type: 'string' } } }, ['clipId', 'field', 'value']),
  duplicate: object({ ...clip, newId: str }, ['clipId', 'newId']),
  group: object({ videoId: str, clipIds: { type: 'array', items: str, minItems: 1 }, id: str, name: str }, ['clipIds', 'id']),
  'set-beat-lock': object({ ...clip, value: bool }, ['clipId', 'value']),
  retime: object({ ...clip, speed: rational }, ['clipId', 'speed']),
  delete: object(clip, ['clipId']),
  'edit-style': object({ videoId: str, styleId: str, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } }, ['styleId', 'color']),
  'apply-taste': object({ videoId: str, receipt: applicationSchema }, ['receipt']),
  'save-version': object({ videoId: str, id: str, name: str }, ['id']),
  'restore-version': object({ videoId: str, id: str }, ['id']),
};
export const COMMAND_IDS = Object.freeze(Object.keys(definitions));
const ui = ['play','reverse','pause','forward','previousFrame','nextFrame','previousClip','nextClip','in','out','undo','redo','palette','close-palette','save','compare','settings','close-settings','reset-settings','toggle-story','toggle-inspector','loop-shot','loop-film','mute','screening','play-here','seek-start','copy-timecode','recover','discard-recovery','export','export-project','save-copy','reload-external','keep-local','inspect-proposal','reject-proposal','apply-proposal','import-reference','compare-reference','voice','component-lab','taste'];
const destructive = new Set(['delete','trim','in','out','replace','restore-version','reload-external','reset-settings']);
const bulk = new Set(['edit-style','apply-taste','group','restore-version','apply-proposal']);
const synonyms = { trim: ['shorten', 'trim shot'], delete: ['remove'], 'edit-text': ['change text', 'change title'], play: ['start playback'], pause: ['stop playback'], 'import-reference': ['deconstruct', 'reference video'], voice: ['dictate', 'microphone'],
  comfy: ['comfyui', 'image generation'], 'comfy-run': ['comfy generate', 'comfy queue'], 'comfy-variations': ['more variations'], 'comfy-cancel': ['comfy stop'] };
// ComfyUI pane: workspace actions only (never proposal commands); available only when the bridge enables ComfyUI.
const count = { type: 'integer', minimum: 1, maximum: 4 };
const comfy = {
  comfy: object(), 'comfy-run': object({ count }), 'comfy-variations': object({ count }), 'comfy-cancel': object(),
  'comfy-set-prompt': object({ prompt: { type: 'string', minLength: 1 } }),
  'comfy-set-param': object({ name: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,31}$' }, value: { type: ['string', 'number'] } }),
  'comfy-use-template': object({ template: str }),
};
export function validateParams(schema, value, path = 'params') {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type && !types.includes(type) && !(type === 'integer' && types.includes('number'))) throw Error(`${path}: expected ${types.join(' or ')}`);
  if (typeof value === 'number' && (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw Error(`${path}: invalid range`);
  if (typeof value === 'string' && ((schema.minLength && value.length < schema.minLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) throw Error(`${path}: invalid string`);
  if (Object.hasOwn(schema, 'const') && value !== schema.const) throw Error(`${path}: unsupported value`);
  if (schema.enum && !schema.enum.includes(value)) throw Error(`${path}: unsupported value`);
  if (type === 'array') {
    if (schema.uniqueItems && new Set(value).size !== value.length) throw Error(`${path}: duplicate items`);
    if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems ?? 1000)) throw Error(`${path}: invalid length`);
    if (schema.items) value.forEach((v, i) => validateParams(schema.items, v, `${path}[${i}]`));
  }
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw Error(`${path}.${key}: required`);
    for (const [key, v] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) throw Error(`${path}: unsafe key`);
      if (schema.properties?.[key]) validateParams(schema.properties[key], v, `${path}.${key}`);
      else if (schema.additionalProperties === false) throw Error(`${path}.${key}: unknown parameter`);
    }
  }
  return value;
}
function entry(id, schema, command = false) {
  return Object.freeze({
    id, title: id.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('-', ' '),
    synonyms: Object.freeze(synonyms[id] || []), schema, command,
    // Proposal/recovery lifecycle controls are contextual, not user commands.
    palette: !['seek','open-panel','recover','discard-recovery','keep-local','reload-external','inspect-proposal','reject-proposal','apply-proposal'].includes(id) && !id.startsWith('close-'),
    scope: command ? (schema.properties.clipId ? 'selection + downstream ripple' : 'video') : 'workspace',
    requires: id.startsWith('comfy') ? 'comfy' : null,
    destructive: destructive.has(id), bulk: bulk.has(id),
    preview(context, params) {
      validateParams(schema, params);
      return command ? context.store.preview({ type: id, ...params }) : { scope: 'workspace', diff: [], action: { id, params } };
    },
    apply(context, params = {}, { interactive = false } = {}) {
      // Interactive invocations gather missing parameters in the existing inspector/dialog.
      if (interactive && (command || !schema.required.length)) return context.performAction(id, params);
      validateParams(schema, params);
      return command && id !== 'select' ? context.run({ type: id, ...params }) : context.performAction(id, params);
    },
    inverse(receipt) { return receipt?.inverse || null; },
  });
}
export const ACTIONS = Object.freeze(Object.fromEntries([
  ...Object.entries(definitions).map(([id, schema]) => [id, entry(id, schema, true)]),
  ...ui.map(id => [id, entry(id, object({ clipId: str }))]),
  ['seek', entry('seek', object({ frame: int }, ['frame']))],
  ...Object.entries(comfy).map(([id, schema]) => [id, entry(id, schema)]),
  ['open-panel', entry('open-panel', object({ panel: { type: 'string', enum: ['shot','narrative','direction','takes','assistant','source','story','taste','generate'] } }, ['panel']))],
]));
export function action(id) { if (!Object.hasOwn(ACTIONS, id)) throw Error(`Unknown studio action: ${id}`); return ACTIONS[id]; }
export function validateCommand(command) {
  const { type, ...params } = command || {};
  const a = action(type);
  if (!a.command) throw Error('Command not allowed in a proposal');
  validateParams(a.schema, params);
  return command;
}
export function resolveClip(context, target = 'this shot') {
  const clips = context.video.clips;
  if (typeof target === 'number') return clips[target - 1] || null;
  const explicit = clips.find(c => c.id === target);
  if (explicit) return explicit;
  if (/^(this|current|selected)( shot| clip)?$/.test(target)) return clips.find(c => c.id === context.selection) || clips.find(c => context.frame >= c.start && context.frame < c.start + c.duration) || null;
  return null;
}
export const actionManifest = () => Object.values(ACTIONS).map(({ id, title, synonyms, schema, scope, destructive, bulk, command }) => ({ id, title, synonyms, schema, scope, destructive, bulk, command }));
