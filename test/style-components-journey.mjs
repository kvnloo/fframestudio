import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { VIDEO_STYLE_PRESETS, parseRecipe } from '../web/src/video-style/components.mjs';

// Compare actual DOM/CSS sampling with a separate CLI process, not a preview debug object.
export async function verifyStyleComponents({context,base,out,root,assert,mode='bridge',perf=true}) {
  const page = await context.newPage(), errors = [], failed = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).origin !== base) external.push(r.url()); });
  page.on('response', r => { if(r.status()>=400) failed.push(new URL(r.url()).pathname+':'+r.status()); });
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'style-parity-'));
  let samples=0, metrics;
  const close=(a,b,label,tolerance=1e-6)=>assert(Math.abs(a-b)<=tolerance,`${label}: ${a} != ${b}`);
  try {
    await page.goto(base+'/app/labs/video-styles.html');
    await page.waitForSelector('#stage-a .layer');
    await page.setViewportSize({width:1896,height:880});
    await page.evaluate(()=>document.fonts.ready);
    for (const name of Object.keys(VIDEO_STYLE_PRESETS)) {
      await page.selectOption('#component',name);
      await page.fill('#primary','A real editable take');
      await page.fill('#secondary','The visible result');
      await page.locator('#accent').evaluate(el=>{el.value='#eeaa66';el.dispatchEvent(new Event('input'));});
      await page.fill('#duration','121');await page.locator('#duration').dispatchEvent('change');
      await page.fill('#fps-num','30000');await page.locator('#fps-num').dispatchEvent('change');
      await page.fill('#fps-den','1001');await page.locator('#fps-den').dispatchEvent('change');
      for(const aspect of ['16:9','9:16','1:1']){
        for (const take of ['a','b']) {
          await page.click(`[data-take="${take}"]`);
          await page.selectOption('#aspect',aspect);
          await page.click('#copy-instance');
          const source=await page.inputValue('#json'), recipe=parseRecipe(source);
          const file=path.join(work,'instance.json');fs.writeFileSync(file,source);
          for(const frame of [0,23,Math.min(55,recipe.durationFrames-1),recipe.durationFrames-1,7]){
            await page.locator('#frame').evaluate((el,f)=>{el.value=f;el.dispatchEvent(new Event('input'));},frame);
            const command=spawnSync(process.execPath,['tools/video-style-components.mjs','eval',file,String(frame)],{cwd:root,encoding:'utf8'});
            assert(command.status===0,command.stderr);
            const expected=JSON.parse(command.stdout);
            const actual=await page.locator('#stage-'+take).evaluate(stage=>({frame:Number(stage.dataset.frame),background:getComputedStyle(stage).backgroundColor,
              layers:[...stage.querySelectorAll('.layer')].map(el=>{const css=getComputedStyle(el),m=new DOMMatrixReadOnly(css.transform);return {id:el.dataset.layer,text:el.textContent,x:parseFloat(el.style.left)/100,y:parseFloat(el.style.top)/100,scale:m.a,opacity:Number(css.opacity),z:Number(css.zIndex),color:css.color,accent:css.borderColor,maxWidth:parseFloat(el.style.width)/100};}),
              safeArea:Object.fromEntries(['left','top','right','bottom'].map(k=>[k,parseFloat(stage.querySelector('.safe-area').style[k])/100])),
            }));
            const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')';
            assert(actual.frame===frame,'wrong sampled preview frame');assert(actual.background===rgb(expected.background),'canvas color differs from CLI');
            assert(actual.layers.length===expected.layers.length,'layer count differs');
            for(const [i,l]of expected.layers.entries()){
              const a=actual.layers[i];assert(a.id===l.id && a.text===l.text && a.z===l.z,'identity/copy/z differs from CLI');
              assert(a.color===rgb(l.color) && a.accent===rgb(l.accent),'look tokens differ from CLI');
              for(const key of ['x','y','scale','opacity','maxWidth'])close(a[key],l[key],key,5e-6);
            }
            for(const k of Object.keys(expected.safeArea))close(actual.safeArea[k],expected.safeArea[k],k);
            const geometry=await page.locator('#stage-'+take).evaluate(stage=>{const s=stage.getBoundingClientRect(),m=stage.parentElement.getBoundingClientRect();return {width:s.width,height:s.height,inside:s.left>=m.left && s.right<=m.right && s.top>=m.top && s.bottom<=m.bottom};});
            assert(geometry.inside && geometry.width>0 && geometry.height>0,'stage is outside its mat');
            close(geometry.width/geometry.height,recipe.size.width/recipe.size.height,'aspect ratio',.001);
            samples++;
          }
        }
      }
    }
    // Compare and guides are functional controls, not labels.
    await page.uncheck('#compare');assert(await page.locator('#figure-b').isHidden(),'compare off still shows B');
    await page.check('#compare');assert(await page.locator('#figure-b').isVisible(),'compare on hides B');
    await page.uncheck('#guides');assert(await page.locator('#stage-a .safe-area').isHidden(),'safe guide toggle failed');
    await page.check('#guides');
    // Import/export are real user paths, including rejection without losing the active take.
    await page.click('[data-take="a"]');await page.click('#copy-instance');
    const exported=await page.inputValue('#json'), edited=JSON.parse(exported);
    edited.props.action='Imported action';edited.definition.layers[0].tracks.x[0][1]=.19;
    await page.fill('#json',JSON.stringify(edited));await page.click('#import');
    assert(await page.inputValue('#primary')==='Imported action','import did not edit copy');
    close(await page.locator('#stage-a [data-layer="action"]').evaluate(el=>parseFloat(el.style.left)/100),.19,'imported track preview');
    await page.fill('#json','{"schema":"unsupported"}');await page.click('#import');
    assert((await page.locator('#message').innerText()).startsWith('Import refused:'),'invalid import accepted');
    assert(await page.inputValue('#primary')==='Imported action','failed import mutated take');
    const download=page.waitForEvent('download');await page.click('#export');const file=await download;
    assert(parseRecipe(fs.readFileSync(await file.path(),'utf8')).props.action==='Imported action','download lost edits');
    await page.click('#copy-definition');assert(JSON.parse(await page.inputValue('#json')).id==='ui-action-result','definition copy is not a definition');
    await page.click('#json-toggle');
    // Keyboard seek and playback must drive the same mounted layers.
    await page.selectOption('#component','headline-reveal');
    await page.locator('#frame').fill('30');await page.locator('#frame').press('ArrowRight');
    assert(await page.locator('#stage-a').getAttribute('data-frame')==='31','keyboard scrub failed');
    await page.click('#play');await page.waitForFunction(()=>Number(document.querySelector('#stage-a').dataset.frame)>32);await page.click('#play');
    const playbackPaused=await page.locator('#play').innerText();assert(playbackPaused.includes('Play'),'preview did not pause');
    if(perf){
      await page.setViewportSize({width:1896,height:880});
      metrics={runs:[]};
      for(const component of Object.keys(VIDEO_STYLE_PRESETS)){
        await page.selectOption('#component',component);
        const measured=await page.evaluate(async()=>{
        const range=document.querySelector('#frame'), intervals=[],work=[],long=[];
        const observer=new PerformanceObserver(list=>long.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
        const nodes=[...document.querySelectorAll('.layer')];
        let previous;
        const begin=performance.now();
        await new Promise(resolve=>{
          function tick(now){
            if(previous!==undefined)intervals.push(now-previous);previous=now;
            const start=performance.now();range.value=String((intervals.length*37)%90);range.dispatchEvent(new Event('input'));work.push(performance.now()-start);
            if(intervals.length>=120)resolve();else requestAnimationFrame(tick);
          }requestAnimationFrame(tick);
        });
        await new Promise(r=>setTimeout(r,0));observer.disconnect();
        return {fps:1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),intervals,workMs:work,longTasks:long.filter(e=>e.start>=begin),nodesPreserved:nodes.every(n=>n.isConnected),frames:work.length};
      });
        metrics.runs.push({component,...measured});
      }
      fs.writeFileSync(path.join(out,'style-lab-'+mode+'-perf.json'),JSON.stringify(metrics,null,2));
      for(const m of metrics.runs)assert(m.nodesPreserved,'scrub rebuilt layer DOM');
    }
    for(const component of Object.keys(VIDEO_STYLE_PRESETS)){
      await page.selectOption('#component',component);
      await page.locator('#frame').fill(component==='ui-action-result'?'70':'35');
      await page.screenshot({path:path.join(out,`style-${component}-${mode}.png`)});
    }
    await page.selectOption('#component','headline-reveal');
    await page.locator('#frame').fill('35');
    const layouts=[];
    for(const [width,height] of [[1896,880],[390,780]]){
      await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(out,`style-lab-${mode}-${width}x${height}.png`)});
      if(width===390)await page.screenshot({path:path.join(out,`style-lab-${mode}-${width}x${height}-full.png`),fullPage:true});
      const size=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
      assert(size.width<=width,'lab has horizontal overflow');
      if(width>=1024)assert(size.height<=height,'desktop lab does not fit');
      layouts.push({viewport:{width,height},document:size});
    }
    if(metrics)for(const m of metrics.runs){assert(m.fps>=1000/17.5,m.component+': lab scrub below existing 60 Hz scheduling tolerance');assert(m.longTasks.length===0,m.component+': lab scrub has long tasks');}
    assert(!errors.length && !failed.length && !external.length,JSON.stringify({errors,failed,external}));
    return {mode,cliMatchedSamples:samples,properties:['copy','x','y','scale','opacity','z','color','accent','maxWidth','safeArea','background'],importExport:true,invalidImportRefused:true,keyboardScrub:true,playPause:true,layouts,metrics};
  }catch(error){
    fs.writeFileSync(path.join(out,'style-lab-'+mode+'-failure.json'),JSON.stringify({mode,cliMatchedSamples:samples,error:error.message,metrics},null,2));
    if(!page.isClosed())await page.screenshot({path:path.join(out,'style-lab-'+mode+'-failure.png')}).catch(()=>{});
    throw error;
  }finally{await page.close();fs.rmSync(work,{recursive:true,force:true});}
}
