import test from 'node:test';
import assert from 'node:assert/strict';
import { action } from '../../web/src/actions.js';
import { FeedbackDesk } from '../../web/src/feedback/desk.js';
import { saveLocalReview, loadLocalReview, latestLocalReview } from '../../web/src/feedback/persist.js';
import {
  LIMITS, createReview, reduce, visibleStrokes, acceptanceError, transcriptPlan, applyTranscriptResult,
  sidecar, reviewPrompt, captureSupported, voiceMicBusy,
} from '../../web/src/feedback/review.js';

const identity = (over = {}) => ({
  id: 'review-11111111-1111-4111-8111-111111111111',
  projectId: 'demo',
  videoId: 'main',
  baseRevision: 3,
  source: { proxy: 'proxy/demo.mp4', mediaId: 'demo:media:1' },
  fps: { num: 30, den: 1 },
  ...over,
});
const presented = { targetFrame: 12, shownFrame: 12, seekReady: true, presented: true };

test('drawing does not require a microphone or a recording', () => {
  for (const phase of ['idle', 'draft']) {
    let review = { ...createReview(identity()), phase };
    review = reduce(review, { type: 'presentation', ...presented });
    review = reduce(review, { type: 'stroke-begin', id: 'without-mic', x: 0.2, y: 0.4, reviewTimeMs: 0, rate: 0 });
    assert.ok(review.openStroke, 'pencil silently refused ' + phase);
    review = reduce(review, { type: 'stroke-point', x: 0.7, y: 0.6 });
    review = reduce(review, { type: 'stroke-end' });
    assert.equal(review.phase, phase);
    assert.equal(visibleStrokes(review, 12).length, 1);
  }
});

test('one review walks the explicit lifecycle and keeps both clocks', () => {
  let review = createReview(identity());
  assert.equal(review.phase, 'idle');
  review = reduce(review, { type: 'acquire', hold: 'keyboard' });
  review = reduce(review, { type: 'record', mime: 'video/webm;codecs=vp8,opus', captureFps: 12, reportedFrameRate: 12 });
  review = reduce(review, { type: 'clock', reviewTimeMs: 40 });
  review = reduce(review, { type: 'clock', reviewTimeMs: 10 });
  assert.equal(review.reviewTimeMs, 40);
  review = reduce(review, { type: 'presentation', ...presented });
  review = reduce(review, { type: 'transport', reviewTimeMs: 40, frame: 12, rate: 0, kind: 'step', seekReady: false, presented: false, shownFrame: 11, targetFrame: 12 });
  review = reduce(review, { type: 'transport', reviewTimeMs: 80, frame: 12, rate: 0, kind: 'hold', seekReady: true, presented: true, shownFrame: 12, targetFrame: 12 });
  review = reduce(review, { type: 'stroke-begin', id: 'stroke-1', x: 0.2, y: 0.4, reviewTimeMs: 80, rate: 0 });
  review = reduce(review, { type: 'stroke-point', x: 0.5, y: 0.6 });
  review = reduce(review, { type: 'stroke-end' });
  assert.equal(visibleStrokes(review, 12).length, 1);
  assert.equal(visibleStrokes(review, 11).length, 0);
  review = reduce(review, { type: 'stop', hold: 'pointer' });
  assert.equal(review.phase, 'recording');
  review = reduce(review, { type: 'stop', hold: 'keyboard' });
  review = reduce(review, { type: 'finalized', bytes: 1000, micBytes: 200, micDurationMs: 800, durationMs: 800, mime: review.mime });
  assert.equal(review.phase, 'draft');
  assert.equal(review.strokes[0].anchorFrame, 12);
  const body = sidecar(review, { movie: 'reviews/review.webm' });
  assert.equal(body.source.proxy, 'proxy/demo.mp4');
  assert.equal(body.fps.num, 30);
  assert.equal(body.transport[0].seekReady, false);
  assert.equal(body.transport[0].shownFrame, 11);
  assert.equal(body.transcript.alignment, 'take');
  assert.match(reviewPrompt(review, body.artifacts), /fframestudio.review\/1/);
  assert.match(reviewPrompt(review), /Do not invent word times/);
});

