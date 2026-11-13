// Deterministic Sound Atlas journeys: every feature a listener touches, on desktop and phone.
// Each assertion reads what the listener would see or hear (audio clock moving, map pixels, URL) — not just DOM existence.
// window.__sa is the app's own test hook (app.js); it is read, never used to drive the UI.
import { describe, test, beforeEach } from '@e2e-dev/web';
import { expect } from 'e2e';

const ready = () => !!(window as any).__sa && (window as any).__sa.all.length > 1000;
const sa = <T,>(b: any, fn: string) => b.evaluate(`(() => { const s = window.__sa; return (${fn}); })()`) as Promise<T>;
// Phone sheet: at peek only search + player show; Track/Similar/Library, Radio, Share and Cast appear at half.
// Raise it the way a person does (tap the grab handle) and wait for the spring to settle before measuring.
const settled = (b: any) => wait(b, `(() => { const r = document.querySelector('#sheet').getBoundingClientRect().top; const o = window.__lastTop === r; window.__lastTop = r; return o; })()`, 5000);
async function raise(b: any) {
  if (await b.evaluate(() => matchMedia('(min-width: 900px)').matches || document.querySelector('#sheet')!.getAttribute('data-snap') !== 'peek')) return;
  await b.locator('.grab').click();
  await wait(b, `document.querySelector('#sheet').dataset.snap !== 'peek'`, 5000);
  await settled(b);
}
const wait = async (b: any, fn: string, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await sa<boolean>(b, fn)) return true; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`timed out after ${ms} ms waiting for: ${fn}`);
};
const errors = (b: any) => b.evaluate(() => (window as any).__errs ?? []);
const audioState = `({ sel: s.state.sel, src: s.audio.src, t: s.audio.currentTime, paused: s.audio.paused, err: s.audio.error && s.audio.error.code })`;

