import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fromV0 } from '../../web/src/doc/project.js';
import { FFRAMES_CLI, PINNED_REVISION, LATEST_REVISION, nativeRange, reviewPlan, fframesReviewInner, fframesReviewShell, shellQuote, commandLine, upstreamStatus, fframesUpstreamSource, LATEST_CHANGES } from '../../web/src/fframes-cli.js';

const root = new URL('../../', import.meta.url);
const surface = JSON.parse(fs.readFileSync(new URL('docs/evidence/fframes-cli-surface-20261020.json', root)));
const catalog = JSON.parse(fs.readFileSync(new URL('examples/catalog.json', root)));

// Mirrors tools/example_fframes_intro.py project_from_timeline: contiguous scenes from `timeline --json`.
const film = (revision, fps = 30, extra = {}) => fromV0({
  schema: 'fframestudio.project/0', id: 'ff-review', title: 'Review fixture', kind: 'fframes',
  canvas: { width: 1280, height: 720, fps }, duration_s: 4,
  shots: [
    { id: 'scene-0', name: 'Intro', t0: 0, t1: 2, sourceFrames: [0, 2 * fps], sourceScene: 'fframes_intro::IntroScene' },
    { id: 'scene-1', name: 'Outro <b>', t0: 2, t1: 4, sourceFrames: [2 * fps, 4 * fps], sourceScene: 'fframes_intro::OutroScene' },
  ],
  media: { proxy: 'proxy.mp4' }, renders: [{ label: 'Local web proxy', file: 'proxy.mp4', duration_s: 4 }],
  source: { sourceRepo: 'https://github.com/dmtrKovalenko/fframes', sourcePath: 'examples/fframes-intro' },
  provenance: revision ? { revision } : {}, ...extra,
});

test('verified CLI table matches the cli.rs surface extracted at each pinned revision', () => {
  assert.deepEqual(Object.keys(FFRAMES_CLI).sort(), Object.keys(surface.revisions).sort());
  for (const [sha, r] of Object.entries(surface.revisions)) {
    assert.equal(r.url, `https://github.com/dmtrKovalenko/fframes/blob/${sha}/fframes/src/renderer/cli.rs`);
    assert.deepEqual([...FFRAMES_CLI[sha].commands].sort(), [...r.commands].sort(), sha);
    assert.equal(r.inspect_exit_findings, 2);
    for (const f of ['json']) assert.ok(r.global.includes(f));
    assert.ok(r.args.frame.includes('ids') && r.args.inspect.includes('pops') && r.args.inspect.includes('fail-on') && r.args.render.includes('draft'));
    assert.deepEqual(r.short.strip, ['count', 'output']);
  }
  assert.ok(surface.revisions[PINNED_REVISION].commands.includes('snapshot'));
  assert.ok(!surface.revisions[LATEST_REVISION].commands.includes('snapshot'), 'v1.3.0 removed snapshot (#235)');
});

test('the example film pin is one revision across catalog, render script and CLI table', () => {
  const entry = catalog.find((e) => e.id === 'fframes-intro');
  assert.equal(entry.provenance.revision, PINNED_REVISION);
  assert.ok(entry.source_url.includes(PINNED_REVISION));
  const script = fs.readFileSync(new URL('tools/example_fframes_intro.py', root), 'utf8');
  assert.match(script, new RegExp(`REVISION = '${PINNED_REVISION}'`));
  assert.ok(FFRAMES_CLI[entry.provenance.revision], 'bumping the pin requires a verified CLI table entry');
});

test('untrimmed scene maps to its exact native frames at the pinned revision', () => {
  const doc = film(PINNED_REVISION), clip = doc.videos[0].clips[1];
  const r = nativeRange(doc, clip);
  assert.deepEqual([r.unit, r.start, r.end, r.spec, r.untrimmed, r.scene], ['frames', 60, 120, '60..120', true, 'fframes_intro::OutroScene']);
  const p = reviewPlan(doc, clip);
  assert.equal(p.revisionKnown, true);
  assert.deepEqual(p.prefix, ['cargo', 'run', '--release', '-p', 'fframes-intro', '--']);
  const byId = Object.fromEntries(p.commands.map((c) => [c.id, c.argv]));
  assert.deepEqual(Object.keys(byId), ['timeline', 'frame', 'strip', 'onion', 'inspect', 'render']);
  assert.deepEqual(byId.frame.slice(0, 2), ['frame', '60,89,119']);
  assert.deepEqual(byId.strip, ['strip', '60..120', '-n', '12', '-o', 'review/outro-b/strip.png']);
  assert.deepEqual(byId.inspect, ['inspect', '60..120', '--pops', '--json', '--fail-on', 'warning']);
  for (const c of p.commands) assert.ok(FFRAMES_CLI[PINNED_REVISION].commands.includes(c.argv[0]));
  assert.ok(p.commands.every((c) => c.argv[0] !== 'snapshot'));
  assert.ok(p.notes.some((n) => /snapshot.*removed in v1\.3\.0/.test(n)));
  assert.ok(p.notes.some((n) => /v1\.3\.0 \(69174f0\) is newer/.test(n)));
});

