// Pure, seekable motion grammar. All spatial coordinates are canvas fractions.
// These data-only components are not a replacement for a video renderer.
export const VIDEO_STYLE_SCHEMA = 'fframestudio.video-style/1';

export const VIDEO_STYLE_PRESETS = Object.freeze({
  'headline-reveal': {
    title: 'Kinetic headline',
    description: 'A legible opening that lands before the supporting line arrives.',
    durationFrames: 90,
    props: { headline: 'Make something remarkable', kicker: 'INTRODUCING', background: '#101218' },
    layers: [
      { id: 'kicker', role: 'eyebrow', text: 'kicker', z: 1,
        tracks: { x: [[0, .08]], y: [[0, .32]], scale: [[0, 1]], opacity: [[0, 1]] } },
      { id: 'headline', role: 'title', text: 'headline', z: 2,
        tracks: { x: [[0, -.45], [.26, .08, 'out-cubic']], y: [[0, .47]], scale: [[0, 1.05], [.26, 1, 'out-cubic']], opacity: [[0, 1]] } },
    ],
    cues: [{ at: .26, kind: 'arrival', label: 'headline lands' }],
  },
  'foreground-fly-through': {
    title: 'Foreground fly-through',
    description: 'One recognizable actor expands to reveal the next composition behind it.',
    durationFrames: 75,
    props: { subject: 'YOUR PRODUCT', next: 'The next chapter', background: '#101218' },
    layers: [
      { id: 'next', role: 'title', text: 'next', z: 1,
        tracks: { x: [[0, .09]], y: [[0, .48]], scale: [[0, .82], [.95, 1.05, 'in-out-cubic']], opacity: [[0, 0], [.45, 0], [.78, 1, 'out-cubic']] } },
      { id: 'subject', role: 'hero', text: 'subject', z: 2,
        tracks: { x: [[0, .1], [.95, -.15, 'in-cubic']], y: [[0, .47]], scale: [[0, 1], [.42, 1.1, 'in-out-cubic'], [1, 8, 'in-cubic']], opacity: [[0, 1], [.83, 1], [1, 0, 'in-cubic']] } },
    ],
    cues: [{ at: .7, kind: 'transition', label: 'foreground crosses camera' }],
  },
  'ui-action-result': {
    title: 'Action → visible result',
    description: 'A product interaction that resolves into an understandable outcome.',
    durationFrames: 90,
    props: { action: 'Generate report', result: 'Report ready', background: '#101218' },
    layers: [
      { id: 'action', role: 'ui-control', text: 'action', z: 1,
        tracks: { x: [[0, .12]], y: [[0, .46]], scale: [[0, 1], [.53, 1.03, 'out-cubic'], [.61, 1]], opacity: [[0, 1], [.65, 1], [.8, .2, 'out-cubic']] } },
      { id: 'result', role: 'confirmation', text: 'result', z: 2,
        tracks: { x: [[0, .12]], y: [[0, .59], [.83, .48, 'out-cubic']], scale: [[0, .92], [.83, 1, 'out-cubic']], opacity: [[0, 0], [.57, 0], [.79, 1, 'out-cubic']] } },
    ],
    cues: [{ at: .52, kind: 'ui-click', label: 'action confirmed' }],
  },
});

const TRACKS = ['x', 'y', 'scale', 'opacity'];
const propPattern = /^[\w -]{1,100}$/;

function ease(t, curve) {
  switch (curve) {
    case 'hold': return 0;
    case 'in-cubic': return t ** 3;
    case 'out-cubic': return 1 - (1 - t) ** 3;
    case 'in-out-cubic': return t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    default: return t;
  }
}

export function interpolate(keys, fraction) {
  if (!Array.isArray(keys) || !keys.length || !Number.isFinite(fraction)) throw Error('Invalid timeline');
  if (fraction <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [end, value, curve = 'linear'] = keys[i];
    if (fraction <= end) {
      const [start, previous] = keys[i - 1];
      const t = (fraction - start) / (end - start);
      return previous + (value - previous) * ease(t, curve);
    }
  }
  return keys[keys.length - 1][1];
}

export function validateRecipe(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schema !== VIDEO_STYLE_SCHEMA || !Object.hasOwn(VIDEO_STYLE_PRESETS, value.component))
    throw Error('Unknown video style component/schema');
  if (!Number.isSafeInteger(value.durationFrames) || value.durationFrames < 2 || value.durationFrames > 60 * 60 * 10)
    throw Error('Invalid frame duration');
  for (const part of ['num', 'den'])
    if (!Number.isSafeInteger(value.fps?.[part]) || value.fps[part] <= 0)
      throw Error('Invalid fps');
  if (value.fps.num / value.fps.den > 240 || value.fps.num / value.fps.den < 1) throw Error('Unsupported fps');
  for (const dim of ['width', 'height'])
    if (!Number.isSafeInteger(value.size?.[dim]) || value.size[dim] < 64 || value.size[dim] > 16384)
      throw Error('Invalid canvas');
  if (!value.props || typeof value.props !== 'object' || Array.isArray(value.props)) throw Error('Invalid props');
  const allowed = VIDEO_STYLE_PRESETS[value.component].props;
  for (const [k, v] of Object.entries(value.props)) {
    if (!Object.hasOwn(allowed, k) || typeof v !== 'string' || v.length > 512) throw Error('Unsupported prop: ' + k);
    if (k === 'background' && !/^#[0-9a-f]{6}$/i.test(v)) throw Error('Invalid background color');
    if (k !== 'background' && /[\u0000-\u001f]/.test(v)) throw Error('Control character in ' + k);
  }
  for (const k of Object.keys(allowed)) if (!Object.hasOwn(value.props, k)) throw Error('Missing prop: ' + k);
  if (value.id != null && !propPattern.test(value.id)) throw Error('Invalid instance id');
  return value;
}

export function instantiate(component, overrides = {}) {
  if (!Object.hasOwn(VIDEO_STYLE_PRESETS, component)) throw Error('Unknown component');
  const { durationFrames: duration, props } = VIDEO_STYLE_PRESETS[component];
  const recipe = {
    schema: VIDEO_STYLE_SCHEMA, component,
    fps: { num: 30, den: 1 }, size: { width: 1920, height: 1080 },
    durationFrames: duration, props: { ...props, ...overrides },
  };
  return structuredClone(validateRecipe(recipe));
}

export function evaluateRecipe(recipe, frame) {
  validateRecipe(recipe);
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= recipe.durationFrames)
    throw Error('Frame out of bounds');
  const preset = VIDEO_STYLE_PRESETS[recipe.component];
  const t = frame / (recipe.durationFrames - 1);
  return {
    component: recipe.component, frame,
    seconds: frame * recipe.fps.den / recipe.fps.num,
    background: recipe.props.background,
    // Normalized canvas coordinates; consumers must convert before rendering.
    layers: preset.layers.map(layer => ({
      id: layer.id, role: layer.role, text: recipe.props[layer.text], z: layer.z,
      ...Object.fromEntries(TRACKS.map(key => [key, interpolate(layer.tracks[key], t)])),
    })).sort((a, b) => a.z - b.z),
    cues: preset.cues.filter(cue => Math.round(cue.at * (recipe.durationFrames - 1)) === frame)
      .map(({ kind, label }) => ({ kind, label })),
  };
}

export function serializeRecipe(recipe) {
  return JSON.stringify(validateRecipe(recipe), null, 2) + '\n';
}

export function parseRecipe(source) {
  return structuredClone(validateRecipe(JSON.parse(source)));
}
