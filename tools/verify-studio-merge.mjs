// Reproducible Studio + desktop-palette review on private copies; originals stay read-only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
const repo = path.resolve(new URL('..', import.meta.url).pathname);
const out = path.resolve(process.env.FFS_EVIDENCE || 'verify-out/studio-merge');
fs.mkdirSync(out, { recursive: true });
const home = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-studio-merge-'));
const root = path.join(home, 'fframestudio');
const ownerHome = os.homedir();
const config = path.join(ownerHome, '.config/fframestudio/bridge.json');
const fingerprint = file => ({ hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(fs.statSync(file, { bigint: true }).mtimeNs) });
const configBefore = fingerprint(config);
const originalFiles = ['expresslane-i880', 'gev-showcase'].map(id => path.join(ownerHome, 'fframestudio/projects', id, 'project.json'));
const originals = originalFiles.map(fingerprint);
const report = { screenshots: [], screens: [], errors: [], sourceUnchanged: false, discoveryUnchanged: false };
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: repo, env: { ...process.env, HOME: home, FFS_SOURCES: path.join(repo, 'projects/sources.example.json') }, encoding: 'utf8' }); if (r.status) throw Error(r.stderr); };
let browser;
try {
  run('python3', ['tools/make_demo.py']); run('python3', ['tools/import_projects.py']);
  for (const id of ['expresslane-i880', 'gev-showcase']) fs.cpSync(path.join(ownerHome, 'fframestudio/projects', id), path.join(root, 'projects', id), { recursive: true });
  // Repair the copied v0 export using the same resolver called by studio-spec import.
  run('python3', ['-c', `import json,pathlib,sys;sys.path.insert(0,'tools');from studio_music import resolve_music;p=pathlib.Path(sys.argv[1]);d=json.loads(p.read_text());d['music']=resolve_music(d['source']['path'],d['music'],p.parent,d['source'].get('studio'));p.write_text(json.dumps(d))`, path.join(root, 'projects/expresslane-i880/project.json')]);
  const repaired = JSON.parse(fs.readFileSync(path.join(root, 'projects/expresslane-i880/project.json')));
  const catalogue = JSON.parse(fs.readFileSync(path.join(repaired.source.path,'music/tracks.json')));
  const track = catalogue.find(t=>t.id===repaired.music.id);
  const originalTrack = path.resolve(repaired.source.path,path.dirname(repaired.source.studio),track.full);
  const copiedTrack = path.join(root,'projects/expresslane-i880',repaired.music.file);
  report.soundtrack = { title: repaired.music.title, beats: repaired.music.beats.length, bytes: fs.statSync(copiedTrack).size, copiedBytesMatch: fingerprint(copiedTrack).hash===fingerprint(originalTrack).hash };
  if (!report.soundtrack.copiedBytesMatch) throw Error('Copied soundtrack differs from selected original');
  const indexPath = path.join(root, 'projects/library.json'), index = JSON.parse(fs.readFileSync(indexPath));
  for (const id of ['expresslane-i880', 'gev-showcase']) {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'projects', id, 'project.json')));
    index.projects.push({ id, title: p.title, kind: p.kind, tags: p.tags, shots: p.shots.length, renders: p.renders?.length || 0, duration_s: p.duration_s, poster: p.media?.poster ? id+'/'+p.media.poster : null });
  }
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const fixture = path.join(home, 'wal-fixture');
  fs.cpSync(path.join(repo, 'test/fixtures/themes/wal'), fixture, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [provider, themeHome, themes] of [['noctalia', ownerHome, ['studio', 'paper', 'system:noctalia']], ['wal', fixture, ['system']]]) {
    const port = await new Promise(resolve => { const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
    const token = randomBytes(24).toString('base64url');
    const bridge = spawn(process.execPath, ['bridge/bridge.mjs', '--root', root, '--port', String(port), '--token', token, '--quiet', '--no-config', '--theme-home', themeHome], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await Promise.race([once(bridge.stdout, 'data'), new Promise((_, reject) => setTimeout(() => reject(Error('Owned bridge not ready')), 15000))]);
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', e => report.errors.push(e.message));
      const base = `http://127.0.0.1:${port}`;
      await page.goto(base+'/open?token='+token); await page.waitForSelector('.card');
      const shot = async name => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(out, name+'.png') }); report.screenshots.push(name+'.png'); };
      for (const theme of themes) for (const [width,height] of [[1600,1000],[1280,800]]) {
        await page.setViewportSize({ width, height });
        await page.goto(base);
        await page.evaluate(theme => { localStorage.setItem('ffs.settings', JSON.stringify({ theme })); }, theme);
        await page.reload(); await page.waitForSelector('.card');
        await page.waitForFunction(() => [...document.images].every(i=>i.complete));
        const label = (theme.startsWith('system') ? provider : theme)+'-'+width+'x'+height;
        if (theme.startsWith('system')) await page.waitForFunction(async source => (await import('/app/src/system-theme.js')).themeInfo().source === source, provider);
        if (!await page.locator('#library-theme').inputValue()) throw Error('Library theme picker is blank '+label);
        await shot('library-'+label);
        const libraryOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1);
        if (libraryOverflow) throw Error('Library horizontal overflow '+label);
        for (const id of ['demo','expresslane-i880','gev-showcase']) {
          await page.goto(base+'/#/p/'+id);
          await page.waitForFunction(id => window.ffs?.doc.id === id && window.ffs.interactiveAt, id);
          await page.waitForFunction(() => !['pending','decoding'].includes(window.ffs.studio.analysisState));
          await page.evaluate(() => { window.ffs.rate=0; window.ffs.seek(0); window.scrollTo(0,0); });
          if (id !== 'gev-showcase') {
            await page.waitForFunction(() => window.ffs.studio.peaks?.some(x=>x>0));
            if (!await page.evaluate(() => window.ffs.studio.energy.some(x=>x>0) && !document.querySelector('#audio-wave').hidden)) throw Error('Measured waveform/energy missing '+id);
          }
          if (await page.locator('.attached-item').count()) throw Error('Timeline attachment clutter returned');
          await shot(id+'-'+label);
          const layout = await page.evaluate(async () => {
            const box = selector => { const r=document.querySelector(selector).getBoundingClientRect();return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
            const { contrast, themeInfo } = await import('/app/src/system-theme.js');
            const css=getComputedStyle(document.documentElement), value=k=>css.getPropertyValue('--'+k).trim();
            return { overflow:document.documentElement.scrollWidth>innerWidth+1, canvas:box('#canvas'), timeline:box('#timeline'), wave:box('#audio-wave'), inspector:box('.inspector-panel'), source:themeInfo().source, background:value('bg'), accent:value('acc'), paper:value('paper'), paperContrast:contrast(value('paper-ink'),value('paper')), peaks:window.ffs.studio.peaks?.length||0, energy:window.ffs.studio.energy?.length||0, analysis:window.ffs.studio.analysisState, clips:window.ffs.video.clips.length, palette:[...new Set([...document.querySelectorAll('.timeline-clip')].map(n=>getComputedStyle(n).getPropertyValue('--slot').trim()))] };
          });
          if (layout.overflow || layout.canvas.right > layout.inspector.x || layout.timeline.bottom > height || layout.paperContrast < 4.5) throw Error('Layout/contrast failed '+id+' '+label+' '+JSON.stringify(layout));
          if (id === 'expresslane-i880' && layout.palette.length !== 5) throw Error('Five shot meanings collapsed '+label);
          report.screens.push({ project:id, theme, provider, width, height, ...layout });
          if (id==='expresslane-i880') {
            const clip=page.locator('.timeline-clip').nth(1); await clip.click({button:'right'});
            await page.getByRole('menu',{name:'Clip actions'}).waitFor({state:'visible'});
            const menuContrast = await page.evaluate(async () => {
              const { contrast } = await import('/app/src/system-theme.js');
              const menu = document.querySelector('.context-menu'), bg=getComputedStyle(menu).backgroundColor;
              const ctx=document.createElement('canvas').getContext('2d');
              const hex=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return '#'+[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>x.toString(16).padStart(2,'0')).join('');};
              return Math.min(...[...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')].flatMap(n=>{const s=getComputedStyle(n),b=s.backgroundColor==='rgba(0, 0, 0, 0)'?bg:s.backgroundColor;return [contrast(hex(s.color),hex(b)),contrast(hex(getComputedStyle(n.querySelector('kbd')).color),hex(b))];}));
            });
            if (menuContrast < 4.5) throw Error('Native menu text contrast '+label+' '+menuContrast);
            report.screens.at(-1).menuMinimumTextContrast = menuContrast;
            await shot('menu-'+label); await page.keyboard.press('Escape');
            if (width===1600) { await page.click('[data-action="settings"]'); await shot('workspace-'+label); await page.click('[data-action="close-settings"]'); }
          }
        }
      }
      await context.close();
    } finally { bridge.kill('SIGTERM'); await once(bridge,'exit'); }
  }
  report.ok = !report.errors.length;
} catch (error) { report.ok=false; report.error=error.stack; process.exitCode=1; }
finally {
  await browser?.close();
  report.sourceUnchanged=originalFiles.every((f,i)=>JSON.stringify(fingerprint(f))===JSON.stringify(originals[i]));
  report.discoveryUnchanged=JSON.stringify(fingerprint(config))===JSON.stringify(configBefore);
  if (!report.sourceUnchanged || !report.discoveryUnchanged) { report.ok=false; process.exitCode=1; }
  fs.writeFileSync(path.join(out,'studio-merge-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
