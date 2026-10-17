import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createHash} from 'node:crypto';
test('bridge compare-and-swap refuses external edit, preserves bytes, accepts matching base',async()=>{
 const root=await fs.mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'ffs-cas-'));await fs.writeFile(path.join(root,'project.json'),'old');
 const child=spawn(process.execPath,['bridge/bridge.mjs','--port','17879','--root',root,'--token','test-cas','--no-config'],{stdio:['ignore','pipe','pipe']});
 try{let ready='';child.stdout.on('data',d=>ready+=d);for(let i=0;i<200&&!ready.includes('open the studio:');i++)await new Promise(r=>setTimeout(r,50));
 const url='http://127.0.0.1:17879/fs?path=project.json',headers={Authorization:'Bearer test-cas','X-FFS-Expected':createHash('sha256').update('old').digest('hex')};
 await fs.writeFile(path.join(root,'project.json'),'external');let r=await fetch(url,{method:'PUT',headers,body:'local'});assert.equal(r.status,409);assert.equal(await fs.readFile(path.join(root,'project.json'),'utf8'),'external');
 headers['X-FFS-Expected']=createHash('sha256').update('external').digest('hex');r=await fetch(url,{method:'PUT',headers,body:'local'});assert.equal(r.status,200);assert.equal((await(await fetch(url,{headers})).json()).content,'local');
 }finally{child.kill();await once(child,'exit');await fs.rm(root,{recursive:true});}
});
