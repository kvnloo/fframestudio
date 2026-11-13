// Browser journey for recorded reviews. The happy path uses Chromium's real MediaRecorder
// and a fake-device WAV. It does not stub getUserMedia.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';
import { fromV0, validate } from '../web/src/doc/project.js';

const freePort = () => new Promise((ok) => { const server = net.createServer().listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => ok(port)); }); });
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function chromeLaunch() {
  const channel = process.env.PW_CHANNEL;
  const candidates = [process.env.CHROMIUM, '/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  const executablePath = channel ? undefined : candidates.find((file) => fs.existsSync(file));
  if (!channel && !executablePath) throw Error('No Chrome or Chromium with codec support was found');
  return { channel, executablePath };
}

async function tone(file) {
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12:sample_rate=48000', '-ac', '1', file], { stdio: 'ignore' });
    child.on('exit', (code) => code === 0 ? resolve() : reject(Error('ffmpeg could not write the fake microphone WAV')));
  });
}

function browserFor(wav) {
  const launch = chromeLaunch();
  return chromium.launch({
    ...launch,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
    ],
  });
}

async function ready(page) {
  await page.waitForSelector('#preview-video');
  await page.waitForFunction(() => window.ffs?.interactiveAt && document.querySelector('#preview-video').readyState >= 2);
}

