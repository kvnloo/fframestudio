#!/usr/bin/env node
// Alternating uncached local-bridge cold opens isolate host-adapter overhead.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=path.resolve('.'),work=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-cold-compare-'));
const out=path.resolve(process.env.FFS_EVIDENCE||'verify-out/hosted-cold');fs.mkdirSync(out,{recursive:true});
const revision=process.env.FFS_BASELINE||'fe3dac8',baseline=path.join(work,'baseline');fs.mkdirSync(baseline);
const archive=spawnSync('git',['archive',revision],{maxBuffer:20*1024*1024});assert.equal(archive.status,0);
assert.equal(spawnSync('tar',['-xf','-','-C',baseline],{input:archive.stdout}).status,0);
const library=path.join(work,'library'),project=path.join(library,'projects/perf-48');fs.mkdirSync(project,{recursive:true});
fs.writeFileSync(path.join(project,'project.json'),JSON.stringify({schema:'fframestudio.project/0',id:'perf-48',title:'48 clip cold-open fixture',kind:'fframes',canvas:{fps:30},shots:Array.from({length:48},(_,i)=>({id:'clip-'+i,name:'Clip '+i,t0:i*3,t1:(i+1)*3,text:{title:'Story '+i}}))}));
fs.writeFileSync(path.join(library,'projects/library.json'),JSON.stringify({projects:[]}));
const children=[],samples={baseline:[],hostAdapter:[]};let browser;
const port=()=>new Promise(ok=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>ok(n));});});
const connections={};
try {
  for(const [name,web] of [['baseline',path.join(baseline,'web')],['hostAdapter',path.join(root,'web')]]) {
    const p=await port(),token=crypto.randomUUID();
    const child=spawn(process.execPath,['bridge/bridge.mjs','--port',String(p),'--root',library,'--web',web,'--token',token,'--quiet','--no-config','--theme-home',work],{stdio:['ignore','pipe','pipe']});children.push(child);
    await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('Owned bridge startup timeout')),15000);child.stdout.once('data',()=>{clearTimeout(timer);ok();});child.once('exit',()=>{clearTimeout(timer);bad(Error('Owned bridge exited'));});});
    connections[name]={base:'http://127.0.0.1:'+p,token};
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium'});
  for(let round=0;round<5;round++)for(const name of round%2?['hostAdapter','baseline']:['baseline','hostAdapter']) {
    const {base,token}=connections[name],context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addCookies([{name:'ffs',value:token,url:base}]);
    const page=await context.newPage(),cdp=await context.newCDPSession(page);
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await page.goto(base+'/#/p/perf-48',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.ffs?.interactiveAt&&!window.ffs.loading);
    const value=await page.evaluate(()=>({ms:window.ffs.interactiveAt,folderModuleFetched:performance.getEntriesByType('resource').some(r=>r.name.includes('folder-host.js')),exampleModuleFetched:performance.getEntriesByType('resource').some(r=>r.name.includes('/examples'))}));
    samples[name].push(value);await context.close();
  }
  const median=list=>list.map(x=>x.ms).sort((a,b)=>a-b)[Math.floor(list.length/2)];
  const result={baselineRevision:revision,method:'Same owned bridge executable, alternate baseline/current web roots, fresh browser context, cache disabled, 48 clips, 1440x1000, five samples each. Serial; no screenshot jobs.',samples,baselineMedianMs:median(samples.baseline),hostAdapterMedianMs:median(samples.hostAdapter),budgetMs:300,optionalHostedModulesFetched:samples.hostAdapter.some(s=>s.folderModuleFetched||s.exampleModuleFetched)};
  result.deltaMedianMs=result.hostAdapterMedianMs-result.baselineMedianMs;
  result.withinUnchangedBudget=samples.hostAdapter.every(s=>s.ms<300);
  fs.writeFileSync(path.join(out,'cold-comparison.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  assert.equal(result.withinUnchangedBudget,true);assert.equal(result.optionalHostedModulesFetched,false);
}finally{
  await browser?.close();
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}
  fs.rmSync(work,{recursive:true,force:true});
}
