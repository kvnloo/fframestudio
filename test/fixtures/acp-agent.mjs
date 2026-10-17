// Deterministic protocol fixture; never a substitute for live-provider qualification.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
const send = message => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...message}) + '\n');
for await (const line of readline.createInterface({input:process.stdin})) {
  const m=JSON.parse(line);
  if(m.id===undefined)continue;
  let result;
  if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{},agentInfo:{name:'Hosted ACP fixture',version:'1'}};
  else if(m.method==='session/new')result={sessionId:'hosted-fixture'};
  else if(m.method==='session/prompt') {
    const text=m.params.prompt.filter(p=>p.type==='text').map(p=>p.text).join('\n');
    const target=text.match(/Write ONLY a proposal to (.+?)\. Format:/)?.[1];
    const source=text.match(/Read (.+?), schema /)?.[1];
    if(target && source) {
      const {fromV0}=await import('../../web/src/doc/project.js');
      const doc=fromV0(JSON.parse(fs.readFileSync(source,'utf8')));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,JSON.stringify({schema:'fframestudio.proposal/1',projectId:doc.id,baseRevision:doc.revision,title:'Hosted fixture suggestion',commands:[{type:'edit-text',clipId:doc.videos[0].clips[0].id,field:'title',value:'Hosted ACP suggestion'}]}));
    }
    send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hosted fixture pong'}}}});
    result={stopReason:'end_turn'};
  }else {send({id:m.id,error:{code:-32601,message:'Unknown method'}});continue;}
  send({id:m.id,result});
}
