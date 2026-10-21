// /comfy/* routes. Enabled only with `--comfy-url URL` (or FFS_COMFY_URL); otherwise the
// bridge reports the feature off and the pane, palette entries and voice grammar stay hidden.
import { ComfyClient, ComfyRunner, comfyEndpoint, loadTemplates, TEMPLATE_DIR, comfyGenerationProviders } from './generation/comfyui.mjs';

const KNOWN = ['invalid-request', 'unknown-template', 'unknown-project', 'invalid-count', 'no-seed-param', 'queue-full', 'queue-closed', 'unknown-job', 'unsafe-path', 'invalid-params'];
export async function comfyFeature({ url, apiKey, templateDirs = [], root, publish }) {
  if (!url) {
    const templates = await loadTemplates([TEMPLATE_DIR, ...templateDirs]).catch(() => new Map());
    return { enabled: false, providers: comfyGenerationProviders({ templates }), handle: async () => false, close: async () => {} };
  }
  const endpoint = comfyEndpoint(url);
  const client = new ComfyClient({ endpoint, apiKey });
  const templates = await loadTemplates([TEMPLATE_DIR, ...templateDirs]);
  const runner = new ComfyRunner({ root, client, templates, publish });
  await runner.ready;
  const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  async function handle(req, res, u) {
    if (!u.pathname.startsWith('/comfy/')) return false;
    try {
      if (req.method === 'GET' && u.pathname === '/comfy/status') return send(res, 200, await runner.status()), true;
      if (req.method === 'GET' && u.pathname === '/comfy/templates') return send(res, 200, { templates: await runner.templateList() }), true;
      if (req.method === 'GET' && u.pathname === '/comfy/jobs') return send(res, 200, { jobs: runner.list(u.searchParams.get('projectId')) }), true;
      const m = /^\/comfy\/jobs\/([\w-]+)\/cancel$/.exec(u.pathname);
      if (req.method === 'POST' && m) return send(res, 200, await runner.cancel(m[1])), true;
      if (req.method === 'POST' && u.pathname === '/comfy/cancel-all') {
        const body = await readJSON(req); if (!body || typeof body.projectId !== 'string') return send(res, 400, { error: 'invalid-request' }), true;
        return send(res, 200, { cancelled: await runner.cancelAll(body.projectId) }), true;
      }
      if (req.method === 'POST' && u.pathname === '/comfy/jobs') {
        const body = await readJSON(req); if (body === undefined) return send(res, 413, { error: 'too-big' }), true;
        if (!body) return send(res, 400, { error: 'invalid-json' }), true;
        return send(res, 202, { jobs: await runner.submit(body) }), true;
      }
      return send(res, 404, { error: 'not-found' }), true;
    } catch (e) {
      const known = KNOWN.includes(e.message) || /^(invalid|unknown)-param:/.test(e.message);
      return send(res, 400, { error: known ? e.message : 'comfy-request-failed' }), true;
    }
  }
  return { enabled: true, endpoint: endpoint.label, providers: comfyGenerationProviders({ client, templates }), handle, close: () => runner.close() };
}
async function readJSON(req) {
  let body = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 32768) return undefined; body += chunk; }
  try { return JSON.parse(body); } catch { return null; }
}
