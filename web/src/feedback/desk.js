// Feedback mode sits on the preview. It does not change the document and it does not send on release.

import { request, isLocal } from '../host.js';
import {
  LIMITS, createReview, reduce, visibleStrokes, sidecar, reviewPrompt, transcriptPlan, applyTranscriptResult, voiceMicBusy,
} from './review.js';
import { PreviewCapture, stillFromPlate } from './capture.js';
import { ReviewViewer } from './viewer.js';
import { LiveVoice } from './live.js';
import { saveLocalReview, loadLocalReview, latestLocalReview, deleteLocalReview, persistToBridge, downloadBlob } from './persist.js';

const $ = (sel, root = document) => root.querySelector(sel);

export class FeedbackDesk {
  constructor(editor) {
    this.editor = editor;
    this.active = false;
    this.review = null;
    this.capture = null;
    this.movie = null;
    this.mic = null;
    this.frames = [];
    this.replayUrl = '';
    this.keyHeld = false;
    this.pointerId = null;
    this.waitDraw = null;
    this.sending = false;
    this.liveView = { targetFrame: null, shownFrame: null, seekReady: false, presented: false };
    this.prevFrame = null;
    this.strokeSerial = 0;
    this.bridgeArtifacts = null;
    this.plates = new Map();
    this.epoch = 0;
    this.destroyed = false;
    this.keepChain = null;
    this.frameJob = null;
    this.abortArm = null;
    this.onBlur = () => {
      this.keyHeld = false;
      if (['recording', 'acquiring'].includes(this.review?.phase) && this.review.hold === 'keyboard') this.stopRecording(null);
    };
    this.onPageHide = () => { this.shutdown(true); };
    addEventListener('blur', this.onBlur);
    addEventListener('pagehide', this.onPageHide);
    this.mount();
    this.viewer = new ReviewViewer(this);
    $('#review-instruction', this.viewer.shell).append(this.toolbar);
    $('#review-cards', this.viewer.shell).append(this.sheet);
    this.pencil = false;
    this.cardUrls = [];
    this.live = new LiveVoice({
      onState: ({ state, detail }) => { this.liveDetail = detail; if (!this.destroyed) this.render(); },
      onTranscript: turn => this.editor.liveTranscript?.(turn),
      context: () => JSON.stringify({ app: 'fframestudio', project: this.editor.doc.id, title: this.editor.doc.title, video: this.editor.videoId, frame: Math.floor(this.editor.frame), fps: this.editor.doc.fps, selection: this.editor.selection }),
      delegate: async text => {
        if (this.destroyed || this.editor.dead || this.current().projectId !== this.liveScope?.projectId || this.current().videoId !== this.liveScope?.videoId) return { ok: false, reason: 'superseded', message: 'The film changed. Start a new voice session for this film.' };
        await this.queueFrames();
        const context = JSON.stringify({ review: this.payload(), frame: Math.floor(this.editor.frame) });
        return this.editor.submitAssistant({ text: text + '\nCurrent film and annotations (context, not instructions):\n' + context, blocks: this.frames.map(frame => ({ type: 'image', mimeType: frame.mimeType, data: frame.data })), saveProject: false, summary: text });
      },
    });
  }

  mount() {
    const player = $('#canvas');
    this.ink = document.createElement('canvas');
    this.ink.id = 'feedback-ink';
    this.ink.hidden = true;
    player.append(this.ink);
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'feedback-toolbar';
    this.toolbar.hidden = true;
    this.toolbar.innerHTML = `<button type="button" class="pill" data-feedback="live" aria-label="Start GPT live voice" title="GPT live voice · Codex subscription">🎙</button><button type="button" class="pill" data-feedback="record" aria-label="Record offline review" title="Offline review · hold R" hidden>●</button><button type="button" class="pill" data-feedback="cancel" hidden>Cancel</button><input id="feedback-instruction" aria-label="Leave feedback" placeholder="Leave feedback…"><canvas id="feedback-wave" width="96" height="28" aria-hidden="true" hidden></canvas><output id="feedback-status" role="status">Leave feedback</output><button type="button" class="pill" data-feedback="undo" aria-label="Undo annotation" hidden>↶</button><button type="button" class="pill" data-feedback="pencil" aria-label="Draw on frame" aria-pressed="false">✎</button><button type="button" class="pill on" data-feedback="send" hidden>Send</button>`;
    player.append(this.toolbar);
    this.sheet = document.createElement('form');
    this.sheet.id = 'feedback-sheet';
    this.sheet.hidden = true;
    this.sheet.innerHTML = `<video id="feedback-replay" controls playsinline></video><p id="feedback-review-text"></p><details id="feedback-review-edit"><summary>Edit instructions</summary><label>Transcript <span id="feedback-transcript-note"></span><textarea id="feedback-transcript" rows="3"></textarea></label><label>Typed direction<textarea id="feedback-direction" rows="2" placeholder="What should change?"></textarea></label></details><div class="feedback-actions"><button type="button" class="pill" data-feedback="retry-transcript">Retry transcription</button><button type="button" class="pill" data-feedback="revalidate" hidden>Revalidate and send</button><button type="submit" class="pill on" data-feedback="send">Send</button></div>`;
    player.append(this.sheet);
    this.sheet.setAttribute('aria-label', 'Recorded review card');
    this.status = $('#feedback-status', this.toolbar);
    this.wave = $('#feedback-wave', this.toolbar);
    this.toolbar.onclick = (event) => {
      const action = event.target.closest('[data-feedback]')?.dataset.feedback;
      if (!action) return;
      event.stopPropagation();
      this.command(action).catch((error) => this.fail(error));
    };
    this.sheet.onsubmit = (event) => {
      event.preventDefault();
      this.command('send').catch((error) => this.fail(error));
    };
    this.sheet.onclick = (event) => {
      const action = event.target.closest('[data-feedback]')?.dataset.feedback;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      this.command(action).catch((error) => this.fail(error));
    };
    this.sheet.oninput = (event) => {
      if (!this.review || !['draft', 'sent'].includes(this.review.phase) || this.destroyed) return;
      if (event.target.id === 'feedback-transcript') this.apply({ type: 'edit-transcript', text: event.target.value });
      else if (event.target.id === 'feedback-direction') this.apply({ type: 'edit-direction', text: event.target.value });
      else return;
      this.enqueueKeep().catch((error) => this.fail(error));
    };
    $('#feedback-instruction', this.toolbar).oninput = event => {
      this.ensureReview();
      if (['idle', 'recording', 'draft'].includes(this.review.phase)) {
        this.review.direction = event.target.value;
        this.review.error = null;
        this.enqueueKeep().catch(error => this.fail(error));
        this.render();
      }
    };
    this.ink.addEventListener('pointerdown', (event) => this.drawStart(event));
    this.ink.addEventListener('pointermove', (event) => this.drawMove(event));
    this.ink.addEventListener('pointerup', (event) => this.drawEnd(event));
    this.ink.addEventListener('pointercancel', (event) => this.drawEnd(event));
  }

