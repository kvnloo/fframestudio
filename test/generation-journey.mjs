import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function makeGenerationFixture(library) {
  const dir = path.join(library, 'generation-demo');
  fs.cpSync(path.join(library, 'demo'), dir, { recursive: true });
  const file = path.join(dir, 'project.json'), doc = JSON.parse(fs.readFileSync(file));
  doc.id = 'generation-demo'; doc.title = 'Generation test';
  fs.writeFileSync(file, JSON.stringify(doc));
}
export async function verifyGeneration({ context, base, out, library, assert }) {
  const page = await context.newPage();
  try {
    await page.goto(base + '/#/p/generation-demo');
    await page.waitForFunction(() => window.ffs?.doc && !window.ffs.loading && window.ffs.journal);
    const original = await page.evaluate(() => structuredClone(window.ffs.video.clips));
    await page.locator('[data-slate-tab="generate"]').click();
    await page.waitForFunction(() => document.querySelector('#gen-model')?.value === 'fake');
    await page.locator('#gen-prompt').fill('A warm beam of light crosses a teal studio.');
    await page.locator('#gen-seed').fill('123');
    await page.route('**/generation/jobs', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      await page.waitForSelector('[data-gen-action="insert"]', { timeout: 30000 });
      await route.fulfill({ response });
    }, { times: 1 });
    await page.locator('#gen-submit').click();
    await page.waitForSelector('[data-gen-job]');
    // Editor commands stay interactive while a separate worker is generating.
    const commandMs = await page.evaluate(async () => {
      const start = performance.now(); await window.ffs.run({ type: 'edit-text', clipId: window.ffs.video.clips[0].id, field: 'title', value: 'Interactive during generation' }); await window.ffs.run({ type: 'undo' }); return performance.now() - start;
    });
    await page.waitForSelector('[data-gen-action="insert"]', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#gen-submit').disabled);
    assert(await page.locator('[data-gen-action="insert"]').count() === 1, 'late queued response regressed completed job');
    const jobId = await page.locator('[data-gen-job]').first().getAttribute('data-gen-job');
    await page.waitForFunction(() => document.querySelector('.gen-preview video')?.readyState >= 2);
    await page.locator('#generate-pane').evaluate(n => { n.scrollTop = 0; });
    await page.screenshot({ path: path.join(out, 'generation-form.png') });
    await page.locator('[data-gen-job]').first().scrollIntoViewIfNeeded();
    await page.locator('.gen-preview video').evaluate(async v => {
      const frame = new Promise(resolve => v.addEventListener('seeked', resolve, { once: true }));
      const presented = v.requestVideoFrameCallback ? new Promise(resolve => v.requestVideoFrameCallback(resolve)) : Promise.resolve();
      v.currentTime = 0.25; await Promise.all([frame, presented]);
    });
    await page.screenshot({ path: path.join(out, 'generation-variations.png') });
    await page.locator('[data-gen-action="insert"]').first().click();
    await page.waitForFunction(n => window.ffs.video.clips.length === n + 1, original.length);
    const inserted = await page.evaluate(() => ({ clip: window.ffs.video.clips.at(-1), media: window.ffs.doc.media.at(-1) }));
    assert(inserted.clip.mediaId === inserted.media.id, 'generated clip does not reference asset');
    assert(inserted.media.generation.seed === 123, 'seed missing from imported provenance');
    await page.locator('[data-action="undo"]').click();
    const undone = await page.evaluate(() => window.ffs.video.clips);
    assert(JSON.stringify(undone) === JSON.stringify(original), 'undo did not restore original clips');
    assert(fs.existsSync(path.join(library, 'generation-demo/media/generated', jobId, 'result.mp4')), 'undo deleted generated original');
    await page.locator('[data-action="redo"]').click();
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
    const saved = JSON.parse(fs.readFileSync(path.join(library, 'generation-demo/project.json')));
    assert(saved.media.some(m => m.id === inserted.media.id && m.generation.seed === 123), 'generation missing from saved project');
    await page.reload();
    await page.waitForFunction(n => window.ffs?.video?.clips.length === n + 1 && !window.ffs.loading, original.length);
    assert(await page.evaluate(id => window.ffs.doc.media.some(m => m.id === id && m.generation.seed === 123), inserted.media.id), 'reopen lost asset settings');
    await page.screenshot({ path: path.join(out, 'generation-reopened.png') });
    const i2v = await verifyPlayheadI2V({ page, out, library, assert });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-slate-tab="generate"]').click();
    await page.waitForSelector('[data-gen-action="insert"]');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!overflow, 'generation panel overflows phone width');
    await page.locator('[data-gen-job]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'generation-phone.png'), fullPage: true });
    await page.locator('[data-slate-tab="shot"]').click();
    return { provider: 'fake-not-ai', jobId, seed: 123, i2v, generate_insert_undo_redo_save_reopen: true, generation_command_pair_ms: commandMs, phone_no_overflow: true };
  } finally { await page.close(); }
}

