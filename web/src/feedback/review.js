// Explicit review lifecycle. Review time and editorial time stay separate.
// Speech text is take-level only. This module does not touch the DOM, media, or network.

export const SCHEMA = 'fframestudio.review/1';

export const LIMITS = {
  maxDurationMs: 120_000,
  maxReviewBytes: 48 * 1024 * 1024,
  maxMicBytes: 3_500_000,
  transcribeWindowMs: 30_000,
  captureFps: 12,
  maxStrokes: 400,
  maxPointsPerStroke: 2_000,
  maxTransport: 4_000,
  maxAnnotatedFrames: 4,
};

export const PHASES = ['idle', 'acquiring', 'recording', 'finalizing', 'draft', 'sending', 'sent'];

const HOLDS = new Set(['pointer', 'keyboard']);
const TRANSCRIPT = new Set(['empty', 'pending', 'ready', 'unavailable', 'edited']);

const TRANSCRIPT_LONG = 'Local transcription decodes at most 30 seconds and returns untimed text. This take is longer, so the automatic transcript is unavailable. The recording is kept. Type the direction.';
const TRANSCRIPT_SIZE = 'Local transcription accepts at most 3.5 MB of microphone audio. This take is larger than that size limit, so the automatic transcript is unavailable. The recording is kept. Type the direction.';
const TRANSCRIPT_BOTH = 'Local transcription decodes at most 30 seconds and at most 3.5 MB of microphone audio. This take exceeds those limits, so the automatic transcript is unavailable. The recording is kept. Type the direction.';
const TRANSCRIPT_UNAVAILABLE = 'Local transcription is unavailable. The recording is kept. Type the direction.';
const TRANSCRIPT_TAKE = 'Untimed take-level transcript. It is not aligned to words or frames.';

const clone = (value) => structuredClone(value);

const round = (n) => Math.round(n * 10000) / 10000;

export function normalizePoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: round(Math.min(1, Math.max(0, x))), y: round(Math.min(1, Math.max(0, y))) };
}

function assertIdentity(identity) {
  if (!identity || typeof identity.id !== 'string' || !/^review-[0-9a-f-]{36}$/.test(identity.id)) throw Error('Invalid review id');
  if (!/^[\w.-]{1,128}$/.test(identity.projectId || '')) throw Error('Invalid project id');
  if (typeof identity.videoId !== 'string' || !identity.videoId) throw Error('Invalid video id');
  if (!Number.isInteger(identity.baseRevision) || identity.baseRevision < 0) throw Error('Invalid base revision');
  const fps = identity.fps;
  if (!fps || !Number.isInteger(fps.num) || !Number.isInteger(fps.den) || fps.num <= 0 || fps.den <= 0) throw Error('Invalid frame rate');
  const source = identity.source || {};
  if (source.proxy != null && typeof source.proxy !== 'string') throw Error('Invalid source proxy');
  if (source.mediaId != null && typeof source.mediaId !== 'string') throw Error('Invalid source media');
}

export function createReview(identity) {
  assertIdentity(identity);
  return {
    schema: SCHEMA,
    id: identity.id,
    projectId: identity.projectId,
    videoId: identity.videoId,
    baseRevision: identity.baseRevision,
    source: { proxy: identity.source?.proxy || '', mediaId: identity.source?.mediaId || null },
    fps: { num: identity.fps.num, den: identity.fps.den },
    phase: 'idle',
    hold: null,
    reviewTimeMs: 0,
    transport: [],
    strokes: [],
    openStroke: null,
    presentation: { targetFrame: null, shownFrame: null, seekReady: false, presented: false },
    transcript: '',
    transcriptStatus: 'empty',
    transcriptNote: '',
    direction: '',
    mime: null,
    bytes: 0,
    micBytes: 0,
    micDurationMs: 0,
    captureFps: LIMITS.captureFps,
    reportedFrameRate: null,
    error: null,
  };
}

function fail(review, code, message, phase = review.phase) {
  review.error = { code, message };
  review.phase = phase;
  return review;
}

function sameSample(last, entry) {
  return last && last.frame === entry.frame && last.kind === entry.kind && last.rate === entry.rate
    && last.seekReady === entry.seekReady && last.presented === entry.presented
    && last.shownFrame === entry.shownFrame && last.targetFrame === entry.targetFrame
    && entry.reviewTimeMs - last.reviewTimeMs < 200;
}

export function visibleStrokes(review, shownFrame) {
  if (shownFrame == null) return [];
  const open = review.openStroke ? [review.openStroke] : [];
  return [...review.strokes, ...open].filter((stroke) => stroke.anchorFrame === shownFrame);
}

