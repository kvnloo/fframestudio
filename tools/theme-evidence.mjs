// Capture real desktop palettes, read-only, against a private copy of the verify demo.
// node tools/theme-evidence.mjs <verify-home>/fframestudio <output-dir>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { detectTheme } from '../bridge/system-theme.mjs';
const [library, output] = process.argv.slice(2);
if (!library || !output) throw Error('Expected demo library path and evidence output directory');
const home = os.homedir(), root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ffs-theme-visual-'));
fs.cpSync(library, root, { recursive: true }); fs.mkdirSync(output, { recursive: true });
// Reset only the disposable demo copy after the recovery journeys have edited it.
const demoPath = path.join(root,'projects/demo/project.json'), demo = JSON.parse(fs.readFileSync(demoPath,'utf8'));
demo.title = 'Demo film'; for (const video of demo.videos || []) for (const clip of video.clips) clip.textOverrides = {};
fs.writeFileSync(demoPath,JSON.stringify(demo));
const port = await new Promise(resolve => { const s = net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
const token = (await import('node:crypto')).randomBytes(24).toString('base64url');
const bridge = spawn(process.execPath, ['bridge/bridge.mjs','--root',root,'--port',String(port),'--token',token,'--quiet','--no-config','--theme-home',home], { stdio:['ignore','pipe','pipe'] });
let browser;
try {
  await Promise.race([once(bridge.stdout,'data'), new Promise((_,reject)=>setTimeout(()=>reject(Error('Bridge timeout')),15000))]);
  browser = await chromium.launch({ executablePath:process.env.CHROMIUM || '/usr/bin/chromium', args:['--no-sandbox'] });
  const context = await browser.newContext({ viewport:{width:1440,height:1000} }), page = await context.newPage();
  const errors = []; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/open?token=${token}`);
  await page.goto(`http://127.0.0.1:${port}/#/p/demo`); await page.waitForFunction(()=>window.ffs?.journal);
  const results=[];
  for (const source of ['noctalia','wal']) {
    const p = await detectTheme({home,source,desktop:false}); if(p.source!==source) throw Error('Missing real '+source+' palette');
    await page.click('[data-action="settings"]'); await page.selectOption('#theme','system:'+source);
    await page.waitForFunction(async s => (await import('/app/src/system-theme.js')).themeInfo().source===s,source);
    await page.screenshot({path:path.join(output,source+'-workspace.png')});
    await page.click('[data-action="close-settings"]'); await page.waitForTimeout(200);
    const screenshot=path.join(output,source+'-editor.png'); await page.screenshot({path:screenshot});
    const detail=await page.evaluate(async()=>{
      const {themeInfo,contrast,applyTheme}=await import('/app/src/system-theme.js');
      performance.clearMeasures('system-theme-apply');for(let i=0;i<30;i++)applyTheme(window.ffs.settings);
      const css=getComputedStyle(document.documentElement), value=k=>css.getPropertyValue('--'+k).trim();
      return {source:themeInfo().source,adjustments:themeInfo().adjustments,background:getComputedStyle(document.body).backgroundColor,fgContrast:contrast(value('ink'),value('bg2')),accentContrast:contrast(value('acc'),value('bg2')),applyMs:performance.getEntriesByName('system-theme-apply').map(m=>m.duration)};
    });
    if(detail.fgContrast<4.5||detail.accentContrast<3||Math.max(...detail.applyMs)>=16)throw Error('Readability/perf failed '+source);
    results.push({source,screenshot,...detail});
  }
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(output,'real-palettes.json'),JSON.stringify({root,results,errors},null,2));
  console.log(JSON.stringify({root,results,errors},null,2));
} finally { await browser?.close(); bridge.kill('SIGTERM'); await once(bridge,'exit'); }
