import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { contrast, ensureContrast, TOKENS } from '../../web/src/system-theme.js';
import { wal, noctalia } from '../../bridge/system-theme.mjs';

test('Studio system mapping recolours five semantic slots and preserves readable cream paper', () => {
  for (const [provider,name] of [[wal,'wal'],[noctalia,'noctalia']]) {
  const p = provider(new URL('../fixtures/themes/'+name, import.meta.url).pathname);
  const normalized = ensureContrast(p);
  for (const key of Object.values(TOKENS)) assert.match(normalized[key], /^#[\da-f]{6}$/i, key);
  assert.ok(contrast(normalized.paperInk, normalized.paper) >= 7);
  assert.ok(contrast(normalized.paperMute, normalized.paper) >= 4.5);
  assert.ok(contrast(normalized.posterAccent, normalized.paper) >= 4.5);
  const meanings = ['teal','amber','yellow','coral','green'].map(k => normalized[TOKENS[k]]);
  assert.equal(new Set(meanings).size, 5);
  assert.equal(TOKENS.acc, 'accent');
  for (const color of meanings) for (const surface of [p.bg,p.surface,p.surface2]) assert.ok(contrast(color,surface)>=4.5);
  }
});

test('studio-spec import resolves the selected ID relative to the studio, copies real bytes and beats without touching sources', () => {
  const script = `
import json, pathlib, tempfile, os, sys
sys.path.insert(0, 'tools')
from studio_music import resolve_music
with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as tmp:
    root=pathlib.Path(tmp); base=root/'source'; project=root/'library'
    (base/'music').mkdir(parents=True); (base/'storyboard/lab/audio').mkdir(parents=True)
    original=base/'storyboard/lab/audio/selected.wav'; original.write_bytes(b'real selected audio bytes')
    untouched=(original.read_bytes(), original.stat().st_mtime_ns)
    (base/'music/tracks.json').write_text(json.dumps([{'id':'pulse','full':'lab/audio/selected.wav','beats':[0.5,1.0,1.5]}]))
    music={'id':'pulse','title':'Selected','starts_at_s':0.5,'bpm':117}
    result=resolve_music(base,music,project,'storyboard/studio.html')
    assert result['file']=='media/soundtrack.wav'
    assert (project/result['file']).read_bytes()==original.read_bytes()
    assert result['beats']==[0.5,1.0,1.5] and result['starts_at_s']==0.5 and result['bpm']==117
    assert music=={'id':'pulse','title':'Selected','starts_at_s':0.5,'bpm':117}
    assert untouched==(original.read_bytes(),original.stat().st_mtime_ns)
    assert 'file' not in resolve_music(base,{'id':'missing'},project,'storyboard/studio.html')
    (base/'music/tracks.json').write_text(json.dumps([{'id':'escape','full':'../../../outside.wav'}]))
    assert 'file' not in resolve_music(base,{'id':'escape'},project,'storyboard/studio.html')
print('copied selected bytes; original bytes/mtime unchanged; missing ID and traversal fail closed')
`;
  const r = spawnSync('python3', ['-c',script], { encoding:'utf8' });
  assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/original bytes\/mtime unchanged/);
});
