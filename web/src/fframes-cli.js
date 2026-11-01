// Revision-aware fframes CLI review recipes for a selected clip. Pure: builds argv to copy;
// the editor never executes native fframes code (see docs/research/upstream-refresh-20261020.md).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BASE = ['render', 'frame', 'strip', 'onion', 'svg', 'timeline', 'inspect', 'audio', 'preview'];
// Source: fframes/src/renderer/cli.rs at each revision (Command enum, Args structs, exit codes).
export const FFRAMES_CLI = Object.freeze({
  '44745c09a6c8c51071609097326a820cf59d087b': Object.freeze({
    label: 'main 44745c0 · 2026-10-17 (after v1.2.0)', release: null,
    commands: Object.freeze([...BASE, 'snapshot']), parallelConvert: false,
  }),
  '69174f0187b5d8e92329246898f70250b59f08f2': Object.freeze({
    label: 'v1.3.0 69174f0 · 2026-10-20', release: 'v1.3.0',
    commands: Object.freeze(BASE), parallelConvert: true,
  }),
});
export const PINNED_REVISION = '44745c09a6c8c51071609097326a820cf59d087b';
export const LATEST_REVISION = '69174f0187b5d8e92329246898f70250b59f08f2';
// Commands every known revision accepts; an unknown revision only gets these.
const COMMON = BASE.filter((c) => Object.values(FFRAMES_CLI).every((r) => r.commands.includes(c)));

const SAFE = /^[A-Za-z0-9_./:=@%+,-]+$/;
export const shellQuote = (a) => (SAFE.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`);
export const commandLine = (argv) => argv.map(shellQuote).join(' ');

const slug = (s) => String(s || 'clip').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'clip';
const integerFps = (doc) => (doc?.fps && doc.fps.den === 1 ? doc.fps.num : null);

// The clip's half-open range in the native film, or why it cannot be mapped.
export function nativeRange(doc, clip) {
  const m = doc?.metadata || {};
  if (m.kind !== 'fframes') return { ok: false, reason: 'Not an fframes film: no native CLI range.' };
  const master = doc.media?.find((x) => x.file === (m.renders?.[0]?.file || m.media?.proxy));
  if (!master || clip?.mediaId !== master.id)
    return { ok: false, reason: 'This clip does not use the film render, so its source frames are not native frames.' };
  const filmFps = Number(m.canvas?.fps);
  const fps = integerFps(doc);
  const span = Math.ceil((clip.duration * clip.speed.num) / clip.speed.den);
  const start = clip.sourceIn, end = clip.sourceIn + span;
  const scene = clip.metadata?.sourceScene || null;
  const untrimmed = Array.isArray(clip.metadata?.sourceFrames) && clip.metadata.sourceFrames[0] === start && clip.metadata.sourceFrames[1] === end;
  if (fps && Number.isInteger(filmFps) && fps === filmFps)
    return { ok: true, unit: 'frames', start, end, spec: `${start}..${end}`, at: (f) => String(f), scene, untrimmed };
  // Different or rational project rate: give exact seconds and let fframes round to its frame.
  const sec = (f) => `${((f * doc.fps.den) / doc.fps.num).toFixed(3)}s`;
  return { ok: true, unit: 'seconds', start, end, spec: `${sec(start)}..${sec(end)}`, at: sec, scene, untrimmed,
    warning: `Project rate ${doc.fps.num}/${doc.fps.den} differs from the film's ${filmFps || 'unrecorded'} fps: times are seconds, rounded by fframes.` };
}

export function reviewPlan(doc, clip) {
  const range = nativeRange(doc, clip);
  if (!range.ok) return { available: false, reason: range.reason };
  const m = doc.metadata || {};
  const revision = m.provenance?.revision || m.source?.revision || null;
  const known = revision ? FFRAMES_CLI[revision] : null;
  const allowed = known ? known.commands : COMMON;
  const dir = `review/${slug(clip.name || clip.id)}`;
  const mid = Math.floor((range.start + range.end - 1) / 2);
  const all = [
    { id: 'timeline', label: 'Scenes and audio tracks', argv: ['timeline', '--json'], why: 'Exact scene frame ranges (end exclusive, overlaps included).' },
    { id: 'frame', label: 'First, middle and last frame with element ids', argv: ['frame', [range.start, mid, range.end - 1].map(range.at).join(','), '--ids', '--json', '-o', `${dir}/frames`], why: 'PNG per frame plus per-frame diagnostics; --ids outlines and labels elements with an id.' },
    { id: 'strip', label: 'Contact strip of the range', argv: ['strip', range.spec, '-n', '12', '-o', `${dir}/strip.png`], why: 'Evenly spaced labelled frames: one image to review motion.' },
    { id: 'onion', label: 'Onion skin of the range', argv: ['onion', range.spec, '-n', '6', '-o', `${dir}/onion.png`], why: 'Later frames stronger: shows path, overshoot and spacing.' },
    { id: 'inspect', label: 'Inspect with pop detection', argv: ['inspect', range.spec, '--pops', '--json', '--fail-on', 'warning'], why: 'Exit 0 = passed, 2 = completed with findings, other non-zero = failed to run. A report is not a pass.' },
    { id: 'render', label: 'Draft render of this range', argv: ['render', range.spec, '--draft', '-o', `${dir}/draft.mp4`], why: 'Half resolution, fastest preset; not a delivery master.' },
  ];
  const commands = all.filter((c) => allowed.includes(c.argv[0]));
  const example = /dmtrKovalenko\/fframes/i.test(m.source?.sourceRepo || m.sourceRepo || '') && (m.source?.sourcePath || m.sourcePath);
  const pkg = example ? String(example).split('/').pop() : null;
  const prefix = pkg ? ['cargo', 'run', '--release', '-p', pkg, '--'] : ['cargo', 'run', '--release', '--'];
  const notes = [];
  if (range.warning) notes.push(range.warning);
  if (!revision) notes.push(`fframes revision not recorded: showing only commands present at both ${PINNED_REVISION.slice(0, 7)} and ${LATEST_REVISION.slice(0, 7)}. Check \`--help\` first.`);
  else if (!known) notes.push(`Revision ${revision.slice(0, 12)} is not in the verified CLI table: showing only common commands. Check \`--help\` first.`);
  if (known && known.commands.includes('snapshot')) notes.push('`snapshot` exists at this revision but is removed in v1.3.0 (#235); these recipes do not use it.');
  if (known?.parallelConvert) notes.push('v1.3.0 converts multi-frame commands on 1–4 threads (a quarter of FFRAMES_NUM_THREADS); upstream reports unchanged pixels and reports (#235), not re-measured here.');
  if (revision && revision !== LATEST_REVISION) notes.push(`Upstream v1.3.0 (${LATEST_REVISION.slice(0, 7)}) is newer than this film's revision; flags above are this revision's.`);
  return {
    available: true, revision, revisionKnown: !!known, revisionLabel: known?.label || (revision ? `unverified ${revision.slice(0, 12)}` : 'not recorded'),
    range, prefix, cwd: pkg ? `an unmodified fframes checkout at ${revision ? revision.slice(0, 7) : 'the recorded revision'}` : 'the film source folder (Source & provenance)',
    commands: commands.map((c) => ({ ...c, line: commandLine([...prefix, ...c.argv]) })), notes,
  };
}

