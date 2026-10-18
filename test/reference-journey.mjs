import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
export async function verifyReference({page,base,out,journey,assert,library}) {
  const ready=()=>page.waitForFunction(()=>window.ffs?.interactiveAt&&!window.ffs.loading);
  let projectId;
  await page.setViewportSize({width:1440,height:900});
  await journey('actions: palette/menu/shortcut/agent share one registry',async()=>{
    const demo=JSON.parse(fs.readFileSync(path.join(library,'library.json'),'utf8')).projects.find(p=>p.title==='Demo film');
    assert(demo,'demo fixture missing');await page.goto(base+'/#/p/'+demo.id);await ready();
    // Existing full journeys cover each native menu and shortcut behaviour; compare exact edits here.
    const results=[];
    await page.click('[data-action="palette"]');await page.fill('#command-search','duplicate');
    assert(await page.locator('#command-list [data-action="duplicate"]').count()===1,'palette did not resolve registry action');
    await page.click('#command-list [data-action="duplicate"]');await page.waitForFunction(()=>window.ffs.video.clips.length===5);
    results.push(await page.evaluate(()=>window.ffs.video.clips.map(c=>c.name)));await page.click('[data-action="undo"]');
    await page.locator('.timeline-clip').first().click({button:'right'});await page.click('[data-menu-action="duplicate"]');
    await page.waitForFunction(()=>window.ffs.video.clips.length===5);results.push(await page.evaluate(()=>window.ffs.video.clips.map(c=>c.name)));await page.click('[data-action="undo"]');
    await page.locator('#canvas').focus();await page.keyboard.press('Control+d');await page.waitForFunction(()=>window.ffs.video.clips.length===5);results.push(await page.evaluate(()=>window.ffs.video.clips.map(c=>c.name)));await page.click('[data-action="undo"]');
    await page.evaluate(async()=>{const e=window.ffs;await e.receiveProposal({schema:'fframestudio.proposal/1',projectId:e.doc.id,baseRevision:e.doc.revision,title:'Registry action proposal',commands:[{id:'duplicate',params:{clipId:e.selection,newId:'agent-copy'}}]});});
    const before=await page.evaluate(()=>window.ffs.video.clips.length);assert(before===4,'agent applied before confirmation');
    await page.click('[data-action="apply-proposal"]');results.push(await page.evaluate(()=>window.ffs.video.clips.map(c=>c.name)));assert(results.every(x=>JSON.stringify(x)===JSON.stringify(results[0])),'input paths produced different edits');
    await page.click('[data-action="undo"]');await page.click('[data-action="save"]');await page.waitForFunction(()=>!window.ffs.saving&&!window.ffs.dirty);
    return {routes:['palette','context menu','shortcut','ACP proposal'],identicalEdits:true};
  });
  await journey('reference: import -> analyze -> recreate',async()=>{
    const file=path.join(out,'cc0-colour-tone.mp4');
    const generated=spawnSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=red:s=320x180:r=30:d=3','-f','lavfi','-i','color=blue:s=320x180:r=30:d=3','-f','lavfi','-i','color=green:s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=9','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-y',file],{encoding:'utf8'});assert(generated.status===0,generated.stderr);
    await page.click('[data-action="import-reference"]');await page.setInputFiles('#reference-file',file);await page.waitForSelector('#reference-analyze:enabled');
    await page.click('#reference-analyze');await page.waitForSelector('#reference-recreate:enabled',{timeout:90000});assert(await page.locator('[data-reference-shot]').count()===3,'missing detected shots');
    await page.locator('[data-reference-shot="2"]').click();assert(Math.abs(await page.$eval('#reference-original',v=>v.currentTime)-3)<.05,'breakdown click did not seek');
    await page.screenshot({path:path.join(out,'reference-breakdown.png')});
    const measured=await page.evaluate(()=>window.ffs.reference.analysis);assert(measured.shots[1].startFrame===90&&measured.shots[2].startFrame===180,'cut frame evidence wrong');
    // Cached replay retains content identity and does not launch another ffmpeg pass.
    await page.click('#reference-analyze');await page.waitForFunction(()=>document.querySelector('#reference-status').textContent.includes('Cached analysis'));
    await page.click('#reference-recreate');await page.waitForFunction(()=>window.ffs?.doc.id.startsWith('recreated-'));await ready();
    projectId=await page.evaluate(()=>window.ffs.doc.id);const doc=await page.evaluate(()=>window.ffs.doc);
    assert(doc.videos[0].clips.length===3&&doc.metadata.reference.approximation,'not an editable approximation');
    const saved=JSON.parse(fs.readFileSync(path.join(library,projectId,'project.json'),'utf8'));assert(saved.videos[0].clips[1].sourceIn===90,'source range not saved');assert(fs.statSync(path.join(library,projectId,'source.mp4')).size>0,'source media missing');
    await page.click('[data-action="compare-reference"]');await page.waitForSelector('#reference-reconstruction:visible');await page.waitForFunction(()=>document.querySelector('#reference-original').readyState>=2&&document.querySelector('.reference-rebuilt video').readyState>=2);
    await page.fill('#reference-scrub','135');await page.dispatchEvent('#reference-scrub','input');await page.waitForFunction(()=>!document.querySelector('#reference-original').seeking&&!document.querySelector('.reference-rebuilt video').seeking);
    const sync=await page.evaluate(()=>[document.querySelector('#reference-original').currentTime,document.querySelector('.reference-rebuilt video').currentTime]);assert(sync.every(t=>Math.abs(t-4.5)<.05),'comparison is not synchronized');
    await page.screenshot({path:path.join(out,'reference-side-by-side.png')});await page.click('#reference-close');
    return {generatedLicence:'CC0 (solid-colour/tone fixture authored for this test)',cuts:measured.shots.map(s=>s.startFrame),cached:true,editable:true,comparison:sync};
  });
  await journey('voice: typed-fallback says shorten the second shot by one second, change the text, undo',async()=>{
    await page.evaluate(()=>{window.ffs.voice.panel.hidden=false;});
    const direction=async text=>{await page.fill('#voice-transcript',text);await page.click('#voice-form button');};
    await direction('shorten the second shot by one second');await page.waitForSelector('#voice-confirm:visible');
    assert(await page.evaluate(()=>window.ffs.video.clips[1].duration)===90,'destructive trim applied without confirmation');
    await page.click('#voice-confirm');await page.waitForFunction(()=>window.ffs.video.clips[1].duration===60);
    await direction('select the second shot');await page.waitForFunction(()=>window.ffs.selection===window.ffs.video.clips[1].id);
    await direction("change the text to 'A voice-directed title'");await page.waitForFunction(()=>window.ffs.video.clips[1].textOverrides.title==='A voice-directed title');
    await page.screenshot({path:path.join(out,'voice-typed-fallback.png')});
    await direction('undo');await page.waitForFunction(()=>window.ffs.video.clips[1].textOverrides.title===undefined);
    assert(await page.evaluate(()=>window.ffs.video.clips[1].duration)===60,'undo reverted wrong action');
    await direction('shorten the second shot');assert((await page.locator('#voice-preview').innerText()).includes('precise action'),'ambiguous intent did not ask for clarification');
    await page.click('#voice-close');await page.click('[data-action="save"]');await page.waitForFunction(()=>!window.ffs.saving&&!window.ffs.dirty);
    const saved=JSON.parse(fs.readFileSync(path.join(library,projectId,'project.json'),'utf8'));assert(saved.videos[0].clips[1].duration===60&&saved.videos[0].clips[1].textOverrides.title===undefined,'saved voice edits incorrect');
    await page.reload();await ready();assert(await page.evaluate(()=>window.ffs.video.clips[1].duration)===60,'voice edit lost on reload');
    return {typedFallback:true,previewConfirm:true,undo:true,savedReopened:true,realMic:'NOT RUN'};
  });
}
