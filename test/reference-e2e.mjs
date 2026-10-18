#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {verifyReference} from './reference-journey.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname),work=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-reference-e2e-')),library=path.join(work,'projects');
const out=process.env.FFS_EVIDENCE || path.join(root,'verify-out/reference-e2e');fs.mkdirSync(out,{recursive:true});
const port=await new Promise(ok=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});}),token='reference-fixture-'+crypto.randomUUID(),base='http://127.0.0.1:'+port;
let bridge,browser;const journeys=[],errors=[];
try {
 fs.mkdirSync(path.join(library,'reference-fixture'),{recursive:true});
 const clip=path.join(library,'reference-fixture/source.mp4');const generated=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=12','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-y',clip]);assert.equal(generated.status,0);
 fs.writeFileSync(path.join(library,'reference-fixture/project.json'),JSON.stringify({schema:'fframestudio.project/0',id:'reference-fixture',title:'Demo film',canvas:{fps:30,width:320,height:180},media:{proxy:'source.mp4'},shots:Array.from({length:4},(_,i)=>({id:'shot-'+i,name:'Shot '+i,t0:i*3,t1:(i+1)*3,text:{title:'Title '+i}}))}));
 fs.writeFileSync(path.join(library,'library.json'),JSON.stringify({projects:[{id:'reference-fixture',title:'Demo film',shots:4,duration_s:12,tags:[]}]}));
 bridge=spawn(process.execPath,['bridge/bridge.mjs','--port',String(port),'--root',work,'--token',token,'--quiet','--no-config','--theme-home',work],{cwd:root,stdio:['ignore','pipe','pipe']});await once(bridge.stdout,'data');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium'});const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/open?token='+token);await page.waitForSelector('.card');
 const journey=async(name,fn)=>{try{const detail=await fn();journeys.push({name,ok:true,...detail});console.log('ok '+name);}catch(e){journeys.push({name,ok:false,error:e.message});console.log('FAIL '+name+': '+e.message);}};
 await verifyReference({page,base,out,journey,assert,library});assert.deepEqual(errors,[]);assert(journeys.every(j=>j.ok));
} catch(e){process.exitCode=1;errors.push(e.message);} finally {
 await browser?.close();if(bridge&&bridge.exitCode===null){bridge.kill('SIGTERM');await once(bridge,'exit');}
 fs.writeFileSync(path.join(out,'reference-report.json'),JSON.stringify({journeys,errors},null,2));fs.rmSync(work,{recursive:true,force:true});
}
