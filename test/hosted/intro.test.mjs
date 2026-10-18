import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fromV0} from '../../web/src/doc/project.js';

test('intro media and poster are fail-closed, even if an input manifest claims available',()=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-intro-build-'));
 try{
  const input=path.join(work,'input');fs.mkdirSync(input);
  fs.writeFileSync(path.join(input,'manifest.json'),JSON.stringify([{id:'fframes-intro',readiness:'available',poster:'poster.webp',video:'proxy.mp4',project:'project.json'}]));
  // Intentionally no media: a default build must not even try to read these files.
  const site=path.join(work,'site');let r=spawnSync('python3',['tools/build_demo_site.py','--out',site,'--examples',input],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const catalog=JSON.parse(fs.readFileSync(path.join(site,'examples/manifest.json')));assert.equal(catalog.length,2);
  const e=catalog[0];assert.equal(e.readiness,'awaiting-permission');assert.equal(e.poster,'');assert.equal(e.project,undefined);assert.equal(e.video,undefined);
  for(const key of ['sourceRepo','sourcePath','duration','provenance','credits','poster','readiness'])assert.ok(Object.hasOwn(e,key),key);
  assert.equal(fs.readdirSync(path.join(site,'examples')).some(n=>/^(proxy|poster)\./.test(n)),false);
  // The explicit opt-in requires real media and preserves the pinned provenance.
  fs.writeFileSync(path.join(input,'proxy.mp4'),'synthetic-test-bytes');fs.writeFileSync(path.join(input,'poster.webp'),'synthetic-test-bytes');
  fs.writeFileSync(path.join(input,'project.json'),JSON.stringify({schema:'fframestudio.project/0',media:{proxy:'proxy.mp4'}}));
  r=spawnSync('python3',['tools/build_demo_site.py','--out',site,'--examples',input,'--allow-unlisted-media','fframes-intro'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const available=JSON.parse(fs.readFileSync(path.join(site,'examples/manifest.json')))[0];assert.equal(available.readiness,'available');assert.match(available.poster,/\.webp$/);assert.match(available.video,/\.mp4$/);assert.equal(available.provenance.licenceVerdict,'UNCLEAR');
 }finally{fs.rmSync(work,{recursive:true,force:true});}
});

test('structured upstream scene import preserves frame boundaries through project/1 migration without invented beats',()=>{
 const timeline={fps:60,width:1920,height:1080,duration_frames:7650,duration_seconds:127.5,scenes:[{index:0,name:'PromptScene',full_name:'test::PromptScene',start_frame:0,end_frame:129},{index:1,name:'OutroScene',full_name:'test::OutroScene',start_frame:129,end_frame:7650}],audio:[{file:'music.wav',start_seconds:0,end_seconds:127.5}]};
 const script="import sys,json; sys.path.insert(0,'tools'); from example_fframes_intro import project_from_timeline; from pathlib import Path; print(json.dumps(project_from_timeline(json.load(sys.stdin),json.loads(Path('examples/catalog.json').read_text())[0])))";
 const r=spawnSync('python3',['-c',script],{input:JSON.stringify(timeline),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const doc=fromV0(JSON.parse(r.stdout));assert.equal(doc.schema,'fframestudio.project/1');assert.deepEqual(doc.videos[0].clips.map(c=>[c.start,c.duration,c.sourceIn]),[[0,129,0],[129,7521,129]]);assert.equal(doc.videos[0].scenes.length,2);assert.deepEqual(doc.videos[0].beats,[]);assert.deepEqual(doc.metadata.provenance.audioTimeline,timeline.audio);
});
