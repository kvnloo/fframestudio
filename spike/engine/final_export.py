"""Final calibration export after font-unit mapping and marker placement."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
A=Path(__file__).parent/'artifacts'
async def main():
 r={}
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=vulkan','--enable-features=Vulkan','--autoplay-policy=no-user-gesture-required'],env={k:v for k,v in os.environ.items() if k not in ['DISPLAY','WAYLAND_DISPLAY']})
  page=await b.new_page()
  for label,width,height,fps,duration in [('final',1920,1080,30,20),('portrait60',1080,1920,60,2),('4k30',3840,2160,30,2),('1440p120',2560,1440,120,2)]:
   await page.goto('http://127.0.0.1:5197/alternative.html');await page.wait_for_function('window.alt');await page.evaluate('alt.init()')
   try:r[label]=await asyncio.wait_for(page.evaluate('c=>alt.exportFilm(c)',{'width':width,'height':height,'fps':fps,'duration':duration,'name':'diffusion-'+label+'.mp4'}),180)
   except Exception as e:r[label]={'error':str(e) or type(e).__name__}
   print(label,r[label],flush=True);(A/'final-export-results.json').write_text(json.dumps(r,indent=2))
  await b.close()
asyncio.run(main())
