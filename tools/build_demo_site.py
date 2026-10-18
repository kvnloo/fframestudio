#!/usr/bin/env python3
"""Build a static, local-first studio. Only explicitly licensed Examples are optional.

No media is generated and no visitor projects are bundled. --examples expects a directory
with manifest.json and its referenced files; absent default artifacts are silently skipped.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]

def default_examples():
    for ancestor in ROOT.parents:
        candidate = ancestor / 'project-artifacts/fframestudio/examples/out'
        if candidate.is_dir():
            return candidate
    return None

def build(output, examples=None):
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
    manifest = []
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
        for entry in entries:
            for key in ['id', 'title', 'author', 'source_url', 'licence', 'credit', 'video', 'project']:
                if not isinstance(entry.get(key), str) or not entry[key]:
                    raise ValueError('Example is missing required attribution or assets: ' + key)
            e = {key: entry[key] for key in ['id', 'title', 'author', 'source_url', 'licence', 'credit']}
            for key in ['poster', 'video', 'project']:
                e[key] = copy_asset(entry[key]) if entry.get(key) else ''
            manifest.append(e)
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
    args = parser.parse_args()
    build(args.out, args.examples)