test('pointer recording survives another key release and keyboard release stops only its own hold', () => {
  let review = reduce(createReview(identity()), { type: 'acquire', hold: 'pointer' });
  review = reduce(review, { type: 'record', mime: 'video/webm' });
  review = reduce(review, { type: 'stop', hold: 'keyboard' });
  assert.equal(review.phase, 'recording');
  review = reduce(review, { type: 'stop', hold: 'pointer' });
  assert.equal(review.phase, 'finalizing');
});

test('ink waits for the presented frame and undo removes only ink', () => {
  let review = reduce(createReview(identity()), { type: 'acquire', hold: 'pointer' });
  review = reduce(review, { type: 'record', mime: 'video/webm' });
  review = reduce(review, { type: 'presentation', targetFrame: 4, shownFrame: 1, seekReady: false, presented: false });
  const rejected = reduce(review, { type: 'stroke-begin', id: 'stroke-1', x: 0.5, y: 0.5, reviewTimeMs: 10, rate: 0 });
  assert.equal(rejected.openStroke, null);
  assert.equal(rejected.error.code, 'not-presented');
  review = reduce(review, { type: 'presentation', ...presented, targetFrame: 4, shownFrame: 4 });
  review = reduce(review, { type: 'stroke-begin', id: 'stroke-1', x: 1.4, y: -2, reviewTimeMs: 10, rate: 1 });
  assert.equal(review.error.code, 'not-paused');
  review = reduce(review, { type: 'stroke-begin', id: 'stroke-1', x: 1.4, y: -2, reviewTimeMs: 10, rate: 0 });
  assert.deepEqual(review.openStroke.points[0], { x: 1, y: 0 });
  review = reduce(review, { type: 'undo-stroke' });
  assert.equal(review.openStroke, null);
  assert.equal(review.phase, 'recording');
});

test('caps stop the take and a long mic is not treated as a complete transcript', () => {
  let review = reduce(reduce(createReview(identity()), { type: 'acquire', hold: 'keyboard' }), { type: 'record', mime: 'video/webm' });
  review = reduce(review, { type: 'clock', reviewTimeMs: LIMITS.maxDurationMs });
  assert.equal(review.phase, 'finalizing');
  assert.equal(review.error.code, 'duration-cap');
  review = reduce(review, { type: 'finalized', micDurationMs: 31_000, durationMs: 31_000, bytes: 10, micBytes: 10 });
  assert.equal(review.transcriptStatus, 'unavailable');
  assert.match(review.transcriptNote, /30 seconds/);
  const plan = transcriptPlan({ micDurationMs: 31_000, micBytes: 10, backendAvailable: true });
  assert.equal(plan.send, false);
  const short = transcriptPlan({ micDurationMs: 2_000, micBytes: 10, backendAvailable: true });
  assert.equal(short.send, true);
  const ready = applyTranscriptResult({ ...review, phase: 'draft' }, { text: 'hold the second shot' });
  assert.equal(ready.transcriptStatus, 'ready');
  assert.match(ready.transcriptNote, /Untimed take-level/);
  assert.equal(sidecar(ready).transcript.alignment, 'take');
  assert.equal(sidecar(ready).transcript.words, undefined);
});

