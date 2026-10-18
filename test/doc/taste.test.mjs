import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateProfile, parseProfile, previewTaste, tasteReceipt, resolveScopes } from '../../web/src/taste/profile.js';
import { mockAdapter, fileAdapter, bridgeAdapter } from '../../web/src/taste/adapters.js';
import { agentWebAdapter, fromAgentWeb } from '../../bridge/taste.mjs';
import { fromV0 } from '../../web/src/doc/project.js';
const fixture = () => JSON.parse(fs.readFileSync(new URL('../fixtures/taste/synthetic.json', import.meta.url)));
const project = () => fromV0({ schema:'fframestudio.project/0', id:'taste-test', title:'Film', canvas:{fps:30}, shots:[{id:'intro',name:'Intro',t0:0,t1:4,text:{title:'A film'}}] });
const timestamp = '2026-01-01T00:00:00.000Z';
const wire = () => ({profile:{schema:'taste.profile.v1',sourceCount:2,itemCount:12,sources:[{source:'collection',itemCount:12}],topDomains:['example.invalid'],topTerms:['editorial'],styleSignals:[{name:'editorial',score:1}],updatedAt:timestamp}});

test('versioned aggregate schema rejects unknown/raw/source/credential fields at every boundary', () => {
  const p = fixture(); assert.equal(validateProfile(p), p);
  for (const field of ['text','url','posts','media','credentials','accessToken','authorization','cookie','rawReferences']) {
    for (const where of ['root','signals','signal','provenance']) {
      const bad = fixture();
      (where === 'root' ? bad : where === 'signals' ? bad.signals : where === 'signal' ? bad.signals.palette : bad.provenance)[field] = 'https://example.invalid/private';
      assert.throws(() => parseProfile(JSON.stringify(bad)), /aggregate/);
    }
  }
  for (const bad of [p => p.signals.typography.value='private post text', p => p.signals.palette.value=['https://example.invalid'], p => p.signals.motion.confidence=2, p => p.signals.pacing.value=NaN, p => p.signals.density.evidenceCount=99, p => p.schema='v2', p => p.provenance=null, p => p.signals.soundtrack.confidence=.2]) {
    const p = fixture(); bad(p); assert.throws(() => validateProfile(p));
  }
  assert.throws(() => parseProfile(' '.repeat(32769)));
});
test('scopes overlay user -> brand -> project -> task, brand constraints always authoritative', () => {
  const user=fixture(),brand=fixture(),campaign=fixture(),task=fixture();
  brand.signals.pacing.value=10; campaign.signals.pacing.value=20; task.signals.pacing.value=90;
  assert.equal(resolveScopes(user,{brand}).signals.pacing.value,10);
  assert.equal(resolveScopes(user,{brand,project:campaign}).signals.pacing.value,20);
  assert.equal(resolveScopes(user,{brand,project:campaign,task}).signals.pacing.value,90);
  const preview=previewTaste(user,project(),{strength:100,scopes:{brand,project:campaign,task,constraints:{pacing:33,typography:'IBM Plex Mono'}}});
  assert.equal(preview.scope,'task'); assert.equal(preview.dials.pacing,33); assert.equal(preview.dials.typography,'IBM Plex Mono');
  assert.match(preview.changes.find(c=>c.signal==='pacing').reason,/Brand/);
  assert.throws(()=>resolveScopes(user,{constraints:{text:'raw'}}));
});
test('same aggregate + project + controls produce byte-identical previews and receipts with supplied timestamp', () => {
  const p=fixture(),d=project(),before=structuredClone(d),options={strength:70};
  const a=previewTaste(p,d,options),b=previewTaste(structuredClone(p),structuredClone(d),options);
  assert.deepEqual(a,b); assert.deepEqual(tasteReceipt(p,a,timestamp),tasteReceipt(p,b,timestamp)); assert.deepEqual(d,before);
  assert.equal(previewTaste(p,d,{strength:0}).changes.length,0);
  assert.equal(previewTaste(p,d,{on:false}).changes.length,0);
  assert.equal(previewTaste(p,d,{enabled:[]}).changes.length,0);
  assert.equal(previewTaste(p,d).dials.soundtrack,'calm');
  assert.throws(()=>previewTaste(p,d,{strength:101}));
});
test('mock + file adapters share contract; deletion removes persisted profile across instances and pending writes', async () => {
  let text; const storage={async get(){return text;},async set(t){text=t;},async delete(){text=undefined;}};
  const adapter=fileAdapter(storage); assert.equal((await adapter.getProfile()).state,'disconnected');
  const imported=await adapter.importJSON(JSON.stringify(fixture())); assert.deepEqual(imported,await mockAdapter(fixture()).getProfile());
  assert.deepEqual(await fileAdapter(storage).getProfile(),imported);
  const write=adapter.importJSON(JSON.stringify(fixture())),remove=adapter.deleteProfile(); await Promise.all([write,remove]);
  assert.equal((await fileAdapter(storage).getProfile()).state,'disconnected'); assert.equal(text,undefined);
  assert.equal((await fileAdapter({get(){throw Error('disk');}}).getProfile()).state,'offline');
  for(const state of ['offline','unauthorized','disconnected']) assert.deepEqual(await mockAdapter(null,state).getProfile(),{state});
});
test('AgentWeb PR57 GET envelope: server bearer only, redirects refused, no tenant selector, visual evidence stays unknown', async () => {
  let calls=0;
  const adapter=agentWebAdapter({enabled:true,baseURL:'https://agentweb.invalid',token:'synthetic-unit-only',fetcher:async(url,options)=>{
    calls++; assert.equal(String(url),'https://agentweb.invalid/api/taste/profile'); assert.equal(options.method,'GET'); assert.equal(options.redirect,'error'); assert.equal(options.headers.Authorization,'Bearer synthetic-unit-only'); return Response.json(wire());
  }});
  const result=await adapter.getProfile(); assert.equal(calls,1); assert.equal(result.state,'ready'); validateProfile(result.profile);
  assert.deepEqual(result.profile.provenance,{sourceCount:2,itemCount:12});
  assert.ok(Object.values(result.profile.signals).every(s=>s.value===null));
  assert.ok(!JSON.stringify(result).includes('example.invalid')); assert.ok(!JSON.stringify(result).includes('editorial'));
  let disabledCalls=0; assert.equal((await agentWebAdapter({fetcher:()=>disabledCalls++}).getProfile()).state,'disconnected'); assert.equal(disabledCalls,0);
  assert.throws(()=>agentWebAdapter({enabled:true,baseURL:'https://agentweb.invalid/?user=someone',token:'test'}));
  for(const [status,state] of [[401,'unauthorized'],[403,'unauthorized'],[404,'disconnected'],[503,'offline']]) assert.equal((await agentWebAdapter({enabled:true,baseURL:'https://agentweb.invalid',token:'test',fetcher:async()=>new Response('',{status})}).getProfile()).state,state);
  assert.equal((await agentWebAdapter({enabled:true,baseURL:'https://agentweb.invalid',token:'test',fetcher:async()=>{throw Error('network');}}).getProfile()).state,'offline');
  assert.throws(()=>fromAgentWeb({profile:{...wire().profile,password:'raw'}}));
  assert.equal((await agentWebAdapter({enabled:true,baseURL:'https://agentweb.invalid',token:'test',fetcher:async()=>Response.json({posts:[]})}).getProfile()).state,'invalid');
  assert.equal((await bridgeAdapter(async()=>Response.json({state:'disconnected'})).getProfile()).state,'disconnected');
});
test('Markdown conversion is conservative and requires a separate human review before approved export', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-taste-md-'));
  try {
    const md=path.join(root,'TASTE.md'),candidate=path.join(root,'candidate.json'),approved=path.join(root,'approved.json');
    fs.writeFileSync(md,'# Synthetic study\nIBM Plex Mono with #123456. Do not assume a tempo.\nPrivate post https://example.invalid must not survive.');
    const run=args=>spawnSync('python3',['tools/taste-from-md.py',...args],{encoding:'utf8',input:'APPROVE\n'});
    assert.equal(run([md,'--out',candidate]).status,0);
    const p=parseProfile(fs.readFileSync(candidate,'utf8')); assert.equal(p.signals.palette.confidence,.25); assert.equal(p.signals.pacing.value,null);
    assert.ok(!fs.readFileSync(candidate,'utf8').includes('example.invalid'));
    assert.notEqual(run(['--review',candidate,'--out',approved]).status,0); assert.ok(!fs.existsSync(approved));
    assert.equal(run(['--review',candidate,'--out',approved,'--approve']).status,0); validateProfile(JSON.parse(fs.readFileSync(approved)));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
