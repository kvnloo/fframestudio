// ComfyUI adapter: REST + WebSocket client, template registry with typed parameter
// introspection, a serial job runner for the ComfyUI pane, and an adapter that exposes
// video templates through the existing generation-provider interface.
//
// Trust boundary: a ComfyUI workflow is arbitrary code (custom nodes run Python). The
// browser, voice and ACP agents may only name a registered template and supply typed
// parameter values; raw graphs are never accepted over HTTP.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runProcess } from './providers.mjs';
import { safePath } from './queue.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = path.join(here, 'comfy-templates');
const terminal = new Set(['done', 'failed', 'cancelled']);
const need = (value, message) => { if (!value) throw Error(message); };
const sha256 = data => createHash('sha256').update(data).digest('hex');
const isLink = v => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && Number.isInteger(v[1]);
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024, MAX_OUTPUTS = 8;
const EXT = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', mp4: 'video', webm: 'video', mov: 'video' };

// ---------------------------------------------------------------- configuration
// Loopback and tailnet (CGNAT 100.64/10) may use plain HTTP; anything else needs HTTPS.
export function comfyEndpoint(raw) {
  if (!raw) return null;
  const u = new URL(raw);
  need(['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash, 'invalid-comfy-url');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const tailnet = /^100\.(\d+)\./.exec(host); const cgnat = tailnet && +tailnet[1] >= 64 && +tailnet[1] <= 127;
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host) || cgnat || host.endsWith('.ts.net');
  need(u.protocol === 'https:' || local, 'insecure-comfy-url');
  const cloud = host === 'cloud.comfy.org';
  return Object.freeze({ base: u.origin + u.pathname.replace(/\/$/, ''), prefix: cloud ? '/api' : '', cloud, label: cloud ? 'Comfy Cloud' : host + (u.port ? ':' + u.port : '') });
}

// ---------------------------------------------------------------- REST + WS client
export class ComfyClient {
  constructor({ endpoint, apiKey = null, fetch = globalThis.fetch, WebSocket = globalThis.WebSocket, timeout = 15000 }) {
    this.endpoint = endpoint; this.fetch = fetch; this.WebSocket = WebSocket; this.timeout = timeout;
    // Held privately; never serialized, logged or returned.
    Object.defineProperty(this, 'apiKey', { value: apiKey, enumerable: false });
  }
  url(route) { return this.endpoint.base + this.endpoint.prefix + route; }
  headers(json) { const h = { Accept: 'application/json' }; if (json) h['Content-Type'] = 'application/json'; if (this.apiKey) h['X-API-Key'] = this.apiKey; return h; }
  async request(route, { method = 'GET', body, raw = false, signal, limit = MAX_OUTPUT_BYTES } = {}) {
    const timer = AbortSignal.timeout(raw ? 120000 : this.timeout);
    let r;
    try { r = await this.fetch(this.url(route), { method, headers: this.headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timer]) : timer, redirect: this.apiKey ? 'manual' : 'follow' }); }
    catch (e) { if (signal?.aborted) throw Error('cancelled'); throw Error('comfy-unreachable'); }
    // Cloud /view answers 302 to a signed URL: follow it WITHOUT the API key.
    if (raw && r.status >= 300 && r.status < 400 && r.headers.get('location')) r = await this.fetch(new URL(r.headers.get('location'), this.url(route)), { signal: signal ? AbortSignal.any([signal, timer]) : timer });
    if (raw) {
      if (!r.ok) throw Error('comfy-output-missing');
      const length = Number(r.headers.get('content-length') || 0); need(!length || length <= limit, 'comfy-output-too-large');
      const bytes = Buffer.from(await r.arrayBuffer()); need(bytes.length <= limit, 'comfy-output-too-large');
      return bytes;
    }
    const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) { const e = Error(r.status === 400 && data?.node_errors ? 'workflow-invalid' : r.status === 401 || r.status === 403 ? 'comfy-forbidden' : 'comfy-http-' + r.status); e.details = data; throw e; }
    return data;
  }
  stats() { return this.request('/system_stats'); }
  objectInfo(cls) { return this.request('/object_info/' + encodeURIComponent(cls)); }
  models(folder) { return this.request((this.endpoint.cloud ? '/experiment/models/' : '/models/') + encodeURIComponent(folder)); }
  queue() { return this.request('/queue'); }
  history(id) { return this.request((this.endpoint.cloud ? '/history_v2/' : '/history/') + encodeURIComponent(id)); }
  view(ref, signal) {
    const q = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder || '', type: ref.type || 'output' });
    return this.request('/view?' + q, { raw: true, signal });
  }
  async submit(prompt, clientId) {
    try {
      const data = await this.request('/prompt', { method: 'POST', body: { prompt, client_id: clientId } });
      if (data?.node_errors && Object.keys(data.node_errors).length) { const e = Error('workflow-invalid'); e.details = data; throw e; }
      need(typeof data?.prompt_id === 'string', 'comfy-bad-response');
      return data.prompt_id;
    } catch (e) { if (e.message === 'workflow-invalid') e.summary = nodeErrorSummary(e.details); throw e; }
  }
  // Cancel only our own prompt: targeted interrupt when running, queue delete when pending.
  // Never clears the whole queue or unloads models another user may be using.
  async cancel(promptId) {
    const q = await this.queue().catch(() => null);
    const running = (q?.queue_running || []).some(item => item?.[1] === promptId);
    if (running || !q) await this.request('/interrupt', { method: 'POST', body: { prompt_id: promptId } }).catch(() => {});
    if (!running) await this.request('/queue', { method: 'POST', body: { delete: [promptId] } }).catch(() => {});
  }
  // Opens before submission so no event is missed; resolves null when WS is unavailable.
  socket(clientId) {
    if (!this.WebSocket) return Promise.resolve(null);
    const u = new URL(this.url('/ws')); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; u.searchParams.set('clientId', clientId);
    if (this.apiKey && this.endpoint.cloud) u.searchParams.set('token', this.apiKey);
    return new Promise(resolve => {
      let ws; try { ws = new this.WebSocket(u); } catch { return resolve(null); }
      const t = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 3000);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(ws); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); resolve(null); }, { once: true });
    });
  }
}
function nodeErrorSummary(details) {
  const out = [];
  for (const [node, v] of Object.entries(details?.node_errors || {})) for (const e of v?.errors || []) out.push(`${node} ${String(v.class_type || '').slice(0, 60)}: ${String(e.message || '').slice(0, 120)} ${String(e.extra_info?.input_name || e.details || '').slice(0, 60)}`.trim());
  if (!out.length && details?.error?.message) out.push(String(details.error.message).slice(0, 200));
  return out.slice(0, 8);
}