export function acceptanceError(review, current) {
  if (!current || current.projectId !== review.projectId) return 'Review is for a different project';
  if (current.videoId !== review.videoId) return 'Review is for a different video';
  if (current.baseRevision !== review.baseRevision) return 'Project revision changed. Revalidate the review before sending.';
  return null;
}

// Mic audio only. A take longer than the bridge window, or larger than its body cap, is not sent.
// ffmpeg -t 30 would drop the tail and the response would still look like a finished {text}.
export function transcriptPlan({ micDurationMs, micBytes, backendAvailable, reviewStt = false, reviewMaxSeconds = 120, reviewMaxBytes = 4_000_000 }) {
  if (reviewStt) {
    const maxMs = Math.min(120, Number.isFinite(reviewMaxSeconds) ? reviewMaxSeconds : 120) * 1000;
    const maxBytes = Math.min(4_000_000, Number.isFinite(reviewMaxBytes) ? reviewMaxBytes : 4_000_000);
    if (micDurationMs > maxMs || micBytes > maxBytes) return { send: false, status: 'unavailable', note: 'Recording exceeds the full-review transcription limit. Recording kept. Type your direction.' };
    if (!backendAvailable) return { send: false, status: 'unavailable', note: TRANSCRIPT_UNAVAILABLE };
    return { send: true, status: 'pending', note: '', endpoint: '/reference/review-transcribe' };
  }
  const tooLong = micDurationMs > LIMITS.transcribeWindowMs;
  const tooBig = micBytes > LIMITS.maxMicBytes;
  if (tooLong && tooBig) return { send: false, status: 'unavailable', note: TRANSCRIPT_BOTH };
  if (tooLong) return { send: false, status: 'unavailable', note: TRANSCRIPT_LONG };
  if (tooBig) return { send: false, status: 'unavailable', note: TRANSCRIPT_SIZE };
  if (!backendAvailable) return { send: false, status: 'unavailable', note: TRANSCRIPT_UNAVAILABLE };
  return { send: true, status: 'pending', note: '' };
}

export function applyTranscriptResult(review, result) {
  const next = clone(review);
  if (next.phase !== 'draft' && next.phase !== 'finalizing') return next;
  // A reviewer correction is the text that will be sent. A late automatic result must not replace it.
  if (next.transcriptStatus === 'edited') return next;
  if (!result || result.unavailable) {
    next.transcriptStatus = 'unavailable';
    next.transcriptNote = result?.note || TRANSCRIPT_UNAVAILABLE;
    next.phase = 'draft';
    return next;
  }
  next.transcript = typeof result.text === 'string' ? result.text : '';
  next.transcriptStatus = 'ready';
  next.transcriptNote = TRANSCRIPT_TAKE;
  next.phase = 'draft';
  return next;
}

