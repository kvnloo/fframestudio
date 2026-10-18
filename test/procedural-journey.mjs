import fs from 'node:fs';
import path from 'node:path';

export async function verifyProcedural({page, base, library, out, assert, real = false}) {
  const originalSize = page.viewportSize();
  await page.setViewportSize({width:1896,height:880});
  const results = [];
  try {
    for (const id of ['ff-tracking','ff-unmute']) {
      const file = path.join(library,id,'project.json'), before = fs.readFileSync(file);
      const raw = JSON.parse(before), p = raw.procedural || raw.metadata?.procedural;
      await page.goto(`${base}/#/p/${id}`);
      await page.waitForFunction(id => window.ffs?.doc?.id === id && window.ffs.journal, id);
      const clips = await page.evaluate(() => window.ffs.video.clips.map(c=>({duration:c.duration,sourceIn:c.sourceIn})));
      assert(clips.length === (id === 'ff-tracking' ? 12 : 1), 'procedural physical shot count');
      assert(clips.every(c=>c.duration === (id === 'ff-tracking' ? 15 : 480)), 'source duration mismatch');
      await page.click('[data-slate-tab="source"]');
      const panel = page.locator('#procedural-source');
      await panel.waitFor({state:'visible'});
      assert((await panel.textContent()).includes('Source — read-only'),'missing read-only label');
      assert(await panel.locator('input,textarea,select,button').count() === 0,'source exposes fake writable controls');
      assert((await panel.textContent()).includes('Mustafa Saraç'),'source credit missing');
      assert((await panel.textContent()).includes('Future writable surface'),'future scope missing');
      if (id === 'ff-tracking') {
        assert(await panel.locator('[data-source-shot]').count() === 12,'shot grid missing');
        const names = await panel.locator('.source-palette>span').allTextContents();
        assert(names.join(',') === 'Paper,Thermal,Mono,Phosphor,Amber,Navy,Neon','named palettes missing');
        await panel.locator('[data-source-shot]').first().locator('summary').click();
        assert((await panel.locator('[data-source-shot]').first().textContent()).includes('tilt_x'),'camera not inspectable');
        assert((await panel.textContent()).includes('nooga'),'optional score credit missing');
      } else {
        assert(p.bpm === 120,'source tempo wrong');
        assert(await panel.locator('.source-wave line').count() > 0,'source waveform missing');
        for (const kind of ['bar','kick','clap','token']) {
          const shown = await panel.locator(`[data-source-event="${kind}"]`).evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.frame)));
          assert(JSON.stringify(shown) === JSON.stringify(p.event_frames[kind]), `${kind} frame alignment`);
        }
        const keys = await panel.locator('[data-source-event="camera"]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.frame)));
        assert(JSON.stringify(keys) === JSON.stringify(p.camera_keyframes.map(k=>k.frame)), 'camera track alignment');
      }
      if (real && p.render_verified) {
        await page.waitForFunction(()=>document.querySelector('#preview-video').readyState>=2);
        assert(await page.$eval('#preview-video',v=>v.videoWidth>0),'real render not decoded');
      }
      await page.screenshot({path:path.join(out,`${real?'real':'synthetic'}-${id}-source.png`)});
      await page.click('[data-slate-tab="shot"]');
      assert(await page.locator('.procedural-selected').isVisible(),'selected source inspector missing');
      await page.screenshot({path:path.join(out,`${real?'real':'synthetic'}-${id}-shot.png`)});
      await page.click('[data-action="save"]');
      await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='Saved');
      const saved = JSON.parse(fs.readFileSync(file));
      assert(saved.schema === 'fframestudio.project/1','source project did not migrate');
      assert(JSON.stringify(saved.metadata.procedural)===JSON.stringify(p),'save lost provenance');
      await page.reload();
      await page.waitForFunction(()=>window.ffs?.journal);
      assert(await page.locator('.procedural-selected').isVisible(),'source inspector did not reopen');
      results.push({id,shots:clips.length,frames:clips.map(c=>c.duration),renderVerified:p.render_verified,readOnly:true,saveReopen:true,revision:p.source_revision});
    }
    return {sources:results};
  } finally {
    await page.setViewportSize(originalSize);
  }
}
