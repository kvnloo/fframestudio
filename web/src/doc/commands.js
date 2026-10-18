import { clone, validate, reflow, uid } from './project.js';
import { COMMAND_IDS, validateCommand } from '../actions.js';
export const COMMANDS = COMMAND_IDS;
export function diff(a, b, path = '') {
  if (a === b) return [];
  if (
    Array.isArray(a) &&
    Array.isArray(b) &&
    (a.length !== b.length ||
      (a[0]?.id && a.some((x, i) => x?.id !== b[i]?.id)))
  )
    return [{ path, before: a, after: b }];
  if (a && b && typeof a === 'object' && typeof b === 'object')
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      diff(
        a[k],
        b[k],
        `${path}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`,
      ),
    );
  return [{ path, before: a, after: b }];
}
export function applyPatches(doc, patches) {
  let result = doc;
  for (const p of patches) {
    const keys = p.path
      .slice(1)
      .split('/')
      .map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'));
    const set = (value, i) => {
      if (i === keys.length) return p.after;
      const copy = Array.isArray(value) ? [...value] : { ...value },
        k = keys[i];
      if (i === keys.length - 1 && p.after === undefined) delete copy[k];
      else copy[k] = set(value?.[k], i + 1);
      return copy;
    };
    result = p.path ? set(result, 0) : p.after;
  }
  return result;
}
export function scope(c) {
  if (c.type === 'batch') return c.commands.map(scope).join('; ');
  if (c.type === 'edit-style')
    return `Shared style: ${c.styleId} — all clips using this style`;
  if (['move', 'trim', 'split', 'delete', 'retime'].includes(c.type))
    return `This clip: ${c.clipId} + ripple downstream; attachments follow`;
  return c.clipId
    ? `This clip: ${c.clipId}`
    : c.clipIds
      ? `These clips: ${c.clipIds.join(', ')}`
      : 'This video';
}
const need = (x, m) => {
  if (!x) throw Error(m);
};
const safeKey = (k) =>
  typeof k === 'string' &&
  k.length > 0 &&
  !['__proto__', 'constructor', 'prototype'].includes(k);