export function reduce(review, event) {
  const next = clone(review);
  switch (event?.type) {
    case 'acquire': {
      if (next.phase !== 'idle') return fail(next, 'phase', 'Finish or discard the current review first');
      if (!HOLDS.has(event.hold)) return fail(next, 'hold', 'Recording needs a pointer or keyboard hold');
      next.phase = 'acquiring';
      next.hold = event.hold;
      next.error = null;
      return next;
    }
    case 'permission-denied': {
      if (next.phase !== 'acquiring') return next;
      next.phase = 'idle';
      next.hold = null;
      next.error = { code: event.code || 'permission', message: event.message || 'Microphone permission was not granted' };
      return next;
    }
    case 'late-permission': {
      next.phase = 'idle';
      next.hold = null;
      next.error = { code: 'late-permission', message: 'Microphone permission arrived after recording was released' };
      return next;
    }
    case 'cancel-acquire': {
      if (next.phase !== 'acquiring') return next;
      next.phase = 'idle';
      next.hold = null;
      next.error = { code: 'released', message: 'Released before the microphone was ready' };
      return next;
    }
    case 'record': {
      if (next.phase !== 'acquiring') return fail(next, 'phase', 'Not waiting for the microphone');
      if (!event.mime) return fail(next, 'unsupported', 'This browser cannot record the preview', 'idle');
      next.phase = 'recording';
      next.mime = event.mime;
      next.captureFps = event.captureFps || LIMITS.captureFps;
      next.reportedFrameRate = event.reportedFrameRate ?? null;
      next.reviewTimeMs = 0;
      next.error = null;
      return next;
    }
    case 'clock': {
      if (next.phase !== 'recording') return next;
      if (!Number.isFinite(event.reviewTimeMs) || event.reviewTimeMs < next.reviewTimeMs) return next;
      next.reviewTimeMs = event.reviewTimeMs;
      if (next.reviewTimeMs >= LIMITS.maxDurationMs) {
        next.phase = 'finalizing';
        next.error = { code: 'duration-cap', message: 'Recording stopped at 2 minutes' };
      }
      return next;
    }
    case 'bytes': {
      if (next.phase !== 'recording' && next.phase !== 'finalizing') return next;
      if (Number.isFinite(event.bytes)) next.bytes = event.bytes;
      if (Number.isFinite(event.micBytes)) next.micBytes = event.micBytes;
      if (next.bytes > LIMITS.maxReviewBytes || next.micBytes > LIMITS.maxMicBytes) {
        next.phase = 'finalizing';
        next.error = { code: 'size-cap', message: 'Recording stopped at the size cap' };
      }
      return next;
    }
    case 'presentation': {
      next.presentation = {
        targetFrame: Number.isInteger(event.targetFrame) ? event.targetFrame : null,
        shownFrame: Number.isInteger(event.shownFrame) ? event.shownFrame : null,
        seekReady: event.seekReady === true,
        presented: event.presented === true,
      };
      if (next.presentation.presented && next.presentation.shownFrame !== next.presentation.targetFrame) {
        next.presentation.presented = false;
      }
      return next;
    }
    case 'transport': {
      if (next.phase !== 'recording') return next;
      const entry = {
        reviewTimeMs: event.reviewTimeMs,
        frame: event.frame,
        rate: event.rate,
        kind: event.kind,
        seekReady: event.seekReady === true,
        presented: event.presented === true,
        shownFrame: Number.isInteger(event.shownFrame) ? event.shownFrame : null,
        targetFrame: Number.isInteger(event.targetFrame) ? event.targetFrame : event.frame,
      };
      if (sameSample(next.transport.at(-1), entry)) return next;
      next.transport.push(entry);
      if (next.transport.length > LIMITS.maxTransport) next.transport.splice(0, next.transport.length - LIMITS.maxTransport);
      return next;
    }
    case 'stroke-begin': {
      if (!['idle', 'recording', 'draft'].includes(next.phase)) return fail(next, 'phase', 'Wait until the review is ready before drawing');
      if (next.openStroke) return next;
      if (event.rate !== 0) return fail(next, 'not-paused', 'Pause before drawing');
      if (!next.presentation.presented || !next.presentation.seekReady || next.presentation.shownFrame !== next.presentation.targetFrame) {
        return fail(next, 'not-presented', 'Wait until the target frame is the frame on screen');
      }
      const point = normalizePoint(event.x, event.y);
      if (!point) return next;
      if (next.strokes.length >= LIMITS.maxStrokes) return fail(next, 'ink-cap', 'Too many strokes');
      next.openStroke = { id: event.id, anchorFrame: next.presentation.shownFrame, reviewTimeMs: event.reviewTimeMs, points: [point] };
      next.error = null;
      return next;
    }
    case 'stroke-point': {
      if (!next.openStroke || next.openStroke.points.length >= LIMITS.maxPointsPerStroke) return next;
      const point = normalizePoint(event.x, event.y);
      if (!point) return next;
      const last = next.openStroke.points.at(-1);
      if (last && last.x === point.x && last.y === point.y) return next;
      next.openStroke.points.push(point);
      return next;
    }
    case 'stroke-end': {
      if (!next.openStroke) return next;
      next.strokes.push(next.openStroke);
      next.openStroke = null;
      return next;
    }
    case 'undo-stroke': {
      if (next.openStroke) next.openStroke = null;
      else next.strokes.pop();
      return next;
    }
    case 'clear-ink': {
      next.strokes = [];
      next.openStroke = null;
      return next;
    }
    case 'stop': {
      if (event.hold && next.hold && event.hold !== next.hold) return next;
      if (next.phase === 'acquiring') return reduce(next, { type: 'cancel-acquire' });
      if (next.phase !== 'recording' && next.phase !== 'finalizing') return next;
      if (next.openStroke) {
        next.strokes.push(next.openStroke);
        next.openStroke = null;
      }
      next.phase = 'finalizing';
      next.hold = null;
      return next;
    }
    case 'finalized': {
      if (next.phase !== 'finalizing' && next.phase !== 'recording') return fail(next, 'phase', 'Not finalizing');
      next.phase = 'draft';
      next.hold = null;
      next.bytes = event.bytes ?? next.bytes;
      next.micBytes = event.micBytes ?? next.micBytes;
      next.micDurationMs = event.micDurationMs ?? next.reviewTimeMs;
      next.mime = event.mime || next.mime;
      next.reviewTimeMs = event.durationMs ?? next.reviewTimeMs;
      const plan = transcriptPlan({ micDurationMs: next.micDurationMs, micBytes: next.micBytes, backendAvailable: false });
      const blocked = next.micDurationMs > LIMITS.transcribeWindowMs || next.micBytes > LIMITS.maxMicBytes;
      if (!plan.send && blocked) {
        next.transcriptStatus = 'unavailable';
        next.transcriptNote = plan.note;
      } else if (next.transcriptStatus === 'empty') {
        next.transcriptStatus = 'pending';
      }
      if (!TRANSCRIPT.has(next.transcriptStatus)) next.transcriptStatus = 'pending';
      return next;
    }
    case 'edit-transcript': {
      if (next.phase !== 'draft' && next.phase !== 'sent') return next;
      next.phase = 'draft';
      next.transcript = String(event.text ?? '');
      next.transcriptStatus = 'edited';
      return next;
    }
    case 'edit-direction': {
      if (next.phase !== 'draft' && next.phase !== 'sent') return next;
      next.phase = 'draft';
      next.direction = String(event.text ?? '');
      return next;
    }
    case 'revalidate': {
      if (next.phase !== 'draft') return next;
      if (!event.current || event.current.projectId !== next.projectId || event.current.videoId !== next.videoId) {
        return fail(next, 'stale', 'Review is for a different project or video');
      }
      if (!Number.isInteger(event.current.baseRevision) || event.current.baseRevision < 0) return fail(next, 'stale', 'Current revision is invalid');
      next.baseRevision = event.current.baseRevision;
      next.error = null;
      return next;
    }
    case 'send': {
      if (next.phase === 'sending') return fail(next, 'duplicate', 'Send already in progress');
      if (next.phase !== 'draft') return fail(next, 'phase', 'Stop the review before sending');
      const stale = acceptanceError(next, event.current);
      if (stale) return fail(next, 'stale', stale);
      next.phase = 'sending';
      next.error = null;
      return next;
    }
    case 'send-failed': {
      if (next.phase !== 'sending') return next;
      next.phase = 'draft';
      next.error = { code: event.code || 'send-failed', message: event.message || 'Send failed. The review is still here.' };
      return next;
    }
    case 'sent': {
      if (next.phase !== 'sending') return next;
      next.phase = 'sent';
      next.error = null;
      return next;
    }
    case 'discard': {
      return createReview({
        id: event.id || next.id,
        projectId: next.projectId,
        videoId: next.videoId,
        baseRevision: event.baseRevision ?? next.baseRevision,
        source: next.source,
        fps: next.fps,
      });
    }
    default:
      return fail(next, 'unknown', 'Unknown review event');
  }
}

