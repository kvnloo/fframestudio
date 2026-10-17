#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {verifyHosted} from '../test/hosted-journey.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname), home=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-hosted-source-'));
const out=path.resolve(process.env.FFS_EVIDENCE||path.join(root,'verify-out','hosted-'+Date.now()));fs.mkdirSync(out,{recursive:true});
const journeys=[],assert=(v,m)=>{if(!v)throw Error(m);};let browser;
try{
 const demo=spawnSync('python3',['tools/make_demo.py'],{cwd:root,env:{...process.env,HOME:home},encoding:'utf8'});assert(demo.status===0,demo.stderr);
 browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--autoplay-policy=no-user-gesture-required']});
 await verifyHosted({browser,root,out,source:path.join(home,'fframestudio/demo-src/demo.mp4'),assert,journey:async(name,fn)=>{try{journeys.push({name,ok:true,...await fn()});console.log('ok '+name);}catch(error){journeys.push({name,ok:false,error:error.message});console.error('FAIL '+name+': '+error.message);}}});
}finally{await browser?.close();fs.rmSync(home,{recursive:true,force:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({journeys,ok:journeys.length>0&&journeys.every(j=>j.ok)},null,2));}
process.exit(journeys.length&&journeys.every(j=>j.ok)?0:1);
