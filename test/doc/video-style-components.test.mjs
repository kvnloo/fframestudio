import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCineticPicks } from '../../web/src/video-style/cinetic.mjs';
import { VIDEO_STYLE_PRESETS, ASPECTS, instantiate, evaluateRecipe, serializeRecipe, parseRecipe, interpolate, validateDefinition, joinComponents, evaluateComposition } from '../../web/src/video-style/components.mjs';

const names = ['headline-reveal','foreground-fly-through','ui-action-result'];
let seed = 0x912021;
const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed / 2**32; };
const cli = (...args) => spawnSync(process.execPath, ['tools/video-style-components.mjs', ...args], { encoding:'utf8' });

test('three portable definitions carry attribution, typed controls, units, safe aspects and explicit capabilities', () => {
  assert.deepEqual(Object.keys(VIDEO_STYLE_PRESETS), names);
  for (const d of Object.values(VIDEO_STYLE_PRESETS)) {
    assert.equal(validateDefinition(d), d);
    assert.equal(d.license, 'Apache-2.0');
    assert.equal(d.provenance[0].author, 'echris6');
    assert.equal(d.provenance[0].license, 'MIT');
    assert.deepEqual(Object.keys(d.variants), ['16:9','9:16','1:1']);
    assert.ok(d.renderCapabilities.unsupported.includes('fframes'));
    assert.equal(d.requiredAssets.length, 0);
    assert.throws(() => { d.layers[0].tracks.x[0][1] = 9; }, TypeError);
    for (const layer of d.layers) for (const keys of Object.values(layer.tracks)) assert.ok(keys.every(k => Number.isInteger(k[0])));
  }
});

test('property: seeded random seek orders equal independently captured sequential samples without input or catalog mutation', () => {
  for (const name of names) for (const aspect of Object.keys(ASPECTS)) for (let run=0;run<4;run++) {
    const durationFrames = 2 + Math.floor(random()*150);
    const recipe = instantiate(name, {motionScale:.5+random(),accent:'#aabbcc'}, {aspect,durationFrames,fps:{num:30000,den:1001}});
    const before = serializeRecipe(recipe);
    const sequential = Array.from({length:durationFrames}, (_,f) => evaluateRecipe(recipe,f));
    const order = Array.from({length:durationFrames}, (_,i) => i);
    for (let i=order.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [order[i],order[j]]=[order[j],order[i]]; }
    for (const frame of [...order,0,durationFrames-1,...order.slice(0,10)]) assert.deepEqual(evaluateRecipe(recipe,frame), sequential[frame]);
    assert.equal(serializeRecipe(recipe),before);
  }
});

test('portable JSON roundtrip keeps edited definition, rational time, looks, cues and samples', () => {
  const r=instantiate('ui-action-result',{action:'Create video',result:'Video ready',foreground:'#fedcba'},{fps:{num:30000,den:1001},aspect:'9:16',durationFrames:121});
  r.definition.layers[0].tracks.x[0][1]=.17;
  const imported=parseRecipe(serializeRecipe(r));
  assert.deepEqual(imported,r);
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverseKeys(v)])) : value;
  assert.deepEqual(parseRecipe(JSON.stringify(reverseKeys(r))),r);
  for (let f=0;f<r.durationFrames;f++) assert.deepEqual(evaluateRecipe(imported,f),evaluateRecipe(r,f));
  assert.equal(evaluateRecipe(imported,0).layers[0].x,.17);
  assert.ok(Array.from({length:r.durationFrames},(_,f)=>evaluateRecipe(imported,f).cues).some(c=>c.length));
  imported.props.action='Independent'; assert.equal(r.props.action,'Create video');
});

