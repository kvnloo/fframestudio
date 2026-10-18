import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateApplication, previewTaste, tasteReceipt } from '../../web/src/taste/profile.js';
import { CommandStore } from '../../web/src/doc/commands.js';
import { fromV0, validate } from '../../web/src/doc/project.js';
const fixture = () => JSON.parse(fs.readFileSync(new URL('../fixtures/taste/synthetic.json', import.meta.url)));
const project = () => fromV0({ schema:'fframestudio.project/0', id:'taste-test', title:'Film', canvas:{fps:30}, shots:[{id:'intro',name:'Intro',t0:0,t1:4,text:{title:'A film'}}] });
const timestamp = '2026-01-01T00:00:00.000Z';

test('apply creates one undoable receipt; preview is pure, raw receipt rejected, brand lock enforced', () => {
  const d=project(),p=fixture(),store=new CommandStore(d);
  const receipt=tasteReceipt(p,previewTaste(p,d),timestamp),cmd={type:'apply-taste',receipt};
  validateApplication(receipt); store.preview(cmd); assert.deepEqual(store.doc,d);
  store.apply(cmd); assert.equal(store.past.length,1); assert.deepEqual(store.doc.metadata.tasteApplications,[receipt]);
  assert.equal(store.doc.videos[0].styles.default.fontFamily,'Instrument Serif');
  assert.deepEqual(store.doc.videos[0].clips,d.videos[0].clips);
  const saved=JSON.parse(JSON.stringify(store.doc)); validate(saved); assert.deepEqual(saved.metadata.tasteDirection,receipt.dials);
  store.undo(); assert.deepEqual({...store.doc,revision:0},d); store.redo(); assert.equal(store.doc.metadata.tasteApplications.length,1);
  assert.throws(()=>store.apply({type:'apply-taste',receipt:{...receipt,rawText:'not aggregate'}}));
  const locked=project(); locked.metadata.tasteBrandConstraints={pacing:20};
  assert.throws(()=>new CommandStore(locked).apply(cmd),/brand constraints/);
  const toggled=new CommandStore(d),onlyPace=tasteReceipt(p,previewTaste(p,d,{enabled:['pacing']}),timestamp);
  toggled.apply({type:'apply-taste',receipt:onlyPace}); assert.deepEqual(toggled.doc.videos[0].styles,d.videos[0].styles);
});