  async toggle() {
    if (this.active) return this.exit(false);
    // Exit can still be finalizing the previous video's capture. Keep its take intact.
    if (this.finishing) await this.finishing;
    if (this.destroyed) return;
    this.active = true;
    this.viewer.enter();
    this.toolbar.hidden = false;
    this.ensureReview();
    this.render();
    return this.restore().catch((error) => this.fail(error));
  }

  archiveCard() {
    if (!this.movie || this.review?.phase !== 'sent') return;
    const card = document.createElement('article');
    card.className = 'review-history-card';
    card.dataset.reviewId = this.review.id;
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    const url = URL.createObjectURL(this.movie);
    this.cardUrls.push(url);
    video.src = url;
    const label = document.createElement('p');
    label.textContent = 'Sent review · ' + this.review.id;
    card.append(label, video);
    const record = { id: this.review.id, projectId: this.review.projectId, videoId: this.review.videoId, phase: 'sent', savedAt: Date.now(), review: this.payload(), movie: this.movie, mic: this.mic, frames: this.frames, micDurationMs: this.review.micDurationMs };
    for (const key of ['transcript', 'direction']) {
      const field = document.createElement('textarea');
      field.setAttribute('aria-label', key === 'transcript' ? 'Review transcript' : 'Review direction');
      field.value = this.review[key];
      field.oninput = () => {
        if (key === 'transcript') { record.review.transcript.text = field.value; record.review.transcript.status = 'edited'; }
        else record.review.direction = field.value;
        loadLocalReview(record.id).then(saved => saveLocalReview({ ...saved, ...record, plates: saved?.plates || [] })).catch(error => this.fail(error));
      };
      card.append(field);
    }
    if (this.editor.registerReviewCard) {
      this.editor.registerReviewCard({ id: this.review.id, node: card });
      $('#review-cards', this.viewer.shell).append(this.sheet);
    } else this.sheet.before(card);
  }

  freshId() {
    return 'review-' + crypto.randomUUID();
  }

  sameTake(epoch, id) {
    return !this.destroyed && this.epoch === epoch && this.review?.id === id;
  }

  ensureReview() {
    const key = JSON.stringify([this.editor.doc.id, this.editor.videoId]);
    const sameVideo = this.review?.projectId === this.editor.doc.id && this.review?.videoId === this.editor.videoId;
    if (sameVideo && this.review.phase !== 'sent') return this.review;
    this.drafts ||= new Map();
    if (this.review && this.review.phase !== 'sent') {
      if (['acquiring', 'recording', 'finalizing', 'sending'].includes(this.review.phase)) throw Error('Finish the current review before changing video');
      this.enqueueKeep().catch(error => this.fail(error));
      this.drafts.set(JSON.stringify([this.review.projectId, this.review.videoId]), {
        review: this.review, movie: this.movie, mic: this.mic, frames: this.frames,
        plates: this.plates, bridgeArtifacts: this.bridgeArtifacts,
      });
    } else this.archiveCard();
    this.epoch += 1;
    // clearMedia mutates the plate map; parked takes must keep their own map.
    this.plates = new Map();
    this.clearMedia();
    const kept = this.drafts.get(key);
    if (kept) {
      this.drafts.delete(key);
      Object.assign(this, kept);
      this.recallReplay();
    } else this.review = createReview(this.identity(this.freshId()));
    return this.review;
  }

  identity(id) {
    const doc = this.editor.doc;
    const valid = typeof id === 'string' && /^review-[0-9a-f-]{36}$/.test(id);
    return {
      id: valid ? id : this.freshId(),
      projectId: doc.id,
      videoId: this.editor.videoId,
      baseRevision: doc.revision,
      source: { proxy: doc.preview?.proxy || '', mediaId: doc.media[0]?.id || null },
      fps: { num: doc.fps.num, den: doc.fps.den },
    };
  }

  clearMedia() {
    this.movie = null;
    this.mic = null;
    this.frames = [];
    this.plates.clear();
    this.bridgeArtifacts = null;
    if (this.replayUrl) URL.revokeObjectURL(this.replayUrl);
    this.replayUrl = '';
    const replay = $('#feedback-replay');
    if (replay) {
      replay.removeAttribute('src');
      try { replay.load(); } catch { /* element is already gone */ }
    }
  }

  current() {
    return { projectId: this.editor.doc.id, videoId: this.editor.videoId, baseRevision: this.editor.doc.revision };
  }

  apply(event) {
    this.review = reduce(this.review, event);
    this.render();
    return this.review;
  }

  holdKey(down) {
    if (!this.active) return;
    if (down) {
      if (this.keyHeld) return;
      this.keyHeld = true;
      if (this.review?.phase === 'idle' || this.review?.phase === 'sent') this.startRecording('keyboard').catch((error) => this.fail(error));
      return;
    }
    if (!this.keyHeld) return;
    this.keyHeld = false;
    if (this.review?.hold === 'keyboard') this.stopRecording('keyboard');
  }

