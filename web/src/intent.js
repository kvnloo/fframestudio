import { action, resolveClip } from './actions.js';
import { fpsOf, uid } from './doc/project.js';
const numbers = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10 };
const number = s => numbers[s] ?? (/^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
const clarify = message => ({ clarification: message });
// Anchored grammar: unsupported or compound instructions never become guessed edits.
export function parseIntent(utterance, context) {
  const raw = String(utterance).trim().replace(/[.!?]+$/, ''), text = raw.toLowerCase();
  const simple = { play:'forward', 'start playback':'forward', pause:'pause', stop:'pause', 'stop playback':'pause', undo:'undo', 'undo that':'undo', redo:'redo', 'redo that':'redo', save:'save', 'save project':'save' };
  const result = (id, params = {}) => {
    try { const a = action(id); a.preview(context, params); return { action: { id, params }, confirmation: a.destructive || a.bulk }; }
    catch (e) { return clarify(e.message); }
  };
  if (simple[text]) return result(simple[text]);
  let m;
  if ((m = /^(?:seek|go)(?: to)? ([\w.]+)\s*(?:s|seconds?)$/.exec(text))) {
    const n = number(m[1]);
    return Number.isFinite(n) && n * fpsOf(context.doc) < context.total ? result('seek', { frame: Math.round(n * fpsOf(context.doc)) }) : clarify('Choose a time inside this video.');
  }
  if ((m = /^open (?:the )?(?:panel )?(shot|narrative|direction|takes|assistant|source|story)(?: panel)?$/.exec(text))) return result('open-panel', { panel:m[1] });
  const target = value => {
    const ordinal = /^(?:the )?([\w]+)(?:st|nd|rd|th)? (?:shot|clip)$/.exec(value || '');
    const n = ordinal ? number(ordinal[1].replace(/^(\d+)(st|nd|rd|th)$/, '$1')) : NaN;
    return resolveClip(context, Number.isFinite(n) ? n : value || 'this shot');
  };
  if ((m = /^select (?:(?:shot|clip) ([\w]+)|(.+))$/.exec(text))) {
    const c = m[1] ? resolveClip(context, number(m[1])) : target(m[2]);
    return c ? result('select', { clipId:c.id }) : clarify('Which shot number?');
  }
  if ((m = /^(?:shorten|trim) (.+) by ([\w.]+)\s*(?:s|seconds?)$/.exec(text))) {
    const c = target(m[1]), n = number(m[2]);
    return c && n > 0 && Number.isFinite(n) ? result('trim', { clipId:c.id, duration:c.duration - Math.round(n * fpsOf(context.doc)) }) : clarify('Which shot, and how many seconds?');
  }
  if ((m = /^(split|delete|remove|duplicate)(?: (.+))?$/.exec(text))) {
    const c = target(m[2]); if (!c) return clarify('Select a shot first.');
    const id = m[1] === 'remove' ? 'delete' : m[1];
    return result(id, { clipId:c.id, ...(id === 'split' ? { at:Math.round(context.frame)-c.start, newId:uid('shot') } : id === 'duplicate' ? { newId:uid('shot') } : {}) });
  }
  if ((m = /^move (.+) to (?:position )?([\w]+)$/.exec(text))) {
    const c = target(m[1]), n = number(m[2]);
    return c && Number.isInteger(n) && n > 0 && n <= context.video.clips.length ? result('move', { clipId:c.id, index:n-1 }) : clarify('Which shot and destination position?');
  }
  if ((m = /^change (?:the )?(text|title)(?: of (.+?))? to (['"])([\s\S]*)\3$/i.exec(raw))) {
    const c = target(m[2]?.toLowerCase());
    return c ? result('edit-text', { clipId:c.id, field:'title', value:m[4] }) : clarify('Select the shot whose text should change.');
  }
  // ff-unmute working-copy camera keys (1-based in speech, 0-based in the command).
  if ((m = /^(?:snap|move) (?:the )?camera key ([\w]+) to (?:the )?(bar|kick|clap|token) ([\w]+)$/.exec(text))) {
    const k = number(m[1]), n = number(m[3]);
    return Number.isInteger(k) && k > 0 && Number.isInteger(n) && n > 0 ? result('edit-procedural-camera', { key:k-1, snap:{ kind:m[2], index:n } }) : clarify('Which camera key, and which bar, kick, clap or token?');
  }
  if ((m = /^set (?:the )?camera key ([\w]+) (zoom|blur|roll|look y|tilt x|tilt y|dx) to (-?\d+(?:\.\d+)?)$/.exec(text))) {
    const k = number(m[1]);
    return Number.isInteger(k) && k > 0 ? result('edit-procedural-camera', { key:k-1, changes:{ [m[2].replace(' ', '_')]:Number(m[3]) } }) : clarify('Which camera key?');
  }
  if ((m = /^reset (?:the )?camera key ([\w]+)$/.exec(text))) {
    const k = number(m[1]);
    return Number.isInteger(k) && k > 0 ? result('edit-procedural-camera', { key:k-1, reset:true }) : clarify('Which camera key?');
  }
  return clarify('Please give one precise action: e.g. “shorten the second shot by one second” or “change the text to \'Hello\'”.');
}
