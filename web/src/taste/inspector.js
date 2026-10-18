import { KEYS, previewTaste, tasteReceipt } from './profile.js';
import { fileAdapter, bridgeAdapter } from './adapters.js';
import { request } from '../host.js';
import { parseSocialReferences, MAX_SOCIAL_REFERENCES_BYTES } from './social-references.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const labels = { palette:'Palette', typography:'Typography', framing:'Framing', motion:'Motion', pacing:'Cuts / pacing', transition:'Transition style', density:'Density', soundtrack:'Soundtrack mood' };
const display = v => Array.isArray(v) ? v.join(' · ') : String(v);
const messages = {
  disconnected: 'No profile connected. Import aggregate JSON from your device.',
  offline: 'Offline or storage unavailable. No profile loaded; try again explicitly.',
  unauthorized: 'AgentWeb authorization expired or refused. Ask your bridge owner to reconnect.',
  invalid: 'Profile rejected: unsupported or non-aggregate data. Nothing imported.',
};
export class TasteInspector {
  constructor(editor, pane) {
    this.e = editor; this.pane = pane;
    this.file = fileAdapter(); this.source = 'file'; this.result = { state:'disconnected' };
    this.on = false; this.strength = 65; this.enabled = [...KEYS]; this.scope = 'task';
    this.socialCollection = null; this.socialStatus = '';
    this.render();
    this.load();
  }
  async load() {
    const source = this.source, epoch = this.epoch = (this.epoch || 0) + 1;
    const result = await (source === 'file' ? this.file : bridgeAdapter(request)).getProfile();
    if (source !== this.source || this.dead || epoch !== this.epoch) return;
    this.result = result;
    this.on = false; this.render();
  }
  render() {
    this.signature = '';
    const p = this.result.profile;
    this.pane.innerHTML = `<div class="slate-heading"><span class="cap">A creative prior · not a rule</span><h2>My <em>Taste.</em></h2><p>Your direction, with the evidence visible.</p></div>
      <div class="taste-source"><label>Profile source<select id="taste-source"><option value="file">File · browser-local</option><option value="agentweb">AgentWeb · bridge, opt-in</option></select></label>
      ${this.source === 'file' ? `<label class="taste-import">Import aggregate JSON<input id="taste-file" type="file" accept="application/json,.json"></label>` : ''}
      <div class="taste-actions"><button id="taste-retry" class="pill">Read profile</button><button id="taste-delete" class="pill" ${!p || this.source !== 'file' ? 'disabled' : ''}>Delete profile</button></div></div>
      ${this.source === 'agentweb' ? `<section class="taste-social" aria-label="Import selected social references">
        <p class="hint">Select only references you want to teach. Curated JSON links from X, Pinterest, YouTube or other collections; not direct account scraping.</p>
        <label>Curated reference JSON<input id="taste-social-file" type="file" accept=".json,application/json"></label>
        <p id="taste-social-preview" role="status">${esc(this.socialStatus || 'No references selected. Nothing leaves this device.')}</p>
        <label class="taste-switch"><input id="taste-social-consent" type="checkbox"> I approve sending this selected metadata to my configured AgentWeb service.</label>
        <button class="pill" id="taste-social-submit" disabled>Teach AgentWeb from selection</button></section>` : ''}
      <p id="taste-state" role="status" data-state="${this.result.state}">${p ? `${p.provenance.itemCount} evidence items · ${p.provenance.sourceCount} sources · revision ${esc(p.revision.slice(0,12))}` : esc(messages[this.result.state])}</p>
      ${this.source === 'file' ? `<p class="hint">Aggregate JSON only: no URLs, posts, media or credentials. Browser-local IndexedDB; nothing uploaded.</p>` : `<p class="hint">Selected URLs and descriptors are sent to AgentWeb only after approval. FrameStudio does not retain them; AgentWeb stores aggregate signals.</p>`}
      ${p ? `<fieldset class="taste-controls"><legend>Apply to this film’s direction</legend><label class="taste-switch"><input id="taste-on" type="checkbox" ${this.on ? 'checked' : ''}> Taste on <span>Preview only · Apply to commit</span></label><label>Strength <output id="taste-strength-value">${this.strength}%</output><input id="taste-strength" type="range" min="0" max="100" value="${this.strength}"></label><label>Application scope<select id="taste-scope"><option value="task">This task only</option><option value="project">This project</option></select></label><div class="taste-signals">${KEYS.map(k => {
        const s = p.signals[k];
        return `<label><input type="checkbox" data-taste-signal="${k}" ${this.enabled.includes(k) ? 'checked' : ''} ${s.value === null ? 'disabled' : ''}><span><b>${labels[k]}</b><small>${s.value === null ? 'Unknown · no visual evidence' : `${s.evidenceCount} evidence · ${Math.round(s.confidence*100)}% confidence${s.confidence < .5 ? ' · uncertain' : ''}`}</small></span></label>`;
      }).join('')}</div></fieldset>
      <section class="taste-comparison" aria-label="Direction comparison"><div class="cap">ORIGINAL → TASTE-ADJUSTED</div><div id="taste-studies"></div><ol id="taste-diff" aria-label="Explained direction diff"></ol><p class="hint">Palette and typography update shared styles. Other dials are direction tokens only: source footage, timing and music stay untouched. Brand locks always win.</p><button class="pill" id="taste-apply">Apply direction · undoable</button></section><p class="hint">Delete clears the local profile and this preview. Existing project receipts contain aggregate dials only; Undo reverses an applied direction.</p>` : ''}`;
    this.pane.querySelector('#taste-source').value = this.source;
    this.pane.querySelector('#taste-source').onchange = e => { this.source = e.target.value; ++this.epoch; this.on = false; this.socialCollection = null; this.socialStatus = ''; this.result = {state:'disconnected'}; this.render(); };
    this.pane.querySelector('#taste-retry').onclick = () => this.load().catch(() => this.fail('offline'));
    if (this.source === 'file') this.pane.querySelector('#taste-file').onchange = async e => {
      try {
        const epoch = ++this.epoch;
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 32768) throw Error('Too large');
        const text = await file.text();
        if (this.dead || epoch !== this.epoch) return;
        const result = await this.file.importJSON(text);
        if (this.dead || epoch !== this.epoch) return;
        this.source = 'file'; this.result = result; this.on = false; this.render();
      } catch { this.fail('invalid'); }
    };
    const socialFile = this.pane.querySelector('#taste-social-file');
    if (socialFile) {
      const consent = this.pane.querySelector('#taste-social-consent');
      const submit = this.pane.querySelector('#taste-social-submit');
      const status = this.pane.querySelector('#taste-social-preview');
      const sync = () => { submit.disabled = !consent.checked || !this.socialCollection; };
      consent.onchange = sync;
      socialFile.onchange = async e => {
        const epoch = ++this.epoch;
        try {
          const file = e.target.files?.[0];
          if (!file || file.size > MAX_SOCIAL_REFERENCES_BYTES) throw Error('Unsupported file');
          const raw = await file.text();
          if (this.dead || epoch !== this.epoch) return;
          this.socialCollection = parseSocialReferences(raw);
          status.textContent = this.socialCollection.items.length + ' selected ' + this.socialCollection.provider
            + ' references. No network request yet; metadata will be sent only after approval.';
        } catch {
          this.socialCollection = null;
          status.textContent = 'Invalid or oversized references. Select a reviewed JSON collection.';
        } finally {
          socialFile.value = '';
          sync();
        }
      };
      submit.onclick = async () => {
        if (!consent.checked || !this.socialCollection || this.dead) return;
        const approved = this.socialCollection, epoch = ++this.epoch;
        this.socialCollection = null;
        submit.disabled = true;
        status.textContent = 'Importing only the selected metadata…';
        try {
          const result = await bridgeAdapter(request).importCollection(approved);
          if (this.dead || epoch !== this.epoch || this.source !== 'agentweb') return;
          this.result = result;
          this.on = false;
          this.socialStatus = result.state === 'ready'
            ? 'Imported aggregate metadata. Visual signals remain unknown until measured.'
            : 'Import unavailable: ' + (messages[result.state] || result.state);
          this.render();
        } catch {
          if (this.dead || epoch !== this.epoch) return;
          this.socialStatus = 'Import failed; verify bridge connection, then select references again.';
          this.render();
        }
      };
    }
    this.pane.querySelector('#taste-delete').onclick = async () => {
      ++this.epoch;
      try { this.result = await this.file.deleteProfile(); this.on = false; this.signature = ''; this.render(); }
      catch { this.fail('offline'); }
    };
    if (!p) return;
    this.pane.querySelector('#taste-scope').value = this.scope;
    for (const selector of ['#taste-on','#taste-strength','#taste-scope','[data-taste-signal]']) for (const node of this.pane.querySelectorAll(selector)) node.oninput = () => {
      this.on = this.pane.querySelector('#taste-on').checked;
      this.strength = Number(this.pane.querySelector('#taste-strength').value);
      this.scope = this.pane.querySelector('#taste-scope').value;
      this.enabled = [...this.pane.querySelectorAll('[data-taste-signal]:checked:not(:disabled)')].map(n => n.dataset.tasteSignal);
      this.update();
    };
    this.pane.querySelector('#taste-apply').onclick = async () => {
      try {
        const preview = this.preview();
        if (!this.on || !preview.changes.length) return;
        await this.e.action('apply-taste', { videoId:this.e.videoId, receipt:tasteReceipt(p, preview, new Date().toISOString()) });
        this.e.toast('Taste direction applied. Undo restores the original.');
        this.update();
      } catch (error) { this.e.toast(error.message); }
    };
    this.update();
  }
  fail(state) { this.result = {state}; this.on = false; this.render(); }
  preview() {
    const p = this.result.profile;
    return previewTaste(p, { ...this.e.doc, videos: [this.e.video] }, { on:this.on, strength:this.strength, enabled:this.enabled, scopes: { [this.scope]:p, constraints:this.e.doc.metadata?.tasteBrandConstraints || {} } });
  }
  update() {
    if (!this.result.profile || this.dead) return;
    let preview;
    try { preview = this.preview(); } catch { this.pane.querySelector('#taste-state').textContent = 'Invalid direction or brand constraint; no changes can be applied.'; this.pane.querySelector('#taste-apply').disabled = true; return; }
    const signature = JSON.stringify(preview);
    if (signature === this.signature) return;
    this.signature = signature;
    this.pane.querySelector('#taste-strength-value').textContent = `${this.strength}%`;
    const study = (name, dials) => `<article class="taste-study"><span class="cap">${name}</span><div class="taste-swatches">${dials.palette.map(c => `<i style="background:${esc(c)}" aria-label="${esc(c)}"></i>`).join('')}</div><strong style="font-family:'${esc(dials.typography === 'IBM Plex Mono' ? 'Plex Mono' : dials.typography)}'">A film with<br>your signature.</strong><span>${esc(dials.typography)}</span><span>Pace ${dials.pacing} / 100 · ${esc(dials.transition)}</span></article>`;
    this.pane.querySelector('#taste-studies').innerHTML = study('Original',preview.before) + study('Taste-adjusted',preview.dials);
    this.pane.querySelector('#taste-diff').innerHTML = preview.changes.map(c => `<li data-taste-diff="${c.signal}"><b>${labels[c.signal]}</b><span>${esc(display(c.before))} → ${esc(display(c.after))}</span><small>${esc(c.reason)} · ${c.evidenceCount} evidence</small></li>`).join('') || `<li>${this.on ? 'No dials changed. Enable signals or increase strength; unknown signals stay unchanged.' : 'Taste is off. Turn it on to preview; your project is unchanged.'}</li>`;
    this.pane.querySelector('#taste-apply').disabled = !this.on || !preview.changes.length;
  }
  destroy() { this.dead = true; this.result = { state:'disconnected' }; }
}
