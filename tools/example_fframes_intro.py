#!/usr/bin/env python3
"""Opt-in local render of the original film. Never publishes or executes an importer config."""
import argparse
import array
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REVISION = '44745c09a6c8c51071609097326a820cf59d087b'
REPO = 'https://github.com/dmtrKovalenko/fframes'


def run(command, **kwargs):
    return subprocess.run(list(map(str, command)), check=True, **kwargs)


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(path)]))


def faststart(path):
    boxes = []
    with path.open('rb') as file:
        offset = 0
        while offset < path.stat().st_size:
            file.seek(offset)
            header = file.read(8)
            if len(header) != 8:
                raise ValueError('Truncated MP4 box')
            size = int.from_bytes(header[:4], 'big')
            kind = header[4:].decode('ascii')
            if size == 1:
                size = int.from_bytes(file.read(8), 'big')
            if size < 8:
                raise ValueError('Invalid MP4 box')
            boxes.append(kind)
            offset += size
    return 'moov' in boxes and 'mdat' in boxes and boxes.index('moov') < boxes.index('mdat')


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def project_from_timeline(timeline, entry):
    fps = timeline['fps']
    end = 0
    shots = []
    for scene in timeline['scenes']:
        a, b = scene['start_frame'], scene['end_frame']
        if a != end or b <= a:
            raise ValueError('Upstream timeline must have contiguous, positive scenes')
        end = b
        name = re.sub(r'(?<!^)([A-Z])', r' \1', scene['name'].removesuffix('Scene'))
        shots.append({'id': 'scene-' + str(scene['index']), 'name': name, 'chapter': name,
                      't0': a / fps, 't1': b / fps, 'origin': 'fframes-intro timeline --json',
                      'sourceFrames': [a, b], 'sourceScene': scene['full_name']})
    if end != timeline['duration_frames']:
        raise ValueError('Timeline does not cover the complete film')
    return {'schema': 'fframestudio.project/0', 'id': 'fframes-intro', 'title': entry['title'],
            'kind': 'fframes', 'canvas': {'width': timeline['width'], 'height': timeline['height'], 'fps': fps},
            'duration_s': end / fps, 'shots': shots, 'media': {'proxy': 'proxy.mp4', 'poster': 'poster.webp'},
            'renders': [{'label': 'Local web proxy', 'file': 'proxy.mp4', 'duration_s': end / fps}],
            'source': {k: entry[k] for k in ['author', 'source_url', 'licence', 'credit', 'sourceRepo', 'sourcePath', 'credits']},
            'provenance': {**entry['provenance'], 'audioTimeline': timeline.get('audio', []), 'durationNote': 'Upstream advertises 128 s; exact compiled duration is 127.5 s at this revision.'},
            'notes': ['Locally rendered from unmodified upstream source. Media redistribution permission unresolved.',
                      'Baked film: scene ranges are editorial navigation, not editable Rust/SVG/shader layers.',
                      'Embedded original audio mix stays synchronized with the proxy. No invented beat grid; waveform is measured after browser decode.']}


