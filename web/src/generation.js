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
// Source frame under the playhead, from the timeline document (not the preview
// element). Mirrors poster mapping: own media uses source frames; a master proxy
// uses timeline frames. Returns null when nothing decodable is under the playhead.
export function playheadSource(doc, video, at) {
  const frame = Math.floor(at), fps = fpsOf(doc);
  const clip = video.clips.find(c => frame >= c.start && frame < c.start + c.duration);
  if (!clip) return null;
  const media = doc.media.find(m => m.id === clip.mediaId && m.kind === 'video');
  const file = media?.file || doc.preview?.proxy || doc.metadata?.renders?.[0]?.file;
  if (!file) return null;
  const sourceFrame = media ? clip.sourceIn + (frame - clip.start) * clip.speed.num / clip.speed.den : frame;
  return { file, frame, sourceTime: sourceFrame / fps, seekTime: (sourceFrame + 0.25) / fps,
    reference: { videoId: video.id, clipId: clip.id, clipName: String(clip.name || '').slice(0, 200), mediaId: media?.id ?? null, frame, sourceTime: sourceFrame / fps } };
}
const clock = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
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
      <label>Source<select name="mode" id="gen-mode"><option value="t2v">Text only</option><option value="i2v" id="gen-mode-i2v">From playhead frame</option></select></label>
      <div id="gen-reference" class="gen-reference" hidden><button class="pill" type="button" id="gen-capture">Capture playhead frame</button>
      <img id="gen-reference-img" alt="Captured playhead reference frame" hidden><p id="gen-reference-meta" class="gen-note">No reference captured yet. Capture uses the paused poster decoder, not the playing preview.</p></div>
      <div class="gen-settings"><label>Duration<select name="duration"><option value="3">3 seconds</option><option value="4">4 seconds</option><option value="5">5 seconds</option></select></label>
      <label>Aspect / resolution<select name="resolution" id="gen-resolution"></select></label>
      <label>FPS<select name="fps" id="gen-fps"></select></label><label>Seed<input name="seed" id="gen-seed" type="number" min="0" max="4294967295" value="42" required></label></div>
      <p class="gen-note" id="gen-mode-note">Local clips use the low-memory preset; no prompt is uploaded.</p>
      <button class="pill" id="gen-submit" type="submit" disabled>Generate variation</button></form>
      <h3>Variations <span class="cap">/ JOBS</span></h3><div id="gen-jobs" class="gen-grid" aria-live="polite"></div>`;
    this.root.querySelector('#gen-probe').onclick = () => this.refresh().catch(e => this.status(e.message));
    this.root.querySelector('#gen-model').onchange = () => this.modelChanged();
    this.root.querySelector('#gen-mode').onchange = () => this.modeChanged();
    this.root.querySelector('#gen-resolution').onchange = () => this.clearReference('Resolution changed: capture the playhead frame again.');
    this.root.querySelector('#gen-capture').onclick = () => this.capture().catch(e => this.referenceNote(e.message));
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
    const resolution = this.root.querySelector('#gen-resolution'), previous = resolution.value;
    resolution.innerHTML = (p?.resolutions || []).map(([w, h]) => `<option value="${w}x${h}">${w === h ? 'Square' : w > h ? 'Landscape' : 'Portrait'} · ${w} × ${h}</option>`).join('');
    if ([...resolution.options].some(o => o.value === previous)) resolution.value = previous;
    this.root.querySelector('#gen-fps').innerHTML = (p?.fps || []).map(f => `<option>${f}</option>`).join('');
    if (this.reference && `${this.reference.width}x${this.reference.height}` !== resolution.value) this.clearReference('Resolution changed: capture the playhead frame again.');
    // i2v is offered only when the selected provider advertises it.
    const i2v = !!p?.modes?.includes('i2v'), option = this.root.querySelector('#gen-mode-i2v');
    option.disabled = !i2v; option.textContent = i2v ? 'From playhead frame' : 'From playhead frame — not supported by this model';
    if (!i2v) this.root.querySelector('#gen-mode').value = 't2v';
    this.modeChanged();
  }
  get mode() { return this.root.querySelector('#gen-mode').value || 't2v'; }
  modeChanged() {
    const p = this.providers?.find(p => p.id === this.root.querySelector('#gen-model').value), i2v = this.mode === 'i2v';
    this.root.querySelector('#gen-reference').hidden = !i2v;
    this.root.querySelector('#gen-mode-note').textContent = (i2v ? 'Image-to-video: the captured playhead frame conditions the first frame. Provenance records its clip, frame and source time. '
      : p?.modes?.includes('i2v') ? '' : 'This model is text-to-video only; playhead reference is unavailable. ') + 'Local clips use the low-memory preset; no prompt is uploaded.';
  }
  referenceNote(text) { if (!this.dead) this.root.querySelector('#gen-reference-meta').textContent = text; }
  clearReference(note) {
    if (this.reference?.url) URL.revokeObjectURL(this.reference.url);
    this.reference = null;
    const img = this.root.querySelector('#gen-reference-img'); img.hidden = true; img.removeAttribute('src');
    if (note) this.referenceNote(note);
  }
  async capture() {
    const source = playheadSource(this.e.doc, this.e.video, this.e.frame);
    if (!source) throw Error('No decodable video under the playhead. Move it over a video shot.');
    const [width, height] = this.root.querySelector('#gen-resolution').value.split('x').map(Number);
    const button = this.root.querySelector('#gen-capture'); button.disabled = true;
    try {
      const url = await prepareMedia(this.e.doc.id, source.file);
      const blob = await this.e.posterDecoder.capture(url, source.seekTime, width, height);
      if (this.dead) return;
      this.clearReference();
      this.reference = { ...source, blob, width, height, url: URL.createObjectURL(blob) };
      const img = this.root.querySelector('#gen-reference-img'); img.src = this.reference.url; img.hidden = false;
      this.referenceNote(`${source.reference.clipName || 'Shot'} · frame ${source.frame} · source ${clock(source.sourceTime)} · ${width} × ${height}`);
    } finally { if (!this.dead) button.disabled = false; }
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
      <p>${esc(job.settings.prompt)}</p>${job.reference ? `<p class="gen-note gen-from" data-gen-reference="${esc(job.reference.id)}"><img alt="Playhead reference" width="64"> From ${esc(job.reference.clipName || 'shot')} · frame ${job.reference.frame} · source ${clock(job.reference.sourceTime)}</p>` : ''}<div class="gen-preview"></div>
      <p class="gen-note">${job.mode === 'i2v' ? 'Image-to-video' : 'Text-to-video'} · Seed ${job.settings.seed} · ${esc(job.version)}<br>${esc(job.licence.name)}${job.error ? '<br>' + esc(job.error) : ''}</p>
      <div class="gen-actions">${['queued', 'running'].includes(job.state) ? `<button class="pill" data-gen-action="cancel" data-job="${job.id}">Cancel</button>` : ['failed', 'cancelled'].includes(job.state) ? `<button class="pill" data-gen-action="retry" data-job="${job.id}">Retry same seed</button>` : `<button class="pill" data-gen-action="insert" data-job="${job.id}">Insert into timeline</button><button class="pill" data-gen-action="variation" data-job="${job.id}">New variation</button>`}</div>
      <details><summary>Provenance</summary><pre>${esc(JSON.stringify(job.result?.provenance || { settings: job.settings, mode: job.mode, reference: job.reference, model: job.model, version: job.version, licence: job.licence, cost: job.cost }, null, 2))}</pre></details>`;
    if (job.reference) {
      const src = await prepareMedia(this.e.doc.id, job.reference.file).catch(() => '');
      const img = card.querySelector('.gen-from img'); if (img && src && !this.dead) img.src = src;
    }
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
      if (this.mode === 'i2v') {
        const ref = this.reference;
        if (!ref || ref.width !== width || ref.height !== height) throw Error('Capture the playhead frame at this resolution first.');
        // Upload once per capture; variations and retries reuse the stored reference ID.
        ref.id ||= (await json('/generation/references?projectId=' + encodeURIComponent(this.e.doc.id), { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: ref.blob })).id;
        settings.mode = 'i2v'; settings.reference = { id: ref.id, ...ref.reference };
      }
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
  destroy() { this.dead = true; this.stop?.(); clearInterval(this.timer); if (this.reference?.url) URL.revokeObjectURL(this.reference.url); }
}