  async command(action) {
    if (action === 'live') return this.toggleLive();
    if (action === 'record') return this.toggleRecord();
    if (action === 'pencil') {
      this.ensureReview();
      this.pencil = !this.pencil;
      if (this.pencil) {
        this.previewProbe ||= new PreviewCapture(this.editor);
        this.sizeInk();
        this.watchInk();
      }
      this.render();
      return;
    }
    if (action === 'conversation') return this.viewer.conversation();
    if (action === 'fullscreen') return this.viewer.fullscreen();
    if (action === 'changes') {
      this.viewer.conversation(true);
      $('#review-changes').scrollIntoView({ block: 'start' });
      return;
    }
    if (action === 'undo-edit') return this.editor.action('undo');
    if (action === 'redo-edit') return this.editor.action('redo');
    if (action === 'save-edit') return this.editor.action('save');
    if (action === 'voice') return this.editor.action('voice');
    if (action === 'cancel') return this.discard(true);
    if (action === 'retry-transcript' && this.review?.phase === 'draft' && !this.finishing && !this.sending) {
      await this.transcribe();
      await this.enqueueKeep();
      return;
    }
    if (action === 'undo' || action === 'clear') {
      this.apply({ type: action === 'undo' ? 'undo-stroke' : 'clear-ink' });
      await this.queueFrames();
      if (this.movie && (this.review?.phase === 'draft' || this.review?.phase === 'sent')) await this.enqueueKeep();
      return;
    }
    if (action === 'discard') return this.discard();
    if (action === 'exit') return this.exit(false);
    if (action === 'download-movie' && this.movie) return downloadBlob(this.movie, this.review.id + '.webm');
    if (action === 'download-json') return downloadBlob(new Blob([JSON.stringify(this.payload(), null, 2)], { type: 'application/json' }), this.review.id + '.json');
    if (action === 'revalidate') {
      this.apply({ type: 'revalidate', current: this.current() });
      if (this.review.error) return;
      return this.send();
    }
    if (action === 'send') return this.send();
  }

  async toggleLive() {
    if (this.livePreparing) { this.livePreparing = false; this.liveGeneration++; this.liveDetail = ''; this.render(); return; }
    if (['connecting', 'live'].includes(this.live.state)) return this.live.stop();
    if (['acquiring', 'recording', 'finalizing'].includes(this.review?.phase)) throw Error('Stop the offline recording before starting live voice.');
    const generation = (this.liveGeneration || 0) + 1;
    this.liveGeneration = generation;
    this.livePreparing = true;
    this.liveDetail = 'Connecting Hermes…';
    this.liveScope = this.current();
    this.render();
    try {
      if (!this.editor.connectLiveAssistant) throw Error('A local Hermes bridge is required for live voice.');
      await this.editor.connectLiveAssistant();
      if (this.destroyed || !this.active || this.liveGeneration !== generation) return;
      this.livePreparing = false;
      await this.live.start();
    } catch (error) {
      if (this.liveGeneration === generation && !this.destroyed) {
        this.livePreparing = false;
        this.liveDetail = error.message;
        this.render();
      }
    }
  }

  async toggleRecord() {
    if (this.livePreparing || ['live', 'connecting'].includes(this.live?.state)) throw Error('Stop live voice before starting an offline recording.');
    if (this.review?.phase === 'acquiring' || this.review?.phase === 'recording' || this.review?.phase === 'finalizing') {
      return this.stopRecording(null);
    }
    await this.startRecording('pointer');
  }

  async startRecording(hold) {
    if (this.livePreparing || ['live', 'connecting'].includes(this.live?.state)) throw Error('Stop live voice before starting an offline recording.');
    this.ensureReview();
    if (this.review.phase !== 'idle') return;
    if (voiceMicBusy(this.editor.voice)) {
      this.status.textContent = 'Voice direction is using the microphone';
      this.editor.toast('Stop voice direction before feedback recording');
      return;
    }
    this.apply({ type: 'acquire', hold });
    const epoch = this.epoch;
    const id = this.review.id;
    this.capture?.destroy();
    const capture = new PreviewCapture(this.editor);
    this.capture = capture;
    capture.strokes = () => (this.review.openStroke ? [...this.review.strokes, this.review.openStroke] : this.review.strokes);
    capture.onLevel = (level) => { if (this.capture === capture) this.drawWave(level); };
    capture.onTick = (tick) => { if (this.capture === capture && !this.destroyed) this.onTick(tick); };
    capture.onAutoStop = () => { if (this.capture === capture && this.review?.phase === 'recording') this.stopRecording(this.review.hold); };
    this.abortArm = new AbortController();
    try {
      const started = await capture.arm(this.abortArm.signal);
      if (!this.sameTake(epoch, id) || this.review.phase !== 'acquiring' || this.review.hold !== hold) {
        capture.cancelPending();
        if (this.sameTake(epoch, id) && this.review.phase === 'acquiring') this.apply({ type: 'late-permission' });
        return;
      }
      this.apply({ type: 'record', ...started });
      this.prevFrame = Math.floor(this.editor.frame);
      this.ink.hidden = !this.active;
      this.sizeInk();
    } catch (error) {
      capture.cancelPending();
      if (!this.sameTake(epoch, id)) return;
      if (error.code === 'late-permission') this.apply({ type: 'late-permission' });
      else if (error.code === 'released') this.apply({ type: 'cancel-acquire' });
      else if (this.review.phase === 'acquiring') this.apply({ type: 'permission-denied', code: error.code || 'permission', message: error.message });
      else this.fail(error);
    }
  }

  stopRecording(hold) {
    if (!this.review) return;
    if (this.review.phase === 'acquiring') {
      this.abortArm?.abort();
      this.capture?.cancelPending();
      this.apply({ type: 'stop', hold });
      return;
    }
    const stopped = this.apply({ type: 'stop', hold });
    if (stopped.phase !== 'finalizing') return;
    return this.finish().catch((error) => this.fail(error));
  }

  async finish() {
    if (this.finishing) return this.finishing;
    const epoch = this.epoch;
    const id = this.review?.id;
    const capture = this.capture;
    this.finishing = (async () => {
      if (!capture) return;
      const media = await capture.finish();
      if (!this.sameTake(epoch, id)) return;
      this.movie = media.movie;
      this.mic = media.mic && media.mic.size ? media.mic : null;
      this.apply({ type: 'finalized', ...media, durationMs: Math.max(this.review.reviewTimeMs, media.durationMs), micDurationMs: media.durationMs });
      if (!this.sameTake(epoch, id)) return;
      await this.queueFrames();
      if (!this.sameTake(epoch, id)) return;
      await this.enqueueKeep();
      if (!this.sameTake(epoch, id)) return;
      this.recallReplay();
      await this.transcribe(epoch, id);
      if (!this.sameTake(epoch, id)) return;
      await this.enqueueKeep();
    })();
    const job = this.finishing;
    try { await job; } catch (error) {
      if (this.sameTake(epoch, id)) {
        this.review.phase = this.movie ? 'draft' : 'idle';
        this.review.error = { code: 'finalization', message: 'Could not finish recording: ' + error.message + (this.movie ? '. Recording kept; retry.' : '. Try recording again.') };
        capture?.destroy();
      }
      throw error;
    } finally {
      if (this.finishing === job) this.finishing = null;
      if (!this.destroyed) this.render();
    }
  }

