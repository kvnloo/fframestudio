import asyncio,json,os,pathlib,gzip
from playwright.async_api import async_playwright
async def main():
    out=pathlib.Path(os.environ['FFS_EVIDENCE']);out.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=await b.new_context(viewport={'width':1440,'height':1000})
        page=await context.new_page();await page.goto(os.environ['FFS_URL'])
        base=page.url.split('#')[0]
        # New page and disabled cache: navigation-to-editor-interactive, includes worker migration.
        cold=await context.new_page();cdp=await context.new_cdp_session(cold);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{'cacheDisabled':True})
        await cold.goto(base+'#/p/expresslane-i880',wait_until='domcontentloaded');await cold.wait_for_function('window.ffs?.doc')
        cold_ms=await cold.evaluate('window.ffs.interactiveAt')
        cold_details=await cold.evaluate('({metrics:window.ffs.metrics,resources:performance.getEntriesByType("resource").map(r=>({name:r.name,start:r.startTime,duration:r.duration}))})')
        await cold.close();await page.goto(base+'#/p/perf-500');await page.wait_for_function('window.ffs?.doc.id==="perf-500"')
        await page.wait_for_timeout(500)
        data=await page.evaluate('''async()=>{
          const e=window.ffs,latencies=[],longtasks=[];const observer=new PerformanceObserver(list=>longtasks.push(...list.getEntries().map(x=>x.duration)));observer.observe({type:'longtask'});
          const unchanged=document.querySelector('.canvas-panel'),input=document.querySelector('#duration');
          for(let i=0;i<20;i++){
            const start=performance.now();await e.run({type:'edit-text',clipId:'clip-0',field:'title',value:'Measured '+i});
            // Flush pending style/layout: CPU work to paint-ready; presentation latency recorded separately.
            document.querySelector('#preview-text').getBoundingClientRect();const ready=performance.now()-start;
            await new Promise(requestAnimationFrame);latencies.push({ready,present:performance.now()-start});
          }
          const inspectorStable=input===document.querySelector('#duration');
          for(const cmd of [
            {type:'add',clip:{id:'perf-new',duration:30}}, {type:'move',clipId:'clip-0',index:499},
            {type:'trim',clipId:'clip-0',duration:60}, {type:'split',clipId:'clip-0',at:30,newId:'perf-split'},
            {type:'replace',clipId:'clip-0',mediaId:null}, {type:'duplicate',clipId:'clip-0',newId:'perf-copy'},
            {type:'group',clipIds:['clip-0','clip-1'],id:'perf-scene'}, {type:'set-beat-lock',clipId:'clip-0',value:true},
            {type:'retime',clipId:'clip-0',speed:{num:2,den:1}}, {type:'delete',clipId:'clip-0'},
            {type:'edit-style',styleId:'default',color:'#ffffff'}, {type:'save-version',id:'perf-version'}
          ]) {const start=performance.now();await e.run(cmd);document.querySelector('.canvas-panel').getBoundingClientRect();const ready=performance.now()-start;await new Promise(requestAnimationFrame);latencies.push({command:cmd.type,ready,present:performance.now()-start});await e.action('undo');}
          await e.run({type:'save-version',id:'perf-restore'});await e.run({type:'trim',clipId:'clip-0',duration:60});
          for(const [command,action] of [['restore-version',()=>e.run({type:'restore-version',id:'perf-restore'})],['undo',()=>e.action('undo')],['redo',()=>e.action('redo')],['select',()=>e.select('clip-1')]]){const start=performance.now();await action();document.querySelector('.canvas-panel').getBoundingClientRect();const ready=performance.now()-start;await new Promise(requestAnimationFrame);latencies.push({command,ready,present:performance.now()-start});}
          const domStable=inspectorStable&&unchanged===document.querySelector('.canvas-panel');
          const story=document.querySelectorAll('.story-card').length,timeline=document.querySelectorAll('.timeline-clip').length;
          longtasks.length=0;const frames=[];let last=performance.now();e.rate=1;
          await new Promise(resolve=>{const start=performance.now();function sample(t){frames.push(t-last);last=t;if(t-start<2000)requestAnimationFrame(sample);else resolve();}requestAnimationFrame(sample);});e.rate=0;observer.disconnect();
          return {latencies,domStable,story,timeline,scrubLongtasks:longtasks,frameIntervals:frames.slice(1)};
        }''')
        files=[pathlib.Path('web/app.js')]+list(pathlib.Path('web/src').rglob('*.js'))
        # All shipped ES editor modules; ACP and its source dependency graph excluded explicitly.
        shipped=sum(len(gzip.compress(f.read_bytes(),mtime=0)) for f in files)
        data.update(coldOpenMs=cold_ms,coldDetails=cold_details,editorGzipBytes=shipped)
        data['budgets']={'coldOpen':cold_ms<300,'commandPaintReady':max(x['ready'] for x in data['latencies'])<16,'commandNextFrame':max(x['present'] for x in data['latencies'])<16,'scrubNoLongtasks':not data['scrubLongtasks'],'scrub60fps':sum(data['frameIntervals'])/len(data['frameIntervals'])<17.5,'gzip':shipped<150*1024,'virtualized':data['story']<20 and data['timeline']<100,'stableDOM':data['domStable']}
        (out/'perf.json').write_text(json.dumps(data,indent=2));print(json.dumps({k:v for k,v in data.items() if k not in ['frameIntervals','latencies']},indent=2))
        await b.close();assert all(data['budgets'].values()),data['budgets']
asyncio.run(main())