export function fframesReviewInner(doc, clip) {
  const p = reviewPlan(doc, clip);
  if (!p.available) return `<p class="hint" data-fframes-unavailable>${esc(p.reason)}</p>`;
  const r = p.range;
  return `<p class="hint">Native ${esc(r.unit)} <b data-fframes-range>${esc(r.spec)}</b>${r.scene ? ` · scene <code>${esc(r.scene)}</code>${r.untrimmed ? '' : ' (trimmed)'}` : ''}<br>CLI <span data-fframes-revision>${esc(p.revisionLabel)}</span> · run in ${esc(p.cwd)}</p><ol class="fframes-recipes">${p.commands.map((c) => `<li data-fframes-command="${esc(c.id)}"><span>${esc(c.label)}</span><code>${esc(c.line)}</code><button type="button" class="pill" data-copy-cli="${esc(c.line)}" aria-label="Copy ${esc(c.label)} command">Copy</button><small>${esc(c.why)}</small></li>`).join('')}</ol>${p.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join('')}<p class="hint">Copy only: Studio never runs native fframes builds or binaries.</p>`;
}

// Upstream status for an fframes film in Source & provenance: which verified revision built it and what
// the newest verified upstream release changes. Static facts from the table above; no network.
export const LATEST_CHANGES = Object.freeze([
  'Lottie playback via frame.play_lottie (feature lottie, #236)',
  '3D scenes via fframes::three_d (features 3d, wgpu, #233)',
  'ctx.render_svgr nests svgr and 3D (#221)',
  'multi-frame CLI commands convert on 1–4 threads (#235)',
  'CLI snapshot command removed (#235)',
]);
export function upstreamStatus(metadata) {
  if (metadata?.kind !== 'fframes') return null;
  const revision = metadata.provenance?.revision || metadata.source?.revision || null;
  const known = revision ? FFRAMES_CLI[revision] : null;
  const current = revision === LATEST_REVISION;
  return {
    revision, known: !!known, current,
    label: known ? known.label : revision ? `unverified ${revision.slice(0, 12)}` : 'not recorded',
    latest: FFRAMES_CLI[LATEST_REVISION].label,
    changes: current ? [] : LATEST_CHANGES,
    action: current ? 'Built at the newest verified release.'
      : revision ? 'Adopting v1.3.0 needs a rebuild of the film and a new timeline --json; Studio does not rebuild or re-import automatically.'
      : 'Record the fframes revision used to build this film (provenance.revision) so review recipes and upgrade notes are exact.',
  };
}
export function fframesUpstreamSource(metadata) {
  const u = upstreamStatus(metadata);
  if (!u) return '';
  return `<section class="fframes-upstream" data-fframes-upstream="${u.current ? 'current' : u.revision ? 'behind' : 'unknown'}"><h3>fframes upstream</h3><p>Built with <b>${esc(u.label)}</b> · newest verified <b>${esc(u.latest)}</b></p>${u.changes.length ? `<ul>${u.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}<p class="hint">${esc(u.action)}</p></section>`;
}

// Stable <details> shell; refreshFframesReview updates only its body so open state survives edits.
export const fframesReviewShell = (doc) => (doc?.metadata?.kind === 'fframes' ? '<details class="fframes-review" id="fframes-review"><summary>Review in fframes CLI</summary><div data-fframes-body></div></details>' : '');

export function refreshFframesReview(box, doc, clip) {
  const body = box?.querySelector('#fframes-review [data-fframes-body]');
  if (!body) return;
  const html = fframesReviewInner(doc, clip);
  if (body.ffsHtml === html) return;
  body.ffsHtml = html;
  body.innerHTML = html;
  for (const b of body.querySelectorAll('[data-copy-cli]'))
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copyCli); b.textContent = 'Copied'; }
      catch { b.textContent = 'Select & copy'; const code = b.previousElementSibling; const s = getSelection(); s.removeAllRanges(); const range = document.createRange(); range.selectNodeContents(code); s.addRange(range); }
    };
}