  onTick(tick) {
    if (this.destroyed || this.review?.phase !== 'recording') return;
    this.liveView = tick.view;
    this.publishView();
    this.review = reduce(this.review, { type: 'clock', reviewTimeMs: tick.reviewTimeMs });
    this.review = reduce(this.review, { type: 'bytes', bytes: tick.bytes, micBytes: tick.micBytes });
    this.noteTransport(false);
    this.paintInk();
    this.maybeStartStroke();
    if (this.review.phase === 'finalizing') this.finish().catch((error) => this.fail(error));
    else this.render();
  }

  notePreview() {
    if (!this.active || !this.review) return;
    if (this.review.phase !== 'recording') {
      if (this.previewProbe && this.pencil) {
        this.liveView = this.previewProbe.sample();
        this.publishView();
        this.maybeStartStroke();
      }
      if (Math.floor(this.editor.frame) !== this.liveView.shownFrame || $('#preview-video')?.seeking) {
        this.ink.getContext('2d').clearRect(0, 0, this.ink.width, this.ink.height);
      } else this.paintInk();
      return;
    }
    this.liveView = this.capture?.sample() || this.liveView;
    this.publishView();
    this.noteTransport(true);
    this.paintInk();
    this.maybeStartStroke();
  }

  noteTransport(fromPreview) {
    const frame = Math.floor(this.editor.frame);
    const rate = this.editor.rate;
    let kind = rate > 0 ? 'play' : rate < 0 ? 'reverse' : 'pause';
    if (rate === 0 && this.prevFrame != null && frame !== this.prevFrame) kind = Math.abs(frame - this.prevFrame) === 1 ? 'step' : 'seek';
    this.prevFrame = frame;
    this.review = reduce(this.review, {
      type: 'transport',
      reviewTimeMs: this.review.reviewTimeMs,
      frame,
      rate,
      kind: fromPreview && kind === 'pause' ? 'hold' : kind,
      seekReady: this.liveView.seekReady,
      presented: this.liveView.presented,
      shownFrame: this.liveView.shownFrame,
      targetFrame: this.liveView.targetFrame,
    });
  }

  publishView() {
    const player = $('#canvas');
    if (!player) return;
    player.dataset.feedbackPresented = String(this.liveView.presented);
    player.dataset.feedbackSeekReady = String(this.liveView.seekReady);
    player.dataset.feedbackShown = this.liveView.shownFrame == null ? '' : String(this.liveView.shownFrame);
    player.dataset.feedbackTarget = this.liveView.targetFrame == null ? '' : String(this.liveView.targetFrame);
    const presented = this.liveView.presented === true && this.liveView.shownFrame === this.liveView.targetFrame;
    this.review.presentation = {
      targetFrame: this.liveView.targetFrame,
      shownFrame: this.liveView.shownFrame,
      seekReady: this.liveView.seekReady === true,
      presented,
    };
  }

  sizeInk() {
    const rect = $('#canvas').getBoundingClientRect();
    this.ink.width = Math.max(1, Math.round(rect.width));
    this.ink.height = Math.max(1, Math.round(rect.height));
  }

