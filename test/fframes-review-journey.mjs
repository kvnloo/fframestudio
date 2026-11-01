// Browser journey for the revision-aware fframes CLI review recipes (web/src/fframes-cli.js).
import fs from 'node:fs';
import path from 'node:path';
import { fromV0 } from '../web/src/doc/project.js';
import { PINNED_REVISION } from '../web/src/fframes-cli.js';

// Copies the generated demo film; two scenes over the film render, pinned like the launch-film example.
export function makeFframesReviewFixture(library) {
  const dir = path.join(library, 'fframes-review');
  fs.cpSync(path.join(library, 'demo'), dir, { recursive: true });
  const doc = fromV0(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')));
  const first = doc.videos[0].clips[0];
  const fps = doc.fps.num / doc.fps.den, total = doc.videos[0].clips.reduce((n, c) => n + c.duration, 0), half = Math.floor(total / 2);
  Object.assign(doc, { id: 'fframes-review', title: 'fframes review recipes fixture', versions: [] });
  doc.metadata = { ...doc.metadata, id: 'fframes-review', kind: 'fframes', canvas: { ...doc.metadata.canvas, fps },
    source: { sourceRepo: 'https://github.com/dmtrKovalenko/fframes', sourcePath: 'examples/fframes-intro' },
    provenance: { revision: PINNED_REVISION, timeline: 'synthetic fixture: not an fframes timeline --json' } };
  doc.videos[0].clips = [[0, half, 'Intro', 'IntroScene'], [half, total, 'Outro', 'OutroScene']].map(([a, b, name, scene], i) => ({
    ...structuredClone(first), id: `review-${i}`, name, start: a, sourceIn: a, duration: b - a, thumb: null, attached: [], text: { title: name }, textOverrides: {},
    metadata: { sourceFrames: [a, b], sourceScene: `fixture::${scene}` } }));
  doc.videos[0].scenes = [];
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(doc));
  return { dir, half, total };
}

export async function verifyFframesReview({ context, base, out, library, assert }) {
  const { half, total } = makeFframesReviewFixture(library);
  const file = path.join(library, 'fframes-review', 'project.json'), before = fs.readFileSync(file);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/#/p/fframes-review`);
    await page.waitForFunction(() => window.ffs?.doc?.id === 'fframes-review' && window.ffs.journal);
    await page.locator('.story-card[data-select="review-1"]').click();
    await page.click('[data-slate-tab="shot"]');
    const panel = page.locator('#fframes-review');
    await panel.locator('summary').click();
    const range = () => panel.locator('[data-fframes-range]').textContent();
    assert(await range() === `${half}..${total}`, `native range ${await range()}`);
    assert((await panel.locator('[data-fframes-revision]').textContent()).includes('44745c0'), 'revision label');
    const ids = await panel.locator('[data-fframes-command]').evaluateAll((n) => n.map((x) => x.dataset.fframesCommand));
    assert(JSON.stringify(ids) === JSON.stringify(['timeline', 'frame', 'strip', 'onion', 'inspect', 'render']), `commands ${ids}`);
    assert(!(await panel.textContent()).includes(' snapshot '), 'snapshot recipe offered');
    await panel.evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(out, 'fframes-review-header.png') });
    await panel.locator('[data-fframes-command="strip"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'fframes-review-desktop.png') });
    // A trim must update the recipes in place and keep the disclosure open.
    await page.locator('#duration').fill('10'); await page.locator('#duration').press('Tab');
    await page.waitForFunction(() => window.ffs.video.clips[1].duration === 10);
    await page.waitForFunction((want) => document.querySelector('#fframes-review [data-fframes-range]')?.textContent === want, `${half}..${half + 10}`);
    assert(await panel.evaluate((n) => n.open), 'review disclosure closed after a trim');
    assert((await panel.textContent()).includes('(trimmed)'), 'trim not labelled');
    const button = panel.locator('[data-fframes-command="inspect"] [data-copy-cli]');
    await button.click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied === await panel.locator('[data-fframes-command="inspect"] code').textContent(), 'clipboard differs from the shown command');
    assert(copied === `cargo run --release -p fframes-intro -- inspect ${half}..${half + 10} --pops --json --fail-on warning`, `copied ${copied}`);
    await page.evaluate(() => window.ffs.action('undo'));
    await page.waitForFunction((want) => document.querySelector('#fframes-review [data-fframes-range]')?.textContent === want, `${half}..${total}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.locator('[data-fframes-command="inspect"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'fframes-review-phone.png') });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(overflow <= 391, `phone scrollWidth ${overflow}`);
    const small = await panel.locator('[data-copy-cli]').evaluateAll((n) => n.map((b) => b.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
    assert(small === 0, `${small} copy buttons under 44 px on phone`);
    // Source & provenance names the build revision and what newest verified upstream changes.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-slate-tab="source"]');
    const upstream = page.locator('.source-panel [data-fframes-upstream]');
    await upstream.waitFor();
    assert(await upstream.getAttribute('data-fframes-upstream') === 'behind', 'upstream state');
    const upText = await upstream.textContent();
    assert(upText.includes('44745c0') && upText.includes('v1.3.0') && upText.includes('snapshot command removed'), `upstream text ${upText}`);
    await upstream.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'fframes-upstream-source.png') });
    assert(Buffer.compare(before, fs.readFileSync(file)) === 0, 'review journey wrote the project');
    return { range: `${half}..${total}`, commands: ids.length, copied };
  } finally { await page.close(); }
}