test('v1.3.0 revision reports parallel conversion and no stale-upgrade note', () => {
  const doc = film(LATEST_REVISION), p = reviewPlan(doc, doc.videos[0].clips[0]);
  assert.match(p.revisionLabel, /v1\.3\.0/);
  assert.ok(p.notes.some((n) => /FFRAMES_NUM_THREADS/.test(n)));
  assert.ok(!p.notes.some((n) => /newer than/.test(n) || /snapshot/.test(n)));
});

test('trim and retime move the native range; unknown revisions fail closed to common commands', () => {
  const doc = film(null), clip = structuredClone(doc.videos[0].clips[0]);
  Object.assign(clip, { sourceIn: 5, duration: 10, speed: { num: 2, den: 1 } });
  const r = nativeRange(doc, clip);
  assert.deepEqual([r.start, r.end, r.untrimmed], [5, 25, false]);
  const p = reviewPlan(doc, clip);
  assert.equal(p.revisionKnown, false);
  assert.ok(p.notes.some((n) => /revision not recorded/.test(n)));
  assert.ok(p.commands.every((c) => FFRAMES_CLI[PINNED_REVISION].commands.includes(c.argv[0]) && FFRAMES_CLI[LATEST_REVISION].commands.includes(c.argv[0])));
  const unknown = reviewPlan(film('f'.repeat(40)), doc.videos[0].clips[0]);
  assert.match(unknown.notes.join(' '), /not in the verified CLI table/);
});

test('a project rate that differs from the film rate uses explicit seconds', () => {
  const doc = film(PINNED_REVISION, 30);
  doc.fps = { num: 30000, den: 1001 };
  const r = nativeRange(doc, doc.videos[0].clips[0]);
  assert.equal(r.unit, 'seconds');
  assert.equal(r.spec, '0.000s..2.002s');
  assert.match(r.warning, /differs from the film's 30 fps/);
});

test('non-film clips and other project kinds have no native range', () => {
  const other = film(PINNED_REVISION);
  other.metadata.kind = 'html-film';
  assert.equal(reviewPlan(other, other.videos[0].clips[0]).available, false);
  assert.equal(fframesReviewShell(other), '');
  const doc = film(PINNED_REVISION), clip = { ...doc.videos[0].clips[0], mediaId: null };
  assert.match(reviewPlan(doc, clip).reason, /does not use the film render/);
  assert.match(fframesReviewInner(doc, clip), /data-fframes-unavailable/);
});

test('rendered recipes escape names and quote shell arguments', () => {
  const doc = film(PINNED_REVISION), html = fframesReviewInner(doc, doc.videos[0].clips[1]);
  assert.doesNotMatch(html, /<b>'|Outro <b>/);
  assert.match(html, /data-fframes-command="inspect"/);
  assert.match(html, /cargo run --release -p fframes-intro -- strip 60\.\.120 -n 12/);
  assert.equal(shellQuote("it's a b"), `'it'\\''s a b'`);
  assert.equal(commandLine(['frame', '1s,Intro@50%']), 'frame 1s,Intro@50%');
});

test('Source upstream status: behind, current and unrecorded fframes revisions', () => {
  const behind = upstreamStatus(film(PINNED_REVISION).metadata);
  assert.equal(behind.current, false);
  assert.match(behind.label, /44745c0/);
  assert.match(behind.latest, /v1\.3\.0/);
  assert.ok(behind.changes.some((c) => /snapshot command removed/.test(c)) && behind.changes.some((c) => /play_lottie/.test(c)));
  assert.match(behind.action, /needs a rebuild/);
  const html = fframesUpstreamSource(film(PINNED_REVISION).metadata);
  assert.match(html, /data-fframes-upstream="behind"/);
  assert.equal((html.match(/<li>/g) || []).length, LATEST_CHANGES.length);
  const current = upstreamStatus(film(LATEST_REVISION).metadata);
  assert.deepEqual([current.current, current.changes.length], [true, 0]);
  assert.match(fframesUpstreamSource(film(LATEST_REVISION).metadata), /data-fframes-upstream="current"/);
  const unknown = upstreamStatus(film(null).metadata);
  assert.equal(unknown.label, 'not recorded');
  assert.match(unknown.action, /provenance\.revision/);
  const other = film(PINNED_REVISION); other.metadata.kind = 'capture-manifest';
  assert.equal(upstreamStatus(other.metadata), null);
  assert.equal(fframesUpstreamSource(other.metadata), '');
});
