"""Full decode verification, ffprobe inventory and three independent A/V markers."""
import json,subprocess
from pathlib import Path
import numpy as np
R=Path(__file__).parent;A=R/'artifacts'
def ff(path,args):return subprocess.check_output(['ffmpeg','-v','error','-threads','2','-filter_threads','2','-i',str(path),*args])
def audio(p):return np.frombuffer(ff(p,['-vn','-ac','1','-ar','48000','-f','f32le','-']),dtype=np.float32)
ref=audio(R/'public/media/music-sync.wav');results={}
for name in ['webav-native-audio.mp4','diffusion-final.mp4']:
 p=A/name
 if not p.exists():continue
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(p)]))
 frames=np.frombuffer(ff(p,['-an','-vf','crop=32:32:1856:1016,scale=1:1','-pix_fmt','gray','-f','rawvideo','-']),np.uint8)
 out=audio(p);markers=[]
 for t in [1,10,19]:
  a=ref[round((t-.05)*48000):round((t+.05)*48000)].astype(np.float64);a-=a.mean()
  b=out[round((t-.15)*48000):round((t+.15)*48000)].astype(np.float64);b-=b.mean()
  lag=(int(np.argmax(np.correlate(b,a,'valid')))-4800)/48000
  lo=round(t*30)-3;hi=round(t*30)+4;frame=lo+int(np.argmax(frames[lo:hi]));level=int(frames[frame]);offset=(frame-t*30)-lag*30
  markers.append({'expectedSeconds':t,'videoFrame':frame,'markerLevel':level,'audioLagSeconds':lag,'avErrorFrames':offset,'pass':abs(offset)<=1 and level>200})
 results[name]={'probe':probe,'markers':markers,'decodedVideoFrames':len(frames),'decodedAudioSamples':len(out),'pass':all(m['pass']for m in markers)}
(A/'av-verification.json').write_text(json.dumps(results,indent=2));print(json.dumps({k:{a:b for a,b in v.items()if a!='probe'}for k,v in results.items()},indent=2))
