#!/usr/bin/env python3
"""Create the labelled fixture, or refresh byte counts after an explicit film swap."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'hosted/launch'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--placeholder', action='store_true')
p.add_argument('--refresh', action='store_true')
a = p.parse_args()
if a.placeholder == a.refresh:
    p.error('Choose exactly one of --placeholder or --refresh')
media = TARGET / 'media'
media.mkdir(parents=True, exist_ok=True)
if a.placeholder:
    for fps, codec in [(120, 'hevc'), (120, 'h264'), (60, 'h264')]:
        output = media / f'launch-{codec}-{fps}.mp4'
        filters = "drawbox=x=0:y=360:w=iw:h=340:color=black@0.8:t=fill,drawtext=fontfile=/usr/share/fonts/TTF/DejaVuSans.ttf:text='PLACEHOLDER / NOT THE LAUNCH FILM':fontcolor=white:fontsize=48:x=(w-tw)/2:y=420,drawtext=fontfile=/usr/share/fonts/TTF/DejaVuSans.ttf:text='" + str(fps) + " FPS / FRAME %{n}':fontcolor=white:fontsize=60:x=(w-tw)/2:y=520"
        options = ['-c:v', 'libx265', '-tag:v', 'hvc1', '-crf', '34', '-x265-params', 'pools=2:frame-threads=2:log-level=error'] if codec == 'hevc' else ['-c:v', 'libx264', '-crf', '29', '-threads', '2']
        subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'testsrc2=size=1920x1080:rate={fps}', '-t','4','-vf',filters,'-pix_fmt','yuv420p','-preset','fast',*options,'-movflags','+faststart',str(output)],check=True)
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(media/'launch-h264-120.mp4'),'-frames:v','1',str(media/'poster.jpg')],check=True)
    manifest = {'title':'fframestudio — launch player test', 'description':'A labelled 1080p120 playback test. The launch film has not been substituted yet.', 'notice':'PLACEHOLDER — 4-second test pattern, not the launch film.', 'poster':{'url':'/launch/media/poster.jpg'},'variants':[{'fps':fps,'codec':codec,'url':f'/launch/media/launch-{name}-{fps}.mp4','bytes':0} for fps,codec,name in [(120,'hvc1','hevc'),(120,'avc1.640033','h264'),(60,'avc1.64002A','h264')]]}
else:
    manifest = json.loads((TARGET/'variants.json').read_text())
for item in manifest['variants']:
    item['bytes'] = (TARGET / item['url'].removeprefix('/launch/')).stat().st_size
(TARGET/'variants.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'variants':manifest['variants']}))
