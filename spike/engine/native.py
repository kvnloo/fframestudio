import json,time,subprocess,hashlib,os
from pathlib import Path
R=Path(__file__).parent.resolve();A=R/'artifacts';results={}
def run(label,args,cwd=R,timeout=180):
 start=time.perf_counter();env={k:v for k,v in os.environ.items() if k not in ['DISPLAY','WAYLAND_DISPLAY']}
 try:
  p=subprocess.run(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout);(A/(label+'.log')).write_bytes(p.stdout);r={'seconds':time.perf_counter()-start,'exitCode':p.returncode,'command':args}
 except subprocess.TimeoutExpired as e:(A/(label+'.log')).write_bytes(e.stdout or b'');r={'seconds':time.perf_counter()-start,'error':'timeout','command':args}
 results[label]=r;(A/'native-results.json').write_text(json.dumps(results,indent=2));print(label,r,flush=True)
 return r
import os
# Local fframes build (not in the repo): FFS_FFRAMES_BIN (film binary), FFS_FFRAMES_SRC (fframes checkout), FFS_FFRAMES_PROJECT (film dir)
binary=Path(os.environ['FFS_FFRAMES_BIN'])
results['fframesBinary']={'sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'sourceHead':subprocess.check_output(['git','-C',os.environ['FFS_FFRAMES_SRC'],'rev-parse','HEAD'],text=True).strip()}
run('fframes',[str(binary),'render','0s..2s','--json','-o',str(A/'fframes-2s.mkv')],Path(os.environ['FFS_FFRAMES_PROJECT']))
if (A/'fframes-2s.mkv').exists():run('fframes-h264',['ffmpeg','-v','error','-y','-i',str(A/'fframes-2s.mkv'),'-c:v','libx264','-preset','fast','-crf','18','-threads','2','-c:a','aac',str(A/'fframes-2s.mp4')])
# Moving average ends at output time; retain every Nth frame after the first complete window.
for fps in [60,30]:
 n=240//fps
 run('tmix'+str(fps),['ffmpeg','-v','error','-y','-i',str(A/'probe-1080p240.mp4'),'-vf',f"tmix=frames={n}:weights='{' '.join(['1']*n)}',select='eq(mod(n,{n}),{n-1})',setpts=N/({fps}*TB)",'-r',str(fps),'-c:v','libx264','-preset','fast','-crf','18','-threads','2',str(A/f'tmix{fps}.mp4')])
# Same bounded fixture as browser throughput, PNG capture independently timed by runner.
run('chromium-frames-encode',['ffmpeg','-v','error','-y','-framerate','30','-i',str(A/'capture-%03d.png'),'-frames:v','60','-c:v','libx264','-preset','fast','-crf','18','-threads','2',str(A/'chromium-native.mp4')])
if (A/'webav-silent.mp4').exists():run('native-mux',['ffmpeg','-v','error','-y','-i',str(A/'webav-silent.mp4'),'-i',str(R/'public/media/music-sync.wav'),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k','-t','20',str(A/'webav-native-audio.mp4')])
