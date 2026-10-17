"""Decode-count all export probes; report real container rates and durations."""
from pathlib import Path
import subprocess,json
A=Path(__file__).parent/'artifacts'
def probe(path):
 return json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames,nb_read_frames,duration','-of','json',str(path)]))
files=sorted(A.glob('probe-*.mp4'))+[A/'webav-silent.mp4']
(A/'probe-verification.json').write_text(json.dumps({'artifacts/'+p.name:probe(p) for p in files},indent=2))
names=['diffusion-final.mp4','diffusion-portrait60.mp4','diffusion-4k30.mp4','diffusion-1440p120.mp4','tmix60.mp4','tmix30.mp4','fframes-2s.mkv','fframes-2s.mp4','chromium-native.mp4']
r={n:probe(A/n)for n in names}
(A/'final-probes.json').write_text(json.dumps(r,indent=2))
print(json.dumps(r,indent=2))
