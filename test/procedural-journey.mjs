import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

export async function verifyProcedural({page, base, library, out, assert, real = false}) {
  const originalSize = page.viewportSize();
  await page.setViewportSize({width:1896,height:880});
  const results = [];
  try {
    for (const id of ['ff-tracking','ff-unmute']) {
      const file = path.join(library,id,'project.json'), before = fs.readFileSync(file);
      const raw = JSON.parse(before), p = raw.procedural || raw.metadata?.procedural;
      let camera = null;
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
      if (!p.render_verified) assert(await page.locator('.source-no-render').isVisible(),'metadata-only canvas implies a rendered preview');
      await page.locator('#source-pane').evaluate(n=>n.scrollTop=0);
      await page.screenshot({path:path.join(out,`${real?'real':'synthetic'}-${id}-source.png`)});
      if (id === 'ff-unmute') {
        await panel.locator('[data-source-event="kick"]').first().scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(out,`${real?'real':'synthetic'}-${id}-events.png`)});
        await panel.getByText(/^Camera values ·/).click();
        await panel.locator('.source-camera').first().locator('summary').click();
        await panel.locator('.source-camera').first().scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(out,`${real?'real':'synthetic'}-${id}-camera.png`)});
        camera = await editCameraOverrides({page,panel,p,out,assert,real});
      }
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
      if (camera) camera = {...camera, ...await reopenAndExport({page,file,saved,camera,out,assert,real})};
      results.push({id,shots:clips.length,frames:clips.map(c=>c.duration),renderVerified:p.render_verified,readOnly:true,saveReopen:true,revision:p.source_revision,...(camera ? {camera} : {})});
    }
    return {sources:results};
  } finally {
    await page.setViewportSize(originalSize);
  }
}

