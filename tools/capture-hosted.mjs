#!/usr/bin/env node
// Capture the built site through a plain static server, never a local bridge.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {staticSite} from '../test/static-site.mjs';
const out=path.resolve(process.env.FFS_EVIDENCE||'verify-out/hosted-visual');
fs.mkdirSync(out,{recursive:true});
const server=await staticSite(path.resolve('site'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium'});
const evidence=[];
try {
  for(const [width,height] of [[1896,880],[1366,680],[390,780]]) {
    const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&u.origin!==server.base)external.push(u.origin);});
    await page.goto(server.base);await page.waitForSelector('#open-folder');await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('.card[data-project]').count(),0);
    const capture=async name=>{await page.screenshot({path:path.join(out,`${name}-${width}x${height}.png`)});evidence.push({file:`${name}-${width}x${height}.png`,width,height});};
    await capture('empty');
    await page.locator('#examples-shelf').scrollIntoViewIfNeeded();await page.waitForSelector('[data-open-example="neon-triangle"]');
    await page.locator('.example-card img').evaluateAll(images=>Promise.all(images.map(i=>{i.loading='eager';return i.decode();})));
    const feature=page.locator('[data-example="fframes-intro"]');
    await feature.evaluate(el=>window.scrollTo({top:scrollY+el.getBoundingClientRect().top-64,behavior:'instant'}));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.ok(await feature.evaluate(el=>el.getBoundingClientRect().top>=52));
    assert.equal(await feature.locator('img').count(),0,'public intro must not redistribute a derived poster');
    await capture('examples');
    assert.ok(await page.locator('.example-card').first().innerText().then(t=>t.includes('Dmitriy Kovalenko')&&t.includes('MIT')));
    await page.click('[data-open-example="neon-triangle"]');await page.waitForFunction(()=>window.ffs?.interactiveAt&&!window.ffs.loading);
    await page.waitForFunction(()=>document.querySelector('#preview-video').readyState>=2);
    await page.evaluate(async()=>{const v=document.querySelector('#preview-video');v.currentTime=2;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));});
    await page.waitForTimeout(300);
    const bounds=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,timeline:document.querySelector('.timeline-panel').getBoundingClientRect().bottom}));
    assert.ok(bounds.width<=width+1);
    if(width>=1024)assert.ok(bounds.height<=height+1&&bounds.timeline<=height);
    await capture('example-editor');
    if(width===390)await page.screenshot({path:path.join(out,'example-editor-390x780-full.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    evidence.push({viewport:[width,height],bounds,externalRequests:0,pageErrors:0});
    await context.close();
  }
}finally{await browser.close();await server.close();}
fs.writeFileSync(path.join(out,'visual-report.json'),JSON.stringify({evidence,staticRequests:server.requests.length},null,2));
console.log(JSON.stringify({screenshots:evidence.filter(e=>e.file).length,out}));
