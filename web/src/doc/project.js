import { validateApplication, validateSchema, constraintsSchema } from '../taste/profile.js';
export const SCHEMA = 'fframestudio.project/1';
export const clone = (value) => structuredClone(value);
export const uid = (prefix = 'id') =>
  `${prefix}-${globalThis.crypto.randomUUID()}`;
export function rational(n) {
  if (n && typeof n === 'object') return { num: n.num, den: n.den };
  const den = 10 ** Math.min(6, (String(n).split('.')[1] || '').length),
    num = Math.round(Number(n) * den);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}
export const fpsOf = (d) => d.fps.num / d.fps.den;
export const frames = (seconds, fps) =>
  Math.round((seconds * fps.num) / fps.den);
export const textOf = (c) => ({ ...c.text, ...c.textOverrides });
/** The still the preview shows for clip `c` (a path relative to the project, or null). */
export function clipStill(doc, c) {
  return c.thumb || doc.preview?.poster || null;
}
/** True when the preview plays the imported master proxy for `c` instead of showing a still. */
export const playsProxy = (doc, c) =>
  !!doc.preview?.proxy && !!c.mediaId && c.mediaId === doc.media[0]?.id;
/**
 * Groups of clip IDs (per video) whose preview would be the same still page. A storyboard
 * with distinct scenes must return []; anything else is the "every page is the same" bug.
 */