// Image-to-video from the playhead with the FAKE provider (holds the reference frame; not AI).
async function verifyPlayheadI2V({ page, out, library, assert }) {
  await page.locator('[data-slate-tab="generate"]').click();
  await page.waitForFunction(() => document.querySelector('#gen-model')?.value === 'fake' && !document.querySelector('#gen-mode-i2v').disabled);
  const before = await page.evaluate(() => structuredClone(window.ffs.video.clips));
  const target = await page.evaluate(() => { const c = window.ffs.video.clips[1] || window.ffs.video.clips[0]; const f = c.start + Math.floor(c.duration / 2); window.ffs.seek(f); return { frame: f, clipId: c.id }; });
  const preview = () => page.evaluate(() => { const v = document.querySelector('#preview-video'); return { src: v.getAttribute('src'), time: v.currentTime, paused: v.paused, videos: document.querySelectorAll('video').length }; });
  const previewBefore = await preview();
  await page.locator('#gen-mode').selectOption('i2v');
  await page.locator('#gen-resolution').selectOption('704x480');
  await page.locator('#gen-capture').click();
  await page.waitForFunction(() => document.querySelector('#gen-reference-img')?.naturalWidth === 704);
  const previewAfter = await preview();
  assert(previewAfter.src === previewBefore.src && Math.abs(previewAfter.time - previewBefore.time) < 1e-6 && previewAfter.videos === previewBefore.videos, 'capture seeked or replaced the playing preview');
  const meta = await page.locator('#gen-reference-meta').textContent();
  assert(meta.includes('frame ' + target.frame), 'reference caption lacks the playhead frame: ' + meta);
  // Pixel check against an independent FFmpeg decode of the same source frame (cover-crop to 704x480).
  const source = await page.evaluate(async () => { const m = await import('/app/src/generation.js'); const s = m.playheadSource(window.ffs.doc, window.ffs.video, window.ffs.frame); return { file: s.file, seekTime: s.seekTime }; });
  const captured = await page.evaluate(async () => { const img = document.querySelector('#gen-reference-img'); const c = new OffscreenCanvas(1, 1), g = c.getContext('2d'); g.drawImage(img, 0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; });
  const projectDir = path.join(library, 'generation-demo');
  const expected = [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(source.seekTime), '-i', path.isAbsolute(source.file) ? source.file : path.join(projectDir, source.file), '-frames:v', '1', '-vf', 'scale=704:480:force_original_aspect_ratio=increase,crop=704:480,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
  const delta = Math.max(...captured.map((v, i) => Math.abs(v - expected[i])));
  assert(delta <= 24, `captured reference does not match the source frame: ${captured} vs ${expected}`);
  await page.locator('#gen-prompt').fill('The captured frame slowly comes alive.');
  await page.locator('#gen-seed').fill('77');
  await page.locator('#generate-pane').evaluate(n => { n.scrollTop = 0; });
  await page.locator('#gen-reference').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'generation-i2v-reference.png') });
  await page.locator('#gen-submit').click();
  await page.waitForSelector('[data-gen-job] .gen-from');
  const jobId = await page.locator('[data-gen-job]:has(.gen-from)').first().getAttribute('data-gen-job');
  const insert = page.locator(`[data-gen-job="${jobId}"] [data-gen-action="insert"]`);
  await insert.waitFor({ timeout: 30000 });
  await page.waitForFunction(id => document.querySelector(`[data-gen-job="${id}"] .gen-from img`)?.naturalWidth > 0, jobId);
  await page.locator(`[data-gen-job="${jobId}"]`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'generation-i2v-job.png') });
  await insert.click();
  await page.waitForFunction(n => window.ffs.video.clips.length === n + 1, before.length);
  const media = await page.evaluate(() => window.ffs.doc.media.at(-1));
  const ref = media.generation.reference;
  assert(media.generation.mode === 'i2v' && ref.frame === target.frame && ref.clipId === target.clipId && Number.isFinite(ref.sourceTime) && /^[a-f0-9]{64}$/.test(ref.sha256), 'i2v provenance missing from inserted asset');
  assert(fs.existsSync(path.join(projectDir, ref.file)), 'reference frame missing on disk');
  await page.locator('[data-action="undo"]').click();
  assert(JSON.stringify(await page.evaluate(() => window.ffs.video.clips)) === JSON.stringify(before), 'undo did not remove the i2v shot');
  assert(fs.existsSync(path.join(projectDir, 'media/generated', jobId, 'result.mp4')) && fs.existsSync(path.join(projectDir, ref.file)), 'undo deleted generated media or reference');
  await page.locator('[data-action="redo"]').click();
  assert(await page.evaluate(n => window.ffs.video.clips.length === n + 1, before.length), 'redo did not restore the i2v shot');
  await page.locator('[data-action="undo"]').click();
  await page.locator('#gen-mode').selectOption('t2v');
  return { provider: 'fake-not-ai', jobId, frame: target.frame, previewUntouched: true, pixelDelta: delta, insert_undo_redo: true };
}
