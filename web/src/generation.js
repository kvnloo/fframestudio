import { request, isLocal, isCopy, events, prepareMedia } from './host.js';
import { escapeHTML as esc } from './studio.js';
import { fpsOf, uid } from './doc/project.js';

export function generatedCommand(job, doc, videoId) {
  if (job?.state !== 'done' || job.projectId !== doc.id || !job.result?.provenance || !Number.isFinite(job.result.media?.duration)) throw Error('Generated media is not ready for this project');
  const duration = Math.floor(job.result.media.duration * fpsOf(doc) + 1e-6);
  if (duration < 1) throw Error('Generated media is shorter than one project frame');
  return { type: 'import-generated', videoId, clipId: uid('clip'), name: job.settings.prompt.slice(0, 70),
    media: { id: uid('media'), kind: 'video', file: job.result.file, duration, generation: job.result.provenance } };
}
const json = async (url, options) => {
  const r = await request(url, options); const data = await r.json();
  if (!r.ok) throw Error(data.error || 'Generation request failed');
  return data;
};
export class GenerationPanel {
  constructor(editor, root) { this.e = editor; this.root = root; this.jobs = new Map(); this.media = new Map(); }
  async mount() {
    if (!document.querySelector('link[data-generation-style]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/app/generation.css'; css.dataset.generationStyle = ''; document.head.append(css);
    }
    this.root.innerHTML = `<div class="slate-heading"><span class="cap">LOCAL / GENERATION</span><h2>Generate <em>shot.</em></h2><p>Explore variations. Keep your originals.</p></div>
      <p id="gen-status" role="status">Checking local inference…</p>
      <button class="pill" id="gen-probe">Check availability</button>
      <form id="gen-form" class="gen-form">
      <label>Model<select name="providerId" id="gen-model" aria-describedby="gen-licence"></select></label>
      <p id="gen-licence" class="gen-note"></p>
      <label>Prompt<textarea id="gen-prompt" name="prompt" rows="4" maxlength="4000" required placeholder="Describe the camera, subject, light and movement."></textarea></label>
      <div class="gen-settings"><label>Duration<select name="duration"><option value="3">3 seconds</option><option value="4">4 seconds</option><option value="5">5 seconds</option></select></label>
      <label>Aspect / resolution<select name="resolution" id="gen-resolution"></select></label>
      <label>FPS<select name="fps" id="gen-fps"></select></label><label>Seed<input name="seed" id="gen-seed" type="number" min="0" max="4294967295" value="42" required></label></div>
      <p class="gen-note">Text-to-video pilot. Playhead reference / image-to-video is not yet enabled. Local clips use the low-memory preset; no prompt is uploaded.</p>
      <button class="pill" id="gen-submit" type="submit" disabled>Generate variation</button></form>
      <h3>Variations <span class="cap">/ JOBS</span></h3><div id="gen-jobs" class="gen-grid" aria-live="polite"></div>`;
    this.root.querySelector('#gen-probe').onclick = () => this.refresh().catch(e => this.status(e.message));
    this.root.querySelector('#gen-model').onchange = () => this.modelChanged();
    this.root.querySelector('#gen-form').onsubmit = ev => { ev.preventDefault(); this.submit().catch(e => this.status(e.message)); };
    this.root.querySelector('#gen-jobs').onclick = ev => {
      const b = ev.target.closest('button[data-gen-action]'); if (!b) return;
      b.disabled = true;
      this.action(b.dataset.genAction, b.dataset.job).catch(e => this.status(e.message)).finally(() => { if (b.isConnected) b.disabled = false; });
    };
    if (isLocal() || isCopy(this.e.doc.id)) {
      this.status('Local inference unavailable in this hosted/folder project. Connect your own authenticated GPU bridge and open a project from its library. Editing remains available.');
      this.root.querySelector('#gen-probe').disabled = true;
      return;
    }
    this.stop = events(event => { if (event.ev === 'generation' && event.job.projectId === this.e.doc.id) this.update(event.job).catch(() => this.status('Cannot load this generated preview. Check the bridge connection.')); }, () => {});
    try { await this.refresh(); } catch { this.status('Local inference unavailable: bridge connection failed. Editing remains available.'); }
    // Readback also heals a missed SSE event after reconnect. Never part of rAF.
    this.timer = setInterval(() => this.loadJobs().catch(() => {}), 5000);
  }
  status(text) { if (!this.dead) this.root.querySelector('#gen-status').textContent = text; }
  async refresh() {
    const { providers } = await json('/generation/providers'); if (this.dead) return;
    this.providers = providers;
    const select = this.root.querySelector('#gen-model'), old = select.value;
    select.innerHTML = providers.map(p => `<option value="${esc(p.id)}" ${p.available ? '' : 'disabled'}>${esc(p.name)}${p.available ? '' : ' — unavailable'}</option>`).join('');
    select.value = providers.find(p => p.id === old && p.available)?.id || providers.find(p => p.available)?.id || '';
    this.modelChanged(); await this.loadJobs();
  }
  modelChanged() {
    const p = this.providers.find(p => p.id === this.root.querySelector('#gen-model').value);
    this.root.querySelector('#gen-submit').disabled = !p?.available;
    this.status(p?.available ? `${p.id === 'fake' ? 'Test provider — synthetic pattern, not AI.' : 'Local inference ready · experimental, hardware fit not yet measured.'} ${p.cost.note || ''}` : this.providers.map(p => p.reason).filter(Boolean).join(' '));
    this.root.querySelector('#gen-licence').textContent = p ? `${p.licence.name}. ${p.licence.notice || ''}` : 'No available model. No API or GPU work will be started.';
    this.root.querySelector('#gen-resolution').innerHTML = (p?.resolutions || []).map(([w, h]) => `<option value="${w}x${h}">${w === h ? 'Square' : w > h ? 'Landscape' : 'Portrait'} · ${w} × ${h}</option>`).join('');
    this.root.querySelector('#gen-fps').innerHTML = (p?.fps || []).map(f => `<option>${f}</option>`).join('');
  }
  async loadJobs() {
    const { jobs } = await json('/generation/jobs?projectId=' + encodeURIComponent(this.e.doc.id));
    if (this.dead) return;
    for (const j of jobs) await this.update(j);
  }
  async update(job) {
    if (this.dead) return;
    const previous = this.jobs.get(job.id);
    if (previous && (job.sequence ?? 0) < (previous.sequence ?? 0)) return;
    this.jobs.set(job.id, job);
    const grid = this.root.querySelector('#gen-jobs');
    let card = grid.querySelector(`[data-gen-job="${CSS.escape(job.id)}"]`);
    if (!card) { card = document.createElement('article'); card.dataset.genJob = job.id; card.className = 'gen-card'; grid.prepend(card); }
    const signature = JSON.stringify([job.state, job.progress, job.error, job.result?.file]);
    if (card.dataset.signature === signature) return;
    card.dataset.signature = signature;
    card.innerHTML = `<div class="gen-job-head"><strong>${esc(job.state)}</strong><span>${Math.round(job.progress * 100)}%</span></div><progress max="1" value="${job.progress}" aria-label="Generation progress"></progress>
      <p>${esc(job.settings.prompt)}</p><div class="gen-preview"></div>
      <p class="gen-note">Seed ${job.settings.seed} · ${esc(job.version)}<br>${esc(job.licence.name)}${job.error ? '<br>' + esc(job.error) : ''}</p>
      <div class="gen-actions">${['queued', 'running'].includes(job.state) ? `<button class="pill" data-gen-action="cancel" data-job="${job.id}">Cancel</button>` : ['failed', 'cancelled'].includes(job.state) ? `<button class="pill" data-gen-action="retry" data-job="${job.id}">Retry same seed</button>` : `<button class="pill" data-gen-action="insert" data-job="${job.id}">Insert into timeline</button><button class="pill" data-gen-action="variation" data-job="${job.id}">New variation</button>`}</div>
      <details><summary>Provenance</summary><pre>${esc(JSON.stringify(job.result?.provenance || { settings: job.settings, model: job.model, version: job.version, licence: job.licence, cost: job.cost }, null, 2))}</pre></details>`;
    if (job.state === 'done') {
      const url = await prepareMedia(this.e.doc.id, job.result.file); if (this.dead || !card.isConnected) return;
      const video = document.createElement('video'); video.src = url; video.controls = true; video.preload = 'metadata'; video.playsInline = true;
      card.querySelector('.gen-preview').append(video);
    }
  }
  async submit(settings) {
    const form = this.root.querySelector('#gen-form');
    if (!settings) {
      const fields = new FormData(form), [width, height] = fields.get('resolution').split('x').map(Number);
      settings = { providerId: fields.get('providerId'), projectId: this.e.doc.id, prompt: fields.get('prompt'), seed: Number(fields.get('seed')), duration: Number(fields.get('duration')), width, height, fps: Number(fields.get('fps')) };
    }
    const button = this.root.querySelector('#gen-submit'); button.disabled = true;
    try { const job = await json('/generation/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); await this.update(job); }
    finally { if (!this.dead) button.disabled = !this.providers?.some(p => p.available); }
  }
  async action(action, id) {
    const job = this.jobs.get(id); if (!job) return;
    if (action === 'insert') {
      // Re-read authoritative job, rather than import a stale progress card.
      const current = await json('/generation/jobs/' + id);
      await prepareMedia(this.e.doc.id, current.result.file);
      const cmd = generatedCommand(current, this.e.doc, this.e.videoId);
      await this.e.run(cmd); await this.e.select(cmd.clipId);
      this.status('Inserted as a new shot. Undo removes this edit, not the generated original. Save to keep it in the project.');
    } else if (action === 'variation') {
      await this.submit({ ...job.settings, seed: (job.settings.seed + 1) % 4294967296 });
    } else await this.update(await json(`/generation/jobs/${id}/${action}`, { method: 'POST' }));
  }
  destroy() { this.dead = true; this.stop?.(); clearInterval(this.timer); }
}
