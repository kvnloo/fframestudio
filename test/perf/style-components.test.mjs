import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { VIDEO_STYLE_PRESETS, instantiate, evaluateRecipe } from '../../web/src/video-style/components.mjs';

test('style component evaluation is below 1 ms per frame including validation', () => {
  const samples = [];
  for (const component of Object.keys(VIDEO_STYLE_PRESETS)) {
    const recipe = instantiate(component, {}, {fps:{num:30000,den:1001}});
    for (let i=0;i<500;i++) evaluateRecipe(recipe,i%recipe.durationFrames);
    const timings=[];
    for(let i=0;i<3000;i++) {
      const t=performance.now();evaluateRecipe(recipe,(i*37)%recipe.durationFrames);timings.push(performance.now()-t);
    }
    const sorted=timings.toSorted((a,b)=>a-b);
    samples.push({component,count:timings.length,meanMs:timings.reduce((a,b)=>a+b,0)/timings.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),timings});
  }
  const receipt={node:process.version,platform:process.platform,arch:process.arch,warmupPerComponent:500,includes:'Full definition/recipe validation and evaluation; excludes DOM/render/encoding',samples};
  if(process.env.FFS_STYLE_EVIDENCE){fs.mkdirSync(process.env.FFS_STYLE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.FFS_STYLE_EVIDENCE,'style-eval-perf.json'),JSON.stringify(receipt,null,2));}
  console.log(JSON.stringify(samples.map(({timings,...s})=>s)));
  for(const s of samples){assert.ok(s.meanMs<1,`${s.component} mean >= 1 ms`);assert.ok(s.p95Ms<1,`${s.component} p95 >= 1 ms`);}
});
