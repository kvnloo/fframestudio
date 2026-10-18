import fs from 'node:fs';
import path from 'node:path';

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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-slate-tab="generate"]').click();
    await page.waitForSelector('[data-gen-action="insert"]');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!overflow, 'generation panel overflows phone width');
    await page.locator('[data-gen-job]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'generation-phone.png'), fullPage: true });
    await page.locator('[data-slate-tab="shot"]').click();
    return { provider: 'fake-not-ai', jobId, seed: 123, generate_insert_undo_redo_save_reopen: true, generation_command_pair_ms: commandMs, phone_no_overflow: true };
  } finally { await page.close(); }
}
