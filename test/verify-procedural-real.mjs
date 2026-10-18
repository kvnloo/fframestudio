// Optional local-only qualification. No fixture path means a clean skip, not a fake render.
// FFS_PROCEDURAL_LIBRARY=<imported library> node test/verify-procedural-real.mjs [--out DIR]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {verifyProcedural} from './procedural-journey.mjs';
const input = process.env.FFS_PROCEDURAL_LIBRARY;
if (!input || !['ff-tracking','ff-unmute'].every(id=>fs.existsSync(path.join(input,id,'project.json')))) {
  console.log('SKIP procedural real: set FFS_PROCEDURAL_LIBRARY to both imported source projects');
  process.exit(0);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(),'ffs-procedural-'));
const root = path.join(work,'library'), library = path.join(root,'projects');
const argv = process.argv.slice(2), out = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out')+1] : 'verify-out/procedural-real');
fs.mkdirSync(out,{recursive:true});
fs.cpSync(input,library,{recursive:true});
const port = await new Promise(ok=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});
const token = 'fixture-'+Math.random().toString(36).slice(2);
const child = spawn(process.execPath,['bridge/bridge.mjs','--root',root,'--port',String(port),'--token',token,'--quiet','--no-config','--theme-home',work],{env:{...process.env,HOME:work},stdio:['ignore','pipe','pipe']});
let browser;
try {
  const base = `http://127.0.0.1:${port}`;
  await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('owned bridge timeout')),15000);child.stdout.once('data',()=>{clearTimeout(timer);ok();});child.once('exit',()=>{clearTimeout(timer);bad(Error('owned bridge exited'));});});
  assert((await fetch(base+'/health')).ok);
  browser=await chromium.launch({channel:process.env.PW_CHANNEL,executablePath:process.env.PW_CHANNEL?undefined:process.env.CHROMIUM||'/usr/bin/chromium',args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1896,height:880}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/open?token=${token}`);
  const result=await verifyProcedural({page,base,library,out,assert,real:true});
  assert.deepEqual(errors,[]);
  assert(!fs.existsSync(path.join(work,'.config/fframestudio')));
  fs.writeFileSync(path.join(out,'procedural-real.json'),JSON.stringify({ok:true,...result,errors},null,2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  await new Promise(ok=>{if(child.exitCode!==null)ok();else child.once('exit',ok);});
  fs.rmSync(work,{recursive:true,force:true});
}
