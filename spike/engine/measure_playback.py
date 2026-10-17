"""Count painted source timestamps without GPU readback (cache-canvas propagation)."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
A=Path(__file__).parent/'artifacts'
HOOK="""() => {
 const provenance=new WeakMap();window.paintTrace=[];window.paintActive=false;
 for(const C of [CanvasRenderingContext2D,OffscreenCanvasRenderingContext2D]){
  const original=C.prototype.drawImage;
  C.prototype.drawImage=function(img,...args){
   const ts=img instanceof VideoFrame?img.timestamp:provenance.get(img);
   if(ts!==undefined){provenance.set(this.canvas,ts);if(window.paintActive&&this.canvas===document.querySelector('#stage canvas'))window.paintTrace.push({ts,wall:performance.now()});}
   return original.call(this,img,...args);
  };
 }
}"""
async def main():
 r={}
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=vulkan','--enable-features=Vulkan','--autoplay-policy=no-user-gesture-required'])
  page=await b.new_page()
  for engine,url,api in [('webav','/','lab'),('diffusion','/alternative.html','alt')]:
   for fps in [30,60]:
    await page.goto('http://127.0.0.1:5197'+url);await page.wait_for_function('window.'+api);await page.evaluate(HOOK);await page.evaluate(api+'.init("source60.mp4")');await page.evaluate('window.paintActive=true');result=await page.evaluate(f'{api}.playback({fps},4)');await page.evaluate('window.paintActive=false');trace=await page.evaluate('paintTrace');r[engine+str(fps)]={'result':result,'paintTrace':trace,'uniquePaintedSourceFrames':len(set(x['ts']for x in trace))};print(engine,fps,len(trace),r[engine+str(fps)]['uniquePaintedSourceFrames'],flush=True)
  await b.close()
 (A/'painted-playback.json').write_text(json.dumps(r,indent=2))
asyncio.run(main())
