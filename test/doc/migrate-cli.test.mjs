import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('migration CLI writes a distinct new copy and refuses overwrite',async()=>{
 const dir=await fs.mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'ffs-cli-'));const input=path.join(dir,'v0.json'),output=path.join(dir,'v1.json'),raw=JSON.stringify({schema:'fframestudio.project/0',id:'test',shots:[]});
 try{await fs.writeFile(input,raw);const run=(a,b)=>spawnSync(process.execPath,['tools/migrate-project.mjs',a,b],{encoding:'utf8'});
 assert.equal(run(input,output).status,0);assert.equal(JSON.parse(await fs.readFile(output)).schema,'fframestudio.project/1');assert.equal(await fs.readFile(input,'utf8'),raw);assert.notEqual(run(input,input).status,0);assert.notEqual(run(input,output).status,0);
 }finally{await fs.rm(dir,{recursive:true});}
});