test('untrusted recipes reject unknown fields, incorrect types, invalid tracks, assets and unsupported capabilities', () => {
  assert.throws(()=>instantiate('nonexistent'),/Unknown component/);
  assert.throws(()=>instantiate('headline-reveal',{unsupported:'injection'}),/Unsupported prop/);
  assert.throws(()=>instantiate('headline-reveal',{background:'url(data:bad)'}),/color/);
  assert.throws(()=>instantiate('headline-reveal',{motionScale:'1'}),/number/);
  assert.throws(()=>instantiate('headline-reveal',{headline:'x'.repeat(121)}),/text/);
  const changes=[r=>r.schema='bad',r=>r.version='2.0.0',r=>r.durationFrames=1,r=>r.fps.den=0,r=>r.fps.num=Infinity,r=>r.fps.num=241,r=>r.size.height=1,r=>r.aspect='2:1',r=>r.extra=true,r=>r.definition.author='',r=>r.definition.requiredAssets.push('missing.png'),r=>r.definition.renderCapabilities.preview='fframes',r=>r.definition.layers[0].tracks.x.push([0,1,'linear']),r=>r.definition.layers[0].tracks.x[0][2]='spring',r=>r.definition.anchors.carry.layer='absent',r=>r.definition.variants['1:1'].safeArea.top=-1];
  for(const mutate of changes){const r=instantiate('headline-reveal');mutate(r);assert.throws(()=>serializeRecipe(r));}
  const r=instantiate('headline-reveal');
  for(const f of [-1,1.1,NaN,r.durationFrames]) assert.throws(()=>evaluateRecipe(r,f),/bounds/);
  assert.throws(()=>parseRecipe('x'.repeat(262145)),/256 KiB/);
  assert.throws(()=>parseRecipe('{bad'),SyntaxError);
});

test('visible result replaces the action without a ghost label over the result', () => {
  const state=evaluateRecipe(instantiate('ui-action-result'),70);
  assert.equal(state.layers.find(l=>l.id==='action').opacity,0);
  assert.equal(state.layers.find(l=>l.id==='result').opacity,1);
});

test('documented easing endpoints, cubic reference values and hold destination jump', () => {
  assert.equal(interpolate([[0,10],[10,20]],5),15);
  assert.equal(interpolate([[0,10],[10,20,'hold']],9),10);
  assert.equal(interpolate([[0,10],[10,20,'hold']],10),20);
  assert.equal(interpolate([[0,0],[10,1,'out-cubic']],5),.875);
  assert.equal(interpolate([[0,0],[10,1,'in-cubic']],5),.125);
  assert.equal(interpolate([[0,0],[10,1,'in-out-cubic']],5),.5);
});

test('CLI list/show/export/import/eval roundtrip and failures are real subprocesses', () => {
  assert.equal(cli('list').stdout.trim().split('\n').length,3);
  for(const name of names){
    assert.deepEqual(JSON.parse(cli('show',name).stdout),VIDEO_STYLE_PRESETS[name]);
    const exp=cli('export',name,'{"accent":"#ab1234"}','{"aspect":"1:1","fps":{"num":30000,"den":1001}}'); assert.equal(exp.status,0,exp.stderr);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'style-cli-'));
    try {
      const file=path.join(dir,'recipe.json');fs.writeFileSync(file,exp.stdout);
      const imported=cli('import',file);assert.equal(imported.status,0,imported.stderr);assert.deepEqual(JSON.parse(imported.stdout),JSON.parse(exp.stdout));
      const evaluated=cli('eval',file,'23');assert.equal(evaluated.status,0,evaluated.stderr);assert.deepEqual(JSON.parse(evaluated.stdout),evaluateRecipe(parseRecipe(exp.stdout),23));
      const stdin=spawnSync(process.execPath,['tools/video-style-components.mjs','import','-'],{input:exp.stdout,encoding:'utf8'});assert.equal(stdin.stdout,exp.stdout);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
  for(const args of [['show','absent'],['eval','headline-reveal','-1'],['eval','headline-reveal','2.5'],['import','nonexistent.json'],['bogus']]) assert.notEqual(cli(...args).status,0);
});

test('minimal composition checks explicit carry positions at the cut across all aspects', () => {
  for(const aspect of Object.keys(ASPECTS)){
    const a=instantiate('headline-reveal',{headline:'Carry this'},{aspect}), b=instantiate('foreground-fly-through',{next:'Carry this'},{aspect});
    const joined=joinComponents(a,b,{fromAnchor:'carry',toAnchor:'start'});
    const end=evaluateComposition(joined,a.durationFrames-1).anchors.carry;
    const start=evaluateComposition(joined,a.durationFrames).anchors.start;
    assert.equal(end.x,start.x);assert.equal(end.y,start.y);
    const actor=evaluateComposition(joined,a.durationFrames).layers.find(l=>l.id===start.layer);
    assert.equal(actor.x,end.x);assert.equal(actor.y,end.y);
    assert.deepEqual(evaluateComposition(joined,a.durationFrames),evaluateComposition(JSON.parse(JSON.stringify(joined)),a.durationFrames));
    assert.throws(()=>joinComponents(a,b,{fromAnchor:'missing'}),/anchor/);
  }
  assert.throws(()=>joinComponents(instantiate(names[0]),instantiate(names[1],{},{fps:{num:60,den:1}})),/same aspect and fps/);
});

