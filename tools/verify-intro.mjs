#!/usr/bin/env node
// Optional real-media journey. No Rust/GPU build and no user library/bridge writes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {staticSite} from '../test/static-site.mjs';
const artifact=process.env.FFS_INTRO_ARTIFACT;
if(!artifact||!fs.existsSync(path.join(artifact,'project.json'))){console.log(JSON.stringify({skipped:true,reason:'Set FFS_INTRO_ARTIFACT to the locally rendered intro project folder.'}));process.exit(0);}
const out=path.resolve(process.env.FFS_EVIDENCE||'verify-out/intro');fs.mkdirSync(out,{recursive:true});
const work=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-intro-')),site=path.join(work,'site');
const result=spawnSync('python3',['tools/build_demo_site.py','--out',site,'--examples',path.join(work,'absent')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
const server=await staticSite(site),browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--autoplay-policy=no-user-gesture-required']});
const report={seeks:[],screenshots:[]};
try{
 const context=await browser.newContext({viewport:{width:1896,height:880}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.base);await page.waitForSelector('#folder-files');
 // Import only the project package, not the upstream checkout or native master.
 const input=path.join(work,'local-film');fs.mkdirSync(input);
 for(const name of ['project.json','proxy.mp4','poster.webp'])fs.copyFileSync(path.join(artifact,name),path.join(input,name));
 const before=fs.readFileSync(path.join(input,'project.json'),'utf8');
 await page.locator('#folder-files').setInputFiles(input);await page.click('.card[data-project="fframes-intro"]');
 await page.waitForFunction(()=>window.ffs?.interactiveAt&&!window.ffs.loading);
 await page.waitForFunction(()=>document.querySelector('#preview-video').readyState>=2);
 const duration=await page.locator('#preview-video').evaluate(v=>v.duration);assert.ok(Math.abs(duration-127.5)<.1);
 const document=JSON.parse(before);assert.equal(document.schema,'fframestudio.project/1');assert.equal(document.videos[0].clips.length,16);assert.equal(document.videos[0].scenes.length,16);assert.deepEqual(document.videos[0].beats,[]);
 await page.waitForFunction(()=>window.ffs.studio.analysisState==='ready',null,{timeout:60000});
 assert.ok(await page.locator('#audio-wave').isVisible());
 const audio=await page.locator('#preview-video').evaluate(v=>({decoded:v.webkitAudioDecodedByteCount||0,tracks:v.audioTracks?.length||0}));assert.ok(audio.decoded>0||audio.tracks>0,'browser has no decoded audio');
 for(const index of [0,10,15]){
   // Real scene navigation, not a direct HTMLVideoElement-only seek.
   const id=document.videos[0].clips[index].id;
   const selector=`.story-card[data-select="${id}"]`;
   let target=page.locator(selector);
   // Story is windowed; the timeline contains all 16 clips at fit scale.
   target=page.locator(`#timeline .timeline-clip[data-select="${id}"]`);
   await target.click({position:{x:Math.max(1,(await target.boundingBox()).width/2),y:10}});
   const expected=document.videos[0].clips[index].start/60;
   await page.waitForFunction(t=>Math.abs(document.querySelector('#preview-video').currentTime-t)<.1,expected);
   await page.waitForFunction(()=>!document.querySelector('#preview-video').seeking&&document.querySelector('#preview-video').readyState>=2);
   report.seeks.push({scene:id,expected,actual:await page.locator('#preview-video').evaluate(v=>v.currentTime)});
 }
 for(const frame of [0,3825,7649]){
   await page.locator('#seek').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},frame);
   await page.waitForFunction(t=>Math.abs(document.querySelector('#preview-video').currentTime-t)<.04,frame/60);
   await page.waitForFunction(()=>!document.querySelector('#preview-video').seeking&&document.querySelector('#preview-video').readyState>=2);
   report.seeks.push({scrubFrame:frame,actual:await page.locator('#preview-video').evaluate(v=>v.currentTime)});
 }
 // Back to the final scene before testing play (the last frame cannot advance).
 await page.locator('#seek').evaluate(input=>{input.value='6674';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.click('[data-action="mute"]');assert.equal(await page.locator('#preview-video').evaluate(v=>v.muted),false,'embedded soundtrack stayed muted');
 await page.click('[data-action="play"]');const start=await page.locator('#preview-video').evaluate(v=>v.currentTime);
 await page.waitForFunction(t=>document.querySelector('#preview-video').currentTime>t+.2,start);await page.click('[data-action="pause"]');
 for(const [width,height]of [[1896,880],[390,780]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(250);const file=`intro-editor-${width}x${height}.png`;
   await page.screenshot({path:path.join(out,file),fullPage:width===390});report.screenshots.push(file);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 await page.setViewportSize({width:1896,height:880});await page.click('#tab-source');
 assert.ok((await page.locator('#source-pane').innerText()).includes('Dmitriy Kovalenko'));
 assert.ok((await page.locator('#source-pane a').first().getAttribute('href')).includes('44745c09a6c8c51071609097326a820cf59d087b/examples/fframes-intro'));
 await page.screenshot({path:path.join(out,'intro-source-1896x880.png')});
 await page.reload();await page.waitForFunction(()=>window.ffs?.interactiveAt&&!window.ffs.loading);await page.waitForFunction(()=>document.querySelector('#preview-video').readyState>=2);
 assert.equal(await page.evaluate(()=>window.ffs.doc.videos[0].clips.length),16);
 assert.equal(fs.readFileSync(path.join(input,'project.json'),'utf8'),before);assert.deepEqual(errors,[]);
 Object.assign(report,{ok:true,duration,audio,scenes:16,reopened:true,sourceUnchanged:true});await context.close();
}finally{await browser.close();await server.close();fs.rmSync(work,{recursive:true,force:true});fs.writeFileSync(path.join(out,'intro-report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
