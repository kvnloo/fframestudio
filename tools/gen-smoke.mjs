#!/usr/bin/env node
// Real local-only smoke. No fake fallback and no downloads. GPU/busy/missing
// optional setup skips cleanly; an attempted inference failure exits nonzero.
import fs from 'node:fs/promises';
import path from 'node:path';
import { GenerationQueue } from '../bridge/generation/queue.mjs';
import { gpuProbe, providers, runProcess } from '../bridge/generation/providers.mjs';
const out = process.env.FFS_GEN_SMOKE_DIR;
const skip = reason => console.log(JSON.stringify({ smoke: 'local-ltx', status: 'skipped', reason }));
const gpu = await gpuProbe();
if (!gpu) skip('NVIDIA GPU unavailable');
else if (gpu.freeMiB < 9216) skip(`Shared GPU busy: ${gpu.freeMiB} MiB free; at least 9216 MiB required. No inference started.`);
else {
  const provider = providers().find(p => p.capability.id === 'local-ltx');
  const status = await provider.probe();
  if (!status.available) skip(status.reason);
  else {
    if (!out || !path.isAbsolute(out)) throw Error('Set FFS_GEN_SMOKE_DIR to a new absolute artifacts directory outside the repository.');
    const repo = path.resolve(new URL('..', import.meta.url).pathname);
    const target = path.resolve(out);
    if (target === repo || target.startsWith(repo + path.sep)) throw Error('Smoke artifacts must stay outside the repository.');
    await fs.mkdir(target, { recursive: false });
    const root = await fs.realpath(target);
    if (root === repo || root.startsWith(repo + path.sep)) throw Error('Smoke artifact ancestor resolves inside repository.');
    await fs.mkdir(path.join(root, 'projects/smoke'), { recursive: true });
    await fs.writeFile(path.join(root, 'projects/smoke/project.json'), JSON.stringify({ id: 'smoke' }));
    const q = new GenerationQueue({ root, providers: [provider] });
    try {
      // Optional low-res/short preset for a shared GPU; still validated against the capability.
      const [width, height] = (process.env.FFS_GEN_SMOKE_SIZE || '704x480').split('x').map(Number);
      const duration = Number(process.env.FFS_GEN_SMOKE_SECONDS || 4);
      // Optional real i2v: an external PNG at the smoke resolution, stored via the same reference API.
      const refPng = process.env.FFS_GEN_SMOKE_REFERENCE;
      const i2v = refPng ? { mode: 'i2v', reference: { id: (await q.addReference('smoke', await fs.readFile(refPng))).id, videoId: 'smoke', clipId: 'smoke-reference', clipName: 'Smoke reference', mediaId: null, frame: 0, sourceTime: 0 } } : {};
      const job = await q.submit({ providerId: 'local-ltx', projectId: 'smoke', prompt: 'A small orange ceramic teapot sits on a wooden table. Warm sunlight falls from a window on the left. Steam rises slowly from the spout. The camera gently moves closer. Natural cinematic footage.', seed: 42, duration, width, height, fps: 24, ...i2v });
      for (;;) {
        const j = q.list().find(j => j.id === job.id);
        if (j?.state === 'failed' || j?.state === 'cancelled') throw Error('Real model smoke failed: ' + j.error);
        if (j?.state === 'done') {
          const clip = path.join(root, 'projects/smoke', j.result.file);
          const metrics = JSON.parse(await fs.readFile(clip.replace('.mp4', '.metrics.json')));
          const sheet = path.join(root, 'contact-sheet.jpg');
          await runProcess('ffmpeg', ['-v', 'error', '-i', clip, '-vf', `fps=${4 / duration},scale=-2:240,tile=2x2`, '-frames:v', '1', sheet], { timeout: 30000 });
          const receipt = { smoke: 'local-ltx', status: 'passed', mode: j.mode, reference: j.reference, metrics, clip: path.relative(root, clip), contactSheet: 'contact-sheet.jpg', jobId: j.id };
          await fs.writeFile(path.join(root, 'smoke.json'), JSON.stringify(receipt, null, 2));
          console.log(JSON.stringify(receipt)); break;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    } finally { await q.close(); }
  }
}