const cineticPicks = seed => JSON.stringify({ seed, format: 'launch', energy: 'high', category: null, picks: [
  { id: 'tr-velocity-handoff-cut', name: 'Velocity handoff cut', category: 'transition', role: 'workhorse' },
  { id: 'ty-kinetic-type', name: 'Animated typography', category: 'typography_motion', role: 'accent' },
  { id: 'ui-cursor-ripple', name: 'Cursor ripple', category: 'ui_choreography', role: 'accent' },
  { id: 'ca-orbit-move', name: '3D orbit', category: 'camera', role: 'signature' },
] });
const projectFrom = (plan, aspect) => plan.picks.filter(p => p.suggestion).map(p => serializeRecipe(instantiate(p.suggestion.component,
  { accent: '#c0ffee', motionScale: 1.25 }, { id: p.sourceId, aspect, durationFrames: 61, fps: { num: 24000, den: 1001 } })));

test('same recipe and seed yield a byte-identical editable project whose edits stay independent', () => {
  for (const aspect of Object.keys(ASPECTS)) {
    const first = projectFrom(parseCineticPicks(cineticPicks(7)), aspect), second = projectFrom(parseCineticPicks(cineticPicks(7)), aspect);
    assert.equal(first.length, 3);
    assert.deepEqual(second, first);
    for (const text of first) {
      const a = parseRecipe(text), b = parseRecipe(text);
      for (let f = 0; f < a.durationFrames; f++) assert.deepEqual(evaluateRecipe(a, f), evaluateRecipe(b, f));
      a.props.background = '#000000'; a.definition.layers[0].tracks.y[0][1] = .3;
      const edited = serializeRecipe(a);
      assert.notEqual(edited, text);
      assert.equal(serializeRecipe(b), text);
      assert.deepEqual(parseRecipe(edited), a);
      assert.equal(evaluateRecipe(parseRecipe(edited), 0).background, '#000000');
    }
  }
});

test('invalid duration and parameter ranges reject with specific errors at their boundaries', () => {
  for (const durationFrames of [1, 36001, 2.5, '90', -2]) assert.throws(() => instantiate('headline-reveal', {}, { durationFrames }), /Invalid frame duration/);
  for (const durationFrames of [2, 36000]) assert.equal(instantiate('headline-reveal', {}, { durationFrames }).durationFrames, durationFrames);
  for (const motionScale of [.49, 1.51, NaN, Infinity]) assert.throws(() => instantiate('headline-reveal', { motionScale }), /Invalid number: motionScale/);
  for (const motionScale of [.5, 1.5]) assert.equal(instantiate('headline-reveal', { motionScale }).props.motionScale, motionScale);
  assert.throws(() => instantiate('headline-reveal', {}, { fps: { num: 241, den: 1 } }), /Invalid fps/);
  assert.throws(() => instantiate('headline-reveal', {}, { fps: { num: 1, den: 2 } }), /Invalid fps/);
  assert.equal(instantiate('headline-reveal', {}, { fps: { num: 240, den: 1 } }).fps.num, 240);
  const rejects = (mutate, message) => {
    const r = instantiate('headline-reveal'); mutate(r);
    assert.throws(() => serializeRecipe(r), message);
    assert.throws(() => parseRecipe(JSON.stringify(r)), message);
  };
  rejects(r => { r.durationFrames = 0; }, /Invalid frame duration/);
  rejects(r => { r.durationFrames = 36001; }, /Invalid frame duration/);
  rejects(r => { r.definition.durationFrames = 1; }, /Invalid frame duration/);
  rejects(r => { r.definition.layers[1].tracks.x.at(-1)[0] = r.definition.durationFrames; }, /Invalid keyframe\/easing/);
  rejects(r => { r.definition.layers[1].tracks.x[1][0] = r.definition.layers[1].tracks.x[0][0]; }, /Invalid keyframe\/easing/);
  rejects(r => { r.definition.layers[1].tracks.opacity[0][1] = 1.01; }, /Invalid opacity/);
  rejects(r => { r.definition.layers[1].tracks.scale[0][1] = 0; }, /Invalid scale/);
  rejects(r => { r.definition.cues[0].frame = r.definition.durationFrames; }, /Invalid cues/);
  rejects(r => { r.definition.controls.motionScale.max = 2; }, /Invalid motionScale/);
  rejects(r => { r.definition.variants['16:9'].safeArea.left = .41; }, /Invalid safe area\/text width/);
  const r = instantiate('headline-reveal', {}, { durationFrames: 2 });
  assert.throws(() => evaluateRecipe(r, 2), /Frame out of bounds/);
  assert.equal(evaluateRecipe(r, 1).frame, 1);
});

