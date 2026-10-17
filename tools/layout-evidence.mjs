#!/usr/bin/env node
// Owned bridge, copied projects, read-only desktop palette and original-byte guard.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
const repo = path.resolve(new URL('..', import.meta.url).pathname);
const out = path.resolve(process.env.FFS_EVIDENCE || 'verify-out/layout-real');
const source = process.env.FFS_LIBRARY || path.join(os.homedir(),'fframestudio/projects');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'ffs-layout-real-'));
const snapshot = () => Object.fromEntries(fs.readdirSync(source).filter(n=>fs.existsSync(path.join(source,n,'project.json'))).map(n=>{const file=path.join(source,n,'project.json');return [n,{hash:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),mtime:fs.statSync(file).mtimeMs}];}));
const original = snapshot();
fs.mkdirSync(out,{recursive:true});
const copied = spawnSync('cp',['-a',source,path.join(root,'projects')]);
if(copied.status) throw Error('Library copy failed');
const port = await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const token=randomUUID();
let bridge,browser;
try {
  bridge=spawn(process.execPath,['bridge/bridge.mjs','--root',root,'--port',String(port),'--token',token,'--no-config','--theme-home',os.homedir(),'--quiet'],{cwd:repo,stdio:['ignore','pipe','pipe']});
  await Promise.race([once(bridge.stdout,'data'),once(bridge,'exit').then(()=>{throw Error('Owned bridge exited');})]);
  const base=`http://127.0.0.1:${port}`;
  if(!(await fetch(base+'/health')).ok)throw Error('Owned bridge not ready');
  browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium'});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/open?token='+token);
  await page.waitForSelector('.card');
  await page.goto(base+'/#/p/expresslane-i880');
  await page.waitForFunction(()=>window.ffs?.journal);
  await page.waitForTimeout(1200);
  const samples=[];
  for(const [width,height] of [[1896,880],[1366,680],[390,780]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.locator('[data-slate-tab="direction"]').click();
    await page.evaluate(()=>scrollTo(0,0));
    const screenshot=`after-${width}x${height}.png`;
    await page.screenshot({path:path.join(out,screenshot),fullPage:width<768});
    samples.push(await page.evaluate(({width,height,screenshot})=>({width,height,screenshot,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,timelineBottom:document.querySelector('#timeline').getBoundingClientRect().bottom,storyWords:[...document.querySelectorAll('.thumb-words')].map(n=>n.textContent),theme:document.documentElement.dataset.theme}),{width,height,screenshot}));
  }
  const unchanged=JSON.stringify(original)===JSON.stringify(snapshot());
  const report={samples,originalProjectsUnchanged:unchanged,errors};
  fs.writeFileSync(path.join(out,'real-library.json'),JSON.stringify(report,null,2));
  if(!unchanged||errors.length)throw Error('Real-library capture failed integrity or console check');
  console.log(JSON.stringify(report,null,2));
} finally { await browser?.close(); if(bridge?.exitCode===null){bridge.kill('SIGTERM');await once(bridge,'exit');}fs.rmSync(root,{recursive:true,force:true}); }
