import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gzipSync} from 'node:zlib';import {performance} from 'node:perf_hooks';
import {fromV0} from '../../web/src/doc/project.js';import {CommandStore} from '../../web/src/doc/commands.js';
const fixture=()=>fromV0({schema:'fframestudio.project/0',id:'perf',canvas:{fps:30},shots:Array.from({length:500},(_,i)=>({id:`c${i}`,t0:i*3,t1:(i+1)*3,text:{title:`Clip ${i}`}}))});
test('editor shipped JavaScript stays below 150 KiB gzip, excluding ACP',()=>{
 const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${p}/${e.name}`):e.name.endsWith('.js')?[`${p}/${e.name}`]:[]);
 const bytes=['web/app.js',...walk('web/src')].reduce((n,f)=>n+gzipSync(fs.readFileSync(f)).length,0);console.log(JSON.stringify({editorGzipBytes:bytes}));assert.ok(bytes<150*1024);
});
test('every document command stays under 16ms at 500 clips (CommandStore CPU, no paint)',()=>{
 const commands=[{type:'add',clip:{id:'new',duration:30}},{type:'select',clipId:'c0'},{type:'move',clipId:'c0',index:499},{type:'trim',clipId:'c0',duration:60},{type:'split',clipId:'c0',at:30,newId:'split'},{type:'replace',clipId:'c0',mediaId:null},{type:'edit-text',clipId:'c0',field:'title',value:'Measured'},{type:'duplicate',clipId:'c0',newId:'copy'},{type:'group',clipIds:['c0','c1'],id:'scene'},{type:'set-beat-lock',clipId:'c0',value:true},{type:'retime',clipId:'c0',speed:{num:2,den:1}},{type:'delete',clipId:'c0'},{type:'edit-style',styleId:'default',color:'#ffffff'},{type:'save-version',id:'v1'}];
 const timings=[];for(const cmd of commands){const store=new CommandStore(fixture()),t=performance.now();store.apply(cmd);timings.push({command:cmd.type,ms:performance.now()-t});}
 const store=new CommandStore(fixture());store.apply({type:'save-version',id:'v1'});store.apply({type:'trim',clipId:'c0',duration:60});for(const action of ['restore-version','undo','redo']){const t=performance.now();if(action==='restore-version')store.apply({type:action,id:'v1'});else store[action]();timings.push({command:action,ms:performance.now()-t});}
 console.log(JSON.stringify({commands:timings}));assert.ok(timings.every(x=>x.ms<16),JSON.stringify(timings.filter(x=>x.ms>=16)));
});
