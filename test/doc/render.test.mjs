import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plan, renderProject } from '../../bridge/render.mjs';

const doc = (clips, extra = {}) => ({
  schema: 'fframestudio.project/1', id: 'p', revision: 3, fps: { num: 30, den: 1 }, canvas: { width: 64, height: 36 },
  media: [{ id: 'm1', kind: 'video', file: 'src.mp4' }], videos: [{ id: 'v1', name: 'v', clips, scenes: [], beats: [] }], versions: [], ...extra,
});
const clip = (id, start, duration, sourceIn = 0, more = {}) => ({ id, mediaId: 'm1', start, duration, sourceIn, speed: { num: 1, den: 1 }, attached: [], ...more });
const legacy = () => ({ schema: 'fframestudio.project/0', id: 'p', canvas: { width: 64, height: 36, fps: 30 }, renders: [{ file: 'src.mp4', duration_s: 4 }], shots: [{ id: 'a', t0: 0, t1: 1 }, { id: 'b', t0: 2, t1: 2.5 }] });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-render-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'projects', 'p'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'src.mp4'), '');
  return { root, dir };
}
const fakeProbe = { probeFile: () => ({ audio: false }) };

test('plan follows canonical story and source ranges, including black clips', (t) => {
  const { dir } = fixture(t);
  const p = plan(doc([clip('a', 0, 30), clip('black', 30, 10, 0, { mediaId: null }), clip('b', 40, 20, 90)]), dir, fakeProbe);
  assert.deepEqual(p.segs.map((s) => [s.clipId, s.kind, s.frames]), [['a', 'video', 30], ['black', 'gap', 10], ['b', 'video', 20]]);
  assert.equal(p.frames, 60);
  const graph = p.args[p.args.indexOf('-filter_complex') + 1];
  assert.match(graph, /trim=start=3\.000000:duration=0\.666667/);
  assert.match(graph, /concat=n=3:v=1:a=0/);
});

test('saved v0 is migrated before planning without mutating the saved document', (t) => {
  const { dir } = fixture(t), d = legacy(), before = JSON.stringify(d);
  const p = plan(d, dir, fakeProbe);
  assert.equal(p.frames, 45);
  assert.deepEqual(p.segs.map((s) => s.sourceIn), [0, 60]);
  assert.equal(JSON.stringify(d), before);
});

test('canonical validation rejects malformed v1 before probing', (t) => {
  const { dir } = fixture(t);
  const options = { probeFile: () => { assert.fail('must validate before probe'); } };
  assert.throws(() => plan(doc([clip('a', 0, 30), clip('b', 20, 10)]), dir, options), /contiguous/);
  assert.throws(() => plan(doc([clip('a', 0, 30, 0, { mediaId: 'unknown' })]), dir, options), /Unknown media/);
  for (const speed of [{ num: 0, den: 1 }, { num: -1, den: 1 }, { num: Infinity, den: 1 }, { num: 1, den: 0 }, { num: NaN, den: 1 }]) {
    assert.throws(() => plan(doc([clip('a', 0, 30, 0, { speed })]), dir, options), /Invalid speed/);
  }
  fs.unlinkSync(path.join(dir, 'src.mp4'));
  assert.throws(() => plan(doc([clip('a', 0, 30)]), dir, fakeProbe), /missing/);
});

