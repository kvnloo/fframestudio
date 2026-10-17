import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { omarchy, noctalia, wal, kde, gnome, detectTheme, desktopPalette, watchTheme } from '../../bridge/system-theme.mjs';
import { contrast, ensureContrast, readable, shotColorSlot } from '../../web/src/system-theme.js';
const fixtures = new URL('../fixtures/themes/', import.meta.url).pathname;
function home(t, ...sources) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-theme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const source of sources) fs.cpSync(path.join(fixtures, source), dir, { recursive: true });
  if (sources.some(s => s.startsWith('omarchy-'))) {
    const base = path.join(dir, '.config/omarchy'); fs.mkdirSync(path.join(base, 'current'), { recursive: true });
    const name = sources.includes('omarchy-light') ? 'catppuccin-latte' : 'tokyo-night';
    fs.symlinkSync('../themes/' + name, path.join(base, 'current/theme'));
  }
  return dir;
}
function palette(p) {
  assert.ok(p); assert.equal(p.ansi.length, 16); assert.equal(typeof p.dark, 'boolean');
  for (const k of ['bg','surface','surface2','fg','muted','border','accent','accent2','danger','success','warning']) assert.match(p[k], /^#[\da-f]{6}$/);
  for (const c of p.ansi) assert.match(c, /^#[\da-f]{6}$/);
}
test('Omarchy dark: actual v3 Alacritty + current/theme symlink', t => {
  const p = omarchy(home(t, 'omarchy-dark')); palette(p); assert.equal(p.name, 'tokyo-night'); assert.equal(p.dark, true); assert.equal(p.bg, '#1a1b26'); assert.equal(p.ansi[1], '#f7768e');
});
test('Omarchy light.mode overrides dark inference', t => {
  const p = omarchy(home(t, 'omarchy-light')); palette(p); assert.equal(p.dark, false); assert.equal(p.name, 'catppuccin-latte'); assert.equal(p.bg, '#eff1f5');
});
test('Omarchy kitty, ghostty and current colors.toml adapters', t => {
  const dir = home(t, 'empty'), theme = path.join(dir, '.config/omarchy/current/theme'); fs.mkdirSync(theme, { recursive: true });
  const write = (name, text) => fs.writeFileSync(path.join(theme, name), text);
  write('kitty.conf', 'background #161821\nforeground #c6c8d1\ncolor1 #e27878\n');
  assert.equal(omarchy(dir).bg, '#161821'); assert.equal(omarchy(dir).ansi[1], '#e27878'); fs.unlinkSync(path.join(theme, 'kitty.conf'));
  write('ghostty.conf', 'background = 161821\nforeground = c6c8d1\npalette = 1=#e27878\n');
  assert.equal(omarchy(dir).ansi[1], '#e27878'); fs.unlinkSync(path.join(theme, 'ghostty.conf'));
  write('colors.toml', 'mode = "light"\nbackground = "#eeeeee"\nforeground = "#111111"\naccent = "#335588"\nred = "#aa3344"\n');
  assert.equal(omarchy(dir).dark, false); assert.equal(omarchy(dir).accent, '#335588');
});
test('Noctalia Material palette', t => { const p = noctalia(home(t, 'noctalia')); palette(p); assert.equal(p.source, 'noctalia'); assert.equal(p.accent, '#c8be72'); assert.equal(p.surface2, '#383c31'); });
test('pywal / wallust palette', t => { const p = wal(home(t, 'wal')); palette(p); assert.equal(p.accent, '#84a0c6'); assert.equal(p.ansi[15], '#d2d4de'); });
test('KDE window colors and selection accent', t => { const p = kde(home(t, 'kde')); palette(p); assert.equal(p.dark, false); assert.equal(p.bg, '#eff0f1'); assert.equal(p.accent, '#3daee9'); });
test('GNOME parses bounded gsettings output, rejects default/garbled and tolerates missing executable', async () => {
  for (const [stdout, expected] of [["'prefer-dark'\n", true], ["'prefer-light'\n", false], ["'default'\n", null], ['garbled', null]]) {
    const p = await gnome(async (cmd,args,options) => { assert.equal(cmd,'gsettings'); assert.equal(options.timeout,800); return {stdout}; }, 'linux');
    if (expected === null) assert.equal(p,null); else { palette(p); assert.equal(p.dark,expected); }
  }
  assert.equal(await gnome(async () => { throw Error('ENOENT'); },'linux'),null);
  assert.equal(await gnome(async () => { throw Error('must not run'); },'darwin'),null);
});
test('GNOME dark/light command results and unavailable desktop', async t => {
  for (const dark of [true, false]) {
    const p = await detectTheme({ home: home(t, 'gnome'), gnomeProvider: async () => desktopPalette('gnome', dark) }); palette(p.palette); assert.equal(p.palette.dark, dark); assert.equal(p.source, 'gnome');
  }
  assert.equal((await detectTheme({ home: home(t, 'gnome'), gnomeProvider: async () => null })).palette, null);
});
test('empty and garbled fixture homes return no provider', async t => {
  for (const source of ['empty','garbled']) assert.deepEqual(await detectTheme({ home: home(t, source), desktop: false }), { palette: null, source: null, available: [] });
});
test('empty, malformed JSON, invalid colors and oversized files fail closed', async t => {
  const dir = home(t, 'empty'); const f = path.join(dir, '.config/noctalia/colors.json'); fs.mkdirSync(path.dirname(f), { recursive: true });
  for (const text of ['{garbled', '{"mSurface":"red","mOnSurface":"#ffffff"}', ' '.repeat(65537)]) {
    fs.writeFileSync(f, text); assert.equal(noctalia(dir), null);
    assert.deepEqual(await detectTheme({ home: dir, desktop: false }), { palette: null, source: null, available: [] });
  }
});
test('detection priority and explicit override', async t => {
  const dir = home(t, 'omarchy-dark', 'noctalia', 'wal', 'kde');
  const detect = source => detectTheme({ home: dir, source, desktop: false });
  assert.equal((await detect()).source, 'omarchy');
  assert.deepEqual((await detect()).available, ['omarchy','noctalia','wal','kde']);
  assert.equal((await detect('wal')).source, 'wal');
  fs.rmSync(path.join(dir, '.config/omarchy'), { recursive: true }); assert.equal((await detect()).source, 'noctalia');
  fs.rmSync(path.join(dir, '.config/noctalia'), { recursive: true }); assert.equal((await detect()).source, 'wal');
  fs.rmSync(path.join(dir, '.cache'), { recursive: true }); assert.equal((await detect()).source, 'kde');
});
test('GNOME wins over KDE when no higher-priority file palette exists', async t => {
  assert.equal((await detectTheme({ home: home(t, 'kde'), gnomeProvider: async () => desktopPalette('gnome', true) })).source, 'gnome');
});
test('WCAG contrast changes only deficient colors, preserving surfaces and ANSI', t => {
  assert.equal(contrast('#000000','#ffffff'), 21);
  for (const source of ['wal','noctalia','omarchy-light']) {
    const dir = home(t, source), p = (source === 'wal' ? wal : source === 'noctalia' ? noctalia : omarchy)(dir), before = structuredClone(p), out = ensureContrast(p);
    assert.deepEqual(p, before); assert.equal(out.bg, p.bg); assert.deepEqual(out.ansi, p.ansi);
    for (const s of [p.bg,p.surface,p.surface2]) { assert.ok(contrast(out.fg,s) >= 4.5); assert.ok(contrast(out.muted,s) >= 4.5); assert.ok(contrast(out.accent,s) >= 3); }
  }
  assert.equal(readable('#ffffff',['#000000'],4.5),'#ffffff');
  assert.ok(contrast(readable('#202020',['#222222'],4.5),'#222222') >= 4.5);
  assert.ok(contrast(readable('#dddddd',['#eeeeee'],4.5),'#eeeeee') >= 4.5);
  assert.equal(shotColorSlot('map'), 2); assert.ok(shotColorSlot('unknown') >= 1 && shotColorSlot('unknown') <= 6);
});
async function until(fn) { const end = Date.now()+2000; while(Date.now()<end) { if (fn()) return; await new Promise(r => setTimeout(r,20)); } assert.fail('live palette not updated within 2 s'); }
test('watcher discovers a provider installed into an initially empty home', async t => {
  const dir=home(t,'empty');let latest; const watch=watchTheme({home:dir,desktop:false,onChange:s=>latest=s});t.after(()=>watch.close());await watch.ready;
  fs.cpSync(path.join(fixtures,'wal/.cache'),path.join(dir,'.cache'),{recursive:true});await until(()=>latest?.source==='wal');
});
test('watcher handles atomic wal writes, deletions, new providers and Omarchy symlink swaps', async t => {
  const dir = home(t, 'omarchy-dark','omarchy-light','wal'); let latest;
  const watch = watchTheme({ home: dir, desktop: false, onChange: s => latest = s }); t.after(() => watch.close()); await watch.ready;
  const base = path.join(dir, '.config/omarchy/current');
  fs.symlinkSync('../themes/tokyo-night',path.join(base,'next')); fs.renameSync(path.join(base,'next'),path.join(base,'theme'));
  await until(() => latest?.palette?.name === 'tokyo-night');
  fs.rmSync(path.join(dir,'.config/omarchy'),{recursive:true}); await until(() => latest?.source === 'wal');
  const f = path.join(dir,'.cache/wal/colors.json'), c=JSON.parse(fs.readFileSync(f)); c.special.background='#101c30';
  fs.writeFileSync(f+'.next',JSON.stringify(c)); fs.renameSync(f+'.next',f); await until(() => latest?.palette?.bg === '#101c30');
  fs.cpSync(path.join(fixtures,'noctalia/.config/noctalia'),path.join(dir,'.config/noctalia'),{recursive:true}); await until(() => latest?.source === 'noctalia');
});