// Pick a key whose nearest measured/score event keeps key order (real and synthetic sources differ).
function snapTarget(p) {
  const ks = p.camera_keyframes, end = p.total_frames / p.fps;
  for (let i = 1; i < ks.length; i++) for (const kind of ['kick','clap','token']) {
    const times = p.event_seconds?.[kind] || [];
    if (!times.length) continue;
    const j = times.reduce((b,t,k)=>Math.abs(t-ks[i].time_s) < Math.abs(times[b]-ks[i].time_s) ? k : b, 0), t = times[j];
    const hi = i + 1 < ks.length ? ks[i+1].time_s : end;
    if (t !== ks[i].time_s && t - ks[i-1].time_s >= 1e-3 && (i + 1 < ks.length ? hi - t >= 1e-3 : t <= end)) return {key:i, kind, index:j+1, seconds:t};
  }
  throw Error('no order-preserving snap target in this source');
}
async function editCameraOverrides({page,panel,p,out,assert,real}) {
  const tag = real ? 'real' : 'synthetic', box = page.locator('#procedural-overrides');
  const sourceHtml = await panel.innerHTML();
  await box.scrollIntoViewIfNeeded();
  assert((await box.textContent()).includes('Not rendered'),'working copy must say it is not rendered');
  assert((await box.textContent()).includes('matches source'),'fresh import must have no overrides');
  const target = snapTarget(p), value = `${target.kind}:${target.index}`;
  await box.locator(`[data-camera-snap="${target.key}"]`).selectOption(value);
  await page.waitForFunction(k => window.ffs.doc.metadata.proceduralOverrides?.camera_keyframes[k], target.key);
  const snapped = await page.evaluate(k => window.ffs.doc.metadata.proceduralOverrides.camera_keyframes[k].time_s, target.key);
  assert(snapped === target.seconds, `snap must use exact ${target.kind} seconds (${snapped} != ${target.seconds})`);
  // Invalid value: inline error, document unchanged.
  const bad = box.locator('[data-camera-key="1"][data-camera-field="zoom"]');
  const beforeBad = await page.evaluate(() => JSON.stringify(window.ffs.doc.metadata.proceduralOverrides));
  await bad.fill('0.5'); await bad.dispatchEvent('change');
  await page.locator('#procedural-overrides .cam-error').waitFor();
  assert((await page.locator('#procedural-overrides .cam-error').textContent()).includes('zoom must be'),'invalid zoom not explained');
  assert(await page.evaluate(() => JSON.stringify(window.ffs.doc.metadata.proceduralOverrides)) === beforeBad,'invalid edit changed the document');
  const zoom = Math.min(20, p.camera_keyframes[target.key].zoom + 0.25);
  const input = page.locator(`#procedural-overrides [data-camera-key="${target.key}"][data-camera-field="zoom"]`);
  const history = await page.evaluate(() => window.ffs.store.past.length);
  await input.fill(String(zoom)); await input.dispatchEvent('change');
  await page.waitForFunction(([k,z]) => window.ffs.doc.metadata.proceduralOverrides?.camera_keyframes[k].zoom === z, [target.key, zoom]);
  await input.dispatchEvent('change');
  assert(await page.evaluate(() => window.ffs.store.past.length) === history + 1,'one value edit must add exactly one undo step');
  assert((await page.locator('#procedural-overrides h3').textContent()).includes('2 overrides'),'override count not shown');
  assert(await page.locator('#procedural-overrides .cam-error').count() === 0,'stale error after a valid edit');
  const curves = await page.$$eval('#procedural-overrides polyline', ls => ls.map(l => l.getAttribute('points')));
  assert(curves.length === 2 && curves[0] !== curves[1],'source and working-copy curves must both show and differ');
  assert(await panel.innerHTML() === sourceHtml,'read-only source panel changed while editing overrides');
  assert(await panel.locator('input,textarea,select,button').count() === 0,'source panel gained controls');
  await page.click('[data-action="undo"]');
  await page.waitForFunction(([k,z]) => window.ffs.doc.metadata.proceduralOverrides?.camera_keyframes[k].zoom !== z, [target.key, zoom]);
  await page.click('[data-action="redo"]');
  await page.waitForFunction(([k,z]) => window.ffs.doc.metadata.proceduralOverrides?.camera_keyframes[k].zoom === z, [target.key, zoom]);
  await page.locator('#procedural-overrides').evaluate(n => n.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(out,`${tag}-ff-unmute-camera-overrides.png`)});
  await page.locator('#procedural-overrides .cam-table').evaluate(n => n.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(out,`${tag}-ff-unmute-camera-table.png`)});
  return {...target, zoom, sourcePanelUnchanged:true, undoRedo:true};
}
async function reopenAndExport({page,file,saved,camera,out,assert,real}) {
  const o = saved.metadata.proceduralOverrides;
  assert(o?.camera_keyframes[camera.key].time_s === camera.seconds && o.camera_keyframes[camera.key].zoom === camera.zoom,'save lost camera overrides');
  await page.click('[data-slate-tab="source"]');
  await page.locator('#procedural-overrides').waitFor({state:'visible'});
  assert((await page.locator('#procedural-overrides h3').textContent()).includes('2 overrides'),'overrides did not reopen');
  assert(await page.locator(`#procedural-overrides [data-camera-reset="${camera.key}"]`).count() === 1,'reset control missing after reopen');
  // Write the saved overrides into an isolated working copy and prove the round trip.
  const source = saved.metadata.edit_in?.local, work = fs.mkdtempSync(path.join(os.tmpdir(),'ffs-remix-'));
  assert(source && fs.existsSync(path.join(source,'hud/src/lib.rs')),'imported source path missing');
  const before = fs.readFileSync(path.join(source,'hud/src/lib.rs'));
  try {
    const args = ['tools/procedural_overrides.py','export','--source',source,'--project',file,'--out',path.join(work,'remix'),...(real ? ['--cargo-test'] : [])];
    const r = spawnSync('python3',args,{encoding:'utf8'});
    fs.writeFileSync(path.join(out,`${real?'real':'synthetic'}-ff-unmute-remix-receipt.json`), r.stdout || r.stderr);
    assert(fs.readFileSync(path.join(source,'hud/src/lib.rs')).equals(before),'export wrote the source checkout');
    if (real && r.status === 3) return {export:'round-trip ok; cargo test -p hud FAILED', receipt:JSON.parse(r.stdout)};
    assert(r.status === 0, 'working-copy export failed: ' + (r.stderr || r.stdout).slice(-400));
    const receipt = JSON.parse(r.stdout);
    assert(receipt.round_trip && receipt.source_unchanged && !receipt.rendered,'remix receipt claims too much or too little');
    assert(receipt.changed.length === 2,'remix receipt change count');
    return {export:'round-trip ok', hudTests:receipt.hud_tests};
  } finally { fs.rmSync(work,{recursive:true,force:true}); }
}