  paintInk() {
    if (!this.ink || this.ink.hidden) return;
    const ctx = this.ink.getContext('2d');
    ctx.clearRect(0, 0, this.ink.width, this.ink.height);
    const frame = this.liveView.presented ? this.liveView.shownFrame : null;
    ctx.strokeStyle = '#ff00c8';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const stroke of visibleStrokes(this.review, frame)) {
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * this.ink.width;
        const y = point.y * this.ink.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  point(event) {
    const rect = this.ink.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  drawStart(event) {
    if (!this.pencil || !['idle', 'recording', 'draft'].includes(this.review?.phase)) return;
    event.preventDefault();
    this.ink.setPointerCapture(event.pointerId);
    this.pointerId = event.pointerId;
    this.editor.rate = 0;
    this.editor.updatePreview(true);
    this.waitDraw = this.point(event);
    this.maybeStartStroke();
  }

  maybeStartStroke() {
    if (!this.waitDraw || !['idle', 'recording', 'draft'].includes(this.review?.phase) || this.review.openStroke) return;
    if (this.editor.rate !== 0 || !this.liveView.presented || !this.liveView.seekReady || this.liveView.shownFrame !== this.liveView.targetFrame) return;
    const point = this.waitDraw;
    this.waitDraw = null;
    this.apply({ type: 'stroke-begin', id: 'stroke-' + (++this.strokeSerial), x: point.x, y: point.y, reviewTimeMs: this.review.reviewTimeMs, rate: 0 });
    if (this.review.openStroke) this.notePlate(this.review.openStroke.anchorFrame);
    this.paintInk();
  }

  drawMove(event) {
    if (event.pointerId !== this.pointerId || !this.review?.openStroke) return;
    const point = this.point(event);
    this.apply({ type: 'stroke-point', ...point });
    this.paintInk();
  }

  drawEnd(event) {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.waitDraw = null;
    if (this.review?.openStroke) {
      const frame = this.review.openStroke.anchorFrame;
      this.apply({ type: 'stroke-end' });
      this.notePlate(frame);
      this.queueFrames().then(() => this.enqueueKeep()).catch(error => this.fail(error));
    }
    this.paintInk();
  }

  notePlate(frame) {
    const source = this.review?.phase === 'recording' ? this.capture : this.previewProbe;
    if (!Number.isInteger(frame) || !source || this.destroyed) return;
    const plate = source.presentedPlate(frame);
    if (plate) this.plates.set(frame, plate);
  }

  watchInk() {
    if (this.inkRaf) return;
    const tick = () => {
      this.inkRaf = 0;
      if (!this.active || !this.pencil || this.destroyed) return;
      this.notePreview();
      this.inkRaf = requestAnimationFrame(tick);
    };
    this.inkRaf = requestAnimationFrame(tick);
  }

  retainedAnchors() {
    const anchors = [];
    for (const stroke of this.review?.strokes || []) {
      if (!Number.isInteger(stroke.anchorFrame) || anchors.includes(stroke.anchorFrame)) continue;
      if (anchors.length >= LIMITS.maxAnnotatedFrames) break;
      anchors.push(stroke.anchorFrame);
    }
    return anchors;
  }

  queueFrames() {
    const epoch = this.epoch;
    const id = this.review?.id;
    const run = () => this.syncFrames(epoch, id);
    this.frameJob = (this.frameJob || Promise.resolve()).then(run, run);
    return this.frameJob;
  }

  async syncFrames(epoch, id) {
    try {
    if (!this.sameTake(epoch, id)) return;
    const anchors = this.retainedAnchors();
    for (const key of [...this.plates.keys()]) if (!anchors.includes(key)) this.plates.delete(key);
    this.frames = this.frames.filter((frame) => anchors.includes(frame.anchorFrame));
    for (const frame of anchors) {
      if (!this.sameTake(epoch, id)) return;
      const plate = this.plates.get(frame);
      if (!plate) {
        this.frames = this.frames.filter((item) => item.anchorFrame !== frame);
        continue;
      }
      const strokes = this.review.strokes.filter((stroke) => stroke.anchorFrame === frame);
      const signature = strokes.map((stroke) => `${stroke.id}:${stroke.points.length}`).join(',');
      const shot = await stillFromPlate(plate, strokes, frame);
      const current = (this.review?.strokes || []).filter((stroke) => stroke.anchorFrame === frame);
      const currentSignature = current.map((stroke) => `${stroke.id}:${stroke.points.length}`).join(',');
      if (!this.sameTake(epoch, id) || this.plates.get(frame) !== plate || !this.retainedAnchors().includes(frame) || currentSignature !== signature) continue;
      this.frames = this.frames.filter((item) => item.anchorFrame !== frame);
      if (shot?.anchorFrame === frame && shot.data) this.frames.push(shot);
    }
    const order = this.retainedAnchors();
    this.frames.sort((a, b) => order.indexOf(a.anchorFrame) - order.indexOf(b.anchorFrame));
    } catch {
      // Keep the recording if a still cannot be encoded. Send will not invent a frame label.
    }
  }

  drawWave(level) {
    const ctx = this.wave.getContext('2d');
    const { width, height } = this.wave;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#7fd49a';
    ctx.fillRect(0, height / 2 - level * height, width, Math.max(1, level * height * 2));
  }

  async transcribe(epoch = this.epoch, id = this.review?.id) {
    if (!this.sameTake(epoch, id)) return;
    let capabilities = {};
    if (this.mic && !isLocal()) {
      try {
        const response = await request('/reference/capabilities');
        if (response.ok) capabilities = await response.json();
      } catch { /* retained recording and typed fallback */ }
    }
    if (!this.sameTake(epoch, id)) return;
    const decision = transcriptPlan({
      micDurationMs: this.review.micDurationMs,
      micBytes: this.review.micBytes,
      backendAvailable: !!this.mic && (capabilities.reviewStt === true || capabilities.stt === true),
      reviewStt: capabilities.reviewStt === true,
      reviewMaxSeconds: capabilities.reviewMaxSeconds,
      reviewMaxBytes: capabilities.reviewMaxBytes,
    });
    if (!decision.send) {
      this.review = applyTranscriptResult(this.review, { unavailable: true, note: decision.note });
      this.render();
      return;
    }
    if (this.review.transcriptStatus === 'edited') return;
    this.transcriptAbort?.abort();
    this.transcriptAbort = new AbortController();
    this.review.transcriptStatus = 'pending';
    this.review.transcriptNote = 'Transcribing the complete take…';
    this.render();
    try {
      const response = await request(decision.endpoint || '/reference/transcribe', { method: 'POST', body: this.mic, signal: this.transcriptAbort.signal, headers: { 'Content-Type': 'application/octet-stream' } });
      const data = await response.json().catch(() => ({}));
      if (!this.sameTake(epoch, id)) return;
      if (!response.ok) throw Error(data.error || 'Transcription failed');
      this.review = applyTranscriptResult(this.review, { text: typeof data.text === 'string' ? data.text : '' });
    } catch (error) {
      if (!this.sameTake(epoch, id)) return;
      this.review = applyTranscriptResult(this.review, { unavailable: true, note: error.message + ' Recording kept. Type the direction.' });
    }
    if (this.sameTake(epoch, id)) this.render();
  }

  artifactBody(paths = this.bridgeArtifacts) {
    const anchors = this.retainedAnchors();
    return {
      movie: paths?.moviePath || null,
      mic: paths?.micPath || null,
      json: paths?.jsonPath || null,
      annotatedFrames: this.frames.filter((frame) => anchors.includes(frame.anchorFrame)).map((frame) => frame.anchorFrame),
      movieBytes: this.movie?.size || 0,
      micBytes: this.mic?.size || 0,
    };
  }

  payload() {
    return sidecar(this.review, this.artifactBody());
  }

  enqueueKeep() {
    // Queue the take at the time of the edit, not whichever video is open when IDB runs.
    const epoch = this.epoch;
    const id = this.review?.id;
    const writer = Object.assign(Object.create(this), {
      review: structuredClone(this.review), epoch, destroyed: false,
      movie: this.movie, mic: this.mic, frames: [...this.frames], plates: new Map(this.plates),
      bridgeArtifacts: this.bridgeArtifacts, frameJob: null,
    });
    const run = async () => {
      await writer.writeRecord();
      if (this.sameTake(epoch, id)) this.bridgeArtifacts = writer.bridgeArtifacts;
    };
    this.keepChain = (this.keepChain || Promise.resolve()).then(run, run);
    return this.keepChain;
  }

  async flushKeeps() {
    for (let guard = 0; guard < 8 && this.keepChain; guard++) {
      const pending = this.keepChain;
      await pending.catch(() => {});
      if (this.keepChain === pending) return;
    }
  }

  async plateRecords() {
    const anchors = this.retainedAnchors();
    const records = [];
    for (const [anchorFrame, plate] of this.plates) {
      if (!anchors.includes(anchorFrame)) continue;
      const blob = await new Promise((resolve) => plate.toBlob(resolve, 'image/png'));
      if (blob) records.push({ anchorFrame, blob });
    }
    return records;
  }

  async writeRecord() {
    if (this.review?.phase === 'idle' && !this.movie) {
      await this.queueFrames();
      const annotated = this.review.strokes.length > 0;
      const record = {
        id: this.review.id, projectId: this.review.projectId, videoId: this.review.videoId,
        savedAt: Date.now(), phase: 'idle', error: this.review.error,
        kind: annotated ? 'annotation' : 'text',
        review: this.payload(), movie: null, mic: null,
        frames: this.frames, plates: annotated ? await this.plateRecords() : [],
      };
      if (this.review.direction.trim() || annotated) await saveLocalReview(record);
      else {
        const saved = await loadLocalReview(record.id);
        if (!saved?.movie?.size) await deleteLocalReview(record.id);
      }
      return;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const epoch = this.epoch;
      const id = this.review?.id;
      if (!this.sameTake(epoch, id) || !this.movie) return;
      if (!['draft', 'sending', 'sent'].includes(this.review.phase)) return;
      await this.queueFrames();
      if (!this.sameTake(epoch, id) || !this.movie) return;
      const remote = !isLocal();
      const previous = this.bridgeArtifacts;
      const phase = this.review.phase;
      const error = this.review.error;
      const paths = remote ? {
        moviePath: `reviews/${id}.webm`,
        micPath: this.mic?.size ? `reviews/${id}.mic.webm` : null,
        jsonPath: `projects/${this.review.projectId}/reviews/${id}.json`,
      } : previous;
      const reviewJson = sidecar(this.review, {
        movie: paths?.moviePath || null,
        mic: paths?.micPath || null,
        json: paths?.jsonPath || null,
        annotatedFrames: this.frames.filter((frame) => this.retainedAnchors().includes(frame.anchorFrame)).map((frame) => frame.anchorFrame),
        movieBytes: this.movie.size,
        micBytes: this.mic?.size || 0,
      });
      const plates = await this.plateRecords();
      if (!this.sameTake(epoch, id) || !this.movie) return;
      if (this.review.phase !== phase || JSON.stringify(sidecar(this.review, reviewJson.artifacts)) !== JSON.stringify(reviewJson)) continue;
      const record = {
        id,
        projectId: this.review.projectId,
        videoId: this.review.videoId,
        savedAt: Date.now(),
        phase,
        error,
        micDurationMs: this.review.micDurationMs,
        review: reviewJson,
        movie: this.movie,
        mic: this.mic,
        frames: this.frames.filter((frame) => this.retainedAnchors().includes(frame.anchorFrame)).map((frame) => ({
          anchorFrame: frame.anchorFrame,
          mimeType: frame.mimeType,
          data: frame.data,
        })),
        plates,
      };
      try {
        await saveLocalReview(record);
      } catch (error) {
        if (this.sameTake(epoch, id)) this.status.textContent = 'Review kept in memory. Browser save failed: ' + error.message;
        return;
      }
      if (!remote || !this.sameTake(epoch, id)) return;
      try {
        const stored = await persistToBridge(request, record.projectId, id, record.movie, record.mic, JSON.stringify(reviewJson));
        if (!this.sameTake(epoch, id)) return;
        this.bridgeArtifacts = stored;
        if (JSON.stringify(sidecar(this.review, this.artifactBody())) !== JSON.stringify(reviewJson)) {
          this.bridgeArtifacts = previous;
          continue;
        }
        return;
      } catch (error) {
        this.bridgeArtifacts = previous;
        if (!this.sameTake(epoch, id) || !this.movie) return;
        record.review = sidecar(this.review, this.artifactBody());
        record.phase = this.review.phase;
        record.error = this.review.error;
        record.savedAt = Date.now();
        record.movie = this.movie;
        record.mic = this.mic;
        try { await saveLocalReview(record); } catch { /* the in-memory movie and mic stay */ }
        this.status.textContent = 'Saved in this browser. Bridge save failed: ' + error.message;
        return;
      }
    }
  }

  async restorePlates(records) {
    const plates = new Map();
    for (const item of records || []) {
      if (!item?.blob || !Number.isInteger(item.anchorFrame)) continue;
      try {
        const bitmap = await createImageBitmap(item.blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close?.();
        plates.set(item.anchorFrame, canvas);
      } catch { /* a missing plate drops that still on the next ink edit */ }
    }
    return plates;
  }

  async restore() {
    const epoch = this.epoch;
    const idle = this.review;
    const canRestore = () => this.sameTake(epoch, idle?.id) && this.review === idle
      && idle.phase === 'idle' && !idle.direction.trim();
    if (!canRestore()) return;
    const saved = await latestLocalReview(idle.projectId, idle.videoId);
    if (!canRestore() || !saved?.review || (!saved.movie && saved.phase !== 'idle')) return;
    const stored = saved.review;
    if (!stored.source || !stored.fps || stored.projectId !== saved.projectId || stored.videoId !== saved.videoId) return;
    let review;
    try {
      review = createReview({
        id: saved.id,
        projectId: stored.projectId,
        videoId: stored.videoId,
        baseRevision: stored.baseRevision,
        source: stored.source,
        fps: stored.fps,
      });
    } catch {
      return;
    }
    const anchors = [];
    for (const stroke of stored.strokes || []) {
      if (!Number.isInteger(stroke.anchorFrame) || anchors.includes(stroke.anchorFrame)) continue;
      if (anchors.length >= LIMITS.maxAnnotatedFrames) break;
      anchors.push(stroke.anchorFrame);
    }
    const frames = (saved.frames || [])
      .filter((frame) => anchors.includes(frame.anchorFrame) && typeof frame.data === 'string' && frame.data)
      .map((frame) => ({ type: 'image', mimeType: frame.mimeType || 'image/png', data: frame.data, anchorFrame: frame.anchorFrame }));
    const plates = await this.restorePlates(saved.plates);
    if (!canRestore()) return;
    review.phase = saved.movie ? (saved.phase === 'sent' ? 'sent' : 'draft') : 'idle';
    review.transport = stored.transport || [];
    review.strokes = stored.strokes || [];
    review.transcript = stored.transcript?.text || '';
    review.transcriptStatus = stored.transcript?.status || 'unavailable';
    review.transcriptNote = stored.transcript?.note || '';
    review.direction = stored.direction || '';
    review.mime = stored.mime || null;
    review.reviewTimeMs = stored.durationMs || 0;
    review.micDurationMs = Number.isFinite(saved.micDurationMs) ? saved.micDurationMs : (stored.durationMs || 0);
    review.bytes = stored.artifacts?.movieBytes || saved.movie?.size || 0;
    review.micBytes = stored.artifacts?.micBytes || saved.mic?.size || 0;
    review.captureFps = stored.captureFps || review.captureFps;
    review.reportedFrameRate = stored.reportedFrameRate ?? null;
    review.error = review.phase === 'sent' ? null : (saved.error || null);
    this.review = review;
    this.movie = saved.movie;
    this.mic = saved.mic || null;
    this.frames = frames;
    this.plates = plates;
    this.bridgeArtifacts = stored.artifacts?.movie ? {
      moviePath: stored.artifacts.movie,
      micPath: stored.artifacts.mic || null,
      jsonPath: stored.artifacts.json || null,
    } : null;
    this.recallReplay();
    this.render();
    if (review.phase === 'sent') this.editor.registerReviewCard?.({ id: review.id, node: this.sheet });
  }

  recallReplay() {
    if (this.replayUrl) URL.revokeObjectURL(this.replayUrl);
    this.replayUrl = this.movie ? URL.createObjectURL(this.movie) : '';
    const replay = $('#feedback-replay');
    if (replay) replay.src = this.replayUrl;
  }

  async send() {
    if (this.sending || !this.review || this.destroyed) return;
    const epoch = this.epoch;
    const id = this.review.id;
    this.sending = true;
    this.render();
    try {
      if (this.review.phase === 'recording') await this.stopRecording(null);
      else if (this.finishing) await this.finishing;
      if (!this.sameTake(epoch, id)) return;
      if (this.review.phase === 'idle' && this.review.direction.trim()) {
        const direction = this.review.direction.trim();
        await this.queueFrames();
        const frames = this.frames.map(frame => ({ type: 'image', mimeType: frame.mimeType, data: frame.data }));
        const text = frames.length ? reviewPrompt(this.review, this.artifactBody()) : direction;
        const result = await this.editor.submitAssistant?.({ text, blocks: frames, summary: direction, saveProject: false });
        if (!this.sameTake(epoch, id)) return;
        if (!result?.ok) {
          this.review.error = { code: result?.reason || 'no-agent', message: result?.message || 'Connect an available Assistant in Conversation and retry. Your direction is kept.' };
        } else {
          this.review.direction = '';
          this.review.strokes = [];
          this.review.openStroke = null;
          this.frames = [];
          this.plates.clear();
          $('#feedback-instruction', this.toolbar).value = '';
          await this.enqueueKeep();
          this.paintInk();
        }
        return;
      }
      if (this.review.phase !== 'draft') return;
      if (!this.review.transcript.trim() && !this.review.direction.trim()) {
        this.review.error = { code: 'understanding-required', message: this.review.transcriptNote || 'No usable transcript. Recording kept. Type a direction or retry transcription in Conversation.' };
        await this.enqueueKeep();
        return;
      }
      await this.queueFrames();
      await this.enqueueKeep();
      await this.flushKeeps();
      if (!this.sameTake(epoch, id) || this.review.phase !== 'draft') return;
      this.apply({ type: 'send', current: this.current() });
      if (!this.sameTake(epoch, id) || this.review.phase !== 'sending') return;
      if (typeof this.editor.submitAssistant !== 'function') {
        this.apply({ type: 'send-failed', code: 'no-agent', message: 'Assistant send is unavailable. The review is still here.' });
        await this.enqueueKeep();
        return;
      }
      const anchors = this.retainedAnchors();
      const frames = anchors.map((frame) => this.frames.find((item) => item.anchorFrame === frame && item.data)).filter(Boolean);
      const blocks = frames.map((frame) => ({ type: 'image', mimeType: frame.mimeType || 'image/png', data: frame.data }));
      const text = reviewPrompt(this.review, this.payload().artifacts);
      const summary = 'Recorded review ' + this.review.id + '\n' + [this.review.transcript.trim(), this.review.direction.trim()].filter(Boolean).join('\n');
      this.editor.registerReviewCard?.({ id: this.review.id, node: this.sheet });
      const result = await this.editor.submitAssistant({ text, blocks, saveProject: false, summary, reviewId: this.review.id });
      if (!this.sameTake(epoch, id) || this.review.phase !== 'sending') return;
      if (!result?.ok) {
        const reason = result?.reason || 'error';
        this.apply({ type: 'send-failed', code: reason, message: reason === 'busy' ? 'Assistant is busy. The review is still here.' : reason === 'no-agent' ? 'Pick an agent first. The review is still here.' : (result?.message || 'Send failed. The review is still here.') });
        await this.enqueueKeep();
        return;
      }
      this.apply({ type: 'sent' });
      await this.enqueueKeep();
    } catch (error) {
      if (this.sameTake(epoch, id) && this.review?.phase === 'sending') {
        this.apply({ type: 'send-failed', code: 'error', message: error.message });
        await this.enqueueKeep();
      }
    } finally {
      this.sending = false;
      if (!this.destroyed) this.render();
    }
  }

  discard(immediate = false) {
    if (!this.review || ['idle', 'sent'].includes(this.review.phase) || this.destroyed || this.sending) return;
    if (!immediate && !confirm('Discard this recorded review?')) return;
    const id = this.review.id;
    const pending = this.keepChain;
    this.epoch += 1;
    this.sending = false;
    this.abortArm?.abort();
    this.transcriptAbort?.abort();
    this.capture?.destroy();
    this.capture = null;
    this.finishing = null;
    this.clearMedia();
    this.review = reduce(this.review, { type: 'discard', id: this.freshId(), baseRevision: this.editor.doc.revision });
    Promise.resolve(pending).finally(() => { deleteLocalReview(id).catch(() => {}); });
    this.sheet.hidden = true;
    this.ink.hidden = true;
    this.render();
  }

  exit(keepRecording) {
    this.liveGeneration = (this.liveGeneration || 0) + 1;
    this.livePreparing = false;
    this.live?.stop().catch(error => this.fail(error));
    if (!keepRecording && (this.review?.phase === 'recording' || this.review?.phase === 'acquiring')) this.stopRecording(this.review.hold);
    if (this.review?.phase === 'idle') this.enqueueKeep().catch(error => this.fail(error));
    this.active = false;
    this.viewer.exit();
    this.toolbar.hidden = true;
    this.sheet.hidden = true;
    this.ink.hidden = true;
    const player = $('#canvas');
    if (player) {
      delete player.dataset.feedbackPresented;
      delete player.dataset.feedbackSeekReady;
      delete player.dataset.feedbackShown;
      delete player.dataset.feedbackTarget;
    }
  }

  async shutdown(persist) {
    this.abortArm?.abort();
    if (persist && this.review?.phase === 'recording') {
      this.apply({ type: 'stop', hold: this.review.hold });
      try { await this.finish(); } catch { /* local blob is retained when finish stored it */ }
    }
    this.capture?.destroy();
  }

  render() {
    if (!this.review) return;
    const phase = this.review.phase;
    this.toolbar.dataset.phase = phase;
    this.toolbar.hidden = !this.active;
    this.ink.hidden = !this.active || !['idle', 'recording', 'draft'].includes(phase);
    this.ink.style.pointerEvents = this.pencil && !this.sending && ['idle', 'recording', 'draft'].includes(phase) ? 'auto' : 'none';
    const recording = phase === 'recording' || phase === 'acquiring';
    const busy = this.sending || !!this.finishing || phase === 'finalizing' || phase === 'sending';
    $('#review-menu [data-feedback="discard"]', this.viewer.shell).disabled = this.sending || phase === 'sent';
    $('#review-menu [data-feedback="voice"]', this.viewer.shell).disabled = recording || busy;
    const record = this.toolbar.querySelector('[data-feedback="record"]');
    record.hidden = !recording && phase !== 'finalizing';
    record.textContent = recording ? '■' : '●';
    record.setAttribute('aria-label', recording ? 'Stop recording' : 'Record feedback');
    record.classList.toggle('on', recording);
    record.disabled = busy || phase === 'draft';
    const live = this.toolbar.querySelector('[data-feedback="live"]');
    if (live) {
      const active = this.livePreparing || ['connecting', 'live'].includes(this.live?.state);
      live.hidden = recording || phase === 'finalizing';
      live.setAttribute('aria-label', active ? 'Stop GPT live voice' : 'Start GPT live voice');
      live.setAttribute('aria-pressed', String(active));
      live.classList.toggle('on', active);
      live.disabled = this.sending;
    }
    this.toolbar.querySelector('[data-feedback="cancel"]').hidden = !recording;
    this.toolbar.querySelector('[data-feedback="undo"]').hidden = !['idle', 'recording', 'draft'].includes(phase) || (!this.review.strokes.length && !this.review.openStroke);
    this.toolbar.querySelector('[data-feedback="pencil"]').setAttribute('aria-pressed', String(this.pencil));
    const instruction = $('#feedback-instruction', this.toolbar);
    instruction.hidden = recording || phase === 'finalizing';
    instruction.disabled = busy;
    if (document.activeElement !== instruction) instruction.value = phase === 'sent' ? '' : this.review.direction;
    this.wave.hidden = !recording;
    const send = this.toolbar.querySelector('[data-feedback="send"]');
    send.hidden = phase === 'sent' || (!recording && !['draft', 'sending', 'finalizing'].includes(phase) && !this.review.direction.trim());
    send.disabled = busy || phase === 'acquiring';
    send.textContent = busy ? 'Sending…' : this.review.error && phase === 'draft' ? 'Retry' : 'Send';
    const seconds = Math.floor(this.review.reviewTimeMs / 1000);
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    this.status.textContent = this.review.error?.message || (recording ? clock : this.finishing ? 'Preparing transcript…' : phase === 'draft' ? 'Draft kept' : phase === 'sent' ? 'Sent · continue reviewing' : '');
    if (this.liveDetail) this.status.textContent = this.liveDetail;
    this.status.hidden = !this.status.textContent;
    this.sheet.dataset.phase = phase;
    this.sheet.dataset.reviewId = this.review.id;
    const showSheet = this.active && (phase === 'draft' || phase === 'sending' || phase === 'sent');
    this.sheet.hidden = !showSheet;
    if (showSheet) {
      const description = $('#feedback-review-text', this.sheet);
      if (description) description.textContent = [this.review.transcript.trim(), this.review.direction.trim()].filter(Boolean).join('\n') || this.review.transcriptNote || 'Recorded review';
      const transcript = $('#feedback-transcript');
      const direction = $('#feedback-direction');
      transcript.disabled = this.sending;
      direction.disabled = this.sending;
      if (document.activeElement !== transcript) transcript.value = this.review.transcript;
      if (document.activeElement !== direction) direction.value = this.review.direction;
      $('#feedback-transcript-note').textContent = this.review.transcriptNote || this.review.transcriptStatus;
      const stale = this.review.error?.code === 'stale' && /revision/i.test(this.review.error.message);
      this.sheet.querySelector('[data-feedback="revalidate"]').hidden = !stale;
      this.sheet.querySelector('[data-feedback="send"]').disabled = phase === 'sending' || this.sending || !!this.finishing;
      this.sheet.querySelector('[data-feedback="send"]').hidden = phase === 'sent';
      this.sheet.querySelector('[data-feedback="retry-transcript"]').disabled = this.sending || !!this.finishing;
      this.sheet.querySelector('[data-feedback="retry-transcript"]').hidden = this.review.transcriptStatus !== 'unavailable';
    }
  }

  fail(error) {
    if (this.destroyed || this.editor.dead) return;
    this.status.textContent = error.message;
    this.editor.toast(error.message);
  }

  destroy() {
    this.destroyed = true;
    this.liveGeneration = (this.liveGeneration || 0) + 1;
    this.livePreparing = false;
    this.live?.stop().catch(() => {});
    this.epoch += 1;
    removeEventListener('blur', this.onBlur);
    removeEventListener('pagehide', this.onPageHide);
    this.viewer.destroy();
    for (const url of this.cardUrls) URL.revokeObjectURL(url);
    this.abortArm?.abort();
    this.transcriptAbort?.abort();
    this.capture?.destroy();
    this.capture = null;
    this.previewProbe?.destroy();
    cancelAnimationFrame(this.inkRaf);
    if (this.replayUrl) URL.revokeObjectURL(this.replayUrl);
    this.replayUrl = '';
    this.toolbar?.remove();
    this.sheet?.remove();
    this.ink?.remove();
    this.active = false;
  }
}