test('send is once, stale revisions need revalidation, and failure returns to the draft', () => {
  let review = reduce(reduce(createReview(identity()), { type: 'acquire', hold: 'pointer' }), { type: 'record', mime: 'video/webm' });
  review = reduce(review, { type: 'finalized', micDurationMs: 1000, durationMs: 1000, bytes: 10, micBytes: 10 });
  const current = { projectId: 'demo', videoId: 'main', baseRevision: 3 };
  assert.equal(acceptanceError(review, { ...current, projectId: 'other' }), 'Review is for a different project');
  const stale = reduce(review, { type: 'send', current: { ...current, baseRevision: 4 } });
  assert.equal(stale.phase, 'draft');
  assert.equal(stale.error.code, 'stale');
  const wrong = reduce(stale, { type: 'revalidate', current: { projectId: 'other', videoId: 'main', baseRevision: 4 } });
  assert.equal(wrong.baseRevision, 3);
  review = reduce(review, { type: 'revalidate', current: { ...current, baseRevision: 4 } });
  assert.equal(review.baseRevision, 4);
  review = reduce(review, { type: 'send', current: { ...current, baseRevision: 4 } });
  assert.equal(review.phase, 'sending');
  const duplicate = reduce(review, { type: 'send', current: { ...current, baseRevision: 4 } });
  assert.equal(duplicate.phase, 'sending');
  assert.equal(duplicate.error.code, 'duplicate');
  review = reduce(review, { type: 'send-failed', code: 'busy', message: 'Assistant is busy. The review is still here.' });
  assert.equal(review.phase, 'draft');
  assert.equal(review.strokes.length, 0);
  review = reduce(review, { type: 'send', current: { ...current, baseRevision: 4 } });
  review = reduce(review, { type: 'sent' });
  assert.equal(review.phase, 'sent');
});

test('capture and microphone guards fail closed', () => {
  assert.equal(captureSupported({ mediaRecorder: true, captureStream: true, candidates: ['video/webm'], supported: () => true, reportedFrameRate: 12 }).ok, true);
  assert.equal(captureSupported({ mediaRecorder: true, captureStream: true, candidates: ['video/webm'], supported: () => true, reportedFrameRate: 0 }).reason, 'unsupported');
  assert.equal(captureSupported({ mediaRecorder: false, captureStream: true, candidates: ['video/webm'], supported: () => true }).ok, false);
  assert.equal(voiceMicBusy({ listening: true }), true);
  assert.equal(voiceMicBusy({ stream: { getAudioTracks: () => [{ readyState: 'live' }] } }), true);
  assert.equal(voiceMicBusy({ stream: { getAudioTracks: () => [{ readyState: 'ended' }] } }), false);
});

test('Feedback is a registered workspace action, never a proposal command', () => {
  const feedback = action('feedback');
  assert.equal(feedback.command, false);
  assert.equal(feedback.palette, true);
  assert.equal(feedback.scope, 'workspace');
});

test('late transcription cannot overwrite a manually corrected draft', () => {
  let review = reduce(reduce(createReview(identity()), { type: 'acquire', hold: 'pointer' }), { type: 'record', mime: 'video/webm' });
  review = reduce(review, { type: 'finalized', durationMs: 1000, micDurationMs: 1000 });
  review = reduce(review, { type: 'edit-transcript', text: 'Corrected by the reviewer' });
  const late = applyTranscriptResult(review, { text: 'Late machine output' });
  assert.equal(late.transcript, 'Corrected by the reviewer');
  assert.equal(late.transcriptStatus, 'edited');
  assert.equal(review.phase, 'draft');
});

test('full-review transcription opts into advertised coverage without widening the legacy endpoint', () => {
  const long = { micDurationMs: 119_000, micBytes: 3_800_000, backendAvailable: true };
  assert.equal(transcriptPlan(long).send, false);
  const review = transcriptPlan({ ...long, reviewStt: true, reviewMaxSeconds: 120, reviewMaxBytes: 4_000_000 });
  assert.equal(review.send, true);
  assert.equal(review.endpoint, '/reference/review-transcribe');
  assert.equal(transcriptPlan({ ...long, reviewStt: true, reviewMaxSeconds: 60 }).send, false);
  assert.equal(transcriptPlan({ ...long, reviewStt: true, micDurationMs: 120_001 }).send, false);
  assert.equal(transcriptPlan({ ...long, reviewStt: true, micBytes: 4_000_001 }).send, false);
  assert.equal(transcriptPlan({ ...long, reviewStt: true, backendAvailable: false }).send, false);
});

