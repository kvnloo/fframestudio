// Opt-in real subscription acceptance. No fixture agent or transcription route.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fromV0 } from '../../web/src/doc/project.js';

const base = process.env.FFS_LIVE_APP_BASE;
const tokenFile = process.env.FFS_LIVE_APP_TOKEN_FILE;
const audioFile = process.env.FFS_LIVE_APP_AUDIO;
const out = process.env.FFS_LIVE_APP_OUT;
if (!base || !tokenFile || !audioFile || !out) throw Error('Explicit live app base, app token file, spoken audio and evidence directory required.');
fs.mkdirSync(out, { recursive: true });
const token = fs.readFileSync(tokenFile, 'utf8').trim();
const headers = { Authorization: `Bearer ${token}` };
const api = async (url, options = {}) => {
  const response = await fetch(base + url, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw Error(`App request failed: ${response.status} ${url.split('?')[0]}`);
  return response;
};
const source = await (await api('/fs?path=projects/demo/project.json')).json();
const projectId = 'live-check-' + Date.now();
const doc = fromV0(JSON.parse(source.content));
doc.id = projectId; doc.title = 'Disposable live voice qualification';
const media = new Set();
function collect(value) {
  if (typeof value === 'string' && /^media\/[\w./-]+\.(mp4|jpg|jpeg|png|webp|wav|mp3)$/i.test(value)) media.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
}
collect(doc);
for (const file of media) {
  const content = await (await api('/lib/demo/' + file)).arrayBuffer();
  await api('/fs?path=' + encodeURIComponent(`projects/${projectId}/${file}`), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: content });
  const readback = await (await api('/lib/' + projectId + '/' + file)).arrayBuffer();
  assert.equal(Buffer.compare(Buffer.from(content), Buffer.from(readback)), 0, 'Qualification media changed during copy: ' + file);
}
await api('/fs?path=' + encodeURIComponent(`projects/${projectId}/project.json`), { method: 'PUT', body: JSON.stringify(doc) });
let browser;
const errors = [];
const mediaRequests = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM, args: ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + audioFile, '--autoplay-policy=no-user-gesture-required'] });
  const mobile = process.env.FFS_LIVE_APP_MOBILE === '1';
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, permissions: ['microphone'], isMobile: mobile, hasTouch: mobile });
  await context.addCookies([{ name: 'ffs', value: token, url: base, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => { if (response.url().includes('/lib/')) mediaRequests.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('requestfailed', req => { if (req.url().includes('/lib/')) mediaRequests.push({ path: new URL(req.url()).pathname, error: req.failure()?.errorText }); });
  await page.goto(base + '/#/p/' + projectId);
  await page.waitForFunction(() => window.ffs?.doc && !window.ffs.loading);
  if (!await page.evaluate(() => window.ffs.feedback?.active)) await page.click('[data-action="feedback"]');
  await page.waitForFunction(() => window.ffs.feedback?.active);
  await page.click('[data-feedback="pencil"]');
  const ink = await page.locator('#feedback-ink').boundingBox();
  assert(ink, 'Pencil is hidden before microphone startup');
  await page.mouse.move(ink.x + ink.width * 0.3, ink.y + ink.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(ink.x + ink.width * 0.7, ink.y + ink.height * 0.6, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.ffs.feedback.frames.length > 0);
  assert.equal(await page.evaluate(() => window.ffs.feedback.live.state), 'idle');
  await page.click('[data-feedback="pencil"]');
  await page.evaluate(() => {
    window.__sourceBeforeLive = JSON.stringify(window.ffs.doc);
    window.__remotePeak = 0;
    window.__remoteAfterFinalPeak = 0;
    window.__liveTransitions = [];
    window.__liveTurns = [];
    const voice = window.ffs.feedback.live;
    const transcript = voice.onTranscript;
    voice.onTranscript = turn => { window.__liveTurns.push({ ...turn, afterAgentFinal: voice.completed.size > 0 }); transcript(turn); };
    const state = voice.onState;
    voice.onState = event => { window.__liveTransitions.push(event); state(event); };
    const timer = setInterval(() => {
      if (!voice.audio?.srcObject || window.__liveAudioProbe) return;
      const audio = new AudioContext(); const source = audio.createMediaStreamSource(voice.audio.srcObject);
      const analyser = audio.createAnalyser(); analyser.fftSize = 2048; source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      window.__liveAudioProbe = { audio, timer: setInterval(() => { analyser.getFloatTimeDomainData(samples); let energy = 0; for (const n of samples) energy += n * n; const rms = Math.sqrt(energy / samples.length); window.__remotePeak = Math.max(window.__remotePeak, rms); if (voice.completed.size) window.__remoteAfterFinalPeak = Math.max(window.__remoteAfterFinalPeak, rms); }, 20) };
      clearInterval(timer);
    }, 50);
    window.__probeTimer = timer;
  });
  await page.click('[data-feedback="live"]');
  await page.waitForFunction(() => window.ffs.feedback.live.state === 'live' || window.ffs.feedback.live.state === 'error' || (!window.ffs.feedback.livePreparing && window.ffs.feedback.liveDetail && window.ffs.feedback.live.state === 'idle'), null, { timeout: 60000 });
  const connected = await page.evaluate(() => ({ state: window.ffs.feedback.live.state, detail: window.ffs.feedback.liveDetail }));
  assert.equal(connected.state, 'live', JSON.stringify(connected));
  const approved = [];
  const deadline = Date.now() + 180000;
  for (;;) {
    const complete = await page.evaluate(() => window.ffs.pendingProposal && window.ffs.feedback.live.completed.size > 0 && window.__remoteAfterFinalPeak > 0.01 && window.__liveTurns.some(turn => turn.role === 'assistant' && turn.afterAgentFinal && /midnight garden|proposal|review|approv|accept|ready/i.test(turn.text)));
    if (complete) break;
    if (Date.now() > deadline) throw Error('Live proposal/spoken final timed out');
    const voiceError = await page.evaluate(() => window.ffs.feedback.live.state === 'error' ? window.ffs.feedback.liveDetail : '');
    if (voiceError) throw Error(voiceError);
    const permissions = page.locator('#chat .perm').filter({ has: page.locator('button[data-perm]') });
    if (await permissions.count()) {
      const permission = permissions.first();
      const title = await permission.evaluate(node => node.firstChild.textContent);
      // Consent is bounded to this freshly generated disposable project's proposal.
      // Never approve shell execution, an original project, or an arbitrary tool.
      assert(title.startsWith('Hermes Agent wants to: Approve edit: '), 'Unexpected permission type: ' + title);
      assert(title.includes('/cache/scratch/ffs-feedback-live/library/projects/' + projectId + '/proposals/'), 'Permission escaped the disposable project');
      assert(/\/\d+\.json$/.test(title), 'Permission is not one proposal JSON');
      if (!await permission.getByRole('button', { name: 'Allow once', exact: true }).isVisible()) await page.click('.review-viewer-head [data-feedback="conversation"]');
      await permission.getByRole('button', { name: 'Allow once', exact: true }).click();
      if (mobile) await page.click('.review-conversation-head [data-feedback="conversation"]');
      approved.push(title);
    }
    await page.waitForTimeout(100);
  }
  const result = await page.evaluate(() => ({ model: window.ffs.feedback.live.call.model, webRTC: window.ffs.feedback.live.peer.connectionState, remoteAudioPeak: window.__remotePeak, remoteAfterFinalPeak: window.__remoteAfterFinalPeak, delegations: window.ffs.feedback.live.seen.size, finalsReturned: window.ffs.feedback.live.completed.size, proposal: window.ffs.pendingProposal, documentUnchanged: JSON.stringify(window.ffs.doc) === window.__sourceBeforeLive, transitions: window.__liveTransitions, turns: window.__liveTurns }));
  assert.equal(result.model, 'gpt-live-1-codex');
  assert(result.delegations > 0, 'No real GPT live delegation reached Hermes.');
  assert(result.documentUnchanged, 'Voice automatically applied an edit.');
  assert(result.proposal.commands.some(command => JSON.stringify(command).toLowerCase().includes('midnight garden')), 'Spoken edit did not become the requested proposal.');
  await page.screenshot({ path: path.join(out, 'live-proposal.png') });
  await page.click('[data-feedback="live"]');
  assert.equal(await page.evaluate(() => window.ffs.feedback.live.stream), null);
  const after = await (await api('/fs?path=projects/demo/project.json')).json();
  assert.equal(after.content, source.content, 'Original disposable demo changed during qualification.');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ok: true, microphone: 'synthetic spoken WAV through browser getUserMedia', approvedProposalWrites: approved.length, ...result }, null, 2));
  console.log(JSON.stringify({ ok: true, model: result.model, delegations: result.delegations, remoteAudioPeak: result.remoteAudioPeak, proposalUnapplied: result.documentUnchanged }));
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
      const state = await page.evaluate(() => ({ phase: window.ffs?.feedback?.live?.state, detail: window.ffs?.feedback?.liveDetail, transitions: window.__liveTransitions, pendingProposal: !!window.ffs?.pendingProposal, drawing: { pencil: window.ffs?.feedback?.pencil, view: window.ffs?.feedback?.liveView, pending: window.ffs?.feedback?.waitDraw, strokes: window.ffs?.feedback?.review?.strokes, open: window.ffs?.feedback?.review?.openStroke, frames: window.ffs?.feedback?.frames.length, video: (() => { const v = document.querySelector('#preview-video'); return v && { ready: v.readyState, seeking: v.seeking, paused: v.paused, currentTime: v.currentTime, quality: v.getVideoPlaybackQuality?.().totalVideoFrames, hidden: v.hidden, source: v.getAttribute('src') }; })() }, text: document.querySelector('#chat')?.textContent?.slice(-5000) })).catch(() => ({}));
      state.mediaRequests = mediaRequests;
      state.liveError = await page.evaluate(() => window.ffs?.feedback?.live?.lastError);
      state.videoDetails = await page.evaluate(() => { const v = document.querySelector('#preview-video'); return v && { error: v.error && { code: v.error.code, message: v.error.message }, preload: v.preload, networkState: v.networkState }; });
      fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ error: error.message, errors, state }, null, 2));
      console.error(JSON.stringify(state));
    }
  }
  throw error;
} finally {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    await page?.evaluate(async () => { clearInterval(window.__probeTimer); if (window.__liveAudioProbe) { clearInterval(window.__liveAudioProbe.timer); await window.__liveAudioProbe.audio.close(); } await window.ffs?.feedback?.live?.stop(); }).catch(() => {});
    await browser.close();
  }
}
