import fs from 'node:fs';
import path from 'node:path';
import { fromV0 } from '../web/src/doc/project.js';
export function makeLayoutFixture(library) {
  const dir = path.join(library, 'layout-48');
  fs.cpSync(path.join(library, 'demo'), dir, { recursive:true });
  const doc = fromV0(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')));
  doc.id = 'layout-48'; doc.title = 'Forty-eight shots / sound and story'; doc.versions = [];
  const first = doc.videos[0].clips[0];
  doc.videos[0].clips = Array.from({ length:48 }, (_, i) => {
    const c = structuredClone(first), start = Math.floor(i * 360 / 48), end = Math.floor((i + 1) * 360 / 48);
    Object.assign(c, { id:`layout-shot-${i}`, name:`${String(i+1).padStart(2,'0')} / ${['Opening','Answer','Real camera','Drop','Map'][i%5]}`, start, sourceIn:start, duration:end-start, thumb:null, attached:[], text:{title:['A camera every mile.','Nobody is counting.','What changes when we look?'][i%3]}, textOverrides:{}, metadata:{ type:['S','H','M','R','T'][i%5] } });
    return c;
  });
  doc.videos[0].scenes = Array.from({length:12}, (_,i) => ({id:`chapter-${i}`,name:`Chapter ${i+1}`,clipIds:doc.videos[0].clips.slice(i*4,i*4+4).map(c=>c.id)}));
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(doc));
}
export async function verifyLayout({ browser, context, base, out, assert }) {
  const sizes = [[2560,1340],[1896,880],[1440,800],[1366,680],[1280,640],[1024,700],[768,960],[390,780]];
  const isolated = await browser.newContext({ storageState:{ cookies:(await context.storageState()).cookies, origins:[] } });
  const page = await isolated.newPage(), samples = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const storyReach = async () => {
    const ids = await page.evaluate(() => [window.ffs.video.clips[0].id, window.ffs.video.clips.at(-1).id]);
    await page.locator('#story').evaluate(n => { n.scrollTop = n.scrollHeight; });
    await page.locator(`.story-card[data-select="${ids[1]}"]`).click();
    assert(await page.evaluate(id => window.ffs.selection === id, ids[1]), 'Last virtual Story card was unreachable');
    await page.locator('#story').evaluate(n => { n.scrollTop = 0; });
    await page.locator(`.story-card[data-select="${ids[0]}"]`).click();
  };
  try {
    for (const project of ['demo','layout-48']) {
      await page.goto(base + '/#/p/' + project);
      await page.waitForFunction(id => window.ffs?.doc.id === id && !window.ffs.loading, project);
      await page.waitForFunction(() => window.ffs.studio.peaks?.some(n=>n>0));
      for (const [width,height] of sizes) {
        await page.setViewportSize({width,height});
        await page.evaluate(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        assert(!(await page.locator('#music-credit').textContent()).includes('NO AUDIO'), 'Resize lost the decoded audio credit');
        const check = async label => {
          const result = await page.evaluate(() => {
            const visible = n => {
              if (!n.getClientRects().length) return false;
              for (let p=n;p;p=p.parentElement) { const s=getComputedStyle(p); if(s.visibility==='hidden'||s.display==='none'||s.opacity==='0') return false; }
              return true;
            };
            const leaf = [...document.querySelectorAll('body *')].filter(n=>!n.children.length && n.textContent.trim() && visible(n));
            const clipped = leaf.filter(n=>n.clientWidth>0 && n.scrollWidth>n.clientWidth+2 && getComputedStyle(n).textOverflow!=='ellipsis').map(n=>({tag:n.tagName,id:n.id,text:n.textContent.slice(0,70),width:n.clientWidth,scroll:n.scrollWidth}));
            const escaped = [...document.querySelectorAll('body *')].filter(n=>visible(n) && n.getBoundingClientRect().right>innerWidth+1).filter(n=>{
              for(let p=n.parentElement;p&&p!==document.body;p=p.parentElement) if(/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return false;
              return true;
            }).map(n=>({tag:n.tagName,id:n.id,class:n.className}));
            const box = id => {const r=document.querySelector(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
            return {scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,canvas:box('#canvas'),timeline:box('#timeline'),aspect:window.ffs.doc.canvas.width/window.ffs.doc.canvas.height,clipped,escaped};
          });
          assert(result.scrollWidth<=width+1, `${project} ${width} ${label}: horizontal document scroll ${result.scrollWidth}`);
          assert(!result.clipped.length, `${project} ${width} ${label}: clipped text ${JSON.stringify(result.clipped)}`);
          assert(!result.escaped.length, `${project} ${width} ${label}: escaped elements ${JSON.stringify(result.escaped)}`);
          if(width>=1024) {
            assert(result.scrollHeight<=height+1, `${project} ${width}: document height ${result.scrollHeight}>${height}`);
            for(const id of ['timeline','canvas']) assert(result[id].x>=0&&result[id].y>=0&&result[id].right<=width+1&&result[id].bottom<=height+1&&result[id].height>0, `${project} ${width}: ${id} not wholly in viewport ${JSON.stringify(result[id])}`);
          }
          if(width>=768) assert(result.timeline.bottom<=height+1, `${project} ${width}: timeline below fold`);
          if(width<768) {
            const phone = await page.evaluate(() => ({
              overlap:document.querySelector('.inspector-panel').getBoundingClientRect().top < document.querySelector('.timeline-panel').getBoundingClientRect().bottom - 1,
              small:[...document.querySelectorAll('.film-workspace button,.film-workspace select,.film-workspace input:not([type="checkbox"])')].filter(n=>n.getClientRects().length && n.getBoundingClientRect().width>0).filter(n=>{const r=n.getBoundingClientRect();return r.width<39||r.height<39;}).map(n=>n.id||n.dataset.action||n.className)
            }));
            assert(!phone.overlap, 'Phone panels overlap the timeline');
            assert(!phone.small.length, `Phone touch targets below 40px: ${phone.small}`);
          }
          assert(Math.abs(result.canvas.width/result.canvas.height-result.aspect)<.02, `${project} ${width}: canvas aspect distorted`);
          return result;
        };
        const tabs = width<1024 ? ['shot','narrative','direction','takes','assistant','source','story'] : ['shot','narrative','direction','takes','assistant','source'];
        for(const tab of tabs) {
          await page.locator(`[data-slate-tab="${tab}"]`).click();
          const pane = page.locator(tab==='shot'?'#inspector':`#${tab}-pane`);
          assert(await pane.isVisible(), `${project} ${width}: ${tab} unreachable`);
          if(tab==='story') await storyReach();
          await check(tab);
        }
        if(width>=1024) {
          assert(await page.locator('#story').isVisible(), 'Story rail not reachable');
          await storyReach();
          await page.locator('[data-action="toggle-story"]').click();
          assert(await page.locator('#story').isHidden(), 'Story did not collapse');
          await page.locator('[data-action="toggle-story"]').click();
        }
        await page.locator('[data-slate-tab="shot"]').click();
        await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#story').scrollTop=0;});
        const result = await check('final');
        const screenshot=`08-layout-${project}-${width}x${height}.png`;
        await page.screenshot({ path:path.join(out,screenshot) });
        samples.push({project,width,height,...result,screenshot,tabs});
      }
    }
    await page.setViewportSize({width:1896,height:880});
    await page.reload(); await page.waitForFunction(()=>window.ffs?.journal);
    await page.waitForSelector('.story-card canvas[data-ready="true"]');
    const posters = await page.locator('.story-card canvas[data-ready="true"]').count();
    assert(posters>0, 'No midpoint posters were generated for missing thumbnails');
    const splitter = page.locator('#timeline-splitter'), box = await splitter.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
    await page.mouse.move(box.x+box.width/2,box.y-50,{steps:15}); await page.mouse.up();
    const resized = await splitter.getAttribute('aria-valuenow');
    await page.reload(); await page.waitForFunction(()=>window.ffs?.journal);
    assert(await splitter.getAttribute('aria-valuenow')===resized,'Timeline splitter height not persisted');
    for (const key of ['Home','End']) {
      await splitter.press(key);
      const fit = await page.evaluate(() => ({height:document.documentElement.scrollHeight, viewport:innerHeight, bottom:document.querySelector('.timeline-panel .panel-foot').getBoundingClientRect().bottom}));
      assert(fit.height<=fit.viewport+1 && fit.bottom<=fit.viewport+1, `Splitter ${key} does not fit: ${JSON.stringify(fit)}`);
    }
    await page.locator('[data-action="toggle-story"]').click();
    await page.locator('[data-action="toggle-inspector"]').click();
    await page.reload(); await page.waitForFunction(()=>window.ffs?.journal);
    assert(await page.locator('.story-panel.collapsed').count()===1 && await page.locator('.inspector-panel.collapsed').count()===1, 'Panel collapse state not persisted');
    await page.locator('[data-action="toggle-story"]').click();
    await page.locator('[data-action="toggle-inspector"]').click();
    assert(!errors.length, `Layout page errors: ${errors}`);
    return {samples,midpointPosters:posters,splitterPersisted:true,panelCollapsePersisted:true,virtualStoryReachable:true,errors};
  } finally { await isolated.close(); }
}
