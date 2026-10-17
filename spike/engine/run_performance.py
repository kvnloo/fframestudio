import asyncio,json,time,os,base64
from pathlib import Path
from playwright.async_api import async_playwright
R=Path(__file__).parent;A=R/'artifacts'
FLAGS=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=vulkan','--enable-features=Vulkan','--autoplay-policy=no-user-gesture-required']
async def main():
 results={}
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=FLAGS,env={k:v for k,v in os.environ.items() if k not in ['DISPLAY','WAYLAND_DISPLAY']})
  page=await b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  for width,height,fps,samples,label in [(1920,1080,30,1,'1080p30'),(1080,1920,60,1,'portrait60'),(3840,2160,30,1,'4k30'),(2560,1440,120,1,'1440p120'),(1920,1080,240,1,'1080p240'),(1920,1080,60,4,'accum60'),(1920,1080,30,8,'accum30')]:
   await page.goto('http://127.0.0.1:5197/performance.html');await page.wait_for_function('window.perf');config={'width':width,'height':height,'fps':fps,'samples':samples,'name':'probe-'+label+'.mp4'};print(label,flush=True)
   try:results[label]=await asyncio.wait_for(page.evaluate('c=>perf.exportProbe(c)',config),240)
   except Exception as e:results[label]={'error':str(e) or type(e).__name__}
   print(results[label],flush=True);(A/'performance-results.json').write_text(json.dumps({**results,'errors':errors},indent=2))
  await page.goto('http://127.0.0.1:5197/performance.html');await page.wait_for_function('window.perf');t=time.perf_counter();await page.evaluate('perf.captureInit()')
  for i in range(60):(A/f'capture-{i:03d}.png').write_bytes(base64.b64decode(await page.evaluate('i=>perf.captureFrame(i)',i)))
  results['chromiumCapture']={'frames':60,'seconds':time.perf_counter()-t};(A/'performance-results.json').write_text(json.dumps({**results,'errors':errors},indent=2))
  await page.goto('http://127.0.0.1:5197');await page.wait_for_function('window.lab');await page.evaluate('lab.init()')
  try:results['webavSilent20s']=await asyncio.wait_for(page.evaluate('lab.exportFilm({audio:false,name:"webav-silent.mp4"})'),240)
  except Exception as e:results['webavSilent20s']={'error':str(e) or type(e).__name__}
  (A/'performance-results.json').write_text(json.dumps({**results,'errors':errors},indent=2));print(results,flush=True);await b.close()
asyncio.run(main())
