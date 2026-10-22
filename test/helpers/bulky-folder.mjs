// A synthetic "whole repo" folder: one real project hidden among thousands of unrelated files.
import fs from 'node:fs';
import path from 'node:path';

// layout 'library': <dir>/projects/<id>/project.json; 'project': <dir>/project.json beside the clutter.
export function makeBulkyFolder(dir, {document, video, total = 3000, fileBytes = 16 * 1024, layout = 'library'}) {
  const inner = layout === 'library' ? `projects/${document.id}/` : '', projectDir = path.join(dir, inner);
  fs.mkdirSync(projectDir, {recursive: true});
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(document, null, 2));
  fs.copyFileSync(video, path.join(projectDir, 'film.mp4'));
  const filler = Buffer.alloc(fileBytes, 7);
  const groups = ['node_modules/pkg', '.git/objects/o', 'target/debug/obj', inner + 'frames/f', inner + 'renders/unused-take'];
  let written = 2;
  for (let i = 0; written < total; i++, written++) {
    const file = path.join(dir, groups[i % groups.length] + i + (i % groups.length >= 3 ? '.png' : '.bin'));
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, filler);
  }
  return {total: written, kept: ['project.json', 'film.mp4'].map(n => path.join(projectDir, n))};
}

// Read the persisted read-only folder record from the page's real IndexedDB.
export const readFolderRecord = page => page.evaluate(() => new Promise((ok, bad) => {
  const open = indexedDB.open('fframestudio.local', 1);
  open.onerror = () => bad(open.error);
  open.onsuccess = () => {
    const r = open.result.transaction('local').objectStore('local').get('folder');
    r.onerror = () => bad(r.error);
    r.onsuccess = async () => {
      const files = r.result?.files || [];
      const estimate = await navigator.storage?.estimate?.();
      ok({files: files.length, paths: files.map(([p]) => p).sort(), bytes: files.reduce((n, [, f]) => n + f.size, 0), usage: estimate?.usage ?? null, summary: r.result?.summary ?? null});
      open.result.close();
    };
  };
}));
