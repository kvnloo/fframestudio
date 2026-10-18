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
      const job = await q.submit({ providerId: 'local-ltx', projectId: 'smoke', prompt: 'A small orange ceramic teapot sits on a wooden table. Warm sunlight falls from a window on the left. Steam rises slowly from the spout. The camera gently moves closer. Natural cinematic footage.', seed: 42, duration: 4, width: 704, height: 480, fps: 24 });
      for (;;) {
        const j = q.list().find(j => j.id === job.id);
        if (j?.state === 'failed' || j?.state === 'cancelled') throw Error('Real model smoke failed: ' + j.error);
        if (j?.state === 'done') {
          const clip = path.join(root, 'projects/smoke', j.result.file);
          const metrics = JSON.parse(await fs.readFile(clip.replace('.mp4', '.metrics.json')));
          const sheet = path.join(root, 'contact-sheet.jpg');
          await runProcess('ffmpeg', ['-v', 'error', '-i', clip, '-vf', 'fps=1,scale=352:240,tile=2x2', '-frames:v', '1', sheet], { timeout: 30000 });
          const receipt = { smoke: 'local-ltx', status: 'passed', metrics, clip: path.relative(root, clip), contactSheet: 'contact-sheet.jpg', jobId: j.id };
          await fs.writeFile(path.join(root, 'smoke.json'), JSON.stringify(receipt, null, 2));
          console.log(JSON.stringify(receipt)); break;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    } finally { await q.close(); }
  }
}