export function sidecar(review, artifacts = {}) {
  return {
    schema: review.schema,
    id: review.id,
    projectId: review.projectId,
    videoId: review.videoId,
    baseRevision: review.baseRevision,
    source: review.source,
    fps: review.fps,
    durationMs: review.reviewTimeMs,
    mime: review.mime,
    captureFps: review.captureFps,
    reportedFrameRate: review.reportedFrameRate,
    transcript: {
      text: review.transcript,
      status: review.transcriptStatus,
      note: review.transcriptNote,
      alignment: 'take',
    },
    direction: review.direction,
    transport: review.transport,
    strokes: review.strokes.map((stroke) => ({
      id: stroke.id,
      anchorFrame: stroke.anchorFrame,
      reviewTimeMs: stroke.reviewTimeMs,
      points: stroke.points,
    })),
    artifacts,
  };
}

export function reviewPrompt(review, artifacts = {}) {
  const body = sidecar(review, artifacts);
  return [
    'Recorded editorial review.',
    'Do not apply edits. Write only a proposal. The user will Inspect, Apply, or Reject.',
    'The transcript alignment is take. Do not invent word times or per-frame speech.',
    'A file path does not mean you watched the movie. Use the sidecar transport, stroke frames, and attached stills.',
    'Spoken instructions: ' + (review.transcript.trim() || '(No usable transcript; use the typed direction.)'),
    'Typed direction: ' + (review.direction.trim() || '(none)'),
    'Sidecar follows.',
    JSON.stringify(body),
  ].join('\n');
}

export function captureSupported(probe) {
  if (!probe || probe.mediaRecorder !== true || probe.captureStream !== true) return { ok: false, mime: null, reason: 'unsupported' };
  const mime = (probe.candidates || []).find((type) => probe.supported?.(type));
  if (!mime) return { ok: false, mime: null, reason: 'unsupported' };
  if (probe.reportedFrameRate === 0) return { ok: false, mime: null, reason: 'unsupported' };
  return { ok: true, mime, reason: null };
}

export function voiceMicBusy(voice) {
  if (!voice) return false;
  if (voice.listening || voice.starting) return true;
  const tracks = voice.stream?.getAudioTracks?.() || [];
  return tracks.some((track) => track.readyState === 'live');
}
