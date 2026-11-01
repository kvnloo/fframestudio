"""Copy the dedicated static share/player surface; never import visitor projects."""
import hashlib
import html
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]

def build_launch(output):
    source = ROOT / 'hosted/launch'
    target = output / 'launch'
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)
    manifest = json.loads((target / 'variants.json').read_text())
    manifest['buildId'] = hashlib.sha256(b''.join(p.read_bytes() for p in sorted(source.rglob('*')) if p.is_file())).hexdigest()[:16]
    # Content-address media so replacing the film also changes X's cached poster URL.
    for item in [manifest['poster'], *manifest['variants']]:
        original = target / item['url'].removeprefix('/launch/')
        if not original.resolve().is_relative_to(target.resolve() / 'media'):
            raise ValueError('Launch media must stay inside media/')
        data = original.read_bytes()
        if 'fps' in item and item['bytes'] != len(data):
            raise ValueError('Stale launch byte count; run tools/launch_media.py --refresh')
        name = original.stem + '.' + hashlib.sha256(data).hexdigest()[:12] + original.suffix
        hashed = original.with_name(name)
        original.rename(hashed)
        item['url'] = '/launch/media/' + name
    # Only hashed media is published, avoiding duplicate video delivery bytes.
    (target / 'variants.json').write_text(json.dumps(manifest, indent=2) + '\n')
    replacements = {'TITLE': manifest['title'], 'DESCRIPTION': manifest['description'],
                    'POSTER': manifest['poster']['url'], 'NOTICE': manifest['notice'],
                    'DOWNLOAD': manifest['variants'][1]['url'], 'BUILD': manifest['buildId']}
    for filename in ['index.html', 'embed.html']:
        text = (target / filename).read_text()
        for key, value in replacements.items():
            text = text.replace('@@' + key + '@@', html.escape(value, quote=True))
        (target / filename).write_text(text)
    # cleanUrls makes /launch.html resolve to /launch; no directory-index embed alias.
    shutil.move(target / 'index.html', output / 'launch.html')