function mutate(d, c, depth = 0) {
  need(depth < 10, 'Batch nesting too deep');
  if (c.type === 'restore-document' || c.type === 'restore-patches') {
    const restored = clone(validate(c.type === 'restore-document'
      ? c.document : applyPatches(d, c.patches)));
    need(restored.id === d.id, 'Inverse belongs to another project');
    for (const k of Object.keys(d)) delete d[k];
    Object.assign(d, restored);
    return;
  }
  if (c.type === 'batch') {
    need(
      Array.isArray(c.commands) && c.commands.length <= 100,
      'Invalid batch',
    );
    for (const cmd of c.commands) mutate(d, cmd, depth + 1);
    return;
  }
  const v =
    d.videos.find((v) => v.id === c.videoId) ||
    (!c.videoId ? d.videos[0] : null);
  need(v, 'Unknown video');
  const i = v.clips.findIndex((x) => x.id === c.clipId),
    clip = v.clips[i];
  if (['add', 'duplicate', 'split', 'group', 'save-version'].includes(c.type)) {
    const id =
      c.type === 'add'
        ? c.clip?.id
        : ['split', 'duplicate'].includes(c.type)
          ? c.newId
          : c.id;
    need(
      typeof id === 'string' && id.length > 0,
      'Explicit new object ID is required',
    );
  }
  if (
    [
      'move',
      'trim',
      'split',
      'replace',
      'edit-text',
      'duplicate',
      'set-beat-lock',
      'retime',
      'delete',
    ].includes(c.type)
  )
    need(clip, 'Unknown clip');
  if (['move', 'trim', 'split', 'retime', 'delete'].includes(c.type))
    need(
      !clip.beatLock,
      'Clip is beat-locked; unlock it explicitly before timing edits',
    );
  const newCopy = (id) => {
    const x = clone(clip);
    x.id = id || uid('clip');
    x.attached = x.attached.map((a, j) => ({
      ...a,
      id: `${x.id}:attached:${j}`,
    }));
    return x;
  };
  switch (c.type) {
    case 'add': {
      const x = {
        id: uid('clip'),
        name: 'Untitled clip',
        mediaId: null,
        sourceIn: 0,
        duration: 30,
        start: 0,
        speed: { num: 1, den: 1 },
        thumb: null,
        text: {},
        textOverrides: {},
        styleId: 'default',
        beatLock: false,
        attached: [],
        ...clone(c.clip),
      };
      const index = c.index ?? v.clips.length;
      need(
        Number.isInteger(index) && index >= 0 && index <= v.clips.length,
        'Invalid insertion index',
      );
      v.clips.splice(index, 0, x);
      break;
    }
    case 'select':
      need(c.clipId === null || clip, 'Unknown selection');
      break;
    case 'move':
      need(
        Number.isInteger(c.index) && c.index >= 0 && c.index < v.clips.length,
        'Invalid move index',
      );
      v.clips.splice(i, 1);
      v.clips.splice(c.index, 0, clip);
      break;
    case 'trim': {
      const sourceIn = c.sourceIn ?? clip.sourceIn,
        duration = c.duration ?? clip.duration,
        delta = ((sourceIn - clip.sourceIn) * clip.speed.den) / clip.speed.num;
      need(
        Number.isInteger(delta),
        'Trim must resolve to whole timeline frames',
      );
      clip.sourceIn = sourceIn;
      clip.duration = duration;
      clip.attached = clip.attached.flatMap((a) => {
        if (a.kind !== 'text') return [a];
        const start = Math.max(0, a.offset - delta),
          end = Math.min(duration, a.offset + a.duration - delta);
        return end > start
          ? [{ ...a, offset: start, duration: end - start }]
          : [];
      });
      break;
    }
    case 'split': {
      need(
        Number.isSafeInteger(c.at) && c.at > 0 && c.at < clip.duration,
        'Split must be inside the clip',
      );
      const advance = (c.at * clip.speed.num) / clip.speed.den;
      need(
        Number.isInteger(advance),
        'Split needs an exact source-frame boundary',
      );
      const right = newCopy(c.newId);
      right.sourceIn += advance;
      right.duration -= c.at;
      right.attached = right.attached.flatMap((a) => {
        const end = a.offset + a.duration;
        if (end <= c.at) return [];
        return [
          {
            ...a,
            offset: Math.max(0, a.offset - c.at),
            duration: end - Math.max(c.at, a.offset),
          },
        ];
      });
      clip.attached = clip.attached.flatMap((a) =>
        a.offset >= c.at
          ? []
          : [{ ...a, duration: Math.min(a.duration, c.at - a.offset) }],
      );
      clip.duration = c.at;
      v.clips.splice(i + 1, 0, right);
      for (const s of v.scenes) {
        const n = s.clipIds.indexOf(clip.id);
        if (n >= 0) s.clipIds.splice(n + 1, 0, right.id);
      }
      break;
    }
    case 'replace':
      clip.mediaId = c.mediaId;
      clip.sourceIn = c.sourceIn ?? 0;
      break;
    case 'edit-text':
      need(safeKey(c.field), 'Invalid text field');
      need(
        typeof c.value === 'string' ||
          (Array.isArray(c.value) &&
            c.value.every((v) => typeof v === 'string')),
        'Text must be a string or string array',
      );
      clip.textOverrides[c.field] = clone(c.value);
      if (!clip.attached.some((a) => a.kind === 'text' && a.field === c.field))
        clip.attached.push({
          id: `${clip.id}:text:${c.field}`,
          kind: 'text',
          field: c.field,
          offset: 0,
          duration: clip.duration,
        });
      break;
    case 'duplicate':
      v.clips.splice(i + 1, 0, newCopy(c.newId));
      break;
    case 'group':
      need(
        Array.isArray(c.clipIds) &&
          c.clipIds.length > 0 &&
          c.clipIds.every((id) => v.clips.some((x) => x.id === id)),
        'Invalid group selection',
      );
      v.scenes.push({
        id: c.id || uid('scene'),
        name: c.name || 'Scene',
        clipIds: [...new Set(c.clipIds)],
      });
      break;
    case 'set-beat-lock':
      need(typeof c.value === 'boolean', 'Beat lock must be boolean');
      clip.beatLock = c.value;
      break;
    case 'retime': {
      need(
        Number.isSafeInteger(c.speed?.num) &&
          c.speed.num > 0 &&
          Number.isSafeInteger(c.speed?.den) &&
          c.speed.den > 0,
        'Invalid speed',
      );
      const duration =
        (clip.duration * clip.speed.num * c.speed.den) /
        (clip.speed.den * c.speed.num);
      need(
        Number.isSafeInteger(duration) && duration > 0,
        'Retime needs a whole frame duration',
      );
      for (const a of clip.attached) {
        a.offset = Math.round((a.offset * duration) / clip.duration);
        a.duration = Math.max(
          1,
          Math.round((a.duration * duration) / clip.duration),
        );
      }
      clip.duration = duration;
      clip.speed = clone(c.speed);
      break;
    }
    case 'delete':
      v.clips.splice(i, 1);
      v.scenes.forEach(
        (s) => (s.clipIds = s.clipIds.filter((id) => id !== c.clipId)),
      );
      v.scenes = v.scenes.filter((s) => s.clipIds.length);
      break;
    case 'edit-style':
      need(
        safeKey(c.styleId) && Object.hasOwn(v.styles, c.styleId),
        'Unknown style',
      );
      need(/^#[\da-f]{6}$/i.test(c.color), 'Expected hex color');
      v.styles[c.styleId].color = c.color;
      break;
    case 'save-version':
      d.versions.push({
        id: c.id || uid('version'),
        name: c.name || 'Version',
        videoId: v.id,
        video: clone(v),
      });
      break;
    case 'restore-version': {
      const x = d.versions.find((x) => x.id === c.id);
      need(x && x.videoId === v.id, 'Unknown version for video');
      d.videos[d.videos.indexOf(v)] = clone(x.video);
      return;
    }
    default:
      throw Error(`Unknown command: ${c.type}`);
  }
  reflow(v);
  // A preceding ripple cannot silently displace a locked clip either.
}
export class CommandStore {
  constructor(doc) {
    this.doc = clone(validate(doc));
    this.past = [];
    this.future = [];
    this.selection = null;
  }
  preview(cmd) {
    if (cmd.type === 'select') {
      need(
        cmd.clipId === null ||
          this.doc.videos.some((v) => v.clips.some((c) => c.id === cmd.clipId)),
        'Unknown selection',
      );
      return { scope: scope(cmd), diff: [], after: this.doc };
    }
    const vi = cmd.videoId
      ? this.doc.videos.findIndex((v) => v.id === cmd.videoId)
      : 0;
    need(vi >= 0, 'Unknown video');
    const old = this.doc.videos[vi],
      local = [
        'edit-text',
        'set-beat-lock',
        'replace',
        'edit-style',
        'group',
        'save-version',
        'restore-version',
      ].includes(cmd.type);
    // Structural sharing: source media, provenance and immutable version snapshots are never copied per edit.
    const video = {
      ...old,
      clips: local
        ? [...old.clips]
        : old.clips.map((c) => ({
            ...c,
            attached: c.attached.map((a) => ({ ...a })),
            textOverrides: { ...c.textOverrides },
          })),
      scenes: old.scenes.map((s) => ({ ...s, clipIds: [...s.clipIds] })),
      styles: clone(old.styles),
    };
    if (local) {
      const ci = video.clips.findIndex((c) => c.id === cmd.clipId);
      if (ci >= 0) video.clips[ci] = clone(video.clips[ci]);
    }
    const after = {
      ...this.doc,
      videos:
        cmd.type === 'batch' ? clone(this.doc.videos) : [...this.doc.videos],
      versions: [...this.doc.versions],
    };
    if (cmd.type !== 'batch') after.videos[vi] = video;
    mutate(after, cmd);
    validate(after);
    for (const v of this.doc.videos)
      for (const c of v.clips)
        if (c.beatLock) {
          const next = after.videos
            .find((x) => x.id === v.id)
            ?.clips.find((x) => x.id === c.id);
          if (next?.beatLock)
            need(
              next.start === c.start && next.duration === c.duration,
              'Ripple would move a beat-locked clip',
            );
        }
    return { scope: scope(cmd), diff: diff(this.doc, after), after };
  }
  apply(cmd) {
    const p = this.preview(cmd);
    if (cmd.type === 'select') {
      const inverse = { type: 'select', clipId: this.selection };
      this.selection = cmd.clipId;
      return { ...p, inverse };
    }
    const inverse = { type: 'restore-document', document: this.doc };
    p.after.revision = this.doc.revision + 1;
    this.past.push({ before: this.doc, after: p.after, cmd: clone(cmd) });
    this.future = [];
    this.doc = p.after;
    return { ...p, inverse };
  }
  undo() {
    const x = this.past.pop();
    if (!x) return false;
    this.future.push(x);
    this.doc = { ...x.before, revision: this.doc.revision + 1 };
    return true;
  }
  redo() {
    const x = this.future.pop();
    if (!x) return false;
    this.past.push(x);
    this.doc = { ...x.after, revision: this.doc.revision + 1 };
    return true;
  }
  commit(command) {
    const before = this.doc;
    let receipt;
    if (command.type === 'undo' || command.type === 'redo') this[command.type]();
    else receipt = this.apply(command);
    return {
      patches: receipt
        ? [...receipt.diff, ...(this.doc !== before ? [{
            path: '/revision', before: before.revision, after: this.doc.revision,
          }] : [])]
        : diff(before, this.doc),
      inverse: receipt?.inverse || null,
      undo: this.past.length,
      redo: this.future.length,
    };
  }
}
export function recoveryCommand(entry) {
  const type = entry.command.type;
  // History can predate the saved file. Persisted history actions carry their
  // result so recovery can apply each as a normal, independently undoable edit.
  if ((type === 'undo' || type === 'redo') && entry.patches) {
    return { type: 'restore-patches', patches: entry.patches };
  }
  return entry.command;
}
export function proposalCommand(p, doc) {
  need(
    p?.schema === 'fframestudio.proposal/1' && p.projectId === doc.id,
    'Wrong proposal schema or project',
  );
  need(
    p.baseRevision === doc.revision,
    'Stale proposal: request a new proposal against the current revision',
  );
  need(
    Array.isArray(p.commands) &&
      p.commands.length > 0 &&
      p.commands.length <= 100,
    'Invalid proposal commands',
  );
  const commands = p.commands.map(c => {
    const command = c?.id && c?.params ? { ...c.params, type: c.id } : c;
    need(command && COMMANDS.includes(command.type) && command.type !== 'select', 'Command not allowed in a proposal');
    return validateCommand(command);
  });
  return { type: 'batch', commands: clone(commands) };
}
