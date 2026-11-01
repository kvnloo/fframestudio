// Mock ComfyUI server for tests: the REST + WebSocket surface fframestudio uses, with
// deterministic images and real ffmpeg videos. Never a substitute for a real-model run.
import http from 'node:http';
import zlib from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MiB = 1048576;
const COMBOS = { sampler_name: ['euler', 'uni_pc', 'dpmpp_2m'], scheduler: ['normal', 'simple', 'karras'] };
export const MOCK_CLASSES = ['UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'CFGGuider', 'EmptyFlux2LatentImage', 'Flux2Scheduler', 'KSamplerSelect', 'RandomNoise',
  'SamplerCustomAdvanced', 'VAEDecode', 'SaveImage', 'CheckpointLoaderSimple', 'EmptyLatentImage', 'KSampler', 'ModelSamplingSD3', 'Wan22ImageToVideoLatent', 'CreateVideo', 'SaveVideo', 'LoadImage'];
export const MOCK_MODELS = { diffusion_models: ['flux-2-klein-base-4b-fp8.safetensors', 'wan2.2_ti2v_5B_fp16.safetensors'], unet: [], text_encoders: ['qwen_3_4b.safetensors', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
  vae: ['flux2-vae.safetensors', 'wan2.2_vae.safetensors'], checkpoints: ['sd_xl_base_1.0.safetensors'], loras: [] };

function png(width, height, seed, text) {
  const h = createHash('sha256').update(String(seed) + text).digest();
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3, t = x / width, u = y / height, ring = Math.sin((x * h[3] + y * h[4]) / 900) > 0.6 ? 40 : 0;
      raw[o] = Math.min(255, h[0] * (1 - t) + h[5] * t + ring); raw[o + 1] = Math.min(255, h[1] * (1 - u) + h[6] * u + ring); raw[o + 2] = Math.min(255, h[2] * (1 - t * u) + h[7] * t * u + ring);
    }
  }
  const chunk = (type, data) => { const b = Buffer.alloc(8 + data.length + 4); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function video(width, height, frames, fps) {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'mock-comfy-')), out = path.join(dir, 'v.mp4');
  try {
    // ComfyUI's SaveVideo commonly emits yuv444p; the adapter must normalise it.
    await new Promise((resolve, reject) => spawn('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=${fps}`, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p', out], { stdio: 'ignore' })
      .on('close', c => c === 0 ? resolve() : reject(Error('ffmpeg ' + c))).on('error', reject));
    return await fs.readFile(out);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function wsAccept(key) { return createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'); }
function frame(text) {
  const data = Buffer.from(text), len = data.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, data]);
}