export async function verifyFeedback({ root, home, out, assert, source }) {
  fs.mkdirSync(out, { recursive: true });
  const wav = process.env.FFS_FEEDBACK_AUDIO || path.join(out, 'feedback-tone.wav');
  if (!process.env.FFS_FEEDBACK_AUDIO) await tone(wav);
  const beforeSource = sha(source);
  const projectFile = path.join(home, 'fframestudio/projects/demo/project.json');
  const beforeProject = sha(projectFile);
  const multiDir = path.join(home, 'fframestudio/projects/multi-review');
  fs.cpSync(path.dirname(projectFile), multiDir, { recursive: true });
  const multi = fromV0(JSON.parse(fs.readFileSync(projectFile, 'utf8')));
  multi.id = 'multi-review'; multi.title = 'Review identity regression';
  const alternate = structuredClone(multi.videos[0]);
  alternate.id = 'alternate'; alternate.name = 'Alternate film';
  alternate.clips.forEach(clip => { clip.id = 'alternate-' + clip.id; clip.attached = []; });
  alternate.scenes.forEach(scene => { scene.id = 'alternate-' + scene.id; scene.clipIds = scene.clipIds.map(id => 'alternate-' + id); });
  multi.videos.push(alternate);
  validate(multi);
  fs.writeFileSync(path.join(multiDir, 'project.json'), JSON.stringify(multi));
  const logPath = path.join(out, 'feedback-agent.jsonl');
  const holdPath = path.join(out, 'feedback-hold');
  fs.rmSync(holdPath, { force: true });
  fs.rmSync(logPath, { force: true });
  const agentFile = path.join(out, 'feedback-agents.json');
  fs.writeFileSync(agentFile, JSON.stringify({ fixture: { name: 'Review fixture', cmd: process.execPath, check: 'node', args: [path.join(root, 'test/fixtures/review-agent.mjs'), logPath, holdPath] } }));
  const port = await freePort();
  const token = 'feedback-' + Math.random().toString(36).slice(2);
  const bridge = spawn(process.execPath, ['bridge/bridge.mjs', '--port', String(port), '--root', path.join(home, 'fframestudio'), '--token', token, '--quiet', '--no-config', '--theme-home', home, '--agents', agentFile], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let bridgeLog = '';
  bridge.stdout.on('data', (chunk) => { bridgeLog += chunk; });
  bridge.stderr.on('data', (chunk) => { bridgeLog += chunk; });
  const browser = await browserFor(wav);
  const failures = [];
  let page;
  try {
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15000;
    for (;;) {
      if (bridge.exitCode !== null) throw Error('feedback bridge exited ' + bridge.exitCode + '\n' + bridgeLog.slice(-500));
      if (await fetch(base + '/health').then((response) => response.ok).catch(() => false)) break;
      if (Date.now() >= deadline) throw Error('feedback bridge was not ready');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto(`${base}/open?token=${token}`);
    await page.locator('.card', { hasText: 'Demo film' }).click();
    await ready(page);
    await page.locator('#canvas').click();
    await page.keyboard.press('r');
    await page.waitForFunction(() => document.activeElement?.id === 'replace-media');
    await page.evaluate(() => { document.activeElement.blur(); window.__reviewVideo = document.querySelector('#preview-video'); });
    await page.click('[data-action="feedback"]');
    await page.waitForSelector('#feedback-toolbar');
    await page.waitForFunction(() => window.ffs.feedback?.active);
    await viewerProof(page, assert, 'enter');
    await page.evaluate(() => {
      const cover = document.createElement('div'); cover.id = 'black-screen-negative-control';
      Object.assign(cover.style, { position: 'absolute', inset: '0', zIndex: '9', background: '#000' });
      document.querySelector('#canvas').append(cover);
    });
    let rejectedBlackScreen = false;
    try { await viewerProof(page, assert, 'black negative control'); } catch (error) { rejectedBlackScreen = /rendered source/.test(error.message); }
    await page.evaluate(() => document.querySelector('#black-screen-negative-control').remove());
    assert(rejectedBlackScreen, 'visibility regression gate accepted a black screen');
    await page.screenshot({ path: path.join(out, 'viewer-desktop-ready.png') });
    await page.evaluate(() => {
      window.__idleMicCalls = 0;
      const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => { window.__idleMicCalls++; return acquire(...args); };
    });
    await page.click('#feedback-toolbar [data-feedback="pencil"]');
    const idleInk = await page.locator('#feedback-ink').boundingBox();
    assert(idleInk, 'pencil is hidden until the microphone starts');
    await page.mouse.move(idleInk.x + idleInk.width * 0.2, idleInk.y + idleInk.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(idleInk.x + idleInk.width * 0.7, idleInk.y + idleInk.height * 0.6, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.ffs.feedback.frames.length === 1);
    assert(await page.evaluate(() => window.__idleMicCalls === 0 && window.ffs.feedback.review.phase === 'idle'), 'drawing required microphone capture');
    assert(await inkCount(page) > 10, 'idle pencil did not render ink');
    await page.evaluate(() => window.ffs.feedback.flushKeeps());
    await page.reload(); await ready(page); await page.click('[data-action="feedback"]');
    await page.waitForFunction(() => window.ffs.feedback?.review?.strokes.length === 1);
    await page.evaluate(() => { window.__reviewVideo = document.querySelector('#preview-video'); });
    await page.click('#feedback-toolbar [data-feedback="undo"]');
    await page.waitForFunction(() => !window.ffs.feedback.frames.length);
    await page.fill('#feedback-instruction', 'Keep the opening');
    await page.locator('#canvas').click();
    await page.keyboard.down('r');
    await page.waitForFunction(() => document.querySelector('#feedback-toolbar').dataset.phase === 'recording');
    await page.keyboard.press('v');
    await page.waitForFunction(() => !!window.ffs.voice);
    assert(await page.evaluate(() => !window.ffs.voice?.listening && !window.ffs.voice?.starting && window.ffs.feedback.review.phase === 'recording'), 'V opened a competing microphone during the review');
    await page.click('[data-action="play"]');
    await page.waitForFunction(() => document.querySelector('#preview-video').currentTime > 0.2);
    await page.keyboard.press('Space');
    await page.click('#feedback-toolbar [data-feedback="pencil"]');
    await page.keyboard.press('ArrowLeft');
    await page.evaluate(() => window.ffs.seek(48));
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#canvas');
      return canvas.dataset.feedbackPresented === 'true' && canvas.dataset.feedbackSeekReady === 'true' && canvas.dataset.feedbackShown === canvas.dataset.feedbackTarget;
    }, null, { timeout: 8000 });
    const box = await page.locator('#feedback-ink').boundingBox();
    assert(box && box.width > 40, 'feedback ink overlay has no bounds');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => window.ffs.feedback.frames.length >= 1);
    const anchor = await page.evaluate(() => window.ffs.feedback.review.strokes.at(-1).anchorFrame);
    await page.evaluate((frame) => window.ffs.seek(Math.max(0, frame - 12)), anchor);
    await page.waitForFunction((frame) => document.querySelector('#canvas').dataset.feedbackShown === String(Math.max(0, frame - 12)), anchor);
    const away = await inkCount(page);
    await page.evaluate((frame) => window.ffs.seek(frame), anchor);
    await page.waitForFunction(() => document.querySelector('#canvas').dataset.feedbackPresented === 'true');
    const back = await inkCount(page);
    assert(away < 5, 'ink stayed on a different editorial frame (' + away + ')');
    assert(back > 10, 'ink did not return on its anchor frame (' + back + ')');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((frame) => document.querySelector('#canvas').dataset.feedbackShown === String(frame + 1), anchor);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.ffs.feedback.frames.length >= 2);
    await page.click('#feedback-toolbar [data-feedback="undo"]');
    await page.waitForFunction(() => window.ffs.feedback.frames.length === 1);
    await viewerMenu(page, 'clear');
    await page.waitForFunction(() => window.ffs.feedback.frames.length === 0 && window.ffs.feedback.review.strokes.length === 0);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
    await page.mouse.up();
    await page.evaluate(frame => window.ffs.seek(frame), anchor);
    await page.waitForFunction(frame => document.querySelector('#canvas').dataset.feedbackShown === String(frame), anchor);
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => window.ffs.feedback.frames.length === 2);
    await page.waitForTimeout(Number(process.env.FFS_FEEDBACK_RECORD_MS || 500));
    await page.keyboard.up('r');
    await page.keyboard.up('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('#feedback-toolbar').dataset.phase === 'draft', null, { timeout: 15000 });
    await page.waitForFunction(() => !window.ffs.feedback.finishing);
    await viewerProof(page, assert, 'draft');
    if (process.env.FFS_EXPECT_TRANSCRIPT) assert((await page.evaluate(() => window.ffs.feedback.review.transcript)).toLowerCase().includes(process.env.FFS_EXPECT_TRANSCRIPT.toLowerCase()), 'spoken microphone instruction did not reach transcript');
    const proof = await page.evaluate(async () => {
      const replay = document.querySelector('#feedback-replay');
      await new Promise((resolve, reject) => { if (replay.readyState >= 1) resolve(); else { replay.onloadedmetadata = resolve; replay.onerror = () => reject(Error('replay failed')); } });
      if (!Number.isFinite(replay.duration) || replay.duration <= 0) throw Error('review WebM has no finite replay duration');
      const video = document.createElement('video');
      video.src = replay.currentSrc || replay.src;
      video.muted = true;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const grab = async (time) => {
        video.currentTime = Math.min(time, Math.max(0, video.duration - 0.05));
        await new Promise((resolve) => { video.onseeked = resolve; });
        context.drawImage(video, 0, 0, 160, 90);
        const data = context.getImageData(0, 0, 160, 90).data;
        let pink = 0, sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += data[i] + data[i + 1] + data[i + 2];
          if (data[i] > 180 && data[i + 2] > 120 && data[i + 1] < 120) pink += 1;
        }
        return { pink, sum };
      };
      const frames = [await grab(0.1), await grab(video.duration / 2), await grab(Math.max(0.1, video.duration - 0.15))];
      const audio = await new AudioContext().decodeAudioData(await (await fetch(video.src)).arrayBuffer());
      const channel = audio.getChannelData(0);
      let energy = 0;
      for (let i = 0; i < channel.length; i += 16) energy += channel[i] * channel[i];
      const review = window.ffs.feedback.review;
      const movie = await fetch(`/lib/${encodeURIComponent(review.projectId)}/reviews/${encodeURIComponent(review.id + '.webm')}`);
      const saved = await movie.blob();
      const sidecarResponse = await fetch('/fs?path=' + encodeURIComponent(`projects/${review.projectId}/reviews/${review.id}.json`));
      const sidecar = await sidecarResponse.json();
      return {
        rms: Math.sqrt(energy / Math.ceil(channel.length / 16)),
        frames,
        duration: video.duration,
        savedBytes: saved.size,
        movieBytes: window.ffs.feedback.movie.size,
        sidecar: JSON.parse(sidecar.content),
        phase: review.phase,
        transcript: document.querySelector('#feedback-transcript-note').textContent,
      };
    });
    assert(proof.rms > 0.01, 'recorded audio RMS is ' + proof.rms);
    assert(proof.duration > 0.4, 'replay duration is ' + proof.duration);
    assert(Math.max(...proof.frames.map((frame) => frame.pink)) > 10, 'recorded movie has no ink pixels');
    assert(Math.max(...proof.frames.map((frame) => frame.sum)) - Math.min(...proof.frames.map((frame) => frame.sum)) > 500, 'recorded movie did not keep more than one picture');
    assert(proof.savedBytes === proof.movieBytes && proof.savedBytes > 1000, 'bridge movie readback size mismatched');
    assert(proof.sidecar.schema === 'fframestudio.review/1', 'sidecar schema missing');
    assert(proof.sidecar.projectId === 'demo' && proof.sidecar.videoId && Number.isInteger(proof.sidecar.baseRevision), 'sidecar identity missing');
    assert(proof.sidecar.source.proxy, 'sidecar has no source proxy');
    assert(proof.sidecar.strokes.length >= 2, 'continuous review lost one of its source-frame marks');
    assert(proof.sidecar.transport.some((entry) => entry.kind === 'step' || entry.kind === 'seek'), 'transport has no frame step or seek');
    assert(proof.sidecar.transport.every((entry) => typeof entry.seekReady === 'boolean' && typeof entry.presented === 'boolean'), 'transport clocks are incomplete');
    assert(proof.transcript.toLowerCase().includes('untimed') || proof.transcript.toLowerCase().includes('unavailable'), proof.transcript);
    const savedMovie = await context.request.get(base + '/lib/demo/reviews/' + proof.sidecar.id + '.webm');
    fs.writeFileSync(path.join(out, 'recorded-review.webm'), await savedMovie.body());
    fs.writeFileSync(path.join(out, 'recorded-review.json'), JSON.stringify(proof.sidecar, null, 2));
    await page.screenshot({ path: path.join(out, 'feedback-draft.png') });
    assert(await page.locator('#review-stage #feedback-sheet').count() === 0, 'draft form covers the source film');
    await page.click('#feedback-toolbar [data-feedback="send"]');
    await page.waitForFunction(() => window.ffs.feedback.review.error?.code === 'no-agent' && !window.ffs.feedback.sending);
    await editReview(page);
    await page.fill('#feedback-transcript', 'Corrected review transcript');
    await editReview(page);
    await page.fill('#feedback-direction', 'Preserve this direction through reload');
    await page.waitForFunction(async () => {
      const { latestLocalReview } = await import('/app/src/feedback/persist.js');
      const saved = await latestLocalReview(window.ffs.doc.id, window.ffs.videoId);
      return saved?.review.transcript.text === 'Corrected review transcript' && saved.review.direction === 'Preserve this direction through reload';
    });
    const durableDraft = await page.evaluate(async () => {
      await window.ffs.feedback.flushKeeps();
      const { latestLocalReview } = await import('/app/src/feedback/persist.js');
      const saved = await latestLocalReview(window.ffs.doc.id, window.ffs.videoId);
      return { current: window.ffs.feedback.review.transcript, saved: saved?.review.transcript.text };
    });
    assert(durableDraft.current === 'Corrected review transcript' && durableDraft.saved === durableDraft.current, 'draft text changed while writes were pending: ' + JSON.stringify(durableDraft));
    await page.reload();
    await ready(page);
    await page.evaluate(() => { window.__reviewVideo = document.querySelector('#preview-video'); });
    await page.click('[data-action="feedback"]');
    await page.waitForFunction(() => document.querySelector('#feedback-replay')?.src.startsWith('blob:'));
    assert(await page.evaluate(() => window.ffs.feedback.movie.size > 1000), 'reloaded review lost its recording');
    assert(await page.inputValue('#feedback-transcript') === 'Corrected review transcript', 'reload lost corrected transcript');
    assert(await page.inputValue('#feedback-direction') === 'Preserve this direction through reload', 'reload lost typed direction');
    assert(sha(projectFile) === beforeProject, 'recording or failed review send wrote project.json');
    await editReview(page);
    await page.fill('#feedback-direction', '__FAIL__');
    await connectFixture(page);
    await page.waitForFunction(() => /ready/.test(document.querySelector('#chat').textContent));
    await page.click('#feedback-toolbar [data-feedback="send"]');
    await page.waitForFunction(() => window.ffs.feedback.review.error?.code === 'error' && !window.ffs.feedback.sending);
    assert(await page.evaluate(() => window.ffs.doc.videos[0].clips[0].textOverrides?.title) !== 'Review fixture suggestion', 'failed send applied a proposal');
    await editReview(page);
    await page.fill('#feedback-direction', 'Keep the opening');
    await page.click('#review-message-options summary');
    await page.fill('#ask', '__HOLD__');
    await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#chat').textContent.includes('__HOLD__'));
    await page.click('#feedback-toolbar [data-feedback="send"]');
    await page.waitForFunction(() => window.ffs.feedback.review.error?.code === 'busy' && !window.ffs.feedback.sending);
    fs.writeFileSync(holdPath, 'go');
    await page.waitForFunction(() => document.querySelector('#chat').textContent.includes('turn ended'));
    const beforeReviewSend = sha(projectFile);
    await page.evaluate(() => window.ffs.run({ type: 'edit-text', clipId: window.ffs.selection, field: 'title', value: 'Unsaved local title' }));
    await page.click('#feedback-toolbar [data-feedback="send"]');
    await page.waitForSelector('[data-feedback="revalidate"]');
    await page.click('[data-feedback="revalidate"]');
    await page.waitForFunction(() => document.querySelector('#feedback-toolbar').dataset.phase === 'sent', null, { timeout: 15000 });
    assert(await page.evaluate(() => window.ffs.doc.videos[0].clips[0].textOverrides.title) === 'Unsaved local title', 'review send changed the open title through the proposal');
    const log = fs.readFileSync(logPath, 'utf8');
    assert(log.includes('fframestudio.review/1'), 'fixture did not receive the sidecar');
    assert(log.includes('"type":"image"'), 'fixture did not receive an annotated frame');
    assert(!log.includes(token), 'review prompt included the bridge token');
    assert(sha(projectFile) === beforeReviewSend, 'review send wrote project.json');
    assert(sha(source) === beforeSource, 'review changed the source movie');
    await page.waitForFunction(() => window.ffs.proposalValid && window.ffs.pendingProposal.baseRevision === window.ffs.doc.revision);
    assert(await page.evaluate(() => window.ffs.pendingProposal.commands[0].value) === 'Review fixture suggestion', 'review did not yield a valid pending proposal');
    assert(await page.locator('#chat #feedback-sheet').count() === 1, 'sent review did not become one conversation entry');
    await page.click('[data-action="inspect-proposal"]');
    await page.click('[data-action="apply-proposal"]');
    await page.waitForFunction(() => window.ffs.doc.videos[0].clips[0].textOverrides.title === 'Review fixture suggestion');
    await viewerMenu(page, 'undo-edit');
    assert(await page.evaluate(() => window.ffs.doc.videos[0].clips[0].textOverrides.title) === 'Unsaved local title', 'Undo failed');
    await viewerMenu(page, 'redo-edit');
    await viewerMenu(page, 'save-edit');
    await page.waitForFunction(() => !window.ffs.dirty);
    assert(JSON.stringify(JSON.parse(fs.readFileSync(projectFile, 'utf8'))).includes('Review fixture suggestion'), 'saved proposal did not reach disk');
    await page.screenshot({ path: path.join(out, 'viewer-desktop-proposal.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.ffs.feedback.viewer.conversation(false));
    await viewerProof(page, assert, 'phone');
    await page.screenshot({ path: path.join(out, 'viewer-phone-ready.png') });
    await page.click('[aria-controls="review-conversation"]');
    await page.screenshot({ path: path.join(out, 'feedback-phone.png') });
    assert(await page.evaluate(() => [...document.querySelectorAll('#feedback-toolbar button, #feedback-sheet button')].filter((node) => !node.hidden).every((node) => node.getBoundingClientRect().height >= 44)), 'phone feedback controls are below44px');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone feedback overflowed horizontally');
    await editReview(page);
    for (const selector of ['#feedback-transcript', '#feedback-direction', '.review-conversation-head [data-feedback="conversation"]']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      assert(await page.locator(selector).evaluate(node => {
        const box = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), 'phone review control is obscured: ' + selector);
    }
    await page.evaluate(() => window.ffs.feedback.viewer.conversation(false));
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    await viewerProof(page, assert, 'landscape');
    assert(await page.locator('#review-conversation').isHidden(), 'phone landscape opened a desktop rail over the film');
    await page.screenshot({ path: path.join(out, 'viewer-phone-landscape.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-feedback="exit"]');
    assert(await page.evaluate(() => document.querySelector('#preview-video') === window.__reviewVideo), 'viewer replaced mounted source video');
    assert(await page.locator('#feedback-sheet').isHidden(), 'exit left the review sheet open');
    await page.locator('#canvas').click();
    await page.keyboard.press('r');
    await page.waitForFunction(() => document.activeElement?.id === 'replace-media');
    const secondContext = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 1440, height: 900 } });
    const second = await secondContext.newPage();
    page = second;
    let longTranscribePosts = 0;
    await second.route('**/reference/capabilities', (route) => route.fulfill({ json: { stt: true } }));
    await second.route('**/reference/transcribe', (route) => {
      longTranscribePosts += 1;
      return route.fulfill({ json: { text: 'This route must not receive a long take' } });
    });
    second.on('pageerror', (error) => failures.push(error.message));
    await second.goto(base + '/#/p/demo');
    await ready(second);
    await second.evaluate(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__tracks = [];
      navigator.mediaDevices.getUserMedia = (constraints) => new Promise((resolve) => { window.__grantMic = () => real(constraints).then((stream) => { window.__tracks.push(...stream.getAudioTracks()); resolve(stream); }); });
    });
    await second.click('[data-action="feedback"]');
    await second.waitForFunction(() => window.ffs.feedback?.active);
    await second.keyboard.down('r');
    await second.waitForFunction(() => window.__grantMic);
    await second.keyboard.up('r');
    await second.evaluate(() => window.__grantMic());
    await second.waitForFunction(() => window.__tracks.length && window.__tracks.every((track) => track.readyState === 'ended'));
    assert(await second.evaluate(() => document.querySelector('#feedback-toolbar').dataset.phase !== 'recording'), 'late permission started a recording');
    await second.reload();
    await ready(second);
    await second.evaluate(() => {
      const real = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = () => new MediaStream();
      window.__restoreCapture = () => { HTMLCanvasElement.prototype.captureStream = real; };
    });
    await second.click('[data-action="feedback"]');
    await viewerMenu(second, 'record');
    await second.waitForFunction(() => /cannot record|no video frames|unsupported/i.test(document.querySelector('#feedback-status').textContent));
    await second.evaluate(() => window.__restoreCapture());
    await second.evaluate(() => { window.ffs.voice = { listening: true, stream: { getAudioTracks: () => [{ readyState: 'live' }] } }; });
    await viewerMenu(second, 'record');
    await second.waitForFunction(() => /voice direction/i.test(document.querySelector('#feedback-status').textContent));
    await second.evaluate(() => { window.ffs.voice = null; });
    await second.evaluate(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__live = [];
      navigator.mediaDevices.getUserMedia = (constraints) => real(constraints).then((stream) => { window.__live.push(...stream.getAudioTracks()); return stream; });
    });
    await viewerMenu(second, 'record');
    await second.waitForFunction(() => document.querySelector('#feedback-toolbar').dataset.phase === 'recording' && window.__live.length);
    await second.keyboard.press('ArrowLeft');
    assert(await second.evaluate(() => window.ffs.feedback.review.phase === 'recording'), 'playback key release stopped click recording');
    await second.waitForTimeout(31000);
    await viewerMenu(second, 'record');
    await second.waitForFunction(() => window.ffs.feedback.review.phase === 'draft' && /30 seconds/.test(window.ffs.feedback.review.transcriptNote));
    assert(longTranscribePosts === 0, 'long mic audio was sent to the30second transcription backend');
    assert(await second.evaluate(() => window.ffs.feedback.movie.size > 1000 && window.ffs.feedback.mic.size > 1000), 'long review lost its movie or microphone audio');
    second.once('dialog', (dialog) => dialog.accept());
    await viewerMenu(second, 'discard');
    await viewerMenu(second, 'record');
    await second.waitForFunction(() => window.ffs.feedback.review.phase === 'recording' && window.__live.some((track) => track.readyState === 'live'));
    await second.evaluate(() => window.ffs.destroy());
    await second.waitForFunction(() => window.__live.every((track) => track.readyState === 'ended'));
    const mobileContext = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 844 } });
    const mobile = await mobileContext.newPage();
    page = mobile;
    mobile.on('pageerror', error => failures.push(error.message));
    await mobile.goto(base + '/#/p/demo');
    await ready(mobile);
    await mobile.waitForFunction(() => window.ffs.feedback?.active);
    await viewerProof(mobile, assert, 'mobile auto-open');
    await mobile.click('[aria-controls="review-conversation"]');
    await connectFixture(mobile);
    await mobile.waitForFunction(() => /ready/.test(document.querySelector('#chat').textContent));
    await mobile.click('.review-conversation-head [data-feedback="conversation"]');
    if (!process.env.FFS_EXPECT_TRANSCRIPT) await mobile.fill('#feedback-instruction', 'Keep this opening');
    await viewerMenu(mobile, 'record');
    await mobile.waitForFunction(() => window.ffs.feedback.review.phase === 'recording');
    await mobile.waitForTimeout(Number(process.env.FFS_FEEDBACK_RECORD_MS || 900));
    await mobile.click('#feedback-toolbar [data-feedback="send"]');
    await mobile.waitForFunction(() => window.ffs.feedback.review.phase === 'sent', null, { timeout: 90000 });
    assert(await mobile.evaluate(() => !document.querySelector('#review-viewer').classList.contains('conversation-open')), 'Send forced the conversation over the film');
    assert(await mobile.locator('#feedback-ink').isHidden(), 'submitted marks still cover the film');
    assert(await mobile.locator('#feedback-toolbar [data-feedback="send"]').isHidden(), 'submitted review left duplicate Send button');
    await viewerProof(mobile, assert, 'direct Send');
    await mobile.screenshot({ path: path.join(out, 'viewer-phone-direct-send.png') });
    await mobile.click('[aria-controls="review-conversation"]');
    assert(await mobile.locator('#chat #feedback-sheet').count() === 1, 'direct Send did not create one replayable conversation card');
    await mobile.locator('#feedback-sheet').scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: path.join(out, 'viewer-phone-conversation.png') });
    if (process.env.FFS_EXPECT_TRANSCRIPT) assert((await mobile.inputValue('#feedback-transcript')).toLowerCase().includes(process.env.FFS_EXPECT_TRANSCRIPT.toLowerCase()), 'direct Send lost the spoken instruction');
    await mobile.click('.review-conversation-head [data-feedback="conversation"]');
    await viewerMenu(mobile, 'record');
    await mobile.waitForFunction(() => window.ffs.feedback.review.phase === 'recording');
    assert(await mobile.evaluate(() => window.ffs.feedback.frames.length === 0 && window.ffs.feedback.review.strokes.length === 0), 'new review inherited old attachments');
    await mobile.click('#feedback-toolbar [data-feedback="cancel"]');
    await mobile.waitForFunction(() => window.ffs.feedback.review.phase === 'idle');
    let releaseTranscript;
    await mobile.route('**/reference/capabilities', route => route.fulfill({ json: { reviewStt: true, reviewMaxSeconds: 120, reviewMaxBytes: 4000000 } }));
    await mobile.route('**/reference/review-transcribe', route => new Promise(resolve => {
      releaseTranscript = () => route.fulfill({ json: { text: 'Late automatic transcript' } }).then(resolve);
    }));
    await viewerMenu(mobile, 'record');
    await mobile.waitForFunction(() => window.ffs.feedback.review.phase === 'recording');
    await mobile.waitForTimeout(700);
    await viewerMenu(mobile, 'record');
    const transcriptDeadline = Date.now() + 15000;
    while (!releaseTranscript) {
      if (Date.now() > transcriptDeadline) throw Error('delayed transcript request did not start');
      await mobile.waitForTimeout(50);
    }
    await mobile.click('[aria-controls="review-conversation"]');
    await editReview(mobile);
    await mobile.fill('#feedback-transcript', 'Manual correction beats the late transcript');
    await releaseTranscript();
    await mobile.waitForFunction(() => !window.ffs.feedback.finishing);
    await mobile.evaluate(() => window.ffs.feedback.flushKeeps());
    assert(await mobile.inputValue('#feedback-transcript') === 'Manual correction beats the late transcript', 'late transcription overwrote a manual correction');
    await mobile.unroute('**/reference/review-transcribe');
    await mobile.route('**/reference/review-transcribe', route => route.fulfill({ json: { text: 'Capped review remains transcribable' } }));
    mobile.once('dialog', dialog => dialog.accept());
    await viewerMenu(mobile, 'discard');
    await mobile.click('.review-conversation-head [data-feedback="conversation"]');
    await mobile.evaluate(async () => {
      const { LIMITS } = await import('/app/src/feedback/review.js');
      window.__normalReviewCap = LIMITS.maxDurationMs;
      LIMITS.maxDurationMs = 1200;
    });
    await viewerMenu(mobile, 'record');
    await mobile.waitForFunction(() => window.ffs.feedback.review.phase === 'draft' && !window.ffs.feedback.finishing);
    assert(await mobile.evaluate(() => window.ffs.feedback.review.micDurationMs <= 1200 && window.ffs.feedback.review.transcriptStatus === 'ready'), 'automatic cap counted recorder drain as microphone duration');
    await mobile.evaluate(async () => { (await import('/app/src/feedback/review.js')).LIMITS.maxDurationMs = window.__normalReviewCap; });
    const regression = await context.newPage(); page = regression;
    regression.on('pageerror', error => failures.push(error.message));
    await regression.goto(base + '/#/p/multi-review'); await ready(regression);
    const videoA = await regression.evaluate(() => window.ffs.videoId);
    const recordDraft = async direction => {
      await regression.click('[data-action="feedback"]');
      await regression.waitForFunction(() => window.ffs.feedback?.active);
      await regression.fill('#feedback-instruction', direction);
      await viewerMenu(regression, 'record');
      await regression.waitForFunction(() => window.ffs.feedback.review.phase === 'recording');
      await regression.waitForTimeout(600);
      await viewerMenu(regression, 'record');
      await regression.waitForFunction(() => window.ffs.feedback.review.phase === 'draft' && !window.ffs.feedback.finishing);
      await regression.evaluate(() => window.ffs.feedback.flushKeeps());
      return regression.evaluate(() => ({ id: window.ffs.feedback.review.id, videoId: window.ffs.feedback.review.videoId, bytes: window.ffs.feedback.movie.size }));
    };
    const takeA = await recordDraft('Direction for video A');
    await regression.click('[data-feedback="exit"]');
    await regression.selectOption('#video-choice', 'alternate');
    const takeB = await recordDraft('Direction for video B');
    assert(takeA.id !== takeB.id && takeA.videoId === videoA && takeB.videoId === 'alternate', 'switching videos rebound the old review identity');
    await regression.click('[data-feedback="exit"]');
    await regression.selectOption('#video-choice', videoA);
    await regression.click('[data-action="feedback"]');
    assert(await regression.evaluate(id => window.ffs.feedback.review.id === id && window.ffs.feedback.movie.size > 1000, takeA.id), 'returning to video A lost its recording');
    assert(await regression.inputValue('#feedback-instruction') === 'Direction for video A', 'returning to A restored B direction');
    await connectFixture(regression);
    await regression.waitForFunction(() => /ready/.test(document.querySelector('#chat').textContent));
    await regression.click('#feedback-toolbar [data-feedback="send"]');
    await regression.waitForFunction(() => window.ffs.feedback.review.phase === 'sent');
    await regression.fill('#feedback-instruction', 'A new typed instruction must survive reopening');
    await regression.evaluate(() => window.ffs.feedback.flushKeeps());
    await regression.click('[data-feedback="exit"]'); await regression.click('[data-action="feedback"]');
    assert(await regression.inputValue('#feedback-instruction') === 'A new typed instruction must survive reopening', 'older recording overwrote a new typed instruction');
    await regression.reload(); await ready(regression); await regression.click('[data-action="feedback"]');
    await regression.waitForFunction(() => window.ffs.feedback?.review?.direction === 'A new typed instruction must survive reopening');
    assert(await regression.inputValue('#feedback-instruction') === 'A new typed instruction must survive reopening', 'text-only draft was not durable');
    await connectFixture(regression);
    await regression.waitForFunction(() => /ready/.test(document.querySelector('#chat').textContent));
    await regression.click('#feedback-toolbar [data-feedback="send"]');
    await regression.waitForFunction(() => window.ffs.feedback.review.phase === 'idle' && !window.ffs.feedback.review.direction && !window.ffs.feedback.sending && window.ffs.pendingProposal);
    const beforeReject = await regression.evaluate(() => JSON.stringify(window.ffs.doc));
    await regression.click('[data-action="reject-proposal"]');
    assert(await regression.evaluate(before => !window.ffs.pendingProposal && JSON.stringify(window.ffs.doc) === before, beforeReject), 'Reject changed the film or retained the pending proposal');
    assert(!failures.length, failures.join('\n'));
    return { rms: proof.rms, replay_s: proof.duration, movie_bytes: proof.savedBytes, anchor_frame: anchor, immersive: true, proposalAppliedUndoneSaved: true, directSend: true, multiVideoRetention: true, typedDraftDurable: true, typedDraftSubmitted: true, proposalRejected: true };
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(out, 'feedback-failure.png') }).catch(() => {});
      const state = await page.evaluate(async () => ({
        phase: document.querySelector('#feedback-toolbar')?.dataset.phase,
        status: document.querySelector('#feedback-status')?.textContent,
        review: window.ffs?.feedback?.review?.phase,
        transcript: window.ffs?.feedback?.review?.transcript,
        input: document.querySelector('#feedback-transcript')?.value,
        saved: window.ffs?.feedback ? (await (await import('/app/src/feedback/persist.js')).latestLocalReview(window.ffs.doc.id, window.ffs.videoId))?.review?.transcript : null,
      })).catch(() => null);
      fs.writeFileSync(path.join(out, 'feedback-failure.json'), JSON.stringify({ error: error.message, failures, state }, null, 2));
      console.error(JSON.stringify({ failures, state }));
    }
    throw error;
  } finally {
    await browser.close();
    if (bridge.exitCode === null) bridge.kill('SIGTERM');
  }
}

