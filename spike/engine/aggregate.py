"""Aggregate only actual receipts; keep private media and frame images out of Git."""
from pathlib import Path
import json,hashlib,subprocess,shutil
R=Path(__file__).parent;A=R/'artifacts';E=R/'evidence';E.mkdir(exist_ok=True)
def load(n):return json.loads((A/n).read_text())
w=load('webav-results.json');d=load('alternative-results.json');s=load('seek-verification.json');p=load('performance-results.json');n=load('native-results.json');g=load('native-gpu-results.json');f=load('final-export-results.json');paint=load('painted-playback.json');v=load('probe-verification.json')
for engine in s:assert s[engine]['count']==50
summary={'seek':{k:{a:b for a,b in val.items()if a!='rows'}for k,val in s.items()},'memory':{},'playback':{},'webavExports':{},'diffusionExports':{},'native':{}}
for label,r in [('webav',w),('diffusion',d)]:
 mem=r['memory'];scrub=r['scrub'];summary['memory'][label]={'seconds':scrub['elapsedMs']/1000,'seeks':scrub['count'],'rssMiBStart':mem[0]['rss']/2**20,'rssMiBEnd':mem[-1]['rss']/2**20,'rssMiBPeak':max(x['rss']for x in mem)/2**20,'heapMiBStart':scrub['samples'][0]['heap']/2**20,'heapMiBEnd':scrub['samples'][-1]['heap']/2**20,'pageErrors':len(r['errors'])}
for label,r in paint.items():
 expected=r['result']['fps']*r['result']['seconds'];unique=r['uniquePaintedSourceFrames'];summary['playback'][label]={'paintCalls':len(r['paintTrace']),'distinctSourceFrames':unique,'expectedFrames':expected,'missingPercent':100*(expected-unique)/expected,'distinctFPS':unique/r['result']['seconds'],'measurementSeconds':r['result']['wallMs']/1000}
for label,r in p.items():
 if label in ['errors','chromiumCapture','webavSilent20s']:continue
 st=v['artifacts/probe-'+label+'.mp4']['streams'][0];count=int(st['nb_read_frames']);summary['webavExports'][label]={**r,'actualFrames':count,'verifiedFPS':count/(r['elapsedMs']/1000),'encodedRate':st['r_frame_rate'],'encodedDuration':st['duration']}
summary['webavExports']['film20s']={**p['webavSilent20s'],'actualFrames':601,'verifiedFPS':601/(p['webavSilent20s']['elapsedMs']/1000),'browserAudio':'failed AAC'}
for label,r in f.items():
 count={'final':600,'portrait60':120,'4k30':60,'1440p120':240}[label];duration=20 if label=='final'else 2;summary['diffusionExports'][label]={**r,'actualFrames':count,'verifiedFPS':count/(r['elapsedMs']/1000),'realtimeFactor':duration/(r['elapsedMs']/1000)}
for name,frames,seconds in [('fframesMaster',120,n['fframes']['seconds']),('fframesCPUFinal',120,n['fframes']['seconds']+g['fframes-normalized']['seconds']),('fframesNVENCFinal',120,n['fframes']['seconds']+g['fframes-nvenc']['seconds']),('chromiumCapture',60,p['chromiumCapture']['seconds']),('chromiumCPUFinal',60,p['chromiumCapture']['seconds']+n['chromium-frames-encode']['seconds']),('chromiumNVENCFinal',60,p['chromiumCapture']['seconds']+g['chromium-nvenc']['seconds']),('tmix60Total',120,p['1080p240']['elapsedMs']/1000+n['tmix60']['seconds']),('tmix30Total',60,p['1080p240']['elapsedMs']/1000+n['tmix30']['seconds'])]:summary['native'][name]={'seconds':seconds,'frames':frames,'fps':frames/seconds}
(E/'summary.json').write_text(json.dumps(summary,indent=2))
for name in ['research.json','webav-results.json','alternative-results.json','seek-verification.json','performance-results.json','native-results.json','native-gpu-results.json','final-export-results.json','painted-playback.json','av-verification.json','probe-verification.json','final-probes.json','firefox.json','fixtures.json']:
 shutil.copy2(A/name,E/name)
manifest={str(x.relative_to(R)):{'bytes':x.stat().st_size,'sha256':hashlib.sha256(x.read_bytes()).hexdigest()}for x in A.iterdir()if x.is_file() and x.suffix in ['.mp4','.mkv','.png','.json']}
(E/'local-artifact-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps(summary,indent=2))