// Run one API-format graph to completion. Returns history outputs (refs, not bytes).
export async function execute(client, workflow, { signal, onProgress = () => {}, pollMs = 1000 } = {}) {
  const clientId = randomUUID();
  const ws = await client.socket(clientId);
  let promptId, settle, fail, finished = false, done = new Promise((res, rej) => { settle = res; fail = rej; });
  done.catch(() => {}); // awaited below; avoid an unhandled rejection if it fails before then
  const onAbort = () => fail(Error('cancelled'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const early = [];
  const handle = msg => {
    if (!msg || typeof msg !== 'object' || msg.data?.prompt_id !== promptId) { if (!promptId && msg?.data?.prompt_id) early.push(msg); return; }
    const { type, data } = msg;
    if (type === 'progress' && Number.isFinite(data.value) && data.max > 0) onProgress(Math.min(1, data.value / data.max), data.node);
    else if (type === 'execution_success' || (type === 'executing' && data.node === null)) settle();
    else if (type === 'execution_error') { const e = Error(/OutOfMemory|OOM/i.test(String(data.exception_type)) ? 'out-of-memory' : 'execution-error'); e.summary = [`${data.node_id || '?'} ${String(data.node_type || '').slice(0, 60)}: ${String(data.exception_type || '').slice(0, 80)}`]; fail(e); }
    else if (type === 'execution_interrupted') fail(Error('cancelled'));
  };
  ws?.addEventListener('message', ev => { if (typeof ev.data !== 'string') return; try { handle(JSON.parse(ev.data)); } catch {} });
  ws?.addEventListener('close', () => { poll(); });
  let polling = false;
  // History polling is the fallback for no WS and the recovery lane after a dropped socket.
  async function poll() {
    if (polling) return; polling = true;
    while (!signal?.aborted && !finished) {
      await new Promise(r => setTimeout(r, pollMs));
      if (!promptId || finished) continue;
      const h = await client.history(promptId).catch(() => null), entry = h?.[promptId];
      if (entry?.status?.status_str === 'error') { const e = Error('execution-error'); e.summary = ['history reported an execution error']; fail(e); }
      else if (entry?.status?.completed || (entry?.outputs && Object.keys(entry.outputs).length && entry.status?.status_str === 'success')) settle();
    }
  }
  try {
    promptId = await client.submit(workflow, clientId);
    early.splice(0).forEach(handle);
    if (!ws) poll();
    try { await done; }
    catch (e) { if (e.message === 'cancelled') await client.cancel(promptId); throw e; }
    const history = await client.history(promptId);
    return { promptId, outputs: history?.[promptId]?.outputs || {} };
  } finally {
    finished = true; signal?.removeEventListener('abort', onAbort); try { ws?.close(); } catch {}
  }
}
// Never trust server-supplied filenames for local paths: classify by extension only.
export function outputRefs(outputs) {
  const refs = [];
  for (const [node, out] of Object.entries(outputs || {})) for (const key of ['images', 'videos', 'video', 'gifs']) for (const ref of [].concat(out?.[key] || [])) {
    if (!ref || typeof ref.filename !== 'string' || ref.type === 'temp') continue;
    const ext = ref.filename.split('.').pop().toLowerCase(); if (!EXT[ext]) continue;
    refs.push({ node, ref: { filename: ref.filename, subfolder: typeof ref.subfolder === 'string' ? ref.subfolder : '', type: ref.type || 'output' }, ext, kind: EXT[ext] });
  }
  return refs.slice(0, MAX_OUTPUTS);
}

// ---------------------------------------------------------------- typed parameter introspection
const TEXT = { CLIPTextEncode: 'text', CLIPTextEncodeFlux: 't5xxl', CLIPTextEncodeSD3: 't5xxl', TextEncodeQwenImageEdit: 'prompt' };
const GUIDE = { KSampler: ['positive', 'negative'], KSamplerAdvanced: ['positive', 'negative'], CFGGuider: ['positive', 'negative'], DualCFGGuider: ['cond1', 'negative'], BasicGuider: ['conditioning', null] };
const PASS = { ReferenceLatent: 'conditioning', FluxGuidance: 'conditioning', ConditioningZeroOut: 'conditioning', WanImageToVideo: 'positive', Reroute: '' };
const SIMPLE = [
  ['seed', ['KSampler', 'seed'], ['KSamplerAdvanced', 'noise_seed'], ['RandomNoise', 'noise_seed'], ['SamplerCustom', 'noise_seed']],
  ['steps', ['KSampler', 'steps'], ['KSamplerAdvanced', 'steps'], ['BasicScheduler', 'steps'], ['Flux2Scheduler', 'steps']],
  ['cfg', ['KSampler', 'cfg'], ['KSamplerAdvanced', 'cfg'], ['CFGGuider', 'cfg']],
  ['denoise', ['KSampler', 'denoise'], ['BasicScheduler', 'denoise']],
  ['sampler', ['KSampler', 'sampler_name'], ['KSamplerSelect', 'sampler_name']],
  ['scheduler', ['KSampler', 'scheduler'], ['BasicScheduler', 'scheduler']],
  ['guidance', ['FluxGuidance', 'guidance']],
  ['width', ...['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage', 'EmptyHunyuanLatentVideo', 'EmptyLTXVLatentVideo', 'Wan22ImageToVideoLatent', 'WanImageToVideo', 'Flux2Scheduler', 'ModelSamplingFlux'].map(c => [c, 'width'])],
  ['height', ...['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage', 'EmptyHunyuanLatentVideo', 'EmptyLTXVLatentVideo', 'Wan22ImageToVideoLatent', 'WanImageToVideo', 'Flux2Scheduler', 'ModelSamplingFlux'].map(c => [c, 'height'])],
  ['length', ['EmptyHunyuanLatentVideo', 'length'], ['EmptyLTXVLatentVideo', 'length'], ['Wan22ImageToVideoLatent', 'length'], ['WanImageToVideo', 'length']],
  ['batch', ['EmptyLatentImage', 'batch_size'], ['EmptySD3LatentImage', 'batch_size'], ['EmptyFlux2LatentImage', 'batch_size']],
  ['fps', ['CreateVideo', 'fps']],
];
const DEFAULT_RANGE = { seed: [0, 4294967295], steps: [1, 150], cfg: [0, 30], denoise: [0, 1], guidance: [0, 30], width: [64, 2048], height: [64, 2048], length: [1, 241], batch: [1, 4], fps: [1, 60] };
const LOADERS = { CheckpointLoaderSimple: [['ckpt_name', 'checkpoints']], UNETLoader: [['unet_name', 'diffusion_models']], CLIPLoader: [['clip_name', 'text_encoders']], DualCLIPLoader: [['clip_name1', 'text_encoders'], ['clip_name2', 'text_encoders']], VAELoader: [['vae_name', 'vae']], LoraLoader: [['lora_name', 'loras']], LoraLoaderModelOnly: [['lora_name', 'loras']], ControlNetLoader: [['control_net_name', 'controlnet']], UpscaleModelLoader: [['model_name', 'upscale_models']] };

export function isApiFormat(w) {
  return w && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).length > 0 && !('nodes' in w && 'links' in w) &&
    Object.entries(w).every(([k, n]) => /^[\w.:-]{1,64}$/.test(k) && n && typeof n.class_type === 'string' && n.inputs && typeof n.inputs === 'object');
}
// Follow a conditioning link upstream through pass-through nodes to a text encoder.
function traceText(w, link, seen = new Set()) {
  if (!isLink(link) || seen.has(link[0])) return null; seen.add(link[0]);
  const n = w[link[0]]; if (!n) return null;
  if (TEXT[n.class_type] && typeof n.inputs[TEXT[n.class_type]] === 'string') return [link[0], TEXT[n.class_type]];
  if (n.class_type in PASS) return traceText(w, PASS[n.class_type] ? n.inputs[PASS[n.class_type]] : Object.values(n.inputs).find(isLink), seen);
  return null;
}
export function extractSchema(workflow, overrides = {}) {
  need(isApiFormat(workflow), 'not-api-format');
  const params = {}, add = (name, node, input, extra = {}) => {
    const value = workflow[node].inputs[input]; if (value === undefined || isLink(value)) return;
    const p = params[name] ||= { name, targets: [], default: value, type: typeof value === 'string' ? 'string' : Number.isInteger(value) && !['cfg', 'denoise', 'guidance', 'fps'].includes(name) ? 'integer' : 'number', ...extra };
    if (!p.targets.some(([n, i]) => n === node && i === input)) p.targets.push([node, input]);
  };
  for (const [id, n] of Object.entries(workflow)) {
    const [pos, neg] = GUIDE[n.class_type] || [];
    if (pos) { const t = traceText(workflow, n.inputs[pos]); if (t) add('prompt', ...t, { maxLength: 4000 }); }
    if (neg) { const t = traceText(workflow, n.inputs[neg]); if (t && !params.prompt?.targets.some(([a]) => a === t[0])) add('negative', ...t, { maxLength: 4000 }); }
    for (const [name, ...pairs] of SIMPLE) for (const [cls, input] of pairs) if (n.class_type === cls) add(name, id, input);
  }
  // A literal text that a sampler never reaches is not a prompt; keep the graph honest.
  for (const p of Object.values(params)) {
    if (overrides[p.name] === false) { delete params[p.name]; continue; }
    const range = DEFAULT_RANGE[p.name]; if (range && p.type !== 'string') [p.minimum, p.maximum] = range;
    if (['width', 'height'].includes(p.name)) p.multipleOf = 16;
    Object.assign(p, overrides[p.name] || {});
    p.label ||= p.name === 'prompt' ? 'Prompt' : p.name === 'negative' ? 'Negative prompt' : p.name[0].toUpperCase() + p.name.slice(1);
  }
  const models = [];
  for (const n of Object.values(workflow)) for (const [input, folder] of LOADERS[n.class_type] || []) if (typeof n.inputs[input] === 'string') models.push({ folder, name: n.inputs[input] });
  const classes = [...new Set(Object.values(workflow).map(n => n.class_type))].sort();
  return { params, models, classes };
}
// Live /object_info refinement: combo options become enums, numeric widgets bring their own range.
export function refineSchema(schema, objectInfo) {
  for (const p of Object.values(schema.params)) for (const [node, input] of p.targets.slice(0, 1)) {
    const cls = schema.nodeClasses?.[node]; const info = objectInfo?.[cls]?.input; const spec = info?.required?.[input] || info?.optional?.[input];
    if (!spec) continue;
    // Legacy combos are [[options]]; V3 nodes report ['COMBO', { options }].
    const options = Array.isArray(spec[0]) ? spec[0] : spec[0] === 'COMBO' && Array.isArray(spec[1]?.options) ? spec[1].options : null;
    if (options) p.enum = options.filter(v => typeof v === 'string').slice(0, 200);
    else if (spec[1] && typeof spec[1] === 'object') { if (Number.isFinite(spec[1].min)) p.minimum = Math.max(p.minimum ?? -Infinity, spec[1].min); if (Number.isFinite(spec[1].max)) p.maximum = Math.min(p.maximum ?? Infinity, spec[1].max); }
  }
  return schema;
}
export function applyParams(template, values = {}) {
  need(values && typeof values === 'object' && !Array.isArray(values), 'invalid-params');
  const w = structuredClone(template.workflow), resolved = {};
  for (const [name, value] of Object.entries(values)) {
    need(!['__proto__', 'constructor', 'prototype'].includes(name) && Object.hasOwn(template.schema.params, name), 'unknown-param:' + String(name).slice(0, 40));
    validateParam(template.schema.params[name], value);
  }
  for (const [name, p] of Object.entries(template.schema.params)) {
    const value = Object.hasOwn(values, name) ? values[name] : p.default; resolved[name] = value;
    for (const [node, input] of p.targets) { need(!isLink(w[node].inputs[input]), 'link-overwrite'); w[node].inputs[input] = value; }
  }
  return { workflow: w, params: resolved };
}
export function validateParam(p, v) {
  const bad = () => { throw Error('invalid-param:' + p.name); };
  if (p.type === 'string') { if (typeof v !== 'string' || v.length > (p.maxLength || 4000) || (p.name === 'prompt' && !v.trim())) bad(); if (p.enum && !p.enum.includes(v)) bad(); return; }
  if (typeof v !== 'number' || !Number.isFinite(v) || (p.type === 'integer' && !Number.isSafeInteger(v))) bad();
  if ((p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum) || (p.multipleOf && v % p.multipleOf)) bad();
}

// ---------------------------------------------------------------- template registry
export async function loadTemplates(dirs = [TEMPLATE_DIR]) {
  const templates = new Map();
  for (const dir of dirs) for (const name of (await fs.readdir(dir).catch(() => [])).sort()) {
    if (!name.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(dir, name)); const t = JSON.parse(raw);
    need(t.schema === 'fframestudio.comfy-template/1' && /^[a-z0-9-]{1,64}$/.test(t.id) && !templates.has(t.id) && ['image', 'video'].includes(t.kind) && t.title && t.licence?.name, 'invalid-template:' + name);
    const schema = extractSchema(t.workflow, t.params || {});
    schema.nodeClasses = Object.fromEntries(Object.entries(t.workflow).map(([id, n]) => [id, n.class_type]));
    need(schema.params.prompt, 'template-without-prompt:' + t.id);
    templates.set(t.id, Object.freeze({ ...t, schema, workflowSha256: sha256(JSON.stringify(t.workflow)), file: name }));
  }
  return templates;
}
export function publicTemplate(t, status = {}) {
  const params = Object.values(t.schema.params).map(({ targets, ...p }) => ({ ...p, voice: p.voice || [p.name] }));
  return { id: t.id, title: t.title, kind: t.kind, description: t.description || '', model: t.model || null, licence: t.licence, vram: t.vram || null,
    workflowSha256: t.workflowSha256, models: t.schema.models, classes: t.schema.classes, params, ...status };
}
// Ask the server, not the template, whether nodes and weights exist.
export async function checkDependencies(client, t) {
  const missingNodes = [], missingModels = [], info = {};
  for (const cls of t.schema.classes) { const r = await client.objectInfo(cls).catch(e => e); if (r instanceof Error) { if (r.message === 'comfy-unreachable') throw r; missingNodes.push(cls); } else if (!r?.[cls]) missingNodes.push(cls); else Object.assign(info, r); }
  const lists = {};
  for (const m of t.schema.models) {
    const folders = m.folder === 'diffusion_models' ? ['diffusion_models', 'unet'] : [m.folder];
    let found = false;
    for (const f of folders) { lists[f] ||= await client.models(f).catch(() => []); found ||= (lists[f] || []).some(x => (typeof x === 'string' ? x : x?.name) === m.name); }
    if (!found) missingModels.push(m);
  }
  return { ready: !missingNodes.length && !missingModels.length, missingNodes, missingModels, objectInfo: info };
}
export function vramOf(stats) {
  const d = (stats?.devices || []).find(d => d.type === 'cuda') || stats?.devices?.[0];
  return d ? { name: String(d.name || '').slice(0, 80), freeMiB: Math.round((d.vram_free || 0) / 1048576), totalMiB: Math.round((d.vram_total || 0) / 1048576) } : null;
}

// ---------------------------------------------------------------- job runner (ComfyUI pane)
async function atomicJSON(file, value) {
  const temp = file + '.' + randomUUID();
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  try { await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => {}); }
}
const identifier = s => typeof s === 'string' && /^[a-zA-Z0-9][\w-]{0,100}$/.test(s);
export class ComfyRunner {
  constructor({ root, client, templates, publish = () => {} }) {
    this.root = root; this.client = client; this.templates = templates; this.publish = publish;
    this.jobs = new Map(); this.closed = false; this.active = null; this.cache = new Map();
    this.ready = this.recover();
  }
  async recover() {
    this.root = await fs.realpath(this.root);
    this.stateDir = path.dirname(await safePath(this.root, '.generation/comfy/.marker', { create: true }));
    for (const name of await fs.readdir(this.stateDir)) {
      if (!/^[\w-]+\.json$/.test(name)) continue;
      const j = JSON.parse(await fs.readFile(path.join(this.stateDir, name), 'utf8'));
      need(identifier(j.id) && name === j.id + '.json', 'invalid-journal');
      if (!terminal.has(j.state)) { j.state = 'failed'; j.error = 'interrupted'; j.updatedAt = new Date().toISOString(); await atomicJSON(path.join(this.stateDir, name), j); }
      this.jobs.set(j.id, j);
    }
  }
  async status() {
    const stats = await this.client.stats().catch(() => null);
    const q = stats ? await this.client.queue().catch(() => null) : null;
    return { configured: true, reachable: !!stats, endpoint: this.client.endpoint.label, cloud: this.client.endpoint.cloud,
      comfyuiVersion: stats?.system?.comfyui_version || null, vram: vramOf(stats),
      queue: q ? { running: q.queue_running?.length || 0, pending: q.queue_pending?.length || 0 } : null };
  }
  async templateList() {
    const reachable = !!(await this.client.stats().catch(() => null));
    return Promise.all([...this.templates.values()].map(async t => {
      if (!reachable) return publicTemplate(t, { ready: false, reason: 'ComfyUI is not reachable.' });
      const hit = this.cache.get(t.id);
      const deps = hit && Date.now() - hit.at < 30000 ? hit.deps : await checkDependencies(this.client, t).catch(() => null);
      if (deps) this.cache.set(t.id, { at: Date.now(), deps });
      if (deps) refineSchema(t.schema, deps.objectInfo);
      return publicTemplate(t, { ready: !!deps?.ready, missingNodes: deps?.missingNodes || [], missingModels: deps?.missingModels || [], reason: !deps ? 'Dependency check failed.' : deps.ready ? null : 'Missing ' + [...deps.missingNodes, ...deps.missingModels.map(m => m.folder + '/' + m.name)].join(', ') });
    }));
  }
  list(projectId) { return structuredClone([...this.jobs.values()].filter(j => !projectId || j.projectId === projectId)); }
  async persist(j) {
    j.sequence = (j.sequence || 0) + 1; j.updatedAt = new Date().toISOString();
    await atomicJSON(path.join(this.stateDir, j.id + '.json'), j);
    this.jobs.set(j.id, structuredClone(j)); this.publish({ ev: 'comfy', job: structuredClone(j) });
  }
  async submit(input) {
    await this.ready; need(!this.closed, 'queue-closed');
    const allowed = ['projectId', 'templateId', 'params', 'count'];
    need(input && typeof input === 'object' && Object.keys(input).every(k => allowed.includes(k)), 'invalid-request');
    need(identifier(input.projectId), 'invalid-request');
    const t = this.templates.get(input.templateId); need(t, 'unknown-template');
    const st = await fs.stat(await safePath(this.root, `projects/${input.projectId}/project.json`)).catch(() => null); need(st?.isFile(), 'unknown-project');
    const count = input.count ?? 1; need(Number.isInteger(count) && count >= 1 && count <= 4, 'invalid-count');
    need(count === 1 || t.schema.params.seed, 'no-seed-param');
    need([...this.jobs.values()].filter(j => !terminal.has(j.state)).length + count <= 16, 'queue-full');
    const base = applyParams(t, input.params || {}).params, jobs = [];
    for (let i = 0; i < count; i++) {
      const params = { ...base }; if (i && params.seed !== undefined) params.seed = (params.seed + i) % 4294967296;
      const now = new Date().toISOString();
      const j = { schema: 'fframestudio.comfy-job/1', id: randomUUID(), projectId: input.projectId, templateId: t.id, templateTitle: t.title, kind: t.kind,
        workflowSha256: t.workflowSha256, params, state: 'queued', progress: 0, promptId: null, error: null, errorDetail: [], outputs: [], startedAt: null, finishedAt: null, licence: t.licence, endpoint: this.client.endpoint.label, createdAt: now, updatedAt: now };
      await this.persist(j); jobs.push(structuredClone(j));
    }
    this.kick(); return jobs;
  }
  kick() { if (!this.pumping && !this.closed) this.pumping = this.pump().finally(() => { this.pumping = null; if (!this.closed && [...this.jobs.values()].some(j => j.state === 'queued')) this.kick(); }); }
  async pump() {
    for (;;) {
      if (this.closed) return;
      const next = [...this.jobs.values()].find(j => j.state === 'queued'); if (!next) return;
      const j = structuredClone(next), t = this.templates.get(j.templateId), controller = new AbortController();
      let finish; this.active = { id: j.id, controller, done: new Promise(r => { finish = r; }) };
      // Device-wide VRAM as ComfyUI reports it (includes other GPU users), sampled once a second.
      const vram = { minFree: Infinity, total: 0 }, sampler = setInterval(async () => { const v = vramOf(await this.client.stats().catch(() => null)); if (v) { vram.minFree = Math.min(vram.minFree, v.freeMiB); vram.total = v.totalMiB; } }, 1000);
      try {
        need(t, 'unknown-template');
        j.state = 'running'; j.startedAt = new Date().toISOString(); await this.persist(j);
        const { workflow } = applyParams(t, j.params);
        // We own the output prefix; template prefixes and server filenames never choose local paths.
        for (const n of Object.values(workflow)) if (typeof n.inputs.filename_prefix === 'string') n.inputs.filename_prefix = 'fframestudio/' + j.id;
        let chain = Promise.resolve(), last = 0;
        const progress = n => { const p = Math.min(0.95, n * 0.95); if (p <= last + 0.01) return; last = p; chain = chain.then(async () => { if (j.state === 'running' && !controller.signal.aborted) { j.progress = last; await this.persist(j); } }); };
        const result = await execute(this.client, workflow, { signal: controller.signal, onProgress: progress }).finally(() => chain);
        j.promptId = result.promptId;
        const refs = outputRefs(result.outputs); need(refs.length, 'no-outputs');
        const rel = `projects/${j.projectId}/media/generated/comfy/${j.id}`;
        for (const [i, r] of refs.entries()) {
          const bytes = await this.client.view(r.ref, controller.signal);
          const file = await safePath(this.root, `${rel}/output-${i + 1}.${r.ext}`, { create: true });
          await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
          j.outputs.push({ file: `media/generated/comfy/${j.id}/output-${i + 1}.${r.ext}`, kind: r.kind, bytes: bytes.length, sha256: sha256(bytes) });
        }
        const sidecar = { schema: 'fframestudio.generation/1', provider: 'comfyui', jobId: j.id, templateId: j.templateId, workflowSha256: j.workflowSha256, promptId: j.promptId,
          params: j.params, endpoint: j.endpoint, licence: j.licence, outputs: j.outputs, generatedAt: new Date().toISOString(), machineGenerated: true };
        await atomicJSON(await safePath(this.root, `${rel}/result.json`), sidecar);
        if (controller.signal.aborted) throw Error('cancelled');
        j.state = 'done'; j.progress = 1;
      } catch (e) {
        j.state = controller.signal.aborted || e.message === 'cancelled' ? 'cancelled' : 'failed';
        j.error = j.state === 'cancelled' ? null : ['workflow-invalid', 'execution-error', 'out-of-memory', 'comfy-unreachable', 'comfy-forbidden', 'no-outputs', 'comfy-output-too-large', 'unsafe-path', 'unknown-template'].includes(e.message) ? e.message : 'generation-failed';
        j.errorDetail = (e.summary || []).map(s => String(s).slice(0, 240));
      }
      clearInterval(sampler);
      j.vram = Number.isFinite(vram.minFree) ? { peakUsedMiB: vram.total - vram.minFree, totalMiB: vram.total, sampledEveryMs: 1000, scope: 'device-wide via /system_stats' } : null;
      j.finishedAt = new Date().toISOString(); await this.persist(j); this.active = null; finish();
    }
  }
  async cancel(id) {
    await this.ready; const j = this.jobs.get(id); need(j, 'unknown-job');
    if (terminal.has(j.state)) return structuredClone(j);
    if (this.active?.id === id) { const a = this.active; a.controller.abort(); await a.done; }
    else { const c = structuredClone(j); c.state = 'cancelled'; await this.persist(c); }
    return structuredClone(this.jobs.get(id));
  }
  async cancelAll(projectId) { const ids = [...this.jobs.values()].filter(j => j.projectId === projectId && !terminal.has(j.state)).map(j => j.id); for (const id of ids.reverse()) await this.cancel(id); return ids.length; }
  async close() { this.closed = true; this.active?.controller.abort(); await this.pumping; }
}

