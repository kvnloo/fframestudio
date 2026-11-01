import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plan, renderProject } from '../../bridge/render.mjs';

const doc = (clips, extra = {}) => ({
  schema: 'fframestudio.project/1', id: 'p', revision: 3, fps: { num: 30, den: 1 }, canvas: { width: 64, height: 36 },
  media: [{ id: 'm1', kind: 'video', file: 'src.mp4' }], videos: [{ id: 'v1', name: 'v', clips }], ...extra,
});
const clip = (id, start, duration, sourceIn = 0, more = {}) => ({ id, mediaId: 'm1', start, duration, sourceIn, speed: { num: 1, den: 1 }, ...more });

test('plan follows story order, fills gaps with black and keeps every clip length', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-render-'));
  fs.writeFileSync(path.join(dir, 'src.mp4'), '');
  const p = plan(doc([clip('b', 40, 20, 90), clip('a', 0, 30, 0)]), dir, { probeFile: () => ({ audio: false }) });
  assert.deepEqual(p.segs.map((s) => [s.clipId ?? null, s.kind, s.frames]), [['a', 'video', 30], [null, 'gap', 10], ['b', 'video', 20]]);
  assert.equal(p.frames, 60);
  const graph = p.args[p.args.indexOf('-filter_complex') + 1];
  assert.match(graph, /trim=start=3\.000000:duration=0\.666667/); // clip b: sourceIn 90 f = 3 s, 20 f
  assert.match(graph, /concat=n=3:v=1:a=0/);
  assert.equal(p.withAudio, false);
});

test('plan rejects overlapping clips and missing media', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-render-'));
  fs.writeFileSync(path.join(dir, 'src.mp4'), '');
  assert.throws(() => plan(doc([clip('a', 0, 30), clip('b', 20, 10)]), dir, { probeFile: () => ({ audio: false }) }), /overlaps/);
  fs.unlinkSync(path.join(dir, 'src.mp4'));
  assert.throws(() => plan(doc([clip('a', 0, 30)]), dir, { probeFile: () => ({ audio: false }) }), /missing/);
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('renderProject writes an mp4 whose duration is the edited story', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-render-'));
  const dir = path.join(root, 'projects', 'p'); fs.mkdirSync(dir, { recursive: true });
  const gen = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30:d=4', '-pix_fmt', 'yuv420p', path.join(dir, 'src.mp4')]);
  assert.equal(gen.status, 0, String(gen.stderr));
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(doc([clip('a', 0, 30, 0), clip('b', 30, 15, 60, { speed: { num: 2, den: 1 } })])));
  const r = await renderProject({ root, projectId: 'p' });
  assert.equal(r.frames, 45);
  const n = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', r.file], { encoding: 'utf8' });
  assert.equal(Number(n.stdout.trim()), 45);
  const meta = JSON.parse(fs.readFileSync(r.sidecar, 'utf8'));
  assert.equal(meta.revision, 3);
  assert.deepEqual(meta.clips.map((c) => c.clipId), ['a', 'b']);
  await assert.rejects(renderProject({ root, projectId: '../x' }), /bad project id/);
});