test('atempo independently rejects nonpositive and nonfinite factors without looping', () => {
  const source = fs.readFileSync(new URL('../../bridge/render.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function atempo(');
  const end = source.indexOf('\nexport function plan(', start);
  assert.ok(start >= 0 && end > start, 'render helper boundaries must exist');
  const fn = source.slice(start, end);
  for (const speed of [0, -1, Infinity, -Infinity, NaN]) {
    assert.throws(() => runInNewContext(`${fn}; atempo(speed)`, { speed }, { timeout: 50 }), /Invalid render speed/);
  }
});

test('audio attachments fail closed before any probe, for v1 and migrated v0', (t) => {
  const { dir } = fixture(t);
  const d = doc([clip('a', 0, 30, 0, { attached: [{ id: 'music', kind: 'audio', mediaId: 'tone', offset: 0, duration: 30 }] })]);
  d.media[0].kind = 'image'; d.media.push({ id: 'tone', kind: 'audio', file: 'tone.wav' });
  const old = legacy(); old.music = { file: 'tone.wav' };
  for (const input of [d, old]) assert.throws(() => plan(input, dir, { probeFile: () => assert.fail('audio must fail before probing') }), /unsupported audio attachment/i);
  d.videos[0].clips[0].attached[0].kind = 'video';
  assert.throws(() => plan(d, dir, { probeFile: () => assert.fail('audio media reference must fail before probing') }), /unsupported audio attachment/i);
});

test('project and relative media paths cannot escape through traversal or symlinks', async (t) => {
  const { root, dir } = fixture(t);
  for (const projectId of ['.', '..', '../x', '']) await assert.rejects(renderProject({ root, projectId }), /bad project id/);
  const d = doc([clip('a', 0, 30)]);
  fs.writeFileSync(path.join(root, 'outside.mp4'), '');
  d.media[0].file = '../../outside.mp4';
  assert.throws(() => plan(d, dir, fakeProbe), /outside project/);
  fs.symlinkSync(path.join(root, 'outside.mp4'), path.join(dir, 'link.mp4'));
  d.media[0].file = 'link.mp4';
  assert.throws(() => plan(d, dir, fakeProbe), /outside project/);
  fs.symlinkSync(root, path.join(root, 'projects', 'alias'));
  await assert.rejects(renderProject({ root, projectId: 'alias' }), /outside projects/);
});

test('saved malformed speed rejects promptly at renderProject boundary', async (t) => {
  const { root, dir } = fixture(t);
  const d = doc([clip('a', 0, 30, 0, { speed: { num: 0, den: 1 } })]);
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(d));
  await assert.rejects(renderProject({ root, projectId: 'p' }), /Invalid speed/);
  assert.equal(fs.existsSync(path.join(dir, 'renders')), false);
});

