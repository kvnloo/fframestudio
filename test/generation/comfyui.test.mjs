import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMockComfy, MOCK_MODELS, MOCK_CLASSES } from '../helpers/mock-comfyui.mjs';
import { ComfyClient, ComfyRunner, comfyEndpoint, loadTemplates, applyParams, extractSchema, comfyGenerationProviders, execute } from '../../bridge/generation/comfyui.mjs';
import { GenerationQueue } from '../../bridge/generation/queue.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const templates = await loadTemplates();
async function fixture() {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-comfy-'));
  await fs.mkdir(path.join(root, 'projects/p'), { recursive: true });
  await fs.writeFile(path.join(root, 'projects/p/project.json'), '{}');
  return root;
}
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw Error('timed out'); await sleep(20); } };

test('template introspection finds typed params, traces prompt vs negative and binds coupled dimensions', () => {
  const flux = templates.get('flux2-klein-4b-t2i').schema.params;
  assert.deepEqual(flux.prompt.targets, [['4', 'text']]);
  assert.deepEqual(flux.negative.targets, [['5', 'text']]);
  assert.deepEqual(flux.seed.targets, [['10', 'noise_seed']]);
  assert.deepEqual(flux.width.targets.sort(), [['7', 'width'], ['8', 'width']], 'latent and Flux2Scheduler width must move together');
  assert.equal(flux.batch, undefined, 'template override hides batch');
  assert.equal(flux.steps.maximum, 40);
  const sdxl = templates.get('sdxl-base-t2i').schema;
  assert.deepEqual(sdxl.params.prompt.targets, [['6', 'text']]); assert.deepEqual(sdxl.params.negative.targets, [['7', 'text']]);
  assert.deepEqual(sdxl.models, [{ folder: 'checkpoints', name: 'sd_xl_base_1.0.safetensors' }]);
  const wan = templates.get('wan22-ti2v-5b-t2v').schema.params;
  assert.ok(wan.length && wan.fps && wan.width.multipleOf === 32);
  assert.throws(() => extractSchema({ nodes: [], links: [] }), /not-api-format/);
});

test('applyParams validates every value against the typed schema and never overwrites links', () => {
  const t = templates.get('flux2-klein-4b-t2i');
  const { workflow, params } = applyParams(t, { prompt: 'a red fox', seed: 7, width: 768 });
  assert.equal(workflow['4'].inputs.text, 'a red fox'); assert.equal(workflow['10'].inputs.noise_seed, 7);
  assert.equal(workflow['7'].inputs.width, 768); assert.equal(workflow['8'].inputs.width, 768);
  assert.deepEqual(workflow['6'].inputs.positive, ['4', 0]); assert.equal(params.steps, 20);
  assert.equal(t.workflow['4'].inputs.text.startsWith('A quiet'), true, 'template is not mutated');
  for (const bad of ['{"seed":-1}', '{"seed":1.5}', '{"width":770}', '{"width":4096}', '{"steps":0}', '{"prompt":"   "}', '{"prompt":3}', '{"nodeId":4}', '{"__proto__":1}', '{"batch":2}'])
    assert.throws(() => applyParams(t, JSON.parse(bad)), /invalid-param|unknown-param/, bad);
});

test('endpoint policy: loopback/tailnet may be HTTP, everything else must be HTTPS; cloud uses /api', () => {
  assert.equal(comfyEndpoint('http://127.0.0.1:8188').label, '127.0.0.1:8188');
  assert.equal(comfyEndpoint('http://100.101.2.3:8188/').base, 'http://100.101.2.3:8188');
  assert.equal(comfyEndpoint('https://cloud.comfy.org').prefix, '/api');
  for (const bad of ['http://192.168.1.4:8188', 'http://example.com', 'ftp://127.0.0.1', 'http://u:p@127.0.0.1:8188', 'http://127.0.0.1:8188/?x=1']) assert.throws(() => comfyEndpoint(bad), /comfy-url/, bad);
});

