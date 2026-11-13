// Full-duplex subscribed GPT-Live. Provider credentials never enter this client.
import { request } from '../host.js';

export class LiveVoice {
  constructor({ onState = () => {}, onTranscript = () => {}, delegate, context = () => '' } = {}) {
    this.onState = onState;
    this.onTranscript = onTranscript;
    this.delegate = delegate;
    this.context = context;
    this.state = 'idle';
    this.generation = 0;
    this.seen = new Set();
    this.completed = new Set();
  }

  status(state, detail = '') {
    this.state = state;
    this.onState({ state, detail });
  }

  async api(path, { signal, ...options } = {}) {
    const response = await request(path, {
      ...options, signal,
      headers: { 'Content-Type': 'application/json', ...(this.call ? { 'X-FFS-Live-Token': this.call.callToken } : {}), ...options.headers },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(Error(result.error || `Live voice failed (${response.status})`), { status: response.status });
    return result;
  }

  async start() {
    if (this.state !== 'idle' && this.state !== 'error') return;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.abort = new AbortController();
    this.seen.clear();
    this.completed.clear();
    this.cursor = 0;
    this.pollFailures = 0;
    this.status('connecting', 'Connecting GPT Live…');
    let stage = 'Microphone access';
    try {
      if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error('Microphone requires HTTPS and browser microphone permission.');
      if (typeof RTCPeerConnection !== 'function') throw Error('This browser does not support live voice.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stage = 'WebRTC setup';
      const peer = new RTCPeerConnection();
      this.peer = peer;
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.hidden = true;
      document.body.append(audio);
      this.audio = audio;
      peer.ontrack = event => {
        if (!current()) return;
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        audio.play().catch(() => { if (current()) this.fail(Error('Browser blocked spoken audio. Allow audio playback and retry.'), generation); });
      };
      peer.onconnectionstatechange = () => {
        if (!current()) return;
        if (peer.connectionState === 'connected') this.status('live', 'GPT Live · listening');
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') this.fail(Error('Live voice disconnected. Tap the microphone to reconnect.'), generation);
      };
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      this.channel = peer.createDataChannel('oai-events');
      const offer = await peer.createOffer();
      if (!current()) return;
      await peer.setLocalDescription(offer);
      if (!current()) return;
      // Do not abort signaling mid-admission: retain its response so a cancelled start
      // can end the exact provider call rather than orphan it or blindly retry.
      stage = 'GPT live signaling';
      const call = await this.api('/live/calls', { method: 'POST', body: JSON.stringify({ sdp: offer.sdp }) });
      if (!current()) {
        await this.endCall(call);
        return;
      }
      this.call = call;
      if (call.model !== 'gpt-live-1-codex') throw Error('The live endpoint did not select the subscription-backed GPT live model.');
      await peer.setRemoteDescription({ type: 'answer', sdp: call.sdp });
      if (!current()) return;
      const context = this.context();
      if (context) await this.append({ text: context, channel: 'commentary' });
      if (current()) {
        this.connectTimer = setTimeout(() => {
          if (current() && peer.connectionState !== 'connected') this.fail(Error('GPT Live did not establish an audio connection.'), generation);
        }, 20000);
        this.poll(generation);
      }
    } catch (error) {
      this.lastError = { stage, name: error.name, message: error.message };
      if (error.name !== 'NotAllowedError') error = Object.assign(Error(stage + ': ' + error.message), { name: error.name });
      if (current()) await this.fail(error, generation);
    }
  }

  async append(body) {
    if (!this.call) throw Error('Live voice is not connected.');
    return this.api(`/live/calls/${this.call.callId}/context`, { method: 'POST', body: JSON.stringify(body), signal: this.abort?.signal });
  }

  async poll(generation) {
    if (generation !== this.generation || !this.call) return;
    try {
      const result = await this.api(`/live/calls/${this.call.callId}/events?after=${this.cursor}`, { signal: this.abort.signal });
      if (generation !== this.generation) return;
      this.pollFailures = 0;
      this.cursor = result.cursor;
      for (const event of result.events) {
        if (event.type === 'turn.done') this.onTranscript({ role: event.role, text: event.transcript });
        if (event.type === 'delegation.created' && !this.seen.has(event.id)) {
          this.seen.add(event.id);
          this.handleDelegation(event, generation);
        }
        if (event.type === 'error') throw Error(event.message || 'GPT Live reported a connection error.');
      }
      if (result.closed) throw Error('GPT Live closed the session. Tap the microphone to reconnect.');
      this.pollTimer = setTimeout(() => this.poll(generation), 250);
    } catch (error) {
      if (generation !== this.generation) return;
      // Only this read-only event cursor can retry. Never retry signaling, a
      // delegation or final-context delivery with an indeterminate outcome.
      if ((error instanceof TypeError || [502, 503, 504].includes(error.status)) && (this.pollFailures || 0) < 3) {
        this.pollFailures = (this.pollFailures || 0) + 1;
        this.pollTimer = setTimeout(() => this.poll(generation), 250 * 2 ** this.pollFailures);
        return;
      }
      await this.fail(error, generation);
    }
  }

  async handleDelegation(event, generation) {
    try {
      const result = await this.delegate(event.text);
      if (generation !== this.generation) return;
      const text = result?.ok ? result.text || 'The agent returned no spoken result.' : result?.message || `The request was not completed: ${result?.reason || 'agent unavailable'}.`;
      await this.append({ delegationId: event.id, text, channel: 'speakable', final: true });
      this.completed.add(event.id);
    } catch (error) {
      // Context admission can be indeterminate: never resubmit this delegation.
      if (generation === this.generation) await this.fail(error, generation);
    }
  }

  async endCall(call) {
    if (!call) return;
    const response = await request(`/live/calls/${call.callId}`, { method: 'DELETE', headers: { 'X-FFS-Live-Token': call.callToken } });
    if (!response.ok) throw Error('Audio stopped locally; server-side call closure could not be confirmed.');
  }

  async stop() {
    ++this.generation;
    this.abort?.abort();
    clearTimeout(this.pollTimer);
    clearTimeout(this.connectTimer);
    this.peer?.close();
    this.stream?.getTracks().forEach(track => track.stop());
    this.audio?.pause();
    this.audio?.remove();
    this.peer = null;
    this.stream = null;
    this.audio = null;
    const call = this.call;
    this.call = null;
    this.status('idle');
    await this.endCall(call);
  }

  async fail(error, generation) {
    if (generation !== this.generation) return;
    const permission = error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow microphone access for this site and retry.' : error.message;
    try { await this.stop(); } catch { /* local tracks are already released */ }
    this.status('error', permission);
  }
}
