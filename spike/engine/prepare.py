"""Local-only fixtures; original media is never committed or uploaded."""
from pathlib import Path
import subprocess, json, hashlib, shutil
root=Path(__file__).parent
out=root/'public/media'; out.mkdir(parents=True,exist_ok=True)
import os
# Local fixture media (not in the repo): a folder with moves/, cctv/ and audio/ clips.
lab=Path(os.environ.get('FFS_SPIKE_MEDIA', 'fixtures-media'))
sources={'proxy.mp4':Path.home()/'fframestudio/projects/hermes-one-take/media/proxy.mp4','fly.mp4':lab/'moves/01-2.mp4','cctv.mp4':lab/'cctv/20261016-2322-tv704-i-880-at-jct-92.mp4','music.mp3':lab/'audio/drive-full.mp3','font.ttf':root.parents[1]/'web/fonts/IBMPlexMono-Regular.ttf'}
for name,p in sources.items():
    dst=out/name
    if not dst.exists(): dst.symlink_to(p)
def ff(args): subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*args],check=True)
# Calibration clicks are intentionally generated test signals, not engine output.
if not (out/'music-sync.wav').exists():
    ff(['-i',str(out/'music.mp3'),'-f','lavfi','-i',"aevalsrc=if(lt(mod(t-1\\,9)\\,0.01)\\,0.8*sin(2*PI*2000*t)\\,0):s=48000:d=20",'-filter_complex','[0:a]atrim=0:20,asetpts=PTS-STARTPTS,volume=0.15[a];[a][1:a]amix=inputs=2:normalize=0','-ar','48000','-ac','2',str(out/'music-sync.wav')])
for name,size,fps,duration in [('source60.mp4','1920x1080',60,5),('source4k.mp4','3840x2160',30,3)]:
    if not (out/name).exists(): ff(['-f','lavfi','-i',f'testsrc2=size={size}:rate={fps}:duration={duration}','-c:v','libx264','-preset','ultrafast','-crf','18','-g',str(fps),'-pix_fmt','yuv420p','-threads','2',str(out/name)])
manifest={}
for p in out.iterdir():
    manifest[p.name]={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    if p.suffix not in ['.ttf']: manifest[p.name]['probe']=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
(root/'artifacts').mkdir(exist_ok=True)
(root/'artifacts/fixtures.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({k:{'bytes':v['bytes'],'sha256':v['sha256']} for k,v in manifest.items()},indent=2))
