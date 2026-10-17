import test from 'node:test';import assert from 'node:assert/strict';
import {fromV0,clone,textOf} from '../../web/src/doc/project.js';
import {CommandStore,diff,proposalCommand,applyPatches} from '../../web/src/doc/commands.js';
test('patches reproduce array deletion and escaped text keys, preserve untouched references',()=>{
 const a={videos:[{clips:[{id:'a',text:{'a/b~c':'one'}},{id:'b'}]}],metadata:{source:'immutable'}};
 for(const b of [{...a,videos:[{clips:[{id:'b'}]}]},{...a,videos:[{clips:[{id:'a',text:{'a/b~c':'two'}},{id:'b'}]}]}]){
 const result=applyPatches(a,diff(a,b));assert.deepEqual(result,b);assert.equal(result.metadata,a.metadata);assert.equal(a.videos[0].clips[0].text['a/b~c'],'one');
 }
});
const fixture=()=>fromV0({schema:'fframestudio.project/0',id:'p',title:'P',canvas:{fps:30},shots:[{id:'a',name:'A',t0:0,t1:4,text:{title:'Hello'}},{id:'b',name:'B',t0:4,t1:8}]});
const content=d=>({...d,revision:0});
for(const cmd of [
 {type:'add',clip:{id:'c',name:'C',duration:30}},
 {type:'move',clipId:'a',index:1}, {type:'trim',clipId:'a',duration:60},
 {type:'split',clipId:'a',at:30,newId:'a-right'}, {type:'replace',clipId:'a',mediaId:null},
 {type:'duplicate',clipId:'a',newId:'a-copy'}, {type:'group',clipIds:['a','b'],id:'scene',name:'Opening'},
 {type:'set-beat-lock',clipId:'a',value:true}, {type:'retime',clipId:'a',speed:{num:2,den:1}},
 {type:'delete',clipId:'a'}, {type:'edit-style',styleId:'default',color:'#ffffff'},
 {type:'save-version',id:'version-a',name:'First'},
]) test(`${cmd.type} is validated, previewable, undo/redo round trip`,()=>{
 const s=new CommandStore(fixture()),before=clone(s.doc);s.preview(cmd);assert.deepEqual(s.doc,before);
 s.apply(cmd);const after=clone(s.doc);s.undo();assert.deepEqual(content(s.doc),content(before));s.redo();assert.deepEqual(content(s.doc),content(after));
});
test('select is an ephemeral named command with inverse; does not dirty content history',()=>{
 const s=new CommandStore(fixture());const r=s.apply({type:'select',clipId:'a'});assert.equal(s.selection,'a');assert.deepEqual(r.inverse,{type:'select',clipId:null});assert.equal(s.past.length,0);
});
test('split partitions attached text and source ranges; move keeps attachments',()=>{
 const s=new CommandStore(fixture());s.apply({type:'split',clipId:'a',at:30,newId:'right'});const [a,b]=s.doc.videos[0].clips;
 assert.equal(a.duration,30);assert.equal(b.sourceIn,30);assert.equal(b.duration,90);assert.equal(b.attached[0].duration,90);assert.notEqual(a.attached[0].id,b.attached[0].id);
});
test('invalid batch leaves document/history untouched; stale and unsafe proposals rejected',()=>{
 const s=new CommandStore(fixture()),before=clone(s.doc);
 assert.throws(()=>s.apply({type:'batch',commands:[{type:'trim',clipId:'a',duration:60},{type:'trim',clipId:'b',duration:-2}]}));assert.deepEqual(s.doc,before);assert.equal(s.past.length,0);
 assert.throws(()=>proposalCommand({schema:'fframestudio.proposal/1',projectId:'p',baseRevision:9,commands:[]},s.doc),/stale/i);
 assert.throws(()=>proposalCommand({schema:'fframestudio.proposal/1',projectId:'p',baseRevision:0,commands:[{type:'restore-document'}]},s.doc),/allowed/i);
 const p={schema:'fframestudio.proposal/1',projectId:'p',baseRevision:0,commands:[{type:'edit-text',clipId:'a',field:'title',value:'Proposal'},{type:'trim',clipId:'a',duration:60}]};
 s.apply(proposalCommand(p,s.doc));assert.equal(s.past.length,1);s.undo();assert.deepEqual(content(s.doc),content(before));
});
test('multi-video proposals preview and rollback without touching either source video',()=>{
 const d=fixture(),other=clone(d.videos[0]);other.id='video-other';other.clips.forEach(c=>{c.id+='-other';c.attached.forEach(a=>a.id+='-other');});d.videos.push(other);
 const s=new CommandStore(d),before=clone(s.doc),cmd={type:'batch',commands:[{type:'trim',videoId:other.id,clipId:'a-other',duration:60},{type:'edit-text',clipId:'a',field:'title',value:'New'}]};
 s.preview(cmd);assert.deepEqual(s.doc,before);s.apply(cmd);s.undo();assert.deepEqual(content(s.doc),content(before));
 assert.throws(()=>s.apply({type:'batch',commands:[...cmd.commands,{type:'trim',clipId:'b',duration:-1}]}));assert.deepEqual(content(s.doc),content(before));
});
test('versions restore through history and compare exact content',()=>{
 const s=new CommandStore(fixture());s.apply({type:'save-version',id:'v1',name:'Original'});s.apply({type:'trim',clipId:'a',duration:30});s.apply({type:'save-version',id:'v2',name:'Short'});
 const [a,b]=s.doc.versions;assert.ok(diff(a.video,b.video).length);s.apply({type:'restore-version',id:'v1'});assert.equal(s.doc.videos[0].clips[0].duration,120);s.undo();assert.equal(s.doc.videos[0].clips[0].duration,30);
});
test('object-creating commands require explicit IDs so preview and apply cannot drift',()=>{const s=new CommandStore(fixture());for(const cmd of [{type:'add',clip:{duration:30}},{type:'duplicate',clipId:'a'},{type:'split',clipId:'a',at:30},{type:'group',clipIds:['a']},{type:'save-version'}])assert.throws(()=>s.preview(cmd),/ID/);});
test('returned inverse executes through the command system',()=>{const s=new CommandStore(fixture()),before=clone(s.doc);const r=s.apply({type:'trim',clipId:'a',duration:60});s.apply(r.inverse);assert.deepEqual(content(s.doc),content(before));});
test('beat lock rejects ripple displacement and mutation rolls back',()=>{const s=new CommandStore(fixture());s.apply({type:'set-beat-lock',clipId:'b',value:true});const before=clone(s.doc);assert.throws(()=>s.apply({type:'trim',clipId:'a',duration:30}),/beat-locked/);assert.deepEqual(s.doc,before);});
test('edit text preview shows scope and changes without mutation; inverse restores',()=>{
 const s=new CommandStore(fixture()),before=clone(s.doc),cmd={type:'edit-text',clipId:'a',field:'title',value:'World'};
 const p=s.preview(cmd);assert.equal(p.scope,'This clip: a');assert.ok(p.diff.length);assert.deepEqual(s.doc,before);
 const receipt=s.apply(cmd);assert.equal(textOf(s.doc.videos[0].clips[0]).title,'World');assert.equal(receipt.inverse.type,'restore-document');
 s.undo();assert.deepEqual(content(s.doc),content(before));s.redo();assert.equal(textOf(s.doc.videos[0].clips[0]).title,'World');
});