test('review instructions are readable text, and sent cards can be corrected without applying edits', () => {
  const review = { ...createReview(identity()), phase: 'sent', transcript: 'Hold the second shot', direction: 'Use warmer text' };
  const prompt = reviewPrompt(review);
  assert.match(prompt, /Spoken instructions: Hold the second shot/);
  assert.match(prompt, /Typed direction: Use warmer text/);
  const edited = reduce(review, { type: 'edit-transcript', text: 'Hold the third shot' });
  assert.equal(edited.phase, 'draft');
  assert.equal(edited.transcriptStatus, 'edited');
  assert.equal(edited.baseRevision, review.baseRevision);
});

async function sendDesk(review, submitAssistant) {
  const { FeedbackDesk } = await import('../../web/src/feedback/desk.js');
  const desk = Object.create(FeedbackDesk.prototype);
  Object.assign(desk, {
    review, epoch: 1, destroyed: false, sending: false, frames: [], bridgeArtifacts: null,
    editor: { doc: { id: 'demo', revision: 3 }, videoId: 'main', submitAssistant },
    render() {}, queueFrames: async () => {}, enqueueKeep: async () => {}, flushKeeps: async () => {},
  });
  return desk;
}

test('Send during recording finalizes and awaits usable speech exactly once', async () => {
  let delivered = 0;
  let received = '';
  const desk = await sendDesk({ ...createReview(identity()), phase: 'recording' }, async ({ text, saveProject }) => {
    delivered++;
    received = text;
    assert.equal(saveProject, false);
    return { ok: true };
  });
  let finalize;
  desk.stopRecording = async () => {
    desk.review.phase = 'finalizing';
    await new Promise(resolve => { finalize = resolve; });
    desk.review.phase = 'draft';
    desk.review.transcript = 'Make the title smaller';
  };
  const sending = desk.send();
  await desk.send();
  assert.equal(delivered, 0);
  finalize();
  await sending;
  assert.equal(delivered, 1);
  assert.match(received, /Spoken instructions: Make the title smaller/);
  assert.equal(desk.review.phase, 'sent');
  assert.equal(desk.sending, false);
});

test('missing transcription blocks audio-only delivery and keeps a retryable draft', async () => {
  let delivered = 0;
  const desk = await sendDesk({ ...createReview(identity()), phase: 'draft', transcriptStatus: 'unavailable' }, async () => { delivered++; });
  await desk.send();
  assert.equal(delivered, 0);
  assert.equal(desk.review.phase, 'draft');
  assert.equal(desk.review.error.code, 'understanding-required');
  assert.equal(desk.sending, false);
});

test('oversized short audio is not mislabeled as a long take', () => {
  const plan = transcriptPlan({ micDurationMs: 1000, micBytes: LIMITS.maxMicBytes + 1, backendAvailable: true });
  assert.equal(plan.send, false);
  assert.match(plan.note, /size|large|MB/i);
  assert.doesNotMatch(plan.note, /take is longer/i);
});

// Minimal asynchronous IDB transport for Node (no browser dependencies). The production
// save/load/restore/queue methods below run unchanged, including transaction aborts.
function reviewDb(t) {
  const rows = new Map();
  t.mock.method(globalThis, 'fetch', async () => { throw Error('No bridge in unit tests'); });
  const oldDb = globalThis.indexedDB;
  const oldDoc = globalThis.document;
  globalThis.document = { querySelector: () => null };
  globalThis.indexedDB = { open() {
    const request = {};
    setImmediate(() => {
      request.result = {
        close() {},
        transaction() {
          let pending = 0, aborted = false;
          const staged = new Map(rows);
          const tx = { abort() { aborted = true; setImmediate(() => tx.onabort?.()); } };
          const operation = fn => {
            pending++;
            const req = {};
            setImmediate(() => {
              if (aborted) return;
              req.result = structuredClone(fn());
              req.onsuccess?.();
              pending--;
              if (!pending && !aborted) setImmediate(() => {
                if (pending || aborted) return;
                rows.clear();
                for (const [id, row] of staged) rows.set(id, row);
                tx.oncomplete?.();
              });
            });
            return req;
          };
          const store = {
            get: id => operation(() => staged.get(id)),
            put: row => operation(() => staged.set(row.id, structuredClone(row)) && row.id),
            delete: id => operation(() => { staged.delete(id); }),
            index: () => ({ getAll: projectId => operation(() => [...staged.values()].filter(row => row.projectId === projectId)) }),
          };
          tx.objectStore = () => store;
          return tx;
        },
      };
      request.onsuccess?.();
    });
    return request;
  } };
  t.after(() => { globalThis.indexedDB = oldDb; globalThis.document = oldDoc; });
}

