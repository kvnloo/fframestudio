// One Chromium per session, attached over CDP so we control its flags.
// - DISPLAY set: headed, so a screen share / the wall shows the run. Unset: --headless=new.
// - ARMY_GPU=1: real GPU WebGL (ANGLE on Vulkan). Without a GPU, three.js scenes fall back to SwiftShader, which can run
//   at ~1 fps on a busy host and turn every tap into a timeout (measured: click 29 s software vs 130 ms GPU).
// - CHROME_EXE: browser binary; default is Playwright's own Chromium.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const GPU = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

export function armyBrowser(size: { width: number; height: number }) {
  return {
    cdpEndpoint: () =>
      new Promise<string>((resolve, reject) => {
        const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'army-chrome-'));
        const args = [
          '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
          `--window-size=${size.width},${size.height + 90}`,
          ...(process.env.DISPLAY ? [] : ['--headless=new']),
          ...(process.env.ARMY_GPU === '1' ? GPU : []),
          'about:blank',
        ];
        const chrome = spawn(process.env.CHROME_EXE ?? chromium.executablePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        chrome.stderr.on('data', (b) => {
          err += b;
          const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
          if (m) resolve(m[1]);
        });
        chrome.on('exit', (c) => reject(new Error(`chrome exited ${c}: ${err.slice(-400)}`)));
        process.on('exit', () => chrome.kill());
      }),
  };
}
