#!/usr/bin/env python3
"""Build a static, local-first studio. Only explicitly licensed Examples are optional.

The synthetic 12-second demo is generated in a disposable HOME. No visitor projects
are bundled. --examples expects manifest.json and its referenced cleared assets.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def synthetic_demo(target):
    """Retain the small cleared four-shot fixture, without writing a visitor library."""
    with tempfile.TemporaryDirectory(prefix='ffs-site-demo-') as home:
        subprocess.run(['python3', str(ROOT / 'tools/make_demo.py')], env={**os.environ, 'HOME': home}, check=True, stdout=subprocess.DEVNULL)
        video = Path(home) / 'fframestudio/demo-src/demo.mp4'
        poster = Path(home) / 'demo.jpg'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '1', '-i', str(video), '-frames:v', '1', str(poster)], check=True)
        def publish(stem, suffix, data):
            name = stem + '.' + hashlib.sha256(data).hexdigest()[:12] + suffix
            (target / name).write_bytes(data)
            return '/examples/' + name
        proxy = publish('demo', '.mp4', video.read_bytes())
        image = publish('demo', '.jpg', poster.read_bytes())
        document = {'schema': 'fframestudio.project/0', 'id': 'demo', 'title': 'Demo film', 'kind': 'fframes', 'canvas': {'width': 1280, 'height': 720, 'fps': 30}, 'duration_s': 12, 'media': {'proxy': proxy, 'poster': image}, 'source': {'author': 'fframestudio contributors', 'licence': 'Apache-2.0', 'source_url': 'https://github.com/kvnloo/fframestudio'}, 'shots': [{'id': 'demo-' + str(i), 'name': name, 't0': i * 3, 't1': (i + 1) * 3, 'origin': 'tools/make_demo.py', 'chapter': name} for i, name in enumerate(['Hook', 'Reveal', 'Detail', 'Ask'])], 'notes': ['Synthetic test patterns and generated tones. Not the original launch film.']}
        project = publish('demo', '.json', json.dumps(document).encode())
        return {'id': 'demo', 'title': 'Demo film', 'category': 'Demo', 'duration': 12, 'author': 'fframestudio contributors', 'licence': 'Apache-2.0', 'credit': 'Synthetic four-shot test patterns and generated tones; tools/make_demo.py.', 'credits': ['fframestudio contributors'], 'sourceRepo': 'https://github.com/kvnloo/fframestudio', 'sourcePath': 'tools/make_demo.py', 'source_url': 'https://github.com/kvnloo/fframestudio/blob/main/tools/make_demo.py', 'provenance': {'kind': 'synthetic'}, 'readiness': 'available', 'video': proxy, 'poster': image, 'project': project}


def default_examples():
    for ancestor in ROOT.parents:
        candidate = ancestor / 'project-artifacts/fframestudio/examples/out'
        if candidate.is_dir():
            return candidate
    return None

def build(output, examples=None, allow_unlisted_media=()):
    output = output.resolve()
    if output == ROOT or ROOT in output.parents and output.parts[len(ROOT.parts):len(ROOT.parts)+1] in [('web',), ('tools',), ('bridge',)]:
        raise ValueError('Output must not overwrite source directories')
    output.mkdir(parents=True, exist_ok=True)
    app = output / 'app'
    if app.exists():
        shutil.rmtree(app)
    shutil.copytree(ROOT / 'web', app)
    digest = hashlib.sha256(b''.join(p.read_bytes() for p in sorted(app.rglob('*')) if p.is_file())).hexdigest()[:12]
    assets = 'assets-v' + digest
    for name in ['fonts', 'dist']:
        if (app / name).exists():
            (app / assets).mkdir(exist_ok=True)
            shutil.move(app / name, app / assets / name)
    for file in app.rglob('*'):
        if file.suffix in ['.js', '.html', '.css', '.mjs']:
            text = file.read_text()
            for name in ['fonts', 'dist']:
                text = text.replace('/app/' + name + '/', '/app/' + assets + '/' + name + '/')
            file.write_text(text)
    index = (app / 'index.html').read_text().replace('<title>', '<meta name="ffs-hosted" content="local-first"><link rel="stylesheet" href="/app/hosted.css"><title>', 1)
    (output / 'index.html').write_text(index)
    shutil.copyfile(ROOT / 'web/share-worker.js', output / 'share-worker.js')
    (app / 'index.html').unlink()
    target = output / 'examples'
    if target.exists():
        shutil.rmtree(target)
    target.mkdir()
    catalog = {e['id']: e for e in json.loads((ROOT / 'examples/catalog.json').read_text())}
    manifest = [synthetic_demo(target)]
    if examples and examples.is_dir() and (examples / 'manifest.json').exists():
        source = examples.resolve()
        entries = json.loads((source / 'manifest.json').read_text())
        if not isinstance(entries, list):
            raise ValueError('Examples manifest must be an array')
        notices = source / 'LICENSES.md'
        if notices.is_file():
            shutil.copyfile(notices, target / 'LICENSES.md')
        copied = {}
        def copy_asset(value, relative=source):
            if value.startswith('/examples/'):
                original = source / value[len('/examples/'):]
            else:
                if '://' in value or value.startswith('/'):
                    raise ValueError('Only local example assets may be bundled')
                original = relative / value
            original = original.resolve()
            if not original.is_relative_to(source) or not original.is_file():
                raise ValueError('Example asset escapes its source directory or is missing')
            if original in copied:
                return copied[original]
            data = original.read_bytes()
            if original.suffix == '.json':
                document = json.loads(data)
                def rewrite(obj):
                    if isinstance(obj, dict):
                        for key, value in list(obj.items()):
                            if key in ['file', 'proxy', 'poster', 'thumb'] and isinstance(value, str) and value:
                                obj[key] = copy_asset(value, original.parent)
                            elif key not in ['metadata', 'source', 'docs']:
                                rewrite(value)
                    elif isinstance(obj, list):
                        for value in obj:
                            rewrite(value)
                rewrite(document)
                data = json.dumps(document, indent=2).encode()
            hash_ = hashlib.sha256(data).hexdigest()[:12]
            name = original.stem + '.' + hash_ + original.suffix.lower()
            (target / name).write_bytes(data)
            copied[original] = '/examples/' + name
            return copied[original]
        seen = {'demo'}
        for entry in entries:
            if entry.get('id') in seen:
                raise ValueError('Duplicate or reserved example ID: ' + str(entry.get('id')))
            entry = {**entry, **{k: v for k, v in catalog.get(entry.get('id'), {}).items() if k not in ['poster', 'video', 'project', 'master']}}
            seen.add(entry.get('id'))
            readiness = entry.get('readiness', 'available')
            if readiness not in ['available', 'local-build-only', 'awaiting-permission']:
                raise ValueError('Invalid example readiness')
            if readiness != 'available' and entry.get('id') not in allow_unlisted_media:
                manifest.append({k: v for k, v in entry.items() if k not in ['poster', 'video', 'project', 'master']} | {'poster': ''})
                continue
            # Explicit owner override is a publication decision, not a licence grant.
            entry['readiness'] = 'available'
            for key in ['id', 'title', 'author', 'source_url', 'licence', 'credit', 'video', 'project']:
                if not isinstance(entry.get(key), str) or not entry[key]:
                    raise ValueError('Example is missing required attribution or assets: ' + key)
            e = {key: value for key, value in entry.items() if key not in ['poster', 'video', 'project', 'master']}
            e.setdefault('category', 'Demo' if entry['id'] in ['synthetic', 'demo'] else 'Short film')
            e.setdefault('duration', entry.get('duration_s', 0))
            e.setdefault('sourceRepo', entry['source_url'].split('/tree/')[0])
            e.setdefault('sourcePath', 'examples/' + entry['source_url'].split('/examples/', 1)[1] if '/examples/' in entry['source_url'] else '')
            e.setdefault('provenance', {'source_url': entry['source_url']})
            e.setdefault('credits', [entry['credit']])
            for key in ['poster', 'video', 'project']:
                e[key] = copy_asset(entry[key]) if entry.get(key) else ''
            manifest.append(e)
    existing = {e['id'] for e in manifest}
    manifest.extend(e for id_, e in catalog.items() if id_ not in existing)
    manifest.sort(key=lambda e: not e.get('featured', False))
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' blob: data:; media-src 'self' blob: data:; worker-src 'self' blob: data:; connect-src 'self' blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    config = {'cleanUrls': True, 'headers': [
        {'source': '/(.*)', 'headers': [{'key':'Content-Security-Policy','value':csp}, {'key':'X-Content-Type-Options','value':'nosniff'}, {'key':'Referrer-Policy','value':'no-referrer'}, {'key':'X-Frame-Options','value':'DENY'}, {'key':'Permissions-Policy','value':'camera=(), microphone=(self), geolocation=()'}, {'key':'Cache-Control','value':'public, max-age=0, must-revalidate'}]},
        {'source': '/app/' + assets + '/:path*', 'headers':[{'key':'Cache-Control','value':'public, max-age=31536000, immutable'}]},
        {'source': '/examples/:file(.*\\.[0-9a-f]{12}\\.[a-z0-9]+)', 'headers':[{'key':'Cache-Control','value':'public, max-age=31536000, immutable'}]},
    ]}
    (output / 'vercel.json').write_text(json.dumps(config, indent=2) + '\n')
    size = sum(p.stat().st_size for p in output.rglob('*') if p.is_file())
    if size > 60_000_000:
        raise ValueError('Static site exceeds the 60 MB delivery budget')
    print(json.dumps({'site':str(output), 'bytes':size, 'examples':len(manifest)}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / 'site')
    parser.add_argument('--examples', type=Path, default=default_examples())
    parser.add_argument('--allow-unlisted-media', action='append', default=[], choices=['fframes-intro'], help='Owner opt-in after obtaining permission; never a licence grant')
    args = parser.parse_args()
    build(args.out, args.examples, args.allow_unlisted_media)
