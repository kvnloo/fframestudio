// Render a saved fframestudio project to an mp4 with ffmpeg.
//
// The render follows the saved project.json, not the browser: story order, each clip's
// sourceIn/duration (integer project frames) and speed. Gaps between clips are black. An image
// clip holds its image; a clip with no media is black. Text is not composited: a film imported
// from an fframes render already carries its titles in the picture, and text edits made in the
// studio are listed in the sidecar as not burned in.
//
// renderProject({ root, projectId, videoId?, out? }) -> { file, sidecar, frames, seconds, clips }
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ID = /^[A-Za-z0-9._-]+$/;

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${path.basename(file)}`);
  return { audio: r.stdout.split('\n').some((l) => l.trim() === 'audio') };
}

function atempo(speed) { // atempo accepts 0.5..2; chain for larger factors
  const parts = []; let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-9) parts.push(`atempo=${s}`);
  return parts;
}

/** Build the segment list (story order, gaps filled) and the ffmpeg argument list. Pure apart from probing. */
export function plan(doc, projectDir, { videoId, probeFile = probe } = {}) {
  const video = videoId ? doc.videos.find((v) => v.id === videoId) : doc.videos[0];
  if (!video) throw new Error(`no video ${videoId || ''} in project`);
  const fps = doc.fps.num / doc.fps.den, W = doc.canvas.width, H = doc.canvas.height;
  const media = new Map((doc.media || []).map((m) => [m.id, m]));
  const clips = [...video.clips].sort((a, b) => a.start - b.start);
  const segs = []; let at = 0;
  for (const c of clips) {
    if (c.start < at) throw new Error(`clip ${c.id} overlaps the clip before it`);
    if (c.start > at) segs.push({ kind: 'gap', frames: c.start - at });
    const m = c.mediaId ? media.get(c.mediaId) : null;
    const speed = c.speed ? c.speed.num / c.speed.den : 1;
    if (!m) segs.push({ kind: 'gap', frames: c.duration, clipId: c.id });
    else {
      const file = path.isAbsolute(m.file) ? m.file : path.resolve(projectDir, m.file);
      if (!fs.existsSync(file)) throw new Error(`clip ${c.id}: media file is missing`);
      segs.push({ kind: m.kind === 'image' ? 'image' : 'video', file, clipId: c.id, sourceIn: c.sourceIn || 0, frames: c.duration, speed });
    }
    at = c.start + c.duration;
  }
  if (!segs.length) throw new Error('video has no clips');
  const files = [...new Set(segs.filter((s) => s.kind === 'video').map((s) => s.file))];
  const info = new Map(files.map((f) => [f, probeFile(f)]));
  const withAudio = [...info.values()].some((i) => i.audio);
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
  const args = [], graph = [], labels = [];
  const input = new Map();
  for (const f of files) { input.set(f, input.size); args.push('-i', f); }
  segs.forEach((s, i) => {
    const sec = (s.frames / fps).toFixed(6);
    if (s.kind === 'video') {
      const k = input.get(s.file), start = (s.sourceIn / fps).toFixed(6), span = (s.frames * s.speed / fps).toFixed(6);
      graph.push(`[${k}:v]trim=start=${start}:duration=${span},setpts=(PTS-STARTPTS)/${s.speed},fps=${fps},${fit},trim=end_frame=${s.frames}[v${i}]`);
      if (withAudio) graph.push(info.get(s.file).audio
        ? `[${k}:a]atrim=start=${start}:duration=${span},asetpts=PTS-STARTPTS,${[...atempo(s.speed), 'aresample=48000', 'aformat=channel_layouts=stereo', 'apad', `atrim=duration=${sec}`].join(',')}[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${sec}[a${i}]`);
    } else {
      if (s.kind === 'image') { const k = input.size; input.set(`img${i}`, k); args.push('-loop', '1', '-framerate', String(fps), '-t', sec, '-i', s.file); graph.push(`[${k}:v]fps=${fps},${fit},trim=end_frame=${s.frames}[v${i}]`); }
      else graph.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${sec},format=yuv420p,setsar=1[v${i}]`);
      if (withAudio) graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${sec}[a${i}]`);
    }
    labels.push(withAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  graph.push(`${labels.join('')}concat=n=${segs.length}:v=1:a=${withAudio ? 1 : 0}${withAudio ? '[v][a]' : '[v]'}`);
  args.push('-filter_complex', graph.join(';'), '-map', '[v]');
  if (withAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart');
  const frames = segs.reduce((n, s) => n + s.frames, 0);
  return { video, fps, frames, segs, args, withAudio };
}

export async function renderProject({ root, projectId, videoId, out, onProgress }) {
  if (!ID.test(projectId || '')) throw new Error('bad project id');
  const projectDir = path.join(root, 'projects', projectId);
  const doc = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
  const p = plan(doc, projectDir, { videoId });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const file = out ? path.resolve(out) : path.join(projectDir, 'renders', `${projectId}-r${doc.revision}-${stamp}.mp4`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.part.mp4';
  await new Promise((ok, bad) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...p.args, tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => { const m = /frame=(\d+)/.exec(String(d)); if (m) onProgress?.({ frame: Number(m[1]), frames: p.frames }); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', bad);
    child.on('exit', (code) => (code === 0 ? ok() : bad(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`))));
  }).catch((e) => { try { fs.unlinkSync(tmp); } catch {} throw e; });
  fs.renameSync(tmp, file);
  const textEdits = p.video.clips.filter((c) => c.textOverrides && Object.keys(c.textOverrides).length).map((c) => c.id);
  const sidecar = file.replace(/\.mp4$/, '.render.json');
  const meta = {
    schema: 'fframestudio.render/1', projectId, videoId: p.video.id, revision: doc.revision, fps: doc.fps,
    canvas: doc.canvas, frames: p.frames, seconds: p.frames / p.fps, audio: p.withAudio,
    clips: p.segs.map((s) => ({ clipId: s.clipId ?? null, kind: s.kind, sourceIn: s.sourceIn ?? null, frames: s.frames, speed: s.speed ?? 1 })),
    textNotBurnedIn: textEdits,
  };
  fs.writeFileSync(sidecar, JSON.stringify(meta, null, 2) + '\n');
  return { file, sidecar, frames: p.frames, seconds: p.frames / p.fps, clips: meta.clips };
}