test('missing or incomplete provenance rejects instead of exporting uncredited components', () => {
  const rejects = (mutate, message) => {
    const r = instantiate('foreground-fly-through'); mutate(r.definition);
    assert.throws(() => serializeRecipe(r), message);
    assert.throws(() => parseRecipe(JSON.stringify(r)), message);
    assert.throws(() => validateDefinition(r.definition), message);
  };
  rejects(d => { delete d.provenance; }, /Invalid definition fields/);
  rejects(d => { d.provenance = []; }, /Invalid provenance/);
  rejects(d => { d.provenance = null; }, /Invalid provenance/);
  rejects(d => { d.provenance = { ...d.provenance[0] }; }, /Invalid provenance/);
  rejects(d => { delete d.provenance[0].author; }, /Invalid provenance fields/);
  rejects(d => { delete d.provenance[0].license; }, /Invalid provenance fields/);
  rejects(d => { d.provenance[0].author = ''; }, /Invalid provenance/);
  rejects(d => { d.provenance[0].usage = ''; }, /Invalid provenance/);
  rejects(d => { d.provenance[0].url = 'http://github.com/echris6/motion-video-kit'; }, /Invalid provenance/);
  rejects(d => { d.author = ''; }, /Invalid metadata: author/);
  rejects(d => { d.license = ''; }, /Invalid metadata: license/);
  const exported = parseRecipe(serializeRecipe(instantiate('foreground-fly-through')));
  assert.deepEqual(exported.definition.provenance, VIDEO_STYLE_PRESETS['foreground-fly-through'].provenance);
});

test('conceptual cinetic picks stay suggestions and never become implemented effects', () => {
  const plan = parseCineticPicks(cineticPicks(41));
  assert.deepEqual(parseCineticPicks(cineticPicks(41)), plan);
  assert.equal(parseCineticPicks(cineticPicks(42)).provenance.seed, 42);
  assert.deepEqual(plan.picks.map(p => [p.status, p.suggestion]), [
    ['suggested', { component: 'foreground-fly-through', fidelity: 'conceptual-only' }],
    ['suggested', { component: 'headline-reveal', fidelity: 'conceptual-only' }],
    ['suggested', { component: 'ui-action-result', fidelity: 'conceptual-only' }],
    ['needs-implementation', null],
  ]);
  assert.deepEqual(Object.keys(VIDEO_STYLE_PRESETS), names);
  for (const p of plan.picks) {
    assert.ok(!Object.hasOwn(p, 'recipe') && !Object.hasOwn(p, 'definition'));
    assert.throws(() => instantiate(p.sourceId), /Unknown component/);
    if (!p.suggestion) continue;
    const recipe = instantiate(p.suggestion.component), text = serializeRecipe(recipe);
    assert.deepEqual(recipe, instantiate(p.suggestion.component));
    assert.deepEqual(recipe.definition, VIDEO_STYLE_PRESETS[p.suggestion.component]);
    for (const leaked of [p.sourceId, p.name, 'cinetic', 'conceptual-only']) assert.ok(!text.includes(leaked), leaked);
    assert.ok(recipe.definition.renderCapabilities.unsupported.includes('fframes'));
    const rejects = (mutate, message) => { const r = structuredClone(recipe); mutate(r); assert.throws(() => serializeRecipe(r), message); };
    rejects(r => { r.definition.renderCapabilities.supported.push(p.sourceId); }, /Unsupported render contract/);
    rejects(r => { r.definition.renderCapabilities.unsupported = r.definition.renderCapabilities.unsupported.filter(x => x !== 'fframes'); }, /Unsupported render contract/);
    rejects(r => { r.definition.layers[0].tracks.x[0][2] = p.sourceId; }, /Invalid keyframe\/easing/);
    rejects(r => { r.definition.layers[0].role = p.category; }, /Invalid layer/);
    rejects(r => { r.cinetic = p; }, /Invalid recipe fields/);
    rejects(r => { r.definition.cinetic = p; }, /Invalid definition fields/);
    assert.throws(() => instantiate(p.suggestion.component, { [p.sourceId.replace(/-./g, m => m[1].toUpperCase())]: 1 }), /Unsupported prop/);
  }
});
