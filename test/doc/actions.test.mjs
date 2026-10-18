import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, actionManifest, validateCommand, resolveClip } from '../../web/src/actions.js';
import { fromV0 } from '../../web/src/doc/project.js';
import { CommandStore, proposalCommand } from '../../web/src/doc/commands.js';
import { parseIntent } from '../../web/src/intent.js';
const fixture=()=>fromV0({schema:'fframestudio.project/0',id:'p',title:'P',canvas:{fps:30},shots:[{id:'a',name:'A',t0:0,t1:4,text:{title:'Hello'}},{id:'b',name:'B',t0:4,t1:8},{id:'c',name:'C',t0:8,t1:12}]});
function context() {
 const store=new CommandStore(fixture());return {store,get doc(){return store.doc;},get video(){return store.doc.videos[0];},selection:'a',frame:30,total:360,run:c=>store.apply(c),performAction:(id,p)=>id==='select'?store.apply({type:id,...p}):({id,params:p})};
}
test('every registered action has typed contract, scope, flags, preview, apply and inverse',()=>{
 const manifest=actionManifest();assert.equal(new Set(manifest.map(a=>a.id)).size,manifest.length);
 for(const a of Object.values(ACTIONS)){assert.equal(a.schema.type,'object');assert.ok(a.scope);assert.equal(typeof a.destructive,'boolean');assert.equal(typeof a.bulk,'boolean');for(const name of ['preview','apply','inverse'])assert.equal(typeof a[name],'function');}
 assert.equal(ACTIONS.seek.palette,false);assert.equal(ACTIONS['open-panel'].palette,false);
 assert.throws(()=>ACTIONS.seek.apply(context(),{}, {interactive:true}),/required/);
 assert.throws(()=>validateCommand({type:'trim',clipId:'a',duration:'60'}),/integer/);
 assert.throws(()=>validateCommand({type:'trim',clipId:'a',duration:60,code:'evil'}),/unknown/);
 assert.throws(()=>validateCommand({type:'edit-text',clipId:'a',field:'title',value:[1]}),/string/);
});
const params={add:{clip:{id:'d',name:'D',duration:30}},select:{clipId:'a'},move:{clipId:'a',index:1},trim:{clipId:'a',duration:60},split:{clipId:'a',at:30,newId:'right'},replace:{clipId:'a',mediaId:null},'edit-text':{clipId:'a',field:'title',value:'Edited'},duplicate:{clipId:'a',newId:'copy'},group:{clipIds:['a','b'],id:'group'},'set-beat-lock':{clipId:'a',value:true},retime:{clipId:'a',speed:{num:2,den:1}},delete:{clipId:'a'},'edit-style':{styleId:'default',color:'#ffffff'},'save-version':{id:'saved'},'restore-version':{id:'saved'}};
for(const [id,p] of Object.entries(params))test('registry inverse round trip: '+id,()=>{
 const ctx=context();if(id==='restore-version'){ctx.store.apply({type:'save-version',id:'saved'});ctx.store.apply({type:'trim',clipId:'a',duration:90});}
 const before=structuredClone(ctx.doc),selection=ctx.store.selection;
 const preview=ACTIONS[id].preview(ctx,p);assert.deepEqual(ctx.doc,before);assert.ok(Array.isArray(preview.diff));
 if(id==='select'){const receipt=ACTIONS[id].apply(ctx,p);ctx.store.apply(ACTIONS[id].inverse(receipt));assert.equal(ctx.store.selection,selection);}
 else {const receipt=ACTIONS[id].apply(ctx,p);ctx.store.apply(ACTIONS[id].inverse(receipt));assert.deepEqual({...ctx.doc,revision:before.revision},before);}
});
test('ACP typed actions and legacy commands resolve identical registry validation and transaction',()=>{
 const ctx=context();const proposal=commands=>({schema:'fframestudio.proposal/1',projectId:'p',baseRevision:0,commands});
 const legacy=proposalCommand(proposal([{type:'trim',clipId:'b',duration:90}]),ctx.doc);
 const typed=proposalCommand(proposal([{id:'trim',params:{clipId:'b',duration:90}}]),ctx.doc);
 assert.deepEqual(legacy,typed);ctx.store.apply(typed);assert.equal(ctx.video.clips[1].duration,90);ctx.store.undo();assert.equal(ctx.video.clips[1].duration,120);
 assert.throws(()=>proposalCommand(proposal([{id:'save',params:{}}]),ctx.doc));
});
test('this shot resolves selection, then playhead; second clip uses ordinal context',()=>{
 const ctx=context();assert.equal(resolveClip(ctx,'this shot').id,'a');ctx.selection=null;ctx.frame=150;assert.equal(resolveClip(ctx,'this shot').id,'b');assert.equal(resolveClip(ctx,2).id,'b');
});
const cases=[];
for(const [word,id] of Object.entries({play:'forward','start playback':'forward',pause:'pause',stop:'pause','stop playback':'pause',undo:'undo','undo that':'undo',redo:'redo','redo that':'redo',save:'save','save project':'save'})) for(const suffix of ['','.','!'])cases.push([word+suffix,id]);
for(const ordinal of ['first','second','third'])for(const noun of ['shot','clip']) {
 cases.push([`select the ${ordinal} ${noun}`,'select']);
 for(const amount of ['one','1','two','1.5'])cases.push([`shorten the ${ordinal} ${noun} by ${amount} seconds`,'trim']);
 cases.push([`duplicate the ${ordinal} ${noun}`,'duplicate']);cases.push([`delete the ${ordinal} ${noun}`,'delete']);cases.push([`change the title of the ${ordinal} ${noun} to 'New title'`,'edit-text']);
}
for(const panel of ['shot','narrative','direction','takes','assistant','source','story'])cases.push([`open ${panel} panel`,'open-panel']);
for(const n of ['one','2','3.5'])cases.push([`seek to ${n} seconds`,'seek']);
cases.push(['split this shot','split'],['change the text to "Hello THERE"','edit-text'],['move the second clip to position one','move']);
for(const text of ['shorten the second shot','shorten it','make it better','delete everything','remove all','change the transition','select shot 99','select shot zero','trim this shot by ten seconds','seek to 999 seconds','seek to -1 seconds','change text to unquoted words','play then delete this shot','delete this shot and undo','run shell command','open unknown panel','move this shot to position 20','shorten the second shot by minus one seconds','split the second shot','duplicate that','select that','recreate this but softer','select the eleventh shot','undo twice','shorten the second shot by 0 seconds'])cases.push([text,null]);
assert.ok(cases.length>=100);
for(const [utterance,id] of cases)test('intent: '+utterance,()=>{
 const ctx=context(),before=structuredClone(ctx.doc),r=parseIntent(utterance,ctx);
 assert.equal(r.action?.id || null,id,JSON.stringify(r));assert.deepEqual(ctx.doc,before,'grammar must never mutate');
 if(!id)assert.ok(r.clarification);if(id==='trim'||id==='delete')assert.equal(r.confirmation,true);
});