export async function startMockComfy({ stepMs = 25, vramFreeMiB = 11000, models = MOCK_MODELS, classes = MOCK_CLASSES, websocket = true, evilFilenames = false } = {}) {
  const state = { requests: [], prompts: [], interrupts: [], deletes: [], clears: 0, history: {}, files: new Map(), sockets: new Map(), queue: [], running: null };
  const send = (clientId, type, data) => { for (const s of state.sockets.get(clientId) || []) if (!s.destroyed) s.write(frame(JSON.stringify({ type, data }))); };
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function run(item) {
    const { id, prompt, clientId } = item; state.running = item;
    const texts = Object.values(prompt).filter(n => n.class_type === 'CLIPTextEncode').map(n => n.inputs.text).join(' ');
    const sampler = Object.values(prompt).find(n => ['KSampler', 'Flux2Scheduler'].includes(n.class_type));
    const steps = Math.min(10, sampler?.inputs.steps || 10), slow = texts.includes('[mock:slow]') ? 250 : stepMs;
    send(clientId, 'execution_start', { prompt_id: id, timestamp: Date.now() });
    const outputs = {};
    try {
      for (const [nodeId, node] of Object.entries(prompt)) {
        if (item.interrupted) throw Object.assign(Error(), { interrupted: true });
        send(clientId, 'executing', { node: nodeId, display_node: nodeId, prompt_id: id });
        if (['KSampler', 'SamplerCustomAdvanced'].includes(node.class_type)) for (let i = 1; i <= steps; i++) {
          if (item.interrupted) throw Object.assign(Error(), { interrupted: true });
          if (texts.includes('[mock:oom]') && i === 2) throw Object.assign(Error('CUDA out of memory'), { type: 'torch.OutOfMemoryError', node: nodeId, cls: node.class_type });
          await sleep(slow); send(clientId, 'progress', { value: i, max: steps, prompt_id: id, node: nodeId });
        }
        if (node.class_type === 'SaveImage') {
          const latent = Object.values(prompt).find(n => /^Empty.*Latent/.test(n.class_type));
          const w = latent?.inputs.width || 1024, h = latent?.inputs.height || 1024, scale = 256 / Math.max(w, h);
          const name = evilFilenames ? '../../escape_00001_.png' : `${String(node.inputs.filename_prefix).split('/').pop()}_${String(state.files.size + 1).padStart(5, '0')}_.png`;
          const seed = Object.values(prompt).map(n => n.inputs.noise_seed ?? n.inputs.seed).find(v => v !== undefined);
          state.files.set('fframestudio/' + name, png(Math.round(w * scale), Math.round(h * scale), seed, texts));
          outputs[nodeId] = { images: [{ filename: name, subfolder: 'fframestudio', type: 'output' }] };
        }
        if (node.class_type === 'SaveVideo') {
          const lat = Object.values(prompt).find(n => n.class_type === 'Wan22ImageToVideoLatent'), cv = Object.values(prompt).find(n => n.class_type === 'CreateVideo');
          const name = `${String(node.inputs.filename_prefix).split('/').pop()}_00001_.mp4`;
          state.files.set('fframestudio/' + name, await video(lat.inputs.width, lat.inputs.height, lat.inputs.length, cv.inputs.fps));
          outputs[nodeId] = { images: [{ filename: name, subfolder: 'fframestudio', type: 'output' }], animated: [true] };
        }
        if (outputs[nodeId]) send(clientId, 'executed', { node: nodeId, display_node: nodeId, output: outputs[nodeId], prompt_id: id });
      }
      state.history[id] = { prompt: [0, id, prompt, {}, Object.keys(outputs)], outputs, status: { status_str: 'success', completed: true, messages: [['execution_success', { prompt_id: id }]] } };
      send(clientId, 'executing', { node: null, prompt_id: id }); send(clientId, 'execution_success', { prompt_id: id, timestamp: Date.now() });
    } catch (e) {
      if (e.interrupted) { state.history[id] = { prompt: [0, id, prompt], outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_interrupted', { prompt_id: id }]] } }; send(clientId, 'execution_interrupted', { prompt_id: id }); }
      else { state.history[id] = { prompt: [0, id, prompt], outputs: {}, status: { status_str: 'error', completed: false, messages: [] } }; send(clientId, 'execution_error', { prompt_id: id, node_id: e.node, node_type: e.cls, exception_type: e.type, exception_message: e.message, traceback: ['secret-path/should-not-leak.py'] }); }
    } finally { state.running = null; }
  }
  let pumping = false;
  async function pump() { if (pumping) return; pumping = true; try { while (state.queue.length) await run(state.queue.shift()); } finally { pumping = false; } }
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); state.requests.push({ method: req.method, path: u.pathname });
    let body = ''; for await (const c of req) body += c;
    const input = body ? (() => { try { return JSON.parse(body); } catch { return null; } })() : {};
    if (req.method === 'GET' && u.pathname === '/system_stats') return json(res, 200, { system: { os: 'linux', comfyui_version: '0.30.0-mock', python_version: '3.13', argv: ['main.py', '--lowvram'] }, devices: [{ name: 'cuda:0 Mock RTX 3080 Ti', type: 'cuda', index: 0, vram_total: 12288 * MiB, vram_free: vramFreeMiB * MiB }] });
    if (req.method === 'GET' && u.pathname.startsWith('/object_info/')) {
      const cls = decodeURIComponent(u.pathname.slice(13)); if (!classes.includes(cls)) return json(res, 200, {});
      const required = {}; for (const k of ['sampler_name', 'scheduler']) if ((cls === 'KSampler' || (cls === 'KSamplerSelect' && k === 'sampler_name'))) required[k] = [COMBOS[k]];
      if (cls === 'KSampler') required.steps = ['INT', { default: 20, min: 1, max: 10000 }];
      return json(res, 200, { [cls]: { name: cls, input: { required }, output: [], output_node: ['SaveImage', 'SaveVideo'].includes(cls) } });
    }
    if (req.method === 'GET' && u.pathname.startsWith('/models/')) return json(res, 200, models[decodeURIComponent(u.pathname.slice(8))] || []);
    if (req.method === 'POST' && u.pathname === '/prompt') {
      const prompt = input?.prompt;
      if (!prompt || typeof prompt !== 'object') return json(res, 400, { error: { type: 'invalid_prompt', message: 'Invalid prompt' }, node_errors: {} });
      const node_errors = {};
      for (const [id, n] of Object.entries(prompt)) if (!classes.includes(n.class_type)) node_errors[id] = { class_type: n.class_type, errors: [{ type: 'invalid_prompt', message: 'Cannot execute because node ' + n.class_type + ' does not exist.', details: 'Node ID #' + id }] };
      if (Object.keys(node_errors).length) return json(res, 400, { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' }, node_errors });
      const id = randomUUID(); state.prompts.push({ id, prompt, clientId: input.client_id });
      state.queue.push({ id, prompt, clientId: input.client_id, number: state.prompts.length }); pump();
      return json(res, 200, { prompt_id: id, number: state.prompts.length, node_errors: {} });
    }
    if (req.method === 'GET' && u.pathname === '/queue') return json(res, 200, { queue_running: state.running ? [[state.running.number, state.running.id, {}, {}, []]] : [], queue_pending: state.queue.map(q => [q.number, q.id, {}, {}, []]) });
    if (req.method === 'POST' && u.pathname === '/queue') {
      if (input?.clear) state.clears++;
      for (const id of input?.delete || []) { state.deletes.push(id); state.queue = state.queue.filter(q => q.id !== id); }
      return json(res, 200, {});
    }
    if (req.method === 'POST' && u.pathname === '/interrupt') { state.interrupts.push(input?.prompt_id || null); if (state.running && (!input?.prompt_id || input.prompt_id === state.running.id)) state.running.interrupted = true; return json(res, 200, {}); }
    if (req.method === 'GET' && u.pathname.startsWith('/history/')) { const id = decodeURIComponent(u.pathname.slice(9)); return json(res, 200, state.history[id] ? { [id]: state.history[id] } : {}); }
    if (req.method === 'GET' && u.pathname === '/view') {
      const key = (u.searchParams.get('subfolder') ? u.searchParams.get('subfolder') + '/' : '') + u.searchParams.get('filename'), bytes = state.files.get(key);
      if (!bytes) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': key.endsWith('.mp4') ? 'video/mp4' : 'image/png', 'Content-Length': bytes.length }); return res.end(bytes);
    }
    json(res, 404, { error: 'not found' });
  });
  server.on('upgrade', (req, socket) => {
    const u = new URL(req.url, 'http://x');
    if (!websocket || u.pathname !== '/ws') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(req.headers['sec-websocket-key'])}\r\n\r\n`);
    const id = u.searchParams.get('clientId') || randomUUID();
    if (!state.sockets.has(id)) state.sockets.set(id, new Set());
    state.sockets.get(id).add(socket);
    socket.write(frame(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: state.queue.length } }, sid: id } })));
    socket.on('data', d => { if ((d[0] & 0x0f) === 8) { socket.end(Buffer.from([0x88, 0])); } });
    socket.on('close', () => state.sockets.get(id)?.delete(socket)); socket.on('error', () => {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, state, close: () => new Promise(r => { for (const set of state.sockets.values()) for (const s of set) s.destroy(); server.closeAllConnections?.(); server.close(r); }) };
}

// CLI: node test/helpers/mock-comfyui.mjs  → prints the URL, runs until killed (manual pane demos).
if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockComfy({ stepMs: Number(process.env.MOCK_STEP_MS || 120) });
  console.log(`mock ComfyUI listening: ${mock.url}`);
  process.on('SIGTERM', () => mock.close().then(() => process.exit(0)));
}