def package_project(out):
    # Folder input persists every selected file. Keep build caches and the native master
    # outside this small portable package so opening it cannot exhaust browser storage.
    package = out / 'project'
    package.mkdir(exist_ok=True)
    for name in ['project.json', 'proxy.mp4', 'poster.webp', 'timeline.json', 'LICENSES.md']:
        shutil.copyfile(out / name, package / name)
    return package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Existing unmodified pinned upstream checkout (read only)')
    parser.add_argument('--out', type=Path, default=Path.home() / '.cache/fframestudio/examples/intro')
    parser.add_argument('--binary', type=Path, help='Already built upstream binary; still validates source revision')
    parser.add_argument('--reuse-master', action='store_true', help='Reuse a previously rendered master in this output directory')
    parser.add_argument('--import-library', type=Path, help='Explicit opt-in: copy the generated project into this library folder')
    args = parser.parse_args()
    out = args.out.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    logs = out / 'logs'
    logs.mkdir(exist_ok=True)
    source = args.source.resolve() if args.source else out / 'upstream'
    if not source.exists():
        run(['git', 'clone', REPO, source])
        run(['git', 'checkout', '--detach', REVISION], cwd=source)
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=source, text=True)
    if sha != REVISION or dirty:
        raise ValueError('Use an unmodified upstream checkout at ' + REVISION)
    entry = json.loads((ROOT / 'examples/catalog.json').read_text())[0]
    if args.binary:
        binary = args.binary.resolve()
    else:
        target = Path(os.environ.get('CARGO_TARGET_DIR', out / 'target')).resolve()
        with (logs / 'build.log').open('w') as log:
            run(['cargo', 'build', '--release', '-p', 'fframes-intro', '--target-dir', target], cwd=source, stdout=log, stderr=subprocess.STDOUT)
        binary = target / 'release/fframes-intro'
    with (logs / 'help.txt').open('w') as log:
        run([binary, '--help'], cwd=source, stdout=log)
    timeline = json.loads(subprocess.check_output([binary, 'timeline', '--json'], cwd=source))
    save(out / 'timeline.json', timeline)
    master = out / 'master.mp4'
    if not args.reuse_master or not master.exists():
        with (logs / 'render.log').open('w') as log:
            run([binary, '--renderer', 'gpu', 'render', '-o', master], cwd=source, stdout=log, stderr=subprocess.STDOUT)
    info = probe(master)
    save(logs / 'master-ffprobe.json', info)
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    assert int(video['nb_read_frames']) == timeline['duration_frames']
    numerator, denominator = map(int, video['r_frame_rate'].split('/'))
    assert numerator / denominator == timeline['fps']
    assert (video['width'], video['height']) == (timeline['width'], timeline['height'])
    assert abs(float(info['format']['duration']) - timeline['duration_seconds']) < .1
    assert any(s['codec_type'] == 'audio' for s in info['streams'])
    proxy = out / 'proxy.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-i', master, '-map', '0:v:0', '-map', '0:a:0', '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-threads', '4', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', proxy])
    pi = probe(proxy)
    save(logs / 'proxy-ffprobe.json', pi)
    pv = next(s for s in pi['streams'] if s['codec_type'] == 'video')
    assert pv['codec_name'] == 'h264' and int(pv['nb_read_frames']) == timeline['duration_frames']
    assert any(s['codec_name'] == 'aac' for s in pi['streams'])
    assert abs(float(pi['format']['duration']) - timeline['duration_seconds']) < .1
    assert faststart(proxy), 'Proxy must put moov before mdat for progressive playback'
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', proxy, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'])
    samples = array.array('h'); samples.frombytes(raw)
    rms = math.sqrt(sum((s / 32768) ** 2 for s in samples) / len(samples))
    assert rms > .001
    run(['ffmpeg', '-v', 'error', '-y', '-ss', '17', '-i', proxy, '-frames:v', '1', '-c:v', 'libwebp', out / 'poster.webp'])
    run(['ffmpeg', '-v', 'error', '-y', '-i', proxy, '-vf', 'fps=1/11,scale=480:270,tile=4x3', '-frames:v', '1', out / 'contact-sheet.jpg'])
    v0 = project_from_timeline(timeline, entry)
    v0['renders'][0].update(width=pv['width'], height=pv['height'], fps=timeline['fps'])
    # Use the app's canonical migration and validator, not a second project/1 implementation.
    migration = "import {fromV0} from './web/src/doc/project.js'; let s=''; for await(const c of process.stdin)s+=c; console.log(JSON.stringify(fromV0(JSON.parse(s)),null,2));"
    doc = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', migration], cwd=ROOT, input=json.dumps(v0).encode()))
    save(out / 'project.json', doc)
    local_entry = {**entry, 'duration': timeline['duration_seconds'], 'poster': 'poster.webp', 'video': 'proxy.mp4', 'project': 'project.json'}
    save(out / 'manifest.json', [local_entry])
    (out / 'LICENSES.md').write_text(entry['credit'] + '\n\nLocal viewing only. Permission is required before distributing any derived media.\n')
    package = package_project(out)
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [master, proxy, out / 'project.json']}
    save(out / 'receipt.json', {'revision': sha, 'sourceUnmodified': not dirty, 'duration': timeline['duration_seconds'], 'frames': timeline['duration_frames'], 'scenes': len(timeline['scenes']), 'audioRms': rms, 'audioSamples': len(samples), 'faststart': faststart(proxy), 'hashes': hashes, 'readiness': 'awaiting-permission'})
    if args.import_library:
        library = args.import_library.expanduser().resolve()
        destination = library / 'fframes-intro'
        destination.mkdir(parents=True, exist_ok=False)
        for name in ['project.json', 'proxy.mp4', 'poster.webp', 'timeline.json', 'LICENSES.md']:
            shutil.copyfile(out / name, destination / name)
        index = library / 'library.json'
        listing = json.loads(index.read_text()) if index.exists() else {'schema': 'fframestudio.library/0', 'projects': []}
        listing['projects'].append({'id': 'fframes-intro', 'title': entry['title'], 'kind': 'fframes', 'duration_s': timeline['duration_seconds'], 'shots': len(timeline['scenes']), 'renders': 1, 'poster': 'fframes-intro/poster.webp'})
        save(index, listing)
        assert json.loads((destination / 'project.json').read_text()) == doc
    print(json.dumps({'project': str(package / 'project.json'), 'duration': timeline['duration_seconds'], 'scenes': len(timeline['scenes']), 'audioRms': rms, 'next': 'Open the project subfolder in Studio, not the build folder. No library is modified without --import-library.'}))


if __name__ == '__main__':
    main()
