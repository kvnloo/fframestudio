import { parseIntent } from './intent.js';
import { action } from './actions.js';
import { request, isLocal } from './host.js';
export class VoiceControl {
  constructor(editor) {
    this.editor = editor;
    const tools = editor.root.querySelector('.editor-tools');
    this.button = document.createElement('button'); this.button.className = 'pill'; this.button.dataset.action = 'voice'; this.button.textContent = 'Voice · hold V'; tools.append(this.button);
    this.panel = document.createElement('section'); this.panel.className = 'voice-desk panel'; this.panel.hidden = true;
    this.panel.innerHTML = `<header><strong>Voice direction</strong> <output id="mic-state" role="status">Mic off · typed fallback ready</output><button id="voice-close">Close</button></header><p class="hint">One action at a time. Web Speech may use your browser’s speech service; enable it only if you consent. Otherwise use local transcription or type. Nothing is always listening.</p><label><input type="checkbox" id="speech-consent"> Allow browser speech recognition</label><form id="voice-form"><label>Live transcript / typed direction<input id="voice-transcript" autocomplete="off" placeholder="shorten the second shot by one second"></label><button>Preview direction</button></form><pre id="voice-preview" aria-live="polite"></pre><button id="voice-confirm" hidden>Confirm edit</button><button id="voice-cancel" hidden>Cancel edit</button>`;
    document.body.append(this.panel);
    this.transcript = this.panel.querySelector('#voice-transcript'); this.status = this.panel.querySelector('#mic-state'); this.preview = this.panel.querySelector('#voice-preview');
    this.panel.querySelector('#voice-close').onclick = () => { this.stop(); this.panel.hidden = true; };
    this.panel.querySelector('#voice-form').onsubmit = e => { e.preventDefault(); this.direct(this.transcript.value).catch(e => this.message(e.message)); };
    this.panel.querySelector('#voice-confirm').onclick = () => this.confirm().catch(e => this.message(e.message));
    this.panel.querySelector('#voice-cancel').onclick = () => this.clear();
    this.release = e => { if (e.code === 'KeyV' && this.held) { this.held = false; this.stop(); } };
    this.blur = () => { this.held = false; this.stop(); };
    addEventListener('keyup', this.release); addEventListener('blur', this.blur);
  }
  message(text) { this.preview.textContent = text; }
  key(e) {
    if (e.code !== 'KeyV' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.target.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return false;
    e.preventDefault(); if (!e.repeat) { this.held = true; this.start(); } return true;
  }
  toggle() { this.panel.hidden = false; if (this.listening) this.stop(); else this.start(); }
  clear() { this.pending = null; for (const id of ['voice-confirm','voice-cancel']) this.panel.querySelector('#'+id).hidden = true; this.message('Cancelled · document unchanged'); }
  async direct(text) {
    this.pending = null;
    for (const id of ['voice-confirm','voice-cancel']) this.panel.querySelector('#'+id).hidden = true;
    const intent = parseIntent(text, this.editor);
    if (intent.clarification) { this.message(intent.clarification); return intent; }
    const a = action(intent.action.id), preview = a.preview(this.editor, intent.action.params);
    this.message(a.title + '\n' + JSON.stringify(preview.diff, null, 2));
    if (intent.confirmation) {
      this.pending = { ...intent.action, revision:this.editor.doc.revision };
      for (const id of ['voice-confirm','voice-cancel']) this.panel.querySelector('#'+id).hidden = false;
    } else await a.apply(this.editor, intent.action.params);
    return intent;
  }
  async confirm() {
    const p = this.pending; if (!p) return;
    this.clear();
    if (p.revision !== this.editor.doc.revision) { this.message('Project changed. Repeat the direction to preview it again.'); return; }
    await action(p.id).apply(this.editor, p.params); this.message('Applied · Undo is available');
  }
  async start() {
    this.panel.hidden = false; globalThis.speechSynthesis?.cancel();
    if (this.listening || this.starting) return;
    const generation = this.generation = (this.generation || 0) + 1;
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (Recognition && this.panel.querySelector('#speech-consent').checked) {
      const r = this.recognition = new Recognition(); r.interimResults = true; r.continuous = false;
      r.onresult = e => { this.transcript.value = [...e.results].map(r => r[0].transcript).join(' '); if (e.results[e.results.length-1].isFinal) this.direct(this.transcript.value).catch(e => this.message(e.message)); };
      r.onerror = e => this.message('Speech unavailable ('+e.error+'). Type your direction below.');
      r.onend = () => { this.listening = false; this.status.textContent = 'Mic off · typed fallback ready'; };
      try { r.start(); this.listening = true; this.status.textContent = 'Listening · browser speech service'; } catch (e) { this.message(e.message); }
      return;
    }
    // Probe lazily; never download a model or install a system package implicitly.
    if (!isLocal() && navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder) {
      this.starting = true;
      try {
        const cap = await request('/reference/capabilities').then(r => r.json());
        if (cap.stt) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
          if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
          this.stream = stream; const recorder = this.recorder = new MediaRecorder(stream); const chunks = [];
          recorder.ondataavailable = e => chunks.push(e.data);
          recorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            if (this.dead) return;
            this.status.textContent = 'Transcribing locally…';
            try { const response = await request('/reference/transcribe', { method:'POST', body:new Blob(chunks), headers:{'Content-Type':'application/octet-stream'} }); const data = await response.json(); if (!response.ok) throw Error(data.error); if (this.dead) return; this.transcript.value = data.text; await this.direct(data.text); } catch (e) { this.message(e.message + ' · Type instead.'); }
            this.status.textContent = 'Mic off · typed fallback ready';
          };
          recorder.start(); this.listening = true; this.status.textContent = 'Listening · local bridge transcription';
          this.limit = setTimeout(() => this.stop(), 30000); return;
        }
      } catch (e) { this.message('Microphone unavailable: '+e.message); }
      finally { this.starting = false; }
    }
    this.status.textContent = 'Mic off · no speech backend · type below'; this.transcript.focus();
  }
  stop() { this.generation = (this.generation || 0)+1; clearTimeout(this.limit); this.recognition?.stop(); if (this.recorder?.state === 'recording') this.recorder.stop(); this.listening = false; this.status.textContent = 'Mic off · typed fallback ready'; }
  destroy() { this.dead = true; this.stop(); this.recognition?.abort(); this.stream?.getTracks().forEach(t => t.stop()); removeEventListener('keyup',this.release); removeEventListener('blur',this.blur); this.panel.remove(); }
}
