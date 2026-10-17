import asyncio,json,time,os,base64,random
from pathlib import Path
import psutil
from playwright.async_api import async_playwright
ROOT=Path(__file__).parent; OUT=ROOT/'artifacts';OUT.mkdir(exist_ok=True)
FLAGS=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=vulkan','--enable-features=Vulkan','--autoplay-policy=no-user-gesture-required','--enable-precise-memory-info']
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=FLAGS,env={k:v for k,v in os.environ.items() if k not in ['DISPLAY','WAYLAND_DISPLAY','SWAYSOCK']})
  page=await browser.new_page(viewport={'width':1200,'height':800});page.set_default_timeout(30000)
  errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
  await page.goto('http://127.0.0.1:5197');await page.wait_for_function('window.lab')
  report={'flags':FLAGS,'gpu':await(await browser.new_browser_cdp_session()).send('SystemInfo.getInfo')}
  def checkpoint(): (OUT/'webav-results.json').write_text(json.dumps({**report,'errors':errors},indent=2))
  async def run(name,expr,timeout=120):
   print(name,flush=True)
   try:report[name]=await asyncio.wait_for(page.evaluate(expr),timeout)
   except Exception as e:report[name]={'error':str(e) or type(e).__name__}
   checkpoint();print(str(report[name])[:400],flush=True)
  await run('caps','lab.caps()')
  await run('composition','lab.init()')
  await run('snapshot','lab.snapshot(8.5)')
  await run('export','lab.exportFilm()',90)
  # Reload after failed encoder to prevent abandoned exports contaminating tests.
  await page.reload();await page.wait_for_function('window.lab')
  rng=random.Random(424242);times=[rng.uniform(.05,4.9) for _ in range(50)]
  for engine in ['webav','mediabunny']:
   await run(engine+'SeekInit',f'lab.seekInit("fly.mp4","{engine}")')
   result=[]
   for i,t in enumerate(times):result.append(await page.evaluate('x=>lab.seekFrame(x)',{'time':t,'name':f'{engine}-seek-{i:02d}.png'}))
   report[engine+'Seeks']=result;checkpoint()
  for fps in [30,60]:
   await run(f'playback{fps}Init','lab.init("source60.mp4")')
   await run(f'playback{fps}',f'lab.playback({fps},4)')
  await run('decode4kInit','lab.seekInit("source4k.mp4")')
  await run('decode4k','lab.seekFrame({time:1.5,name:"decode4k.png"})')
  await run('scrubInit','lab.init()')
  mem=[];stop=False
  async def monitor():
   session=await browser.new_browser_cdp_session()
   while not stop:
    procs=(await session.send('SystemInfo.getProcessInfo'))['processInfo'];rows=[]
    for item in procs:
     try:rows.append({'type':item['type'],'pid':item['id'],'rss':psutil.Process(item['id']).memory_info().rss})
     except psutil.Error:pass
    mem.append({'monotonic':time.monotonic(),'rss':sum(x['rss'] for x in rows),'processes':rows});await asyncio.sleep(10)
  task=asyncio.create_task(monitor());await run('scrub','lab.scrub(300)',340);stop=True;await task;report['memory']=mem;checkpoint()
  await browser.close()
asyncio.run(main())
