import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import { directURL, publicAddress } from '../../bridge/reference.mjs';
import { recreateReference } from '../../web/src/recreate.js';
import { CommandStore } from '../../web/src/doc/commands.js';
export function generateReference(file) {
  const p=spawnSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=red:s=320x180:r=30:d=3','-f','lavfi','-i','color=blue:s=320x180:r=30:d=3','-f','lavfi','-i','color=green:s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=9','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-y',file],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
}
test('direct media URL policy rejects pages, auth, social links and private networks',()=>{
 for(const url of ['file:///a.mp4','https://user:pass@example.com/a.mp4','https://example.com/watch','https://youtube.com/watch?v=a','https://x.com/a/status/1','https://tiktok.com/a.mp4'])assert.throws(()=>directURL(url));
 assert.equal(directURL('https://example.com/a.mp4?signature=value').pathname,'/a.mp4');
 for(const ip of ['127.0.0.1','10.0.0.2','172.16.1.1','169.254.169.254','192.168.1.2','::1','::ffff:127.0.0.1','fe80::1','2001:db8::1','2002:7f00:1::1','3fff::1','100.64.1.1','0.0.0.0'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);
});
test('CC0 generated three-shot tone: detected cuts ±1 frame, palette, audio, editable inverse',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-reference-'));try{
  const file=path.join(dir,'cc0-colour-tone.mp4');generateReference(file);
  const p=spawnSync('python3',['bridge/analyze-reference.py',file,'--out',dir],{encoding:'utf8',timeout:180000});assert.equal(p.status,0,p.stdout+p.stderr);
  const a=JSON.parse(p.stdout.trim().split('\n').at(-1)).result;
  assert.equal(a.shots.length,3);assert.ok(Math.abs(a.shots[1].startFrame-90)<=1);assert.ok(Math.abs(a.shots[2].startFrame-180)<=1);
  assert.ok(parseInt(a.shots[0].palette[0].color.slice(1,3),16)>=250);assert.equal(a.shots[0].palette[0].color.slice(3),'0000');assert.ok(a.shots.every(s=>s.palette.length&&fs.statSync(path.join(dir,s.keyframe)).size>0));
  assert.ok(a.audio.levels.length>80);assert.ok(a.audio.onsets.length);assert.ok(a.shots[1].confidence>0);assert.equal(a.shots[0].confidence,null);
  a.contentHash='fixture-cc0';const doc=recreateReference(a,{id:'fixture',source:'Generated CC0 solid colours and tone'}),store=new CommandStore(doc);
  assert.equal(doc.videos[0].clips.length,3);assert.equal(doc.metadata.reference.approximation,true);assert.equal(doc.videos[0].clips[1].sourceIn,90);
  const before=structuredClone(store.doc);store.apply({type:'trim',clipId:'fixture:shot:2',duration:60});store.undo();assert.deepEqual({...store.doc,revision:0},before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
