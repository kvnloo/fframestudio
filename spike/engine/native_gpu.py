"""Compare available native encoders; preserve original raw-master PTS observation."""
from pathlib import Path
import subprocess,time,json
R=Path(__file__).parent;A=R/'artifacts';r={}
for name,input_args,codec,extra,frames in [
 ('fframes-normalized',['-r','60','-i',str(A/'fframes-2s.mkv')],'libx264',['-preset','fast','-crf','18','-threads','2'],120),
 ('fframes-nvenc',['-r','60','-i',str(A/'fframes-2s.mkv')],'h264_nvenc',['-preset','p4','-b:v','12M'],120),
 ('chromium-nvenc',['-framerate','30','-i',str(A/'capture-%03d.png')],'h264_nvenc',['-preset','p4','-b:v','12M'],60)]:
 command=['ffmpeg','-v','error','-y',*input_args,'-frames:v',str(frames),'-pix_fmt','yuv420p','-c:v',codec,*extra,'-c:a','aac',str(A/(name+'.mp4'))];start=time.perf_counter();p=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);elapsed=time.perf_counter()-start
 r[name]={'seconds':elapsed,'exitCode':p.returncode,'command':command,'log':p.stdout.decode()}
 if not p.returncode:r[name]['probe']=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames,r_frame_rate,duration','-of','json',str(A/(name+'.mp4'))]))
 print(name,r[name],flush=True)
(A/'native-gpu-results.json').write_text(json.dumps(r,indent=2))