test('ffprobe subprocess has deadline, kill, output and input admission bounds', () => {
  const source = fs.readFileSync(new URL('../../bridge/render.mjs', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function probe('), source.indexOf('function atempo('));
  let observed;
  const result = runInNewContext(`${fn}; probe('source.mp4')`, {
    INPUT: ['-protocol_whitelist', 'file'], path,
    spawnSync: (bin, args, options) => { observed = { bin, args, options }; return { status: 0, stdout: 'video\naudio\n' }; },
  });
  assert.equal(result.audio, true);
  assert.equal(observed.bin, 'ffprobe');
  assert.equal(observed.options.timeout, 10000);
  assert.equal(observed.options.killSignal, 'SIGKILL');
  assert.equal(observed.options.maxBuffer, 65536);
  assert.ok(observed.args.includes('-protocol_whitelist'));
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0;
function ff(args) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-threads', '1', '-filter_threads', '1', ...args], { timeout: 15000 });
  assert.equal(r.status, 0, String(r.stderr));
}
test('real saved v0 and edited v1 exports retain frame counts and embedded audio', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async (t) => {
  const { root, dir } = fixture(t); fs.unlinkSync(path.join(dir, 'src.mp4'));
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-shortest', path.join(dir, 'src.mp4')]);
  for (const d of [legacy(), doc([clip('a', 0, 30), clip('b', 30, 15, 60, { speed: { num: 2, den: 1 }, textOverrides: { title: 'not composited' } })])]) {
    const saved = JSON.stringify(d); fs.writeFileSync(path.join(dir, 'project.json'), saved);
    const r = await renderProject({ root, projectId: 'p' });
    assert.equal(r.frames, 45);
    const n = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames,duration', '-of', 'json', r.file], { encoding: 'utf8', timeout: 5000 });
    assert.equal(n.status, 0, n.stderr);
    const streams = JSON.parse(n.stdout).streams;
    assert.equal(Number(streams.find((s) => s.codec_type === 'video').nb_read_frames), 45);
    assert.ok(Math.abs(Number(streams.find((s) => s.codec_type === 'audio').duration) - 1.5) < 0.1);
    const pcm = spawnSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', r.file, '-map', '0:a:0', '-t', '0.2', '-f', 'f32le', '-ac', '1', '-'], { timeout: 5000 });
    assert.equal(pcm.status, 0, String(pcm.stderr));
    let peak = 0;
    for (let i = 0; i + 4 <= pcm.stdout.length; i += 4) peak = Math.max(peak, Math.abs(pcm.stdout.readFloatLE(i)));
    assert.ok(peak > 0.01, 'exported tone must decode to non-silent samples');
    const meta = JSON.parse(fs.readFileSync(r.sidecar, 'utf8'));
    assert.equal(meta.revision, d.revision ?? 0);
    assert.deepEqual(meta.clips.map(c => c.clipId), ['a', 'b']);
    assert.deepEqual(meta.textNotBurnedIn, d.revision ? ['b'] : []);
    assert.equal(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'), saved);
  }
  const out = path.join(dir, 'timeout.mp4');
  await assert.rejects(renderProject({ root, projectId: 'p', out, timeoutMs: 1 }), /render timed out/);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(out + '.part.mp4'), false);
});

test('real image plus tone soundtrack rejects without creating an output', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async (t) => {
  const { root, dir } = fixture(t);
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=64x36', '-frames:v', '1', '-threads', '1', path.join(dir, 'still.png')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(dir, 'tone.wav')]);
  const d = doc([clip('a', 0, 30, 0, { attached: [{ id: 'soundtrack', kind: 'audio', mediaId: 'tone', offset: 0, duration: 30 }] })], { media: [{ id: 'm1', kind: 'image', file: 'still.png' }, { id: 'tone', kind: 'audio', file: 'tone.wav' }] });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(d));
  await assert.rejects(renderProject({ root, projectId: 'p' }), /unsupported audio attachment/i);
  assert.equal(fs.existsSync(path.join(dir, 'renders')), false);
  d.videos[0].clips[0].attached = [];
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(d));
  const rendered = await renderProject({ root, projectId: 'p' });
  assert.equal(rendered.frames, 30);
  assert.equal(JSON.parse(fs.readFileSync(rendered.sidecar, 'utf8')).audio, false);
});

test('render limits and output symlinks reject before starting ffmpeg', async (t) => {
  const { root, dir } = fixture(t);
  for (const extra of [{ canvas: { width: 1, height: 36 } }, { canvas: { width: 10000, height: 10000 } }, { fps: { num: 241, den: 1 } }]) {
    assert.throws(() => plan(doc([clip('a', 0, 30)], extra), dir, { probeFile: () => assert.fail('limits before probe') }), /dimensions or fps/);
  }
  assert.throws(() => plan(doc([clip('a', 0, 30 * 21601)]), dir, fakeProbe), /exceeds limits/);
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(doc([clip('a', 0, 30, 0, { mediaId: null })])));
  const out = path.join(dir, 'safe.mp4');
  const missing = path.join(root, 'not-created.mp4');
  for (const target of [out + '.part.mp4', out.replace('.mp4', '.render.json')]) {
    fs.symlinkSync(missing, target);
    await assert.rejects(renderProject({ root, projectId: 'p', out }), /must not be a symlink/);
    fs.unlinkSync(target);
    assert.equal(fs.existsSync(missing), false);
  }
  fs.symlinkSync(root, path.join(dir, 'renders'));
  await assert.rejects(renderProject({ root, projectId: 'p' }), /output outside project/);
});

test('playlist media is rejected by real ffprobe demuxer admission', { skip: !hasFfmpeg && 'ffmpeg not installed' }, (t) => {
  const { dir } = fixture(t);
  fs.writeFileSync(path.join(dir, 'playlist.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttps://example.invalid/media.ts\n#EXT-X-ENDLIST\n');
  const d = doc([clip('a', 0, 30)]); d.media[0].file = 'playlist.m3u8';
  assert.throws(() => plan(d, dir), /ffprobe failed/);
});