export function duplicateStills(doc) {
  const groups = [];
  for (const video of doc.videos) {
    const byStill = new Map();
    for (const c of video.clips) {
      const still = clipStill(doc, c);
      if (!still || playsProxy(doc, c)) continue;
      byStill.set(still, [...(byStill.get(still) || []), c.id]);
    }
    for (const ids of byStill.values()) if (ids.length > 1) groups.push(ids);
  }
  return groups;
}
export function reflow(video) {
  let start = 0;
  for (const c of video.clips) {
    c.start = start;
    start += c.duration;
  }
  return start;
}
export function fromV0(input) {
  if (input.schema === SCHEMA) {
    validate(input);
    return clone(input);
  }
  if (input.schema !== 'fframestudio.project/0')
    throw Error('Unsupported project schema');
  const p = clone(input),
    fps = rational(p.canvas?.fps || 30),
    media = [],
    byPath = new Map();
  const asset = (file, kind = 'video', duration = null) => {
    if (!file) return null;
    if (byPath.has(file)) return byPath.get(file);
    const id = `${p.id}:media:${media.length + 1}`;
    byPath.set(file, id);
    media.push({ id, kind, file, duration });
    return id;
  };
  const master = p.renders?.[0];
  const masterId = asset(
    master?.file || p.media?.proxy,
    'video',
    master ? frames(master.duration_s, fps) : null,
  );
  const video = {
    id: `${p.id}:video:1`,
    name: p.title || p.id,
    clips: [],
    scenes: [],
    styles: { default: { color: '#ecebe7' } },
    beats: [],
  };
  for (const [i, s] of (p.shots || []).entries()) {
    const duration = Math.max(1, frames(s.t1, fps) - frames(s.t0, fps));
    const independent =
      p.kind === 'fframes-clips' ||
      p.kind === 'capture-manifest' ||
      p.kind === 'studio-spec';
    const render = p.kind === 'fframes-clips' ? p.renders?.[i] : null;
    const mediaIds = (s.media || []).map((f) =>
      asset(f, /\.(png|webp|jpg|jpeg)$/i.test(f) ? 'image' : 'video'),
    );
    const mediaId =
      asset(
        render?.file,
        'video',
        render ? frames(render.duration_s, fps) : null,
      ) ||
      mediaIds[0] ||
      (!independent ? masterId : null);
    const text = s.text || {},
      textOverrides = p.edits?.[s.id] || {};
    video.clips.push({
      id: s.id || `${p.id}:clip:${i + 1}`,
      name: s.name || s.id,
      mediaId,
      sourceIn: independent ? 0 : frames(s.t0, fps),
      duration,
      start: 0,
      speed: { num: 1, den: 1 },
      thumb: s.thumb || null,
      text,
      textOverrides,
      styleId: 'default',
      beatLock: false,
      attached: Object.keys({ ...text, ...textOverrides }).map((field, j) => ({
        id: `${s.id}:text:${j}`,
        kind: 'text',
        field,
        offset: 0,
        duration,
      })),
      metadata: { ...s, mediaIds },
    });
    if (s.chapter) {
      let scene = video.scenes.find((x) => x.name === s.chapter);
      if (!scene) {
        scene = {
          id: `${p.id}:scene:${s.chapter}`,
          name: s.chapter,
          clipIds: [],
        };
        video.scenes.push(scene);
      }
      scene.clipIds.push(s.id);
    }
  }
  reflow(video);
  video.beats = [
    ...new Set(
      (p.music?.beats || p.music?.beat_times || [])
        .filter((x) => typeof x === 'number')
        .map((x) => frames(x - (p.music?.starts_at_s || 0), fps))
        .filter((x) => x >= 0),
    ),
  ].sort((a, b) => a - b);
  if (p.music?.file && video.clips.length)
    video.clips[0].attached.push({
      id: `${p.id}:music`,
      kind: 'audio',
      mediaId: asset(p.music.file, 'audio'),
      offset: 0,
      duration: reflow(video),
    });
  const doc = {
    schema: SCHEMA,
    id: p.id,
    title: p.title || p.id,
    revision: 0,
    fps,
    canvas: {
      width: p.canvas?.width || 1920,
      height: p.canvas?.height || 1080,
    },
    media,
    videos: [video],
    versions: [],
    preview: p.media || {},
    metadata: { ...p },
  };
  validate(doc);
  return doc;
}
export function validate(d) {
  const ok = (v, m) => {
    if (!v) throw Error(m);
  };
  const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
  ok(d.schema === SCHEMA, 'Unsupported schema');
  ok(typeof d.id === 'string' && d.id.length, 'Missing project ID');
  ok(integer(d.fps?.num, 1) && integer(d.fps?.den, 1), 'Invalid rational fps');
  ok(integer(d.revision), 'Invalid revision');
  if (d.metadata?.tasteDirection) validateSchema(d.metadata.tasteDirection, constraintsSchema);
  if (d.metadata?.tasteBrandConstraints) validateSchema(d.metadata.tasteBrandConstraints, constraintsSchema);
  if (d.metadata?.tasteApplications) {
    ok(Array.isArray(d.metadata.tasteApplications), 'Invalid Taste receipts');
    d.metadata.tasteApplications.forEach(validateApplication);
  }
  ok(
    Array.isArray(d.media) &&
      Array.isArray(d.videos) &&
      Array.isArray(d.versions),
    'Missing collections',
  );
  const ids = new Set();
  const id = (x) => {
    ok(
      typeof x === 'string' && x.length > 0 && !ids.has(x),
      `Duplicate or invalid ID: ${x}`,
    );
    ids.add(x);
  };
  const mediaIds = new Set(d.media.map((m) => m.id));
  d.media.forEach((m) => id(m.id));
  for (const v of d.videos) {
    id(v.id);
    let start = 0;
    const clips = new Set(v.clips.map((c) => c.id));
    for (const c of v.clips) {
      id(c.id);
      ok(c.start === start, 'Story lane must be contiguous');
      ok(integer(c.duration, 1) && integer(c.sourceIn), 'Invalid clip range');
      ok(integer(c.speed?.num, 1) && integer(c.speed?.den, 1), 'Invalid speed');
      ok(!c.mediaId || mediaIds.has(c.mediaId), 'Unknown media');
      const media = d.media.find((m) => m.id === c.mediaId);
      ok(
        media?.duration == null ||
          c.sourceIn + (c.duration * c.speed.num) / c.speed.den <=
            media.duration + 1e-8,
        'Insufficient source handles',
      );
      for (const a of c.attached) {
        id(a.id);
        ok(
          integer(a.offset) && integer(a.duration, 1),
          'Invalid attachment range',
        );
        ok(!a.mediaId || mediaIds.has(a.mediaId), 'Unknown attached media');
      }
      start += c.duration;
    }
    for (const s of v.scenes) {
      id(s.id);
      ok(
        s.clipIds.every((x) => clips.has(x)),
        'Unknown scene clip',
      );
    }
    ok(
      v.beats.every((x) => integer(x)),
      'Invalid beat frame',
    );
  }
  for (const v of d.versions) id(v.id);
  return d;
}
