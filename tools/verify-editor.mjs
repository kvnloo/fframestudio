#!/usr/bin/env node
// Own the bridge and a disposable library; never tests against the production library.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';
const root=await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(),'ffs-editor-'));
const repo=path.resolve(new URL('..',import.meta.url).pathname);
const evidence=path.resolve(process.env.FFS_EVIDENCE || path.join(root,'evidence'));
let server,child,cancelled=false;
const stop=()=>{cancelled=true;child?.kill('SIGTERM');server?.kill('SIGTERM');};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
try {
 await fs.cp(process.env.FFS_LIBRARY || path.join(os.homedir(),'fframestudio/projects'),path.join(root,'projects'),{recursive:true});
 if(process.argv.includes('--synthetic')){
   const clips=Array.from({length:500},(_,i)=>({id:`clip-${i}`,name:`Clip ${i}`,t0:i*3,t1:(i+1)*3,text:{title:`Story ${i}`}}));
   await fs.mkdir(path.join(root,'projects/perf-500'),{recursive:true});await fs.writeFile(path.join(root,'projects/perf-500/project.json'),JSON.stringify({schema:'fframestudio.project/0',id:'perf-500',title:'500 clip benchmark',kind:'fframes',canvas:{fps:30},shots:clips}));
 }
 server=spawn(process.execPath,['bridge/bridge.mjs','--port',process.env.FFS_PORT || '7879','--root',root,'--no-config'],{cwd:repo,stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>{if(process.env.FFS_DEBUG)process.stderr.write(d);});
 const deadline=Date.now()+30000;let url;
 while(Date.now()<deadline){if(cancelled)throw Error('Cancelled');url=log.match(/open the studio: (\S+)/)?.[1];if(url)break;if(server.exitCode!==null)throw Error('Bridge exited: '+log);await new Promise(r=>setTimeout(r,50));}
 if(!url)throw Error('Bridge startup timeout');const health=await fetch(new URL('/health',url));if(!health.ok)throw Error('Bridge not ready');
 console.log(`Disposable library: ${root}`);
 const script=process.argv.includes('--acp')?'test/editor-acp.py':process.argv.includes('--perf')?'test/editor-perf.py':'test/editor-browser.py';
 child=spawn('uv',['run','--with','playwright','python',script],{cwd:repo,env:{...process.env,FFS_URL:url,FFS_ROOT:root,FFS_EVIDENCE:evidence},stdio:'inherit'});
 const [code]=await once(child,'exit');console.log(`Evidence: ${evidence}`);process.exitCode=code ?? 1;
} finally {
 if(server&&server.exitCode===null&&server.signalCode===null){server.kill('SIGTERM');await once(server,'exit');}
 process.off('SIGTERM',stop);process.off('SIGINT',stop);
 // Keep the disposable library with evidence for inspection. TMPDIR retention owns cleanup.
}