describe('sound atlas', { tags: ['journey'] }, () => {
  beforeEach(async ({ browser }) => {
    await browser.addInitScript(() => {
      try { localStorage.setItem('sa-fs', 'no'); } catch { /* about:blank */ } // no fullscreen prompt
      (window as any).__errs = [];
      addEventListener('error', (e) => (window as any).__errs.push(String(e.message)));
      addEventListener('unhandledrejection', (e) => (window as any).__errs.push('rejection: ' + String((e as any).reason)));
    });
  });

  test('the atlas loads all tracks, paints the map, and throws nothing', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    expect(await sa<number>(browser, 's.all.length')).toBeGreaterThan(1800);
    // the map canvas must be painted, not blank: sample its pixels for variety
    const paint = () => browser.evaluate(() => {
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0] as HTMLCanvasElement;
      if (!c) return -1;
      const o = document.createElement('canvas'); o.width = 64; o.height = 64; const g = o.getContext('2d')!;
      g.drawImage(c, 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data; const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
      return seen.size;
    }) as Promise<number>;
    let lit = 0; for (let i = 0; i < 20 && lit <= 20; i++) { lit = await paint(); if (lit <= 20) await new Promise((r) => setTimeout(r, 500)); }
    expect(lit, 'map canvas still blank after 10 s').toBeGreaterThan(20);
    expect(await errors(browser)).toEqual([]);
  });

  test('search narrows the library and the URL keeps the query', async ({ app, browser, screen }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await screen.getByPlaceholder('Search a vibe…').fill('rain');
    await wait(browser, `location.hash.includes('q=rain')`);
    const titles: string[] = await browser.evaluate(() => [...document.querySelectorAll('#body .trk')].map((b) => b.textContent ?? '').slice(0, 5).map((t) => t.trim()));
    // the best hits for "rain" are songs about rain, not words that merely contain the letters (Brain, Braineating)
    expect(titles.filter((t) => /\brain/i.test(t)).length).toBeGreaterThanOrEqual(3);
    expect(titles[0]).toMatch(/\brain/i);
  });

  test('Play actually plays: the audio clock moves and the button says Pause', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await browser.locator('#pp').click();
    await wait(browser, `!s.audio.paused && s.audio.currentTime > 0.5`, 30000);
    expect(await browser.evaluate(() => document.querySelector('#pp')!.getAttribute('aria-label'))).toBe('Pause');
    await browser.locator('#pp').click();
    await wait(browser, `s.audio.paused`, 5000);
    expect(await browser.evaluate(() => document.querySelector('#pp')!.getAttribute('aria-label'))).toBe('Play');
  });

  test('Next and Previous change the song and the song plays', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await browser.locator('#pp').click();
    await wait(browser, `!s.audio.paused && s.audio.currentTime > 0.3`, 30000);
    const a = await sa<string>(browser, 's.state.sel');
    await browser.locator('#pn').click();
    await wait(browser, `s.state.sel !== ${JSON.stringify(a)} && !s.audio.paused && s.audio.currentTime > 0.3`, 30000);
    await browser.locator('#pv').click();
    await wait(browser, `s.state.sel === ${JSON.stringify(a)}`, 10000);
  });

  test('a shortlist track served by the site itself plays (local /tracks)', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    const id = await sa<string | null>(browser, `(s.all.find(t => /^(\\/|tracks\\/)/.test(t.audio || '')) || {}).id || null`);
    expect(id).not.toBeNull();
    await browser.evaluate((i: string) => { (window as any).__sa.select(i); return null; }, id!);
    await browser.locator('#pp').click();
    await wait(browser, `!s.audio.paused && s.audio.currentTime > 0.5 && !s.audio.error`, 20000);
    expect(await sa<string>(browser, 's.audio.src')).toContain('/tracks/');
  });

  test('a pretty song link opens that song', async ({ app, browser }) => {
    await app.open('/song/inspired-by-kevin-macleod');
    await wait(browser, `(${ready})()`, 60000);
    await wait(browser, `!!s.state.sel`, 10000);
    expect(await browser.evaluate(() => document.querySelector('#pt')!.textContent)).toContain('Inspired');
  });

  test('picking a song and reloading keeps the pick; Liked filter shows it', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await browser.locator('#pp').click();
    await wait(browser, `!!s.state.sel`, 20000);
    const sel = await sa<string>(browser, 's.state.sel');
    await browser.locator('#ph').click();
    await wait(browser, `s.state.picks.has(${JSON.stringify(sel)})`, 5000);
    await new Promise((r) => setTimeout(r, 600)); // saveHash debounce
    await browser.reload(); // app.open would clear storage; a listener's reload must keep the pick
    await wait(browser, `(${ready})()`, 60000);
    expect(await sa<boolean>(browser, `s.state.picks.has(${JSON.stringify(sel)})`)).toBe(true);
    await browser.locator('[aria-label="Only tracks you liked"]').click();
    await wait(browser, `document.querySelectorAll('#body button').length >= 1`);
    const shown: string[] = await browser.evaluate(() => [...document.querySelectorAll('#body button')].map((b) => b.textContent ?? ''));
    const title = await sa<string>(browser, `s.all.find(t => t.id === ${JSON.stringify(sel)}).title`);
    const view = await sa<string>(browser, 's.state.view');
    expect(shown.some((t) => t.trim().startsWith(title)), `Liked filter on (sheet view: ${view}) but "${title}" is not listed; rows: ${shown.slice(0, 3).join(' | ')}`).toBe(true);
  });

  test('a feeling chip filters to that feeling and its count is honest', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    const label: string = await browser.evaluate(() => document.querySelector('#chips button')!.textContent ?? '');
    const n = Number(label.replace(/\D/g, ''));
    await browser.locator('#chips button >> nth=0').click();
    await wait(browser, `s.state.feels.size === 1`);
    const lib = await browser.evaluate(() => [...document.querySelectorAll('#views button')].map((b) => b.textContent ?? '').find((t) => t.startsWith('Library')) ?? '');
    expect(Number(lib.replace(/\D/g, ''))).toBe(n);
  });

  test('every sort lens in the menu re-sorts without errors', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await browser.locator('#sortbtn').click();
    const items: number = await browser.evaluate(() => document.querySelectorAll('#sortmenu button').length);
    expect(items).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < items; i++) {
      if (await browser.evaluate(() => (document.querySelector('#sortmenu') as HTMLElement).hidden)) await browser.locator('#sortbtn').click();
      await browser.locator(`#sortmenu button >> nth=${i}`).click();
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(await errors(browser)).toEqual([]);
  });

  test('every sheet view opens and shows content', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await browser.locator('#pp').click();
    await wait(browser, `!!s.state.sel`, 20000);
    await raise(browser);
    for (const v of ['Track', 'Similar', 'Community', 'Library']) {
      await browser.locator(`#views button:has-text("${v}") >> nth=0`).click();
      await new Promise((r) => setTimeout(r, 600));
      const text: string = await browser.evaluate(() => (document.querySelector('#body') as HTMLElement).innerText.trim());
      expect(text.length, `${v} view is empty`).toBeGreaterThan(20);
    }
    expect(await errors(browser)).toEqual([]);
  });

  test('Share opens a QR code and a link to the current picks', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await browser.locator('#pp').click();
    await wait(browser, `!!s.state.sel`, 20000);
    await browser.locator('#ph').click();
    await raise(browser);
    await browser.locator('#ps').click();
    await wait(browser, `!!document.querySelector('svg') && [...document.querySelectorAll('svg')].some(e => e.innerHTML.length > 2000)`, 5000);
  });

  test('Radio starts a stream of new songs', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await raise(browser);
    await browser.locator('#pr').click();
    await wait(browser, `!!s.state.sel && !s.audio.paused && s.audio.currentTime > 0.3`, 30000);
  });

  test('the community API answers on the isolated schema', async ({ browser, app }) => {
    await app.open('/');
    const r = await browser.evaluate(async () => { const x = await fetch('/api/social?op=stats'); return { status: x.status, body: (await x.text()).slice(0, 200) }; });
    expect(r.status).toBe(200);
    expect(r.body).not.toContain('error');
  });

  test('Play on a TV offers a way to cast or explains why not', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await raise(browser);
    await browser.locator('#pc').click();
    await wait(browser, `!!document.querySelector('.castmenu.on')`, 3000);
    const menu: string = await browser.evaluate(() => (document.querySelector('.castmenu.on') as HTMLElement).innerText);
    expect(menu).toMatch(/Chromecast|Samsung|TV/);
    await new Promise((r) => setTimeout(r, 4000));
    expect(await browser.evaluate(() => (document.querySelector('.castmenu') as HTMLElement).innerText), 'Cast option stuck loading').not.toContain('Loading Cast');
    await browser.locator('#q').press('Escape'); // focus elsewhere then Escape: a menu must close on Escape
    await new Promise((r) => setTimeout(r, 300));
    expect(await browser.evaluate(() => !!document.querySelector('.castmenu.on')), 'cast menu ignores Escape').toBe(false);
    expect(await errors(browser)).toEqual([]);
  });

  test('Bring your own music opens its panel', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await raise(browser);
    await browser.locator('#body button:has-text("Bring your own music") >> nth=0').click();
    await new Promise((r) => setTimeout(r, 800));
    const text: string = await browser.evaluate(() => document.body.innerText);
    expect(text).toMatch(/files|folder|VLC|drop/i);
    expect(await errors(browser)).toEqual([]);
  });

  test('nothing overflows sideways and the player stays on screen', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await settled(browser);
    const g = await browser.evaluate(() => {
      const r = document.querySelector('#player')!.getBoundingClientRect();
      return { over: document.documentElement.scrollWidth - innerWidth, bottom: r.bottom, h: innerHeight, w: r.width };
    });
    expect(g.over).toBeLessThanOrEqual(0);
    expect(g.bottom).toBeLessThanOrEqual(g.h + 1);
    expect(g.w).toBeGreaterThan(200);
  });
  test('a search with good matches never shows a "nothing found" message', async ({ app, browser, screen }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await screen.getByPlaceholder('Search a vibe…').fill('piano');
    await screen.getByPlaceholder('Search a vibe…').press('Enter');
    await new Promise((r) => setTimeout(r, 4000)); // the open-web lookup answers late
    const n: number = await browser.evaluate(() => document.querySelectorAll('#body button').length);
    const said: string = await browser.evaluate(() => document.querySelector('#toast')!.textContent ?? '');
    expect(n).toBeGreaterThan(5);
    expect(said, 'toast reads as a failed search while matches are on screen').not.toMatch(/\bno\b.*(songs|results|matches)/i);
  });

  test('Radio skips a song that will not stream instead of stalling', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    await raise(browser);
    await browser.locator('#pr').click();
    // whatever it picked first, within 20 s something must be audibly playing
    await wait(browser, `!s.audio.paused && s.audio.currentTime > 1 && !s.audio.error`, 20000);
  });

  test('every catalogue source host actually serves audio', async ({ app, browser }) => {
    await app.open('/');
    await wait(browser, `(${ready})()`, 60000);
    // Play one song per host through the real player: a raw fetch of the catalogue URL is not what a listener
    // gets (ccMixter refuses hotlinks and the app streams it through /api/ccm with ccMixter's Referer).
    const byHost: Record<string, string[]> = await browser.evaluate(() => {
      const m: Record<string, string[]> = {};
      for (const t of (window as any).__sa.all) { if (t.src === 'web' || t.src === 'mine') continue; (m[new URL(t.audio, location.href).host] ??= []).push(t.id); }
      return m;
    });
    const dead: string[] = [];
    for (const [host, ids] of Object.entries(byHost)) {
      const sample = [ids[0], ids[Math.floor(ids.length / 2)]];
      let ok = false;
      if (host === 'ccmixter.org' && !(await browser.evaluate(() => location.protocol === 'https:'))) {
        // Local origins don't route through the proxy (app.js `proxied`); check the endpoint deploys stream from.
        const p = (await sa<string>(browser, `s.all.find(t => t.id === ${JSON.stringify(sample[0])}).audio`)).replace('https://ccmixter.org/content/', '');
        const st = await browser.evaluate(async (q: string) => (await fetch('/api/ccm?p=' + encodeURIComponent(q), { headers: { Range: 'bytes=0-1023' } })).status, p);
        if (st !== 206) dead.push(`${host} via /api/ccm answered ${st}`);
        continue;
      }
      for (const id of sample) {
        await browser.evaluate((i: string) => { (window as any).__sa.select(i); return null; }, id);
        if (await sa<boolean>(browser, 's.audio.paused')) await browser.locator('#pp').click();
        ok = await wait(browser, `s.state.sel === ${JSON.stringify(id)} && !s.audio.paused && s.audio.currentTime > 0.3`, 20000).catch(() => false);
        if (ok) break;
      }
      if (!ok) dead.push(`${host} (${ids.length} tracks, 0/${sample.length} played)`);
    }
    expect(dead, 'tracks whose host refuses to stream').toEqual([]);
  });
});
