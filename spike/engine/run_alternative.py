import asyncio,json,time,os,base64,random
from pathlib import Path
import psutil
from playwright.async_api import async_playwright
ROOT=Path(__file__).parent; OUT=ROOT/'artifacts';OUT.mkdir(exist_ok=True)
FLAGS=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=vulkan','--enable-features=Vulkan','--autoplay-policy=no-user-gesture-required','--enable-precise-memory-info']
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=FLAGS,env={k:v for k,v in os.environ.items() if k not in ['DISPLAY','WAYLAND_DISPLAY','SWAYSOCK']})
  page=await browser.new_page(viewport={'width':1200,'height':800});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def reload():await page.goto('http://127.0.0.1:5197/alternative.html');await page.wait_for_function('window.alt')
  await reload();report={}
  def checkpoint(): (OUT/'alternative-results.json').write_text(json.dumps({**report,'errors':errors},indent=2))
  async def run(name,expr,timeout=180):
   print(name,flush=True)
   try:report[name]=await asyncio.wait_for(page.evaluate(expr),timeout)
   except Exception as e:report[name]={'error':str(e) or type(e).__name__}
   checkpoint();print(str(report[name])[:400],flush=True)
  await run('composition','alt.init()');await asyncio.sleep(1);await run('snapshot','alt.snapshot()')
  await run('export','alt.exportFilm()',90)
  await reload();await run('silentInit','alt.init()');await run('exportSilent','alt.exportFilm({audio:false,name:"diffusion-silent.mp4"})')
  await reload();await run('opusInit','alt.init()');await run('exportOpus','alt.exportFilm({codec:"opus",name:"diffusion-opus.mp4"})')
  await reload();await run('seekInit','alt.init("fly.mp4")')
  rng=random.Random(424242);times=[rng.uniform(.05,4.9) for _ in range(50)]
  for engine,settle in [('diffusion',0),('diffusionSettled',500)]:
   rows=[]
   for i,t in enumerate(times): rows.append(await page.evaluate('x=>alt.seekFrame(x)',{'time':t,'name':f'{engine}-seek-{i:02d}.png','settleMs':settle}))
   report[engine+'Seeks']=rows;checkpoint()
  for fps in [30,60]:
   await reload();await run(f'playback{fps}Init','alt.init("source60.mp4")');await run(f'playback{fps}',f'alt.playback({fps},4)')
  await reload();await run('decode4kInit','alt.init("source4k.mp4")');await run('decode4k','alt.seekFrame({time:1.5,settleMs:1000,name:"diffusion4k.png"})')
  await reload();await run('scrubInit','alt.init()');mem=[];stop=False
  async def monitor():
   session=await browser.new_browser_cdp_session()
   while not stop:
    procs=(await session.send('SystemInfo.getProcessInfo'))['processInfo'];rows=[]
    for item in procs:
     try:rows.append({'type':item['type'],'pid':item['id'],'rss':psutil.Process(item['id']).memory_info().rss})
     except psutil.Error:pass
    mem.append({'monotonic':time.monotonic(),'rss':sum(x['rss'] for x in rows),'processes':rows});await asyncio.sleep(10)
  task=asyncio.create_task(monitor());await run('scrub','alt.scrub(300)',340);stop=True;await task;report['memory']=mem;checkpoint();await browser.close()
asyncio.run(main())