test('runner: variations, live WS progress, owned output paths, provenance and no shared-queue side effects', { timeout: 30000 }, async () => {
  const mock = await startMockComfy(), root = await fixture(), events = [];
  const runner = new ComfyRunner({ root, client: new ComfyClient({ endpoint: comfyEndpoint(mock.url) }), templates, publish: e => events.push(e) });
  try {
    const jobs = await runner.submit({ projectId: 'p', templateId: 'flux2-klein-4b-t2i', params: { prompt: 'a red fox in snow', seed: 100 }, count: 2 });
    assert.deepEqual(jobs.map(j => j.params.seed), [100, 101]);
    const done = await until(() => { const l = runner.list('p'); return l.every(j => j.state === 'done') && l; });
    assert.ok(events.some(e => e.ev === 'comfy' && e.job.state === 'running' && e.job.progress > 0 && e.job.progress < 1), 'progress from WebSocket reached SSE');
    for (const j of done) {
      assert.equal(j.outputs.length, 1); assert.equal(j.outputs[0].kind, 'image');
      const bytes = await fs.readFile(path.join(root, 'projects/p', j.outputs[0].file));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      const side = JSON.parse(await fs.readFile(path.join(root, 'projects/p/media/generated/comfy', j.id, 'result.json')));
      assert.equal(side.machineGenerated, true); assert.equal(side.workflowSha256, templates.get('flux2-klein-4b-t2i').workflowSha256); assert.equal(side.params.seed, j.params.seed);
    }
    assert.notEqual(done[0].outputs[0].sha256, done[1].outputs[0].sha256, 'seed variation changes pixels');
    const sent = mock.state.prompts.map(p => p.prompt);
    assert.deepEqual(sent.map(p => p['13'].inputs.filename_prefix), done.map(j => 'fframestudio/' + j.id));
    assert.equal(sent[0]['4'].inputs.text, 'a red fox in snow');
    assert.equal(mock.state.clears, 0); assert.ok(!mock.state.requests.some(r => r.path === '/free'));
    await assert.rejects(runner.submit({ projectId: 'p', templateId: 'flux2-klein-4b-t2i', workflow: {} }), /invalid-request/);
    await assert.rejects(runner.submit({ projectId: 'p', templateId: 'nope' }), /unknown-template/);
    await assert.rejects(runner.submit({ projectId: '../x', templateId: 'flux2-klein-4b-t2i' }), /invalid-request/);
  } finally { await runner.close(); await mock.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('cancel: targeted interrupt for the running prompt, never-submitted queued jobs, no queue clear', { timeout: 30000 }, async () => {
  const mock = await startMockComfy(), root = await fixture();
  const runner = new ComfyRunner({ root, client: new ComfyClient({ endpoint: comfyEndpoint(mock.url) }), templates });
  try {
    const [a, b] = await runner.submit({ projectId: 'p', templateId: 'sdxl-base-t2i', params: { prompt: '[mock:slow] long shot' }, count: 2 });
    await until(() => runner.list().find(j => j.id === a.id).progress > 0);
    assert.equal((await runner.cancel(b.id)).state, 'cancelled');
    const ca = await runner.cancel(a.id); assert.equal(ca.state, 'cancelled');
    await sleep(100);
    assert.equal(mock.state.prompts.length, 1, 'queued job was never sent to ComfyUI');
    assert.deepEqual(mock.state.interrupts, [mock.state.prompts[0].id]);
    assert.equal(mock.state.clears, 0);
  } finally { await runner.close(); await mock.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('failures are typed and sanitized: OOM, missing node, unreachable server', { timeout: 30000 }, async () => {
  const root = await fixture();
  const mock = await startMockComfy(), runner = new ComfyRunner({ root, client: new ComfyClient({ endpoint: comfyEndpoint(mock.url) }), templates });
  const missing = await startMockComfy({ classes: MOCK_CLASSES.filter(c => c !== 'Flux2Scheduler') }), runner2 = new ComfyRunner({ root, client: new ComfyClient({ endpoint: comfyEndpoint(missing.url) }), templates });
  try {
    const [oom] = await runner.submit({ projectId: 'p', templateId: 'sdxl-base-t2i', params: { prompt: '[mock:oom] too big' } });
    const j = await until(() => { const x = runner.list().find(x => x.id === oom.id); return ['failed', 'done'].includes(x.state) && x; });
    assert.equal(j.error, 'out-of-memory'); assert.ok(!JSON.stringify(j).includes('secret-path'), 'traceback must not leak');
    await runner2.ready;
    const [bad] = await runner2.submit({ projectId: 'p', templateId: 'flux2-klein-4b-t2i', params: { prompt: 'x' } });
    const b = await until(() => { const x = runner2.list().find(x => x.id === bad.id); return x.state === 'failed' && x; });
    assert.equal(b.error, 'workflow-invalid'); assert.match(b.errorDetail.join(' '), /Flux2Scheduler/);
    const list = await runner2.templateList(); const flux = list.find(t => t.id === 'flux2-klein-4b-t2i');
    assert.equal(flux.ready, false); assert.deepEqual(flux.missingNodes, ['Flux2Scheduler']);
  } finally { await runner.close(); await runner2.close(); await mock.close(); await missing.close(); }
  const dead = new ComfyRunner({ root, client: new ComfyClient({ endpoint: comfyEndpoint('http://127.0.0.1:9') , timeout: 1000 }), templates });
  try {
    assert.equal((await dead.status()).reachable, false);
    const [x] = await dead.submit({ projectId: 'p', templateId: 'sdxl-base-t2i', params: { prompt: 'x' } });
    assert.equal((await until(() => { const j = dead.list().find(j => j.id === x.id); return j.state === 'failed' && j; })).error, 'comfy-unreachable');
  } finally { await dead.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('history polling fallback without WebSocket; hostile server filenames never choose local paths', { timeout: 30000 }, async () => {
  const mock = await startMockComfy({ websocket: false, evilFilenames: true }), root = await fixture();
  const runner = new ComfyRunner({ root, client: new ComfyClient({ endpoint: comfyEndpoint(mock.url) }), templates });
  try {
    const [j] = await runner.submit({ projectId: 'p', templateId: 'sdxl-base-t2i', params: { prompt: 'poll me' } });
    const done = await until(() => { const x = runner.list().find(x => x.id === j.id); return x.state === 'done' && x; });
    assert.equal(done.outputs[0].file, `media/generated/comfy/${j.id}/output-1.png`);
    await assert.rejects(fs.stat(path.join(root, 'projects/escape_00001_.png')));
    await assert.rejects(fs.stat(path.join(root, 'escape_00001_.png')));
  } finally { await runner.close(); await mock.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('restart recovery marks in-flight jobs interrupted', async () => {
  const root = await fixture(); await fs.mkdir(path.join(root, '.generation/comfy'), { recursive: true });
  await fs.writeFile(path.join(root, '.generation/comfy/job-1.json'), JSON.stringify({ id: 'job-1', state: 'running', projectId: 'p' }));
  const runner = new ComfyRunner({ root, client: new ComfyClient({ endpoint: comfyEndpoint('http://127.0.0.1:9') }), templates });
  await runner.ready; const [j] = runner.list();
  assert.equal(j.state, 'failed'); assert.equal(j.error, 'interrupted');
  await runner.close(); await fs.rm(root, { recursive: true, force: true });
});

test('video templates plug into the existing GenerationQueue provider interface (yuv444p normalised to the H.264 contract)', { timeout: 60000 }, async () => {
  const mock = await startMockComfy(), root = await fixture();
  const client = new ComfyClient({ endpoint: comfyEndpoint(mock.url) });
  const providers = comfyGenerationProviders({ client, templates });
  assert.deepEqual(providers.map(p => p.capability.id), ['comfy-wan22-ti2v-5b-t2v']);
  const queue = new GenerationQueue({ root, providers });
  try {
    const caps = await queue.capabilities(); assert.equal(caps[0].available, true, caps[0].reason);
    const job = await queue.submit({ providerId: 'comfy-wan22-ti2v-5b-t2v', projectId: 'p', prompt: 'slow dolly', seed: 9, duration: 3, width: 704, height: 480, fps: 24 });
    const done = await until(() => { const j = queue.list().find(j => j.id === job.id); return ['done', 'failed'].includes(j.state) && j; }, 45000);
    assert.equal(done.state, 'done', done.error); assert.equal(done.result.media.pixelFormat, 'yuv420p'); assert.equal(done.result.media.width, 704);
    const sent = mock.state.prompts.at(-1).prompt; assert.equal(sent['7'].inputs.length, 73); assert.equal(sent['8'].inputs.seed, 9);
  } finally { await queue.close(); await mock.close(); }
  const low = await startMockComfy({ vramFreeMiB: 2000, models: { ...MOCK_MODELS, diffusion_models: [] } });
  try {
    const [p] = comfyGenerationProviders({ client: new ComfyClient({ endpoint: comfyEndpoint(low.url) }), templates });
    const s = await p.probe(); assert.equal(s.available, false); assert.match(s.reason, /missing wan2\.2_ti2v_5B_fp16/);
  } finally { await low.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('execute() surfaces node_errors from POST /prompt without submitting a run', async () => {
  const mock = await startMockComfy({ classes: [] });
  try { await assert.rejects(execute(new ComfyClient({ endpoint: comfyEndpoint(mock.url) }), templates.get('sdxl-base-t2i').workflow), /workflow-invalid/); assert.equal(mock.state.prompts.length, 0); }
  finally { await mock.close(); }
});