async function editReview(page) {
  if (!await page.locator('#feedback-review-edit').evaluate(node => node.open)) await page.click('#feedback-review-edit summary');
}

async function connectFixture(page) {
  if (await page.locator('#review-agent-options').count() && !await page.locator('#review-agent-options').evaluate(node => node.open)) await page.click('#review-agent-options summary');
  await page.click('[data-agent="fixture"]');
}

async function viewerMenu(page, action) {
  await page.locator('#review-menu').evaluate(node => { node.open = true; });
  await page.click(`#review-menu [data-feedback="${action}"]`);
  await page.locator('#review-menu').evaluate(node => { node.open = false; });
}
async function viewerProof(page, assert, label) {
  const rendered = await page.locator('#canvas').screenshot();
  const pixels = await page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 64, 36); image.close();
    const actual = ctx.getImageData(0, 0, 64, 36).data;
    ctx.drawImage(document.querySelector('#preview-video'), 0, 0, 64, 36);
    const source = ctx.getImageData(0, 0, 64, 36).data;
    let matching = 0;
    for (let i = 0; i < source.length; i += 4) if (Math.abs(actual[i] - source[i]) + Math.abs(actual[i+1] - source[i+1]) + Math.abs(actual[i+2] - source[i+2]) < 120) matching++;
    return matching / (source.length / 4);
  }, rendered.toString('base64'));
  assert(pixels > .45, label + ': rendered source is covered or not the decoded film (' + pixels + ')');
  const proof = await page.evaluate(() => {
    const video = document.querySelector('#preview-video');
    const film = document.querySelector('#canvas');
    const b = film.getBoundingClientRect();
    const shell = document.querySelector('#review-viewer').getBoundingClientRect();
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const ctx = c.getContext('2d'); ctx.drawImage(video, 0, 0, 64, 36);
    const a = ctx.getImageData(0, 0, 64, 36).data;
    let lit = 0; for (let i=0;i<a.length;i+=4) if(a[i]+a[i+1]+a[i+2]>100) lit++;
    return { lit, width:b.width, height:b.height, inside:b.x>=-1&&b.y>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1, top:film.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)), full:Math.abs(shell.height-innerHeight)<=2&&Math.abs(shell.width-innerWidth)<=2 };
  });
  assert(proof.lit>500&&proof.width>100&&proof.height>60&&proof.inside&&proof.top&&proof.full, label+': black/obscured/overflowing film '+JSON.stringify(proof));
}

function inkCount(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#feedback-ink');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 180 && data[i + 2] > 120 && data[i + 1] < 80) count += 1;
    return count;
  });
}
