import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSocialReferences, normalizeSocialReferences, toAgentWebCollection } from '../../web/src/taste/social-references.js';
import { bridgeAdapter } from '../../web/src/taste/adapters.js';
import { emptySignals } from '../../web/src/taste/profile.js';
import { agentWebAdapter } from '../../bridge/taste.mjs';

const youtube = () => ({
  schema:'fframestudio.social-references/1', provider:'youtube', collectionId:'motion_01',
  items:[
    {url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=private',title:'Motion typography',tags:['motion','minimal']},
    {url:'https://youtu.be/dQw4w9WgXcQ?t=4',title:'Duplicate link'},
  ],
});
const pinterest = () => ({
  schema:'fframestudio.social-references/1', provider:'pinterest', collectionId:'board_01',
  items:[{url:'https://www.pinterest.com/pin/123456789/?utm_source=secret',title:'Editorial composition',tags:['editorial']}],
});
const mutate = fn => { const v=youtube(); fn(v); return v; };

test('YouTube user-selected references are canonicalized, de-tracked and de-duplicated', () => {
  const source=JSON.stringify(youtube()), output=parseSocialReferences(source);
  assert.equal(output.items.length,1);
  assert.equal(output.items[0].url,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(!JSON.stringify(output).includes('private'));
  assert.deepEqual(toAgentWebCollection(output), {
    collectionId:'youtube-motion_01', items:[{url:output.items[0].url,title:'Motion typography',tags:['motion','minimal']}],
  });
});

test('Pinterest, X and generic HTTPS collections are metadata only, no URL fetch', () => {
  assert.equal(parseSocialReferences(JSON.stringify(pinterest())).items[0].url,'https://www.pinterest.com/pin/123456789/');
  const x={...pinterest(),provider:'x',items:[{url:'https://x.com/user/status/12345?t=private',title:'Launch film'}]};
  assert.equal(normalizeSocialReferences(x).items[0].url,'https://x.com/user/status/12345');
  const generic={...pinterest(),provider:'collection',items:[{url:'https://example.com/portfolio?ref=secret#frame',tags:['studio']}]};
  assert.equal(normalizeSocialReferences(generic).items[0].url,'https://example.com/portfolio');
});

test('reject credentials, malformed hosts and overbroad imports before bridge transport', () => {
  const cases = [
    v=>{v.token='secret';},
    v=>{v.items[0].authorization='token';},
    v=>{v.provider='unknown';},
    v=>{v.collectionId='../bad';},
    v=>{v.items[0].url='http://www.youtube.com/watch?v=dQw4w9WgXcQ';},
    v=>{v.items[0].url='https://foo:secret@www.youtube.com/watch?v=dQw4w9WgXcQ';},
    v=>{v.items[0].url='https://youtube.evil.test/watch?v=dQw4w9WgXcQ';},
    v=>{v.items[0].url='https://www.youtube.com/playlist?list=PL123';},
    v=>{v.items[0].tags=['</script>'];},
    v=>{v.items = Array(51).fill({url:'https://youtu.be/dQw4w9WgXcQ'});},
  ];
  for (const alter of cases) assert.throws(()=>normalizeSocialReferences(mutate(alter)));
  assert.throws(()=>parseSocialReferences(' '.repeat(65537)),/64 KiB/);
  const generic={...pinterest(),provider:'collection',items:[{url:'https://localhost/admin'}]};
  assert.throws(()=>normalizeSocialReferences(generic), /public HTTPS/);
  assert.throws(()=>parseSocialReferences('{broken'),/Invalid reference JSON/);
});

test('bridge import requires explicit caller action and never carries service credentials', async () => {
  const source=parseSocialReferences(JSON.stringify(pinterest()));
  let count=0;
  const profile={schema:'fframestudio.taste-profile/1',revision:'synthetic-only',
    signals:emptySignals(),provenance:{sourceCount:1,itemCount:1}};
  const adapter=bridgeAdapter(async (url, options)=>{
    count++;
    assert.equal(url,'/taste/import/collection');
    assert.equal(options.method,'POST');
    assert.equal(options.headers['Content-Type'],'application/json');
    const payload=JSON.parse(options.body);
    assert.deepEqual(payload,source);
    assert.ok(!JSON.stringify(payload).includes('Bearer'));
    return Response.json({state:'ready',profile});
  });
  assert.equal(count,0);
  const imported=await adapter.importCollection(source);
  assert.equal(imported.state,'ready');
  assert.equal(count,1);
  assert.equal(imported.profile.signals.palette.value,null);
  assert.equal((await bridgeAdapter(async()=>new Response('',{status:401})).importCollection(source)).state,'unauthorized');
  assert.equal((await bridgeAdapter(async()=>new Response('',{status:429})).importCollection(source)).state,'offline');
  await assert.rejects(()=>adapter.importCollection(mutate(v=>{v.cookie='secret';})));
});

test('server adapter uses only owner-scoped AgentWeb collection endpoint and aggregate GET', async () => {
  const calls=[], source=parseSocialReferences(JSON.stringify(pinterest()));
  const wire={profile:{schema:'taste.profile.v1',sourceCount:1,itemCount:1,
    sources:[{source:'collection',itemCount:1}],topDomains:[],topTerms:[],styleSignals:[],updatedAt:null}};
  const mock=async (url,options)=>{
    calls.push({url:String(url), method:options.method, headers:options.headers,body:options.body});
    if (options.method==='POST') return Response.json({profile:{topTerms:['ignored']}},{status:201});
    if (options.method==='GET') return Response.json(wire);
    throw Error('unexpected');
  };
  const adapter=agentWebAdapter({enabled:true,baseURL:'https://agentweb.invalid',token:'server-test-only',fetcher:mock});
  const result=await adapter.importCollection(source);
  assert.equal(result.state,'ready');
  assert.deepEqual(calls.map(c=>c.url),[
    'https://agentweb.invalid/api/taste/import/collection',
    'https://agentweb.invalid/api/taste/profile',
  ]);
  assert.deepEqual(calls.map(c=>c.method),['POST','GET']);
  assert.ok(calls.every(c=>c.headers.Authorization==='Bearer server-test-only'));
  assert.deepEqual(JSON.parse(calls[0].body),toAgentWebCollection(source));
  assert.equal(result.profile.provenance.itemCount,1);
  assert.ok(Object.values(result.profile.signals).every(v=>v.value===null));
  assert.ok(!JSON.stringify(result).includes('pinterest.com'));
  let network=0;
  const disabled=agentWebAdapter({fetcher:async()=>{network++;throw Error('unexpected');}});
  assert.equal((await disabled.importCollection(source)).state,'disconnected');
  assert.equal(network,0);
});