function stateDesk(videoId = 'main') {
  const desk = Object.create(FeedbackDesk.prototype);
  Object.assign(desk, {
    review: null, epoch: 0, destroyed: false, sending: false, frames: [], plates: new Map(),
    movie: null, mic: null, bridgeArtifacts: null, replayUrl: '', status: {},
    editor: { doc: { id: 'demo', revision: 3, preview: { proxy: 'proxy/demo.mp4' }, media: [{ id: 'demo:media:1' }], fps: { num: 30, den: 1 } }, videoId, toast() {} },
    render() {}, viewer: { enter() {}, exit() {} }, toolbar: {}, sheet: {}, ink: {},
  });
  desk.ensureReview();
  return desk;
}

const localRecord = (review, movie = null, savedAt = 1) => ({
  id: review.id, projectId: review.projectId, videoId: review.videoId,
  phase: movie ? 'draft' : 'idle', savedAt, review: sidecar(review),
  movie, mic: null, frames: [], plates: [],
});

test('video changes park unsent recording identity and restore the matching take without rebinding', async t => {
  reviewDb(t);
  const desk = stateDesk();
  const a = desk.review;
  a.phase = 'draft';
  a.direction = 'Keep A';
  desk.movie = new Blob(['movie-A'], { type: 'video/webm' });
  const movie = desk.movie;
  const plate = {};
  desk.plates.set(12, plate);
  // No strokes retain this plate, so persistence need not encode it.
  desk.editor.videoId = 'videoB';
  desk.ensureReview();
  assert.equal(desk.review.videoId, 'videoB');
  assert.notEqual(desk.review.id, a.id);
  assert.equal(desk.review.phase, 'idle');
  assert.equal(desk.movie, null);
  assert.equal(desk.plates.size, 0);
  desk.review.direction = 'B only';
  const b = desk.review;
  await desk.enqueueKeep();
  desk.editor.videoId = 'main';
  desk.ensureReview();
  await desk.flushKeeps();
  assert.equal(desk.review, a);
  assert.equal(desk.movie, movie);
  assert.equal(desk.plates.get(12), plate);
  assert.equal(desk.review.direction, 'Keep A');
  assert.equal(await (await loadLocalReview(a.id)).movie.text(), 'movie-A');
  assert.equal((await latestLocalReview('demo', 'videoB')).review.direction, 'B only');
  desk.editor.videoId = 'videoB';
  desk.ensureReview();
  assert.equal(desk.review, b);
  assert.equal(desk.movie, null);
  desk.review = reduce(desk.review, { type: 'acquire', hold: 'pointer' });
  desk.review = reduce(desk.review, { type: 'record', mime: 'video/webm' });
  desk.review = reduce(desk.review, { type: 'finalized', durationMs: 500, bytes: 7 });
  desk.movie = new Blob(['movie-B']);
  assert.equal(desk.review.videoId, 'videoB');
  assert.equal(acceptanceError(desk.review, desk.current()), null);
  desk.discard(true);
  assert.equal(desk.review.videoId, 'videoB');
  desk.editor.videoId = 'main';
  desk.ensureReview();
  assert.equal(desk.review, a);
  assert.equal(desk.movie, movie);
  await desk.flushKeeps();
  // discard waits for the previous persistence chain before deleting B.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await (await loadLocalReview(a.id)).movie.text(), 'movie-A');
});

