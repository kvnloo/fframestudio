"""Independent FFmpeg decoded-pixel oracle, not engine timestamps alone."""
from pathlib import Path
import subprocess,json,math
import numpy as np
from PIL import Image
R=Path(__file__).parent;A=R/'artifacts'
raw=subprocess.check_output(['ffmpeg','-v','error','-threads','2','-filter_threads','2','-i',str(R/'public/media/fly.mp4'),'-vf','scale=320:180:flags=bilinear','-pix_fmt','rgb24','-f','rawvideo','-'])
ref=np.frombuffer(raw,np.uint8).reshape(-1,180,320,3).astype(np.float32)
data=json.loads((A/'webav-results.json').read_text());report={}
engines=['webav','mediabunny']
if (A/'alternative-results.json').exists():
 data.update(json.loads((A/'alternative-results.json').read_text()));engines+=['diffusion','diffusionSettled']
for engine in engines:
 rows=[]
 for i,s in enumerate(data[engine+'Seeks']):
  img=np.array(Image.open(A/f'{engine}-seek-{i:02d}.png').convert('RGB')).astype(np.float32)
  mse=((ref-img)**2).mean(axis=(1,2,3));expected=int(s['requested']*30);nearest=int(np.argmin(mse));psnr=lambda v:float(10*np.log10(255**2/max(float(v),1e-12)))
  rows.append({**s,'expectedFrame':expected,'nearestPixelFrame':nearest,'errorFrames':nearest-expected,'expectedPSNR':psnr(mse[expected]),'nearestPSNR':psnr(mse[nearest])})
 report[engine]={'count':len(rows),'maxAbsErrorFrames':max(abs(r['errorFrames']) for r in rows),'minimumExpectedPSNR':min(r['expectedPSNR'] for r in rows),'medianExpectedPSNR':float(np.median([r['expectedPSNR'] for r in rows])),'medianSeekMs':float(np.median([r['ms'] for r in rows])),'p95SeekMs':float(np.percentile([r['ms'] for r in rows],95)),'rows':rows}
(A/'seek-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:{a:b for a,b in v.items() if a!='rows'} for k,v in report.items()},indent=2))