// ---------------------------------------------------------------- generation-provider adapter
// Video templates become ordinary providers for GenerationQueue (same journal, SSE, provenance,
// insert-into-timeline). ComfyUI's default yuv444p H.264 is normalised to the queue's contract.
// Without a client the providers are dormant and hidden: they only keep older journals that
// reference them loadable after the bridge restarts without --comfy-url.
export function comfyGenerationProviders({ client = null, templates }) {
  return [...templates.values()].filter(t => t.kind === 'video' && t.provider).map(t => ({
    capability: { schema: 'fframestudio.generation-provider/1', id: 'comfy-' + t.id, name: 'ComfyUI · ' + t.title, model: t.model || t.id, version: t.version || t.workflowSha256.slice(0, 12), weightRevision: null,
      modes: ['t2v'], maxDuration: t.provider.maxDuration, resolutions: t.provider.resolutions, fps: t.provider.fps, ...(client ? {} : { hidden: true }),
      inference: { templateId: t.id, workflowSha256: t.workflowSha256, endpoint: client?.endpoint.label || 'not-configured' }, vram: t.vram || { minimumFreeMiB: 0, measuredPeakMiB: null },
      cost: client?.endpoint.cloud ? { kind: 'unknown', amount: null, currency: 'USD', note: 'Comfy Cloud consumes subscription credits.' } : { kind: 'local', amount: 0, currency: 'USD', note: 'Local ComfyUI; hardware and model licence conditions apply.' },
      licence: t.licence },
    async probe() {
      if (!client) return { available: false, reason: 'ComfyUI is not configured on this bridge (start it with --comfy-url).' };
      const stats = await client.stats().catch(() => null);
      if (!stats) return { available: false, reason: 'ComfyUI is not reachable at ' + client.endpoint.label + '.', qualification: 'experimental-unmeasured' };
      const deps = await checkDependencies(client, t).catch(() => null), gpu = vramOf(stats);
      const vramOk = client.endpoint.cloud || !t.vram?.minimumFreeMiB || (gpu && gpu.freeMiB >= t.vram.minimumFreeMiB);
      const available = !!deps?.ready && vramOk;
      return { available, gpu, qualification: 'experimental-unmeasured', reason: available ? null : !deps ? 'ComfyUI dependency check failed.' : !deps.ready ? 'ComfyUI is missing ' + [...deps.missingNodes, ...deps.missingModels.map(m => m.name)].join(', ') + '. Nothing is downloaded automatically.' : `Wait for ${t.vram.minimumFreeMiB} MiB free VRAM.` };
    },
    async generate(settings, context) {
      need(client, 'unavailable');
      const frames = n => Math.max(1, Math.round((n - 1) / 4) * 4 + 1);
      const values = { prompt: settings.prompt, seed: settings.seed, width: settings.width, height: settings.height, length: frames(settings.duration * settings.fps + 1), fps: settings.fps };
      for (const k of Object.keys(values)) if (!t.schema.params[k]) delete values[k];
      const { workflow } = applyParams(t, values);
      for (const n of Object.values(workflow)) if (typeof n.inputs.filename_prefix === 'string') n.inputs.filename_prefix = 'fframestudio/' + path.basename(path.dirname(context.output));
      const result = await execute(client, workflow, { signal: context.signal, onProgress: p => context.progress(p * 0.9) });
      const video = outputRefs(result.outputs).find(r => r.kind === 'video'); need(video, 'no-outputs');
      const bytes = await client.view(video.ref, context.signal);
      const temp = path.join(await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-comfy-')), 'raw.' + video.ext);
      try {
        await fs.writeFile(temp, bytes);
        await runProcess('ffmpeg', ['-v', 'error', '-nostdin', '-i', temp, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(settings.fps), '-vf', `scale=${settings.width}:${settings.height}`, '-movflags', '+faststart', '-n', context.output], { signal: context.signal, timeout: 120000 });
      } finally { await fs.rm(path.dirname(temp), { recursive: true, force: true }); }
    },
  }));
}
