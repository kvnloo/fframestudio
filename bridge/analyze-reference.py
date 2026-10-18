#!/usr/bin/env python3
"""Bounded, local-only evidence extraction. JSON-lines progress, one final result."""
import argparse
import array
import json
import math
from pathlib import Path
import re
import subprocess
import sys


def run(args):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    if p.returncode:
        raise ValueError(p.stderr.decode(errors='replace')[-600:])
    return p


def ffmpeg(file, *args):
    return run(['ffmpeg', '-nostdin', '-v', 'info', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,avi,wav,ogg', '-i', str(file), *args])


def probe(file):
    p = run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,avi', '-show_streams', '-show_format', '-of', 'json', str(file)])
    data = json.loads(p.stdout)
    video = next((s for s in data['streams'] if s['codec_type'] == 'video'), None)
    if not video or not set(data['format']['format_name'].split(',')) & {'mov','mp4','matroska','webm','avi'}:
        raise ValueError('Use a direct MP4, WebM, MOV or AVI video file, not a playlist or webpage.')
    fps = video.get('avg_frame_rate', '0/1').split('/')
    num, den = int(fps[0]), int(fps[1])
    duration = float(data['format'].get('duration', 0))
    if not den or num / den <= 0 or num / den > 120 or not 0 < duration <= 600:
        raise ValueError('Reference limit: ten minutes, at most 120 fps, constant frame rate recommended.')
    total = round(duration * num / den)
    return {'fps': {'num':num, 'den':den}, 'duration':duration, 'frames':total,
            'width':video['width'], 'height':video['height'], 'audio':any(s['codec_type'] == 'audio' for s in data['streams'])}


def kmeans(rgb, k=4):
    points = [tuple(rgb[i:i+3]) for i in range(0, len(rgb)-2, 3)]
    if not points:
        return []
    # Stable farthest-point seeds; deterministic even for monochrome shots.
    centers = [points[0]]
    distance = lambda a, b: sum((x-y)**2 for x,y in zip(a,b))
    for _ in range(k-1):
        centers.append(max(points, key=lambda p:min(distance(p,c) for c in centers)))
    for _ in range(8):
        groups = [[] for c in centers]
        for p in points:
            groups[min(range(k), key=lambda i:distance(p,centers[i]))].append(p)
        centers = [tuple(sum(p[c] for p in group)/len(group) for c in range(3)) if group else centers[i] for i,group in enumerate(groups)]
    ranked = sorted(zip(centers,groups), key=lambda x:-len(x[1]))
    result = []
    for c, g in ranked:
        color = '#' + ''.join(f'{round(x):02x}' for x in c)
        if g and not any(v['color'] == color for v in result):
            result.append({'color':color, 'coverage':round(len(g)/len(points),3)})
    return result


def analyze(file, out, threshold=10, min_length=0.3):
    info = probe(file)
    fps = info['fps']['num']/info['fps']['den']
    out.mkdir(parents=True, exist_ok=True)
    print(json.dumps({'progress':0.05, 'stage':'Detecting shot changes'}), flush=True)
    detected = ffmpeg(file, '-an', '-vf', f'scdet=threshold={threshold}:sc_pass=1,metadata=print', '-f', 'null', '-').stderr.decode(errors='replace')
    candidates = [(float(t),float(score)) for score,t in re.findall(r'lavfi\.scd\.score: ([\d.]+), lavfi\.scd\.time: ([\d.]+)', detected)]
    cuts, scores = [0], {}
    for t, score in candidates:
        frame = round(t*fps)
        if frame-cuts[-1] >= math.ceil(min_length*fps) and info['frames']-frame >= math.ceil(min_length*fps):
            cuts.append(frame)
            scores[frame] = score
    if len(cuts) > 200:
        raise ValueError('More than 200 detected shots. Increase threshold or minimum shot length.')
    cuts.append(info['frames'])
    shots = []
    for i,(a,b) in enumerate(zip(cuts,cuts[1:])):
        midpoint = (a+b)/2/fps
        name = f'shot-{i+1}.jpg'
        ffmpeg(file, '-ss', str(midpoint), '-frames:v', '1', '-vf', 'scale=320:-2', '-y', str(out/name))
        pixels = ffmpeg(file, '-ss', str(midpoint), '-frames:v', '1', '-vf', 'scale=32:18', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-').stdout
        score = scores.get(a)
        shots.append({'index':i+1, 'startFrame':a, 'endFrame':b, 'start':a/fps, 'end':b/fps, 'duration':(b-a)/fps,
                      'keyframe':name, 'palette':kmeans(pixels), 'detected':True, 'score':score,
                      'confidence':round(min(0.99,score/100),3) if score is not None else None})
        print(json.dumps({'progress':0.1+0.7*(i+1)/(len(cuts)-1), 'stage':f'Evidence for shot {i+1}'}), flush=True)
    audio = None
    if info['audio']:
        samples = array.array('f', ffmpeg(file, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-').stdout)
        if sys.byteorder != 'little':
            samples.byteswap()
        levels, onsets, previous = [], [], -120
        for i in range(0,len(samples),800):
            window = samples[i:i+800]
            rms = math.sqrt(sum(x*x for x in window)/max(1,len(window)))
            db = 20*math.log10(max(1e-6,rms))
            if db > -45 and db-previous > 6:
                onsets.append(round(i/8000,3))
            levels.append({'time':round(i/8000,3),'rmsDb':round(db,2)})
            previous = db
        def rms_db(values):
            return round(10*math.log10(max(1e-12,sum(x*x for x in values)/max(1,len(values)))),2)
        audio = {'method':'100ms mono RMS dBFS; rising-energy onset candidates (not beats or LUFS)', 'rmsDb':rms_db(samples), 'levels':levels, 'onsets':onsets}
        for shot in shots:
            shot['audio'] = {'rmsDb':rms_db(samples[round(shot['start']*8000):round(shot['end']*8000)]), 'onsets':[t for t in onsets if shot['start'] <= t < shot['end']]}
    return {'schema':'fframestudio.reference/1', 'media':info, 'settings':{'threshold':threshold,'minLength':min_length}, 'shots':shots, 'audio':audio,
            'pace':{'shots':len(shots),'meanShotSeconds':info['duration']/len(shots)},
            'limitations':['Detected changes are candidates, not ground truth. Confidence is normalized scdet score, not calibrated probability.', 'Palette samples one downscaled midpoint per shot.', 'No typography, motion, objects or effects inferred.', 'Frame mapping assumes constant frame rate; variable-rate footage is approximate.']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('file', type=Path)
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--threshold', type=float, default=10)
    parser.add_argument('--min-length', type=float, default=0.3)
    parser.add_argument('--transcribe', action='store_true')
    parser.add_argument('--engine', default='faster-whisper')
    parser.add_argument('--model')
    args = parser.parse_args()
    if args.transcribe:
        # Decode into bounded PCM with an explicit container/protocol allowlist before
        # handing data to PyAV/Whisper. Never let a playlist reach a model decoder.
        wav = args.file.with_suffix('.wav')
        ffmpeg(args.file, '-t', '30', '-ac', '1', '-ar', '16000', '-y', str(wav))
        if args.engine == 'faster-whisper':
            from faster_whisper import WhisperModel
            # Installed, locally cached model only; never download weights implicitly.
            model = WhisperModel(args.model or 'tiny', device='cpu', compute_type='int8', local_files_only=True)
            segments, _ = model.transcribe(str(wav), beam_size=1)
            text = ' '.join(s.text for s in segments)
        else:
            if not args.model or not Path(args.model).is_file():
                raise ValueError('Configure installed local Whisper weights with FFS_WHISPER_MODEL.')
            if args.engine == 'whisper':
                run(['whisper', str(wav), '--model', args.model, '--device', 'cpu', '--fp16', 'False', '--output_format', 'txt', '--output_dir', str(args.file.parent)])
            else:
                run([args.engine, '-m', args.model, '-f', str(wav), '-otxt', '-of', str(args.file.with_suffix(''))])
            text = args.file.with_suffix('.txt').read_text()
        print(json.dumps({'text':text}), flush=True)
    elif args.probe:
        print(json.dumps(probe(args.file)), flush=True)
    else:
        print(json.dumps({'result':analyze(args.file,args.out,args.threshold,args.min_length)}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error':str(error)}), flush=True)
        sys.exit(1)
