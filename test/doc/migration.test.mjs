import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fromV0, validate, textOf } from '../../web/src/doc/project.js';
const kinds = ['studio-spec','fframes','fframes-clips','html-film','capture-manifest'];
for (const kind of kinds) test(`migrate ${kind}: deterministic, non-destructive, text overrides`, () => {
  const old = {schema:'fframestudio.project/0',id:'demo',kind,canvas:{fps:29.97},shots:[{id:'a',t0:0,t1:2,text:{head:['One','Two']}},{id:'b',t0:kind==='fframes-clips'?0:2,t1:kind==='fframes-clips'?3:5}],edits:{a:{head:['New']}}};
  const before = structuredClone(old), doc = fromV0(old);
  assert.deepEqual(old,before); assert.deepEqual(doc,fromV0(old)); validate(doc);
  assert.equal(doc.fps.num,2997); assert.equal(doc.fps.den,100);
  assert.deepEqual(textOf(doc.videos[0].clips[0]).head,['New']);
  assert.equal(doc.videos[0].clips[1].start,doc.videos[0].clips[0].duration);
  assert.equal(doc.videos[0].clips[0].id,'a');
  assert.deepEqual(fromV0(doc),doc);
});
test('migrate every actual library project on disposable copies', async t => {
  const root=process.env.FFS_LIBRARY || path.join(os.homedir(),'fframestudio/projects');
  let files; try {files=await fs.readdir(root);} catch {t.skip('Set FFS_LIBRARY to an imported library');return;}
  const tmp=await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(),'ffs-migration-'));
  let count=0;
  try { for(const id of files) {
    const src=path.join(root,id,'project.json'); let raw; try{raw=await fs.readFile(src,'utf8');}catch{continue;}
    const target=path.join(tmp,id+'.json'); await fs.copyFile(src,target);
    const old=JSON.parse(await fs.readFile(target,'utf8')); const doc=fromV0(old);validate(doc);
    assert.equal(doc.videos[0].clips.length,old.shots?.length ?? old.videos[0].clips.length);
    await fs.writeFile(target,JSON.stringify(doc));assert.deepEqual(JSON.parse(await fs.readFile(target,'utf8')),doc);
    assert.equal(await fs.readFile(src,'utf8'),raw);count++;
  } assert.ok(count>0); t.diagnostic(`Migrated ${count} copied projects; originals unchanged`); } finally {await fs.rm(tmp,{recursive:true});}
});
