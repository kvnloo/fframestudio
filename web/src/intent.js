import { action, resolveClip } from './actions.js';
import { fpsOf, uid } from './doc/project.js';
import { hostFeature } from './host.js';
const numbers = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10, eleven:11, twelve:12, fifteen:15, sixteen:16, twenty:20, thirty:30, forty:40, fifty:50 };
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
  const comfy = comfyIntent(raw, text);
  if (comfy) return comfy.clarification ? comfy : hostFeature('comfy') ? result(comfy.id, comfy.params) : clarify('ComfyUI is not configured on this bridge.');
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
  return clarify('Please give one precise action: e.g. “shorten the second shot by one second” or “change the text to \'Hello\'”.');
}

// ComfyUI pane grammar. Speech has no quotes, so prompts run to the end of the utterance;
// "comfy" is required wherever a bare verb (run, cancel, steps…) could mean an edit.
const unquote = s => s.trim().replace(/^(['"“”‘’])([\s\S]*)\1$/, '$2').trim();
const PARAM_ALIASES = { steps: 'steps', step: 'steps', seed: 'seed', cfg: 'cfg', guidance: 'cfg', width: 'width', height: 'height', denoise: 'denoise', frames: 'length', length: 'length', 'negative prompt': 'negative', negative: 'negative', sampler: 'sampler', scheduler: 'scheduler' };
export function comfyIntent(raw, text) {
  const body = text.replace(/^comfy(?:ui)?[,:]?\s+/, ''), prefixed = body !== text, rawBody = raw.replace(/^comfy(?:ui)?[,:]?\s+/i, '');
  let m;
  if (/^open (?:the )?comfy(?:ui)?(?: pane| panel)?$/.test(text) || (prefixed && /^(?:open|show)$/.test(body))) return { id: 'comfy', params: {} };
  if ((m = /^(?:set |change |use )?(?:the )?prompt (?:to |as )?([\s\S]+)$/i.exec(rawBody)) && (prefixed || /^(?:set|change|use) /i.test(rawBody))) {
    const prompt = unquote(m[1]); return prompt ? { id: 'comfy-set-prompt', params: { prompt } } : { clarification: 'What should the prompt say?' };
  }
  if (prefixed && (m = /^(?:set |change )?(?:the )?(negative prompt|negative|steps?|seed|cfg|guidance|width|height|denoise|frames|length|sampler|scheduler) (?:to |at )?([\s\S]+)$/i.exec(rawBody))) {
    const name = PARAM_ALIASES[m[1].toLowerCase()], v = unquote(m[2]);
    if (['negative', 'sampler', 'scheduler'].includes(name)) return { id: 'comfy-set-param', params: { name, value: name === 'negative' ? v : v.toLowerCase() } };
    const n = number(v.toLowerCase()); return Number.isFinite(n) ? { id: 'comfy-set-param', params: { name, value: n } } : { clarification: `Say a number for ${m[1]}.` };
  }
  if ((m = /^(?:give me |make |run |generate )?(?:(\w+) )?(?:more|another|new|other) variations?$/.exec(body)) || (m = /^(?:more|another) (?:one|take|version)s?$/.exec(body))) {
    const n = m[1] ? number(m[1]) : 1; return Number.isInteger(n) && n >= 1 && n <= 4 ? { id: 'comfy-variations', params: { count: n } } : { clarification: 'Ask for one to four variations.' };
  }
  if ((prefixed && /^(?:run|go|generate|render|queue(?: it)?)(?: it| this)?$/.test(body)) || /^(?:run|generate with) comfy(?:ui)?$/.test(text)) return { id: 'comfy-run', params: {} };
  if ((prefixed && /^(?:cancel|stop|abort)(?: it| that| all| everything)?$/.test(body)) || /^(?:cancel|stop) comfy(?:ui)?$/.test(text)) return { id: 'comfy-cancel', params: {} };
  if (prefixed && (m = /^(?:use|switch to|load) (?:the )?(?:template |workflow |model )?([\w .-]+?)(?: template| workflow| model)?$/.exec(body))) return { id: 'comfy-use-template', params: { template: m[1].trim() } };
  if (prefixed) return { clarification: 'ComfyUI: say “set prompt to …”, “steps 12”, “run”, “more variations” or “cancel”.' };
  return null;
}
