import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LICENCE = Object.freeze({
  name: 'LTXV Open Weights License 0.X',
  url: 'https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt',
  commercial: 'conditional',
  notice: 'Use restrictions and AI disclosure required. Entities with annual revenue >= $10M need a separate commercial licence. Output rights are not guaranteed.',
});
export const LTX = Object.freeze({
  schema: 'fframestudio.generation-provider/1', id: 'local-ltx', name: 'LTX Video 2B distilled · local',
  model: 'Lightricks/LTX-Video', version: 'ltxv-2b-0.9.6-distilled',
  modes: ['t2v'], maxDuration: 5, resolutions: [[704, 480], [480, 704], [480, 480]], fps: [24],
  vram: { minimumFreeMiB: 9216, measuredPeakMiB: null, preset: 'bf16-cpu-offload-vae-tiling' },
  cost: { kind: 'local', amount: 0, currency: 'USD', note: 'No API fee; hardware/electricity and licence conditions apply.' },
  licence: LICENCE,
});
export function validateCapability(c) {
  if (c?.schema !== 'fframestudio.generation-provider/1' || !/^[a-z0-9-]+$/.test(c.id) ||
      !c.model || !c.version || !c.name || !Array.isArray(c.modes) || !c.modes.length || c.modes.some(m => !['t2v', 'i2v'].includes(m)) ||
      !Number.isFinite(c.maxDuration) || c.maxDuration <= 0 || !c.resolutions?.length ||
      c.resolutions.some(r => !Array.isArray(r) || r.length !== 2 || r.some(n => !Number.isSafeInteger(n) || n < 32)) ||
      !c.fps?.length || c.fps.some(n => !Number.isSafeInteger(n) || n <= 0) ||
      !Number.isFinite(c.vram?.minimumFreeMiB) || c.vram.minimumFreeMiB < 0 ||
      !['local', 'free', 'unknown'].includes(c.cost?.kind) || !c.licence?.name || !c.licence?.url) throw Error('Invalid provider capability');
  return c;
}
export function runProcess(command, args, { signal, input, onLine, env = process.env, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('cancelled'));
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', overflow = false;
    const kill = () => { child.kill('SIGTERM'); force = setTimeout(() => child.kill('SIGKILL'), 2000); force.unref(); };
    let force, timer = timeout ? setTimeout(kill, timeout) : null;
    signal?.addEventListener('abort', kill, { once: true });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => { if (stdout.length < 65536) stdout += line + '\n'; else { overflow = true; kill(); } if (line.length < 8192) onLine?.(line); });
    // Provider output is untrusted and may contain credentials: never log stderr or return it to HTTP.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? undefined : JSON.stringify(input));
    child.once('error', () => finish(false));
    child.once('close', code => finish(code === 0 && !overflow));
    let settled = false;
    function finish(ok) {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(force); lines.close(); signal?.removeEventListener('abort', kill);
      if (ok && !signal?.aborted) resolve(stdout); else reject(Error(signal?.aborted ? 'cancelled' : 'worker-failed'));
    }
  });
}
export async function gpuProbe() {
  try {
    const rows = await runProcess('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'], { timeout: 4000 });
    const [name, total, free] = rows.split('\n')[0].split(',').map(s => s.trim());
    if (!Number.isFinite(+free)) throw Error();
    return { name, totalMiB: +total, freeMiB: +free };
  } catch { return null; }
}
export function providers({ python = process.env.FFS_GEN_PYTHON, modelDir = process.env.FFS_GEN_MODEL_DIR, fake = false } = {}) {
  const list = [{
    capability: LTX,
    async probe() {
      const gpu = await gpuProbe();
      const installed = !!python && fs.existsSync(python) && !!modelDir && fs.existsSync(path.join(modelDir, 'ltxv-2b-0.9.6-distilled-04-25.safetensors')) && fs.existsSync(path.join(modelDir, 'base/model_index.json'));
      const available = installed && !!gpu && gpu.freeMiB >= LTX.vram.minimumFreeMiB;
      return { available, gpu, reason: available ? null : !installed ? 'Local inference unavailable: install the worker and model outside the repository.' : !gpu ? 'Local inference unavailable: NVIDIA GPU not detected.' : 'Local inference unavailable: wait for at least 9 GiB free VRAM.', qualification: 'experimental-unmeasured' };
    },
    async generate(settings, context) {
      const status = await this.probe();
      if (!status.available) throw Error('unavailable');
      return runProcess(python, [path.join(here, 'ltx_worker.py')], {
        signal: context.signal, input: { ...settings, output: context.output, modelDir, parentPid: process.pid },
        env: { PATH: process.env.PATH, HOME: process.env.HOME, HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false', CUDA_VISIBLE_DEVICES: '0' },
        onLine: line => { try { const p = JSON.parse(line); if (p.type === 'progress') context.progress(p.progress); } catch {} },
      });
    },
  }, {
    capability: { ...LTX, id: 'hosted-experimental', name: 'Hosted experimental · disabled', model: 'unverified', version: 'none', cost: { kind: 'unknown', amount: null, currency: 'USD', note: 'No verifiably free text-to-video API qualified.' }, vram: { minimumFreeMiB: 0, measuredPeakMiB: null }, licence: { name: 'Unverified — disabled', url: 'https://portal.nousresearch.com/' } },
    async probe() { return { available: false, reason: 'Disabled: no free video endpoint, licence and current limits verified. No network requests are made.' }; },
    async generate() { throw Error('unavailable'); },
  }];
  if (fake) list.unshift({
    capability: { ...LTX, id: 'fake', name: 'Test pattern · fake provider (not AI)', model: 'ffmpeg-testsrc2', version: '1', vram: { minimumFreeMiB: 0, measuredPeakMiB: 0 }, licence: { name: 'Synthetic test pattern', url: 'https://ffmpeg.org/' } },
    async probe() { return { available: true, reason: null, qualification: 'test-only' }; },
    async generate(settings, context) {
      return runProcess(process.execPath, [path.join(here, 'fake-worker.mjs')], { signal: context.signal,
        env: { PATH: process.env.PATH }, input: { ...settings, output: context.output, parentPid: process.pid },
        onLine: line => { try { context.progress(JSON.parse(line).progress); } catch {} },
      });
    },
  });
  for (const p of list) validateCapability(p.capability);
  return list;
}
