// ComfyUI desk: a small, voice-drivable pane over the bridge's /comfy/* routes.
// Every change arrives as a typed action (palette, voice, buttons); the desk never builds
// or uploads a workflow graph — it names a registered template and sends typed values.
import { request, events, prepareMedia } from './host.js';
import { escapeHTML as esc } from './studio.js';

const json = async (url, options) => {
  const r = await request(url, options); const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || 'ComfyUI request failed');
  return data;
};
const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const seconds = (a, b) => a && b ? ((Date.parse(b) - Date.parse(a)) / 1000).toFixed(1) + ' s' : '';

export class ComfyDesk {
  constructor(editor) {
    this.e = editor; this.jobs = new Map(); this.values = {}; this.templates = [];
    if (!document.querySelector('link[data-comfy-style]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/app/comfy.css'; css.dataset.comfyStyle = ''; document.head.append(css);
    }
    const panel = this.panel = document.createElement('section');
    panel.className = 'comfy-desk panel'; panel.id = 'comfy-desk'; panel.hidden = true; panel.setAttribute('aria-label', 'ComfyUI');
    panel.innerHTML = `<header><strong>ComfyUI</strong><output id="comfy-status" role="status">Connecting…</output><button data-comfy-act="close">Close</button></header>
      <label>Template<select id="comfy-template"></select></label><p id="comfy-template-note" class="comfy-note"></p>
      <form id="comfy-form" class="comfy-form"></form>
      <div class="comfy-actions"><button data-comfy-act="comfy-run" id="comfy-run" class="pill">Run</button><button data-comfy-act="comfy-variations" id="comfy-variations" class="pill">More variations</button><button data-comfy-act="comfy-cancel" id="comfy-cancel" class="pill">Cancel</button><button data-comfy-act="voice" class="pill">Voice · hold V</button></div>
      <p id="comfy-heard" class="comfy-note" aria-live="polite">Say “comfy, set prompt to …”, “comfy steps 12”, “comfy run”, “more variations” or “comfy cancel”.</p>
      <div id="comfy-jobs" class="comfy-grid" aria-live="polite"></div>`;
    document.body.append(panel);
    panel.addEventListener('click', ev => {
      const b = ev.target.closest('[data-comfy-act]'); if (!b) return; ev.preventDefault();
      const act = b.dataset.comfyAct;
      if (act === 'close') { panel.hidden = true; return; }
      if (act === 'voice') { this.e.action('voice').catch(e => this.say(e.message)); return; }
      // Buttons go through the same typed action registry as voice and the palette.
      this.e.action(act, b.dataset.job ? { job: b.dataset.job } : {}).catch(e => this.say(e.message));
    });
    panel.querySelector('#comfy-template').onchange = ev => this.useTemplate(ev.target.value);
    panel.querySelector('#comfy-form').oninput = ev => { const f = ev.target.closest('[data-comfy-param]'); if (f) this.values[f.dataset.comfyParam] = this.read(f); };
    panel.querySelector('#comfy-form').onsubmit = ev => ev.preventDefault();
    this.stop = events(event => { if (event.ev === 'comfy' && event.job?.projectId === this.e.doc.id) this.update(event.job); }, () => {});
    this.ready = this.refresh().catch(e => this.status('ComfyUI unavailable: ' + e.message));
    // Readback heals a missed SSE event after reconnect.
    this.timer = setInterval(() => this.loadJobs().catch(() => {}), 5000);
  }
  status(t) { if (!this.dead) this.panel.querySelector('#comfy-status').textContent = t; }
  say(t) { if (!this.dead) this.panel.querySelector('#comfy-heard').textContent = t; }
  get template() { return this.templates.find(t => t.id === this.templateId); }
  async refresh() {
    const [status, { templates }] = await Promise.all([json('/comfy/status'), json('/comfy/templates')]);
    if (this.dead) return;
    const v = status.vram ? ` · ${(status.vram.freeMiB / 1024).toFixed(1)} of ${(status.vram.totalMiB / 1024).toFixed(1)} GiB free` : '';
    this.status(status.reachable ? `Connected · ComfyUI ${status.comfyuiVersion || '?'} · ${status.endpoint}${v}${status.queue ? ` · queue ${status.queue.running + status.queue.pending}` : ''}` : `Not reachable · ${status.endpoint} · start ComfyUI, then reopen`);
    this.templates = templates;
    const select = this.panel.querySelector('#comfy-template');
    select.innerHTML = templates.map(t => `<option value="${esc(t.id)}">${esc(t.title)}${t.ready ? '' : ' — not ready'}</option>`).join('');
    const keep = this.templates.find(t => t.id === this.templateId) || templates.find(t => t.ready && t.kind === 'image') || templates[0];
    if (keep) this.useTemplate(keep.id, true);
    await this.loadJobs();
  }
  useTemplate(id, keepValues = false) {
    const t = this.templates.find(t => t.id === id); if (!t) return false;
    const prompt = this.values.prompt;
    this.templateId = id; this.panel.querySelector('#comfy-template').value = id;
    if (!keepValues || !this.formFor || this.formFor !== id) this.values = Object.fromEntries(t.params.map(p => [p.name, p.default]));
    if (prompt) this.values.prompt = prompt;
    this.formFor = id;
    this.panel.querySelector('#comfy-template-note').textContent = `${t.description} ${t.ready ? '' : '· ' + (t.reason || 'Not ready')} · ${t.licence.name}${t.vram?.measuredPeakMiB ? ` · measured peak ${t.vram.measuredPeakMiB} MiB` : ''}`;
    this.panel.querySelector('#comfy-form').innerHTML = t.params.map(p => {
      const id = 'comfy-p-' + p.name, val = this.values[p.name] ?? '';
      const input = p.type === 'string' && (p.name === 'prompt' || p.name === 'negative') ? `<textarea id="${id}" data-comfy-param="${esc(p.name)}" rows="${p.name === 'prompt' ? 3 : 2}" maxlength="${p.maxLength || 4000}">${esc(val)}</textarea>`
        : p.enum ? `<select id="${id}" data-comfy-param="${esc(p.name)}">${p.enum.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input id="${id}" data-comfy-param="${esc(p.name)}" ${p.type === 'string' ? 'type="text"' : `type="number" step="${p.multipleOf || (p.type === 'integer' ? 1 : 'any')}" ${p.minimum !== undefined ? `min="${p.minimum}"` : ''} ${p.maximum !== undefined ? `max="${p.maximum}"` : ''}`} value="${esc(val)}">`;
      return `<label class="${p.type === 'string' && !p.enum ? 'comfy-wide' : ''}">${esc(p.label)}${input}</label>`;
    }).join('');
    this.panel.querySelector('#comfy-run').disabled = !t.ready;
    return true;
  }
  read(field) { const p = this.template?.params.find(p => p.name === field.dataset.comfyParam); return p && p.type !== 'string' ? Number(field.value) : field.value; }
  setValue(name, value) {
    const p = this.template?.params.find(p => p.name === name);
    if (!p) throw Error(`${this.template?.title || 'This template'} has no “${name}” setting.`);
    if (p.type !== 'string' && typeof value !== 'number') throw Error(`${p.label} needs a number.`);
    if (p.type !== 'string' && ((p.minimum !== undefined && value < p.minimum) || (p.maximum !== undefined && value > p.maximum))) throw Error(`${p.label} must be between ${p.minimum} and ${p.maximum}.`);
    if (p.enum && !p.enum.includes(value)) throw Error(`${p.label} must be one of ${p.enum.join(', ')}.`);
    this.values[name] = value;
    const f = this.panel.querySelector(`[data-comfy-param="${CSS.escape(name)}"]`); if (f) f.value = value;
  }
  // Typed action entry point (voice, palette, buttons). Returns a short receipt string.
  async act(id, params = {}) {
    await this.ready; this.panel.hidden = false;
    let said;
    if (id === 'comfy') said = 'ComfyUI pane open.';
    else if (id === 'comfy-set-prompt') {
      if (!params.prompt) { this.panel.querySelector('[data-comfy-param="prompt"]')?.focus(); said = 'Type or say the prompt.'; }
      else { this.setValue('prompt', params.prompt); said = `Prompt → “${params.prompt}”`; }
    } else if (id === 'comfy-set-param') {
      if (params.name === undefined) { this.panel.querySelector('#comfy-form input,#comfy-form select')?.focus(); said = 'Choose a setting.'; }
      else { this.setValue(params.name, params.value); said = `${params.name} → ${params.value}`; }
    } else if (id === 'comfy-use-template') {
      const q = String(params.template || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const t = this.templates.find(t => t.id === q) || this.templates.find(t => q && q.split(' ').every(w => (t.id + ' ' + t.title).toLowerCase().includes(w)));
      if (!t) throw Error(`No template matches “${params.template}”. Try: ${this.templates.map(t => t.title).join('; ')}.`);
      this.useTemplate(t.id); said = `Template → ${t.title}`;
    } else if (id === 'comfy-run' || id === 'comfy-variations') {
      const t = this.template; if (!t) throw Error('No ComfyUI template is available.');
      if (!t.ready) throw Error(`${t.title} is not ready: ${t.reason}`);
      const values = { ...(id === 'comfy-variations' && this.last ? this.last : this.values) };
      if (id === 'comfy-variations' && 'seed' in values) values.seed = ((this.lastSeed ?? values.seed) + 1) % 4294967296;
      const count = params.count || 1;
      const { jobs } = await post('/comfy/jobs', { projectId: this.e.doc.id, templateId: t.id, params: values, count });
      this.last = values; this.lastSeed = 'seed' in values ? (values.seed + count - 1) % 4294967296 : undefined;
      for (const j of jobs) this.update(j);
      said = `${id === 'comfy-run' ? 'Queued' : 'Queued variation'} ${jobs.length} × ${t.title}${'seed' in values ? ' · seed ' + values.seed + (jobs.length > 1 ? '…' + this.lastSeed : '') : ''}`;
    } else if (id === 'comfy-cancel') {
      const { cancelled } = await post('/comfy/cancel-all', { projectId: this.e.doc.id }); said = cancelled ? `Cancelled ${cancelled} job${cancelled > 1 ? 's' : ''}.` : 'Nothing to cancel.';
    } else throw Error('Unknown ComfyUI action: ' + id);
    this.say(said); return said;
  }
  async loadJobs() {
    const { jobs } = await json('/comfy/jobs?projectId=' + encodeURIComponent(this.e.doc.id));
    for (const j of jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) this.update(j);
  }
  async update(job) {
    if (this.dead) return;
    const prev = this.jobs.get(job.id); if (prev && (job.sequence ?? 0) < (prev.sequence ?? 0)) return;
    this.jobs.set(job.id, job);
    const grid = this.panel.querySelector('#comfy-jobs');
    let card = grid.querySelector(`[data-comfy-job="${CSS.escape(job.id)}"]`);
    if (!card) { card = document.createElement('article'); card.className = 'comfy-card'; card.dataset.comfyJob = job.id; grid.prepend(card); }
    const sig = JSON.stringify([job.state, job.progress, job.error, job.outputs?.length]);
    if (card.dataset.signature === sig) return; card.dataset.signature = sig; card.dataset.state = job.state;
    card.innerHTML = `<div class="comfy-job-head"><strong>${esc(job.state)}</strong><span>${Math.round(job.progress * 100)}%</span></div><progress max="1" value="${job.progress}" aria-label="ComfyUI progress"></progress>
      <div class="comfy-preview"></div><p>${esc(job.params.prompt || '')}</p>
      <p class="comfy-note">${esc(job.templateTitle)} · seed ${esc(job.params.seed ?? '—')}${job.state === 'done' ? ' · ' + seconds(job.startedAt, job.finishedAt) + (job.vram ? ' · peak ' + job.vram.peakUsedMiB + ' MiB' : '') : ''}${job.error ? '<br>' + esc(job.error) + (job.errorDetail?.length ? ': ' + esc(job.errorDetail.join('; ')) : '') : ''}</p>`;
    if (job.state === 'done') for (const o of job.outputs.filter(o => o.kind === 'image' || o.kind === 'video')) {
      const url = await prepareMedia(job.projectId, o.file); if (this.dead || !card.isConnected) return;
      const el = document.createElement(o.kind === 'image' ? 'img' : 'video'); el.src = url; el.alt = 'ComfyUI output for: ' + (job.params.prompt || ''); if (o.kind === 'video') el.controls = true;
      card.querySelector('.comfy-preview').append(el);
    }
  }
  destroy() { this.dead = true; this.stop?.(); clearInterval(this.timer); this.panel.remove(); }
}
