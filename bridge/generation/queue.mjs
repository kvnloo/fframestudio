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
  need(realRoot === path.resolve(root), 'unsafe-path');
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
const referenceKeys = ['id', 'videoId', 'clipId', 'clipName', 'mediaId', 'frame', 'sourceTime'];
const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const docId = s => typeof s === 'string' && s.length <= 200 && /^[\w:.-]+$/.test(s);
// The browser names a server-stored reference by UUID plus where it came from on
// the timeline. It never supplies a path, URL or image bytes inside job settings.
export function referenceFor(r) {
  need(r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).every(k => referenceKeys.includes(k)), 'invalid-reference');
  need(uuid(r.id) && docId(r.videoId) && docId(r.clipId) && (r.mediaId == null || docId(r.mediaId)), 'invalid-reference');
  need(Number.isSafeInteger(r.frame) && r.frame >= 0 && Number.isFinite(r.sourceTime) && r.sourceTime >= 0 && r.sourceTime <= 86400, 'invalid-reference');
  need(r.clipName == null || (typeof r.clipName === 'string' && r.clipName.length <= 200), 'invalid-reference');
  return Object.fromEntries(referenceKeys.filter(k => r[k] !== undefined).map(k => [k, r[k]]));
}
export const referenceFile = id => `media/generated/references/${id}.png`;
export function settingsFor(input, capability) {
  const allowed = ['providerId', 'projectId', 'prompt', 'seed', 'duration', 'width', 'height', 'fps', 'mode', 'reference'];
  need(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => allowed.includes(k)), 'invalid-settings');
  const mode = input.mode ?? 't2v';
  need(['t2v', 'i2v'].includes(mode), 'invalid-settings');
  // i2v is only accepted when the provider advertises it; never silently ignored.
  need(capability.modes.includes(mode), 'unsupported-mode');
  need(mode === 'i2v' ? input.reference !== undefined : input.reference === undefined, 'invalid-reference');
  need(identifier(input.projectId) && input.providerId === capability.id, 'invalid-settings');
  need(typeof input.prompt === 'string' && input.prompt.trim().length > 0 && input.prompt.length <= 4000, 'invalid-prompt');
  need(Number.isSafeInteger(input.seed) && input.seed >= 0 && input.seed <= 4294967295, 'invalid-seed');
  need(Number.isFinite(input.duration) && input.duration >= 1 && input.duration <= capability.maxDuration && capability.fps.includes(input.fps), 'unsupported-timing');
  need(capability.resolutions.some(([w, h]) => input.width === w && input.height === h), 'unsupported-resolution');
  const out = Object.fromEntries(allowed.slice(0, 8).map(k => [k, input[k]]));
  out.mode = mode;
  if (mode === 'i2v') out.reference = referenceFor(input.reference);
  return out;
}
// PNG only: signature + IHDR dimensions, then a full FFmpeg decode before use.
export function pngSize(bytes) {
  need(bytes.length > 33 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && bytes.subarray(12, 16).toString('latin1') === 'IHDR', 'invalid-reference');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  need(width >= 32 && height >= 32 && width <= 4096 && height <= 4096, 'invalid-reference');
  return { width, height };
}
export const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
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
    this.publish = publish; this.jobs = new Map(); this.cancelling = new Set(); this.submitting = 0; this.active = null; this.closed = false;
    this.ready = this.recover();
  }
  async recover() {
    this.root = await fs.realpath(this.root);
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
    j.sequence = (j.sequence || 0) + 1;
    const file = await safePath(this.root, '.generation/jobs/' + j.id + '.json');
    await atomicJSON(file, j);
    this.jobs.set(j.id, structuredClone(j));
    this.publish({ ev: 'generation', job: structuredClone(j) });
  }
  async project(projectId) {
    need(identifier(projectId), 'invalid-settings');
    const file = await safePath(this.root, `projects/${projectId}/project.json`).catch(() => null);
    const st = file && await fs.lstat(file).catch(() => null); need(st?.isFile(), 'unknown-project');
  }
  // Stores one captured playhead frame. Server-selected name; never overwritten.
  async addReference(projectId, bytes) {
    await this.ready; need(!this.closed, 'queue-closed'); await this.project(projectId);
    need(Buffer.isBuffer(bytes) && bytes.length <= MAX_REFERENCE_BYTES, 'invalid-reference');
    const { width, height } = pngSize(bytes), id = randomUUID(), rel = referenceFile(id);
    const file = await safePath(this.root, `projects/${projectId}/${rel}`, { create: true });
    const temp = await safePath(this.root, `projects/${projectId}/media/generated/references/.${id}.tmp.png`);
    await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
    try { await runProcess('ffmpeg', ['-v', 'error', '-xerror', '-i', temp, '-f', 'null', '-'], { timeout: 15000 }); }
    catch { await fs.unlink(temp).catch(() => {}); throw Error('invalid-reference'); }
    await fs.link(temp, file); await fs.unlink(temp);
    return { id, file: rel, width, height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async resolveReference(settings) {
    if (settings.mode !== 'i2v') return null;
    const rel = referenceFile(settings.reference.id);
    const file = await safePath(this.root, `projects/${settings.projectId}/${rel}`);
    const bytes = await fs.readFile(file).catch(() => null); need(bytes, 'unknown-reference');
    const { width, height } = pngSize(bytes);
    need(width === settings.width && height === settings.height, 'reference-mismatch');
    return { file: rel, path: file, width, height, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async submit(input, retryOf = null) {
    await this.ready; need(!this.closed, 'queue-closed');
    const provider = this.providers.get(input?.providerId); need(provider, 'unknown-provider');
    const settings = settingsFor(input, provider.capability);
    await this.project(settings.projectId);
    const ref = await this.resolveReference(settings);
    need([...this.jobs.values()].filter(j => !terminal.has(j.state)).length + this.submitting < 32, 'queue-full');
    this.submitting++;
    try {
    const status = await provider.probe(); need(status.available, 'provider-unavailable');
    const now = new Date().toISOString();
    const j = { schema: 'fframestudio.generation-job/1', id: randomUUID(), providerId: provider.capability.id, projectId: settings.projectId,
      settings, model: provider.capability.model, version: provider.capability.version, weightRevision: provider.capability.weightRevision || null, inference: structuredClone(provider.capability.inference || {}), licence: structuredClone(provider.capability.licence), cost: structuredClone(provider.capability.cost),
      mode: settings.mode, reference: ref && { ...settings.reference, file: ref.file, width: ref.width, height: ref.height, sha256: ref.sha256 },
      state: 'queued', progress: 0, retryOf, createdAt: now, updatedAt: now, error: null, result: null };
    await this.persist(j); this.kick(); return structuredClone(j);
    } finally { this.submitting--; }
  }
  kick() { if (!this.pumping && !this.closed) { this.pumping = this.pump().finally(() => { this.pumping = null; if (!this.closed && [...this.jobs.values()].some(j => j.state === 'queued' && !this.cancelling.has(j.id))) this.kick(); }); } }
  async pump() {
    for (;;) {
      if (this.closed) return;
      const next = [...this.jobs.values()].find(j => j.state === 'queued' && !this.cancelling.has(j.id)); if (!next) return;
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
        // Re-resolve (lstat + hash) right before use; a changed reference fails the job.
        const ref = await this.resolveReference(j.settings);
        need(!ref || ref.sha256 === j.reference?.sha256, 'unknown-reference');
        try { await this.providers.get(j.providerId).generate(j.settings, { output, signal: controller.signal, progress, reference: ref?.path || null }); }
        finally { await chain; }
        if (controller.signal.aborted) throw Error('cancelled');
        await safePath(this.root, rel + '/result.mp4');
        const media = await validateMedia(output, j.settings, controller.signal);
        const sidecar = { schema: 'fframestudio.generation/1', jobId: j.id, prompt: j.settings.prompt, seed: j.settings.seed,
          model: j.model, version: j.version, weightRevision: j.weightRevision, settings: { ...j.settings, inference: j.inference }, mode: j.mode || 't2v', reference: j.reference || null, licence: j.licence, cost: j.cost, media, generatedAt: new Date().toISOString(), machineGenerated: true };
        await atomicJSON(await safePath(this.root, rel + '/result.json'), sidecar);
        if (controller.signal.aborted) throw Error('cancelled');
        j.result = { file: `media/generated/${j.id}/result.mp4`, sidecar: `media/generated/${j.id}/result.json`, media, provenance: sidecar };
        j.state = 'done'; j.progress = 1;
      } catch (e) {
        j.state = controller.signal.aborted ? 'cancelled' : 'failed';
        j.error = ['invalid-media', 'unsafe-path', 'unavailable', 'unknown-reference', 'reference-mismatch', 'invalid-reference'].includes(e.message) ? e.message : controller.signal.aborted ? null : 'generation-failed';
        j.result = null;
      }
      j.updatedAt = new Date().toISOString(); await this.persist(j); this.active = null; finish();
    }
  }
  async cancel(id) {
    await this.ready; const j = structuredClone(this.jobs.get(id)); need(j, 'unknown-job');
    if (terminal.has(j.state)) return structuredClone(j);
    if (this.active?.id === id) { const active = this.active; active.controller.abort(); await active.done; }
    else {
      this.cancelling.add(id);
      try { j.state = 'cancelled'; j.updatedAt = new Date().toISOString(); await this.persist(j); }
      finally { this.cancelling.delete(id); }
    }
    return structuredClone(this.jobs.get(id));
  }
  async retry(id) { await this.ready; const j = this.jobs.get(id); need(j && ['failed', 'cancelled'].includes(j.state), 'not-retryable'); return this.submit(j.settings, id); }
  async close() { this.closed = true; this.active?.controller.abort(); await this.pumping; }
}
