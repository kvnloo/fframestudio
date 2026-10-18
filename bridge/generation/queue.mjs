import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { runProcess } from './providers.mjs';

const terminal = new Set(['done', 'failed', 'cancelled']);
const identifier = s => typeof s === 'string' && /^[a-zA-Z0-9][\w-]{0,100}$/.test(s);
const need = (value, message) => { if (!value) throw Error(message); };
// Reject links even when they currently resolve inside the library. The local OS and
// configured worker are trusted, as for /fs; this is not an OS sandbox.
export async function safePath(root, relative, { create = false } = {}) {
  need(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !relative.includes('\\') && !relative.split('/').some(p => !p || p === '.' || p === '..'), 'unsafe-path');
  const realRoot = await fs.realpath(root);
  let current = realRoot;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let st = await fs.lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; });
    need(!st?.isSymbolicLink(), 'unsafe-path');
    if (i < parts.length - 1) {
      if (!st && create) { await fs.mkdir(current, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; }); st = await fs.lstat(current); }
      need(st?.isDirectory() && !st.isSymbolicLink(), 'unsafe-path');
    }
  }
  return current;
}
async function atomicJSON(file, value) {
  const temp = file + '.' + randomUUID();
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temp, file); const dir = await fs.open(path.dirname(file), 'r'); try { await dir.sync(); } finally { await dir.close(); } }
  finally { await fs.unlink(temp).catch(() => {}); }
}
export function settingsFor(input, capability) {
  const allowed = ['providerId', 'projectId', 'prompt', 'seed', 'duration', 'width', 'height', 'fps'];
  need(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => allowed.includes(k)), 'invalid-settings');
  need(identifier(input.projectId) && input.providerId === capability.id, 'invalid-settings');
  need(typeof input.prompt === 'string' && input.prompt.trim().length > 0 && input.prompt.length <= 4000, 'invalid-prompt');
  need(Number.isSafeInteger(input.seed) && input.seed >= 0 && input.seed <= 4294967295, 'invalid-seed');
  need(Number.isFinite(input.duration) && input.duration >= 1 && input.duration <= capability.maxDuration && capability.fps.includes(input.fps), 'unsupported-timing');
  need(capability.resolutions.some(([w, h]) => input.width === w && input.height === h), 'unsupported-resolution');
  return Object.fromEntries(allowed.map(k => [k, input[k]]));
}
export async function validateMedia(file, settings, signal) {
  const raw = await runProcess('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { signal, timeout: 15000 });
  let info; try { info = JSON.parse(raw); } catch { throw Error('invalid-media'); }
  const streams = info.streams || [], v = streams.find(s => s.codec_type === 'video');
  const [num, den] = (v?.avg_frame_rate || '').split('/').map(Number), fps = num / den;
  const duration = Number(v?.duration || info.format?.duration);
  // LTX requires 8n+1 frames. Requested duration is rounded to the nearest
  // admissible frame count; import uses the probed duration, never the requested one.
  need(streams.length === 1 && v?.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && v.width === settings.width && v.height === settings.height &&
    Math.abs(fps - settings.fps) < 0.01 && Number.isFinite(duration) && duration > 0 && Math.abs(duration - settings.duration) <= 0.4, 'invalid-media');
  await runProcess('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { signal, timeout: 60000 });
  const bytes = await fs.readFile(file);
  return { codec: 'h264', pixelFormat: 'yuv420p', width: v.width, height: v.height, fps, duration, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export class GenerationQueue {
  constructor({ root, providers, publish = () => {} }) {
    this.root = root; this.providers = new Map(providers.map(p => [p.capability.id, p]));
    this.publish = publish; this.jobs = new Map(); this.active = null; this.closed = false;
    this.ready = this.recover();
  }
  async recover() {
    const marker = await safePath(this.root, '.generation/jobs/.marker', { create: true });
    this.stateDir = path.dirname(marker);
    for (const name of await fs.readdir(this.stateDir)) {
      if (!/^[\w-]+\.json$/.test(name)) continue;
      const file = await safePath(this.root, '.generation/jobs/' + name);
      // A malformed journal is a startup failure, not a silently lost job.
      const j = JSON.parse(await fs.readFile(file, 'utf8'));
      need(identifier(j.id) && name === j.id + '.json' && this.providers.has(j.providerId) && [...terminal, 'queued', 'running'].includes(j.state), 'invalid-journal');
      settingsFor(j.settings, this.providers.get(j.providerId).capability);
      if (!terminal.has(j.state)) { j.state = 'failed'; j.error = 'interrupted'; j.updatedAt = new Date().toISOString(); await atomicJSON(file, j); }
      this.jobs.set(j.id, j);
    }
  }
  list(projectId) { return structuredClone([...this.jobs.values()].filter(j => !projectId || j.projectId === projectId)); }
  async capabilities() {
    await this.ready;
    return Promise.all([...this.providers.values()].map(async p => ({ ...structuredClone(p.capability), ...await p.probe() })));
  }
  async persist(j) {
    const file = await safePath(this.root, '.generation/jobs/' + j.id + '.json');
    await atomicJSON(file, j);
    this.jobs.set(j.id, structuredClone(j));
    this.publish({ ev: 'generation', job: structuredClone(j) });
  }
  async submit(input, retryOf = null) {
    await this.ready; need(!this.closed, 'queue-closed');
    const provider = this.providers.get(input?.providerId); need(provider, 'unknown-provider');
    const settings = settingsFor(input, provider.capability);
    await safePath(this.root, `projects/${settings.projectId}/project.json`);
    const st = await fs.stat(await safePath(this.root, `projects/${settings.projectId}/project.json`)); need(st.isFile(), 'unknown-project');
    need([...this.jobs.values()].filter(j => !terminal.has(j.state)).length < 32, 'queue-full');
    const status = await provider.probe(); need(status.available, 'provider-unavailable');
    const now = new Date().toISOString();
    const j = { schema: 'fframestudio.generation-job/1', id: randomUUID(), providerId: provider.capability.id, projectId: settings.projectId,
      settings, model: provider.capability.model, version: provider.capability.version, licence: structuredClone(provider.capability.licence), cost: structuredClone(provider.capability.cost),
      state: 'queued', progress: 0, retryOf, createdAt: now, updatedAt: now, error: null, result: null };
    await this.persist(j); this.kick(); return structuredClone(j);
  }
  kick() { if (!this.pumping && !this.closed) { this.pumping = this.pump().finally(() => { this.pumping = null; if (!this.closed && [...this.jobs.values()].some(j => j.state === 'queued')) this.kick(); }); } }
  async pump() {
    for (;;) {
      if (this.closed) return;
      const next = [...this.jobs.values()].find(j => j.state === 'queued'); if (!next) return;
      const j = structuredClone(next);
      const controller = new AbortController(); let finish;
      this.active = { id: j.id, controller, done: new Promise(resolve => { finish = resolve; }) };
      try {
        j.state = 'running'; j.updatedAt = new Date().toISOString(); await this.persist(j);
        const rel = `projects/${j.projectId}/media/generated/${j.id}`;
        const output = await safePath(this.root, rel + '/result.mp4', { create: true });
        need(!(await fs.lstat(output).catch(() => null)), 'output-exists');
        // Serialize progress journal writes; completion waits for all events.
        let chain = Promise.resolve(), last = 0;
        const progress = n => { if (!Number.isFinite(n) || controller.signal.aborted || n <= last) return; last = Math.min(0.95, Math.max(0, n));
          chain = chain.then(async () => { if (j.state !== 'running') return; j.progress = last; j.updatedAt = new Date().toISOString(); await this.persist(j); }); };
        try { await this.providers.get(j.providerId).generate(j.settings, { output, signal: controller.signal, progress }); }
        finally { await chain; }
        if (controller.signal.aborted) throw Error('cancelled');
        await safePath(this.root, rel + '/result.mp4');
        const media = await validateMedia(output, j.settings, controller.signal);
        const sidecar = { schema: 'fframestudio.generation/1', jobId: j.id, prompt: j.settings.prompt, seed: j.settings.seed,
          model: j.model, version: j.version, settings: j.settings, licence: j.licence, cost: j.cost, media, generatedAt: new Date().toISOString(), machineGenerated: true };
        await atomicJSON(await safePath(this.root, rel + '/result.json'), sidecar);
        if (controller.signal.aborted) throw Error('cancelled');
        j.result = { file: `media/generated/${j.id}/result.mp4`, sidecar: `media/generated/${j.id}/result.json`, media, provenance: sidecar };
        j.state = 'done'; j.progress = 1;
      } catch (e) {
        j.state = controller.signal.aborted ? 'cancelled' : 'failed';
        j.error = ['invalid-media', 'unsafe-path', 'unavailable'].includes(e.message) ? e.message : controller.signal.aborted ? null : 'generation-failed';
        j.result = null;
      }
      j.updatedAt = new Date().toISOString(); await this.persist(j); this.active = null; finish();
    }
  }
  async cancel(id) {
    await this.ready; const j = structuredClone(this.jobs.get(id)); need(j, 'unknown-job');
    if (terminal.has(j.state)) return structuredClone(j);
    if (this.active?.id === id) { const active = this.active; active.controller.abort(); await active.done; }
    else { j.state = 'cancelled'; j.updatedAt = new Date().toISOString(); await this.persist(j); }
    return structuredClone(this.jobs.get(id));
  }
  async retry(id) { await this.ready; const j = this.jobs.get(id); need(j && ['failed', 'cancelled'].includes(j.state), 'not-retryable'); return this.submit(j.settings, id); }
  async close() { this.closed = true; this.active?.controller.abort(); await this.pumping; }
}
