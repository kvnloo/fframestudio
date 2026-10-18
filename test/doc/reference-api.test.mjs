import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';
test('owned reference API: authentication, file validation, progress, cache, settings and cancel',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-ref-api-')),port=await new Promise(ok=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});}),base='http://127.0.0.1:'+port,token='reference-api-fixture';let child;
 try {
  const file=path.join(root,'fixture.mp4');const p=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=30:duration=4','-c:v','libx264','-threads','1','-y',file]);assert.equal(p.status,0);
  child=spawn(process.execPath,['bridge/bridge.mjs','--port',String(port),'--root',root,'--token',token,'--quiet','--no-config','--theme-home',root,'--agents',path.join(root,'no-agents.json')],{stdio:['ignore','pipe','pipe']});await once(child.stdout,'data');
  const request=(url,options={})=>fetch(base+url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  assert.equal((await fetch(base+'/reference/capabilities')).status,401);
  assert.equal((await request('/reference/capabilities',{headers:{Origin:'https://untrusted.example'}})).status,403);
  const cap=await request('/reference/capabilities').then(r=>r.json());assert.equal(cap.maxBytes,60_000_000);assert.equal(cap.analysis,true);
  assert.equal((await request('/reference/import',{method:'POST',body:'<html>Not video</html>'})).status,400);
  for(const url of ['http://127.0.0.1/private.mp4','https://youtube.com/watch?v=a','https://example.com/page'])assert.equal((await request('/reference/import?url='+encodeURIComponent(url),{method:'POST'})).status,400);
  const uploaded=await request('/reference/import',{method:'POST',body:fs.readFileSync(file)}).then(r=>r.json());assert.match(uploaded.id,/^[a-f0-9]{64}$/);assert.equal(uploaded.info.frames,120);
  const media=await request('/reference/media?id='+uploaded.id+'&name=source.mp4');assert.deepEqual(Buffer.from(await media.arrayBuffer()),fs.readFileSync(file));
  assert.equal((await request('/reference/media?id='+uploaded.id+'&name=../../secret')).status,400);
  assert.equal((await request('/reference/analyze?id='+uploaded.id+'&threshold=-1',{method:'POST'})).status,400);
  const started=await request('/reference/analyze?id='+uploaded.id,{method:'POST'}).then(r=>r.json());assert.ok(started.job);
  const shared=await request('/reference/analyze?id='+uploaded.id,{method:'POST'}).then(r=>r.json());assert.ok(shared.job===started.job||shared.cached===true,'duplicate analysis was not shared');
  let status;const deadline=Date.now()+30000;
  do {status=await request('/reference/job?id='+started.job).then(r=>r.json());if(status.state==='running')await new Promise(r=>setTimeout(r,50));}while(status.state==='running'&&Date.now()<deadline);
  assert.equal(status.state,'done',JSON.stringify(status));assert.equal(status.result.contentHash,uploaded.id);assert.equal(status.progress,1);assert.equal(status.result.audio,null);
  const cached=await request('/reference/analyze?id='+uploaded.id,{method:'POST'}).then(r=>r.json());assert.equal(cached.cached,true);assert.deepEqual(cached.result,status.result);
  assert.match(status.result.shots[0].keyframe,/^analysis-10-0.3-v1\/shot-1.jpg$/);
  const thumbnail=await request('/reference/media?id='+uploaded.id+'&name='+encodeURIComponent(status.result.shots[0].keyframe));assert.equal(thumbnail.status,200);assert.equal(Buffer.from(await thumbnail.arrayBuffer()).subarray(0,2).toString('hex'),'ffd8');
  const changed=await request('/reference/analyze?id='+uploaded.id+'&minLength=0.4',{method:'POST'}).then(r=>r.json());assert.ok(changed.job,'settings must invalidate cache');
  let variant;
  do{variant=await request('/reference/job?id='+changed.job).then(r=>r.json());if(variant.state==='running')await new Promise(r=>setTimeout(r,50));}while(variant.state==='running'&&Date.now()<deadline);
  assert.equal(variant.state,'done');assert.notEqual(variant.result.shots[0].keyframe,status.result.shots[0].keyframe,'settings overwrote another analysis evidence');
  assert.ok(fs.existsSync(path.join(root,'references',uploaded.id,status.result.shots[0].keyframe)));
  const cancelled=await request('/reference/analyze?id='+uploaded.id+'&threshold=11',{method:'POST'}).then(r=>r.json());assert.ok(cancelled.job);
  assert.equal((await request('/reference/job?id='+cancelled.job,{method:'DELETE'}).then(r=>r.json())).state,'cancelled');
  await new Promise(r=>setTimeout(r,100));assert.equal((await request('/reference/job?id='+cancelled.job).then(r=>r.json())).state,'cancelled');
  assert.equal(fs.existsSync(path.join(root,'.config/fframestudio')),false);
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}fs.rmSync(root,{recursive:true,force:true});}
});