test('idle typed direction survives reopen, queued video switching and a new desk reload', async t => {
  reviewDb(t);
  const desk = stateDesk();
  desk.review.direction = 'New direction, not the old recording';
  await desk.toggle();
  await desk.toggle();
  await desk.toggle();
  assert.equal(desk.review.direction, 'New direction, not the old recording');
  const id = desk.review.id;
  const queued = desk.enqueueKeep();
  desk.editor.videoId = 'videoB';
  desk.ensureReview();
  await queued;
  await desk.flushKeeps();
  assert.equal((await loadLocalReview(id)).videoId, 'main');
  assert.equal((await loadLocalReview(id)).movie, null);
  desk.editor.videoId = 'main';
  desk.ensureReview();
  await desk.restore();
  assert.equal(desk.review.id, id);
  assert.equal(desk.review.direction, 'New direction, not the old recording');
  const reloaded = stateDesk();
  await reloaded.restore();
  assert.equal(reloaded.review.id, id);
  assert.equal(reloaded.review.phase, 'idle');
  assert.equal(reloaded.review.direction, desk.review.direction);
  assert.equal(reloaded.movie, null);
  reloaded.review.direction = '';
  await reloaded.enqueueKeep();
  assert.equal(await loadLocalReview(id), undefined);
});

test('restore never overwrites a new idle direction, including typing during async read', async t => {
  reviewDb(t);
  const old = { ...createReview(identity()), phase: 'draft', direction: 'Old recording' };
  await saveLocalReview(localRecord(old, new Blob(['old movie'])));
  const desk = stateDesk();
  desk.review.direction = 'New instruction';
  await desk.restore();
  assert.equal(desk.review.direction, 'New instruction');
  assert.equal(desk.movie, null);
  desk.review.direction = '';
  const restoring = desk.restore();
  desk.review.direction = 'Typed during read';
  await restoring;
  assert.equal(desk.review.direction, 'Typed during read');
  assert.equal(desk.movie, null);
});

test('opening B restores B saved recording while retaining A unsent take', async t => {
  reviewDb(t);
  const storedB = { ...createReview(identity({ videoId: 'videoB' })), direction: 'Saved B' };
  await saveLocalReview(localRecord(storedB, new Blob(['saved-B'])));
  const desk = stateDesk();
  const a = desk.review;
  a.direction = 'Unsent A';
  await desk.toggle();
  await desk.toggle();
  desk.editor.videoId = 'videoB';
  await desk.toggle();
  assert.equal(desk.review.videoId, 'videoB');
  assert.equal(desk.review.id, storedB.id);
  assert.equal(desk.review.direction, 'Saved B');
  assert.equal(desk.review.phase, 'draft');
  assert.equal(await desk.movie.text(), 'saved-B');
  await desk.toggle();
  desk.editor.videoId = 'main';
  await desk.toggle();
  assert.equal(desk.review, a);
  assert.equal(desk.review.direction, 'Unsent A');
  assert.equal(desk.movie, null);
  await desk.flushKeeps();
});

test('text-only validation cannot empty an existing recording or accept phantom artifacts', async t => {
  reviewDb(t);
  const review = { ...createReview(identity()), direction: 'Text only' };
  await saveLocalReview(localRecord(review, new Blob(['preserve bytes'])));
  await assert.rejects(saveLocalReview(localRecord(review)), /abort/i);
  assert.equal(await (await loadLocalReview(review.id)).movie.text(), 'preserve bytes');
  await assert.rejects(saveLocalReview(localRecord({ ...review, direction: '' })), /Invalid/);
  await assert.rejects(saveLocalReview(localRecord(review, new Blob([]))), /Invalid/);
  await assert.rejects(saveLocalReview(localRecord({ ...review, strokes: [{ id: 'stroke-1' }] })), /Invalid/);
});
