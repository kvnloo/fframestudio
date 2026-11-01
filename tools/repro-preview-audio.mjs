// Read-only real-media repro. No project edits or private media are written.
// node tools/repro-preview-audio.mjs URL [--fixed] [--out report.json]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const args = process.argv.slice(2), url = args[0];
if (!url || !/^https?:/.test(url)) throw Error('Supply an authenticated studio /open URL');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (args.includes('--fixed')) await page.route('**/app/src/editor.js', route => route.fulfill({ path: new URL('../web/src/editor.js', import.meta.url).pathname, contentType: 'text/javascript' }));
  await page.goto(url);
  await page.waitForFunction(() => window.ffs?.doc && document.querySelector('#preview-video')?.readyState >= 2);
  const trials = [];
  for (const muted of [true, false, true, false]) {
    trials.push(await page.evaluate(async muted => {
      const e = window.ffs, v = document.querySelector('#preview-video');
      e.rate = 0; v.pause(); e.seek(900);
      await new Promise(resolve => { if (!v.seeking) return resolve(); v.addEventListener('seeked', resolve, { once: true }); });
      await new Promise(r => setTimeout(r, 400));
      v.muted = muted;
      let seeking = 0, waiting = 0, presented = 0, live = true;
      const onSeek = () => seeking++, onWait = () => waiting++;
      v.addEventListener('seeking', onSeek); v.addEventListener('waiting', onWait);
      let callback;
      const frame = () => { presented++; if (live) callback = v.requestVideoFrameCallback(frame); };
      callback = v.requestVideoFrameCallback(frame);
      e.rate = 1;
      const start = performance.now();
      await new Promise(r => setTimeout(r, 5000));
      e.rate = 0; v.pause(); live = false; v.cancelVideoFrameCallback(callback);
      v.removeEventListener('seeking', onSeek); v.removeEventListener('waiting', onWait);
      return { muted, seeking, waiting, presented, seconds: (performance.now() - start) / 1000, mediaTime: v.currentTime, frame: e.frame, separateAudio: !!e.studio.audio.src };
    }, muted));
  }
  const report = { fixed: args.includes('--fixed'), trials, errors };
  const out = args.indexOf('--out');
  if (out >= 0) await fs.writeFile(args[out + 1], JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
  if (args.includes('--fixed') && (errors.length || trials.some(t => t.seeking > 2 || t.presented < 110))) process.exitCode = 1;
} finally { await browser.close(); }
