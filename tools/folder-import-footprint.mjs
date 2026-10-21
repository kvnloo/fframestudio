#!/usr/bin/env node
// Measure what a read-only folder import keeps in IndexedDB for a synthetic 3,000-file folder.
// Usage: node tools/folder-import-footprint.mjs [--site <built-site>] [--files 3000] [--layout library|project]
// Serves the site through the CSP static server; never touches a real projects folder.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {staticSite} from '../test/static-site.mjs';
import {makeBulkyFolder, readFolderRecord} from '../test/helpers/bulky-folder.mjs';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const root = path.resolve(new URL('..', import.meta.url).pathname), work = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-footprint-'));
let browser, server;
try {
  let site = arg('--site');
  if (!site) { site = path.join(work, 'site'); const built = spawnSync('python3', ['tools/build_demo_site.py', '--out', site, '--examples', path.join(work, 'none')], {cwd: root, encoding: 'utf8'}); if (built.status) throw Error(built.stderr); }
  const demo = spawnSync('python3', ['tools/make_demo.py'], {cwd: root, env: {...process.env, HOME: work}, encoding: 'utf8'}); if (demo.status) throw Error(demo.stderr);
  const document = {schema: 'fframestudio.project/0', id: 'visitor-film', title: 'Visitor film', canvas: {width: 1280, height: 720, fps: 30}, media: {proxy: 'film.mp4'}, shots: [{id: 'shot-0', name: 'Hook', t0: 0, t1: 3}]};
  const folder = path.join(work, 'cutkit-demo'), made = makeBulkyFolder(folder, {document, video: path.join(work, 'fframestudio/demo-src/demo.mp4'), total: Number(arg('--files', 3000)), layout: arg('--layout', 'library')});
  const selectedBytes = spawnSync('du', ['-sb', folder], {encoding: 'utf8'}).stdout.split('\t')[0];
  server = await staticSite(path.resolve(site));
  browser = await chromium.launch({executablePath: process.env.CHROMIUM || '/usr/bin/chromium'});
  const context = await browser.newContext(), page = await context.newPage(), methods = new Set();
  context.on('request', r => methods.add(r.method() + ' ' + new URL(r.url()).origin));
  page.on('dialog', d => d.accept());
  await page.goto(server.base); await page.waitForSelector('#folder-files', {state: 'attached'});
  const empty = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
  const t0 = Date.now();
  await page.locator('#folder-files').setInputFiles(folder); await page.waitForSelector('.card[data-project="visitor-film"]');
  const importMs = Date.now() - t0;
  await page.waitForTimeout(500);
  const record = await readFolderRecord(page);
  console.log(JSON.stringify({site, layout: arg('--layout', 'library'), selectedFiles: made.total, selectedBytes: Number(selectedBytes), persistedFiles: record.files, persistedBlobBytes: record.bytes, storageUsageBefore: empty, storageUsageAfter: record.usage, importMs, requestMethods: [...methods].sort(), summary: record.summary}, null, 2));
} finally { await browser?.close(); await server?.close(); fs.rmSync(work, {recursive: true, force: true}); }
