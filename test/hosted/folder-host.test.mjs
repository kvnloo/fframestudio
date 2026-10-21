import test from 'node:test';
import assert from 'node:assert/strict';
import {fileHash} from '../../web/src/doc/journal.js';

// In-memory handles implement the browser file API, not a real native picker.
class MemoryFile {
  kind = 'file';
  writes = 0;
  constructor(name, body = '') { this.name = name; this.body = body; }
  async getFile() { return new File([this.body], this.name); }
  async createWritable() {
    let pending;
    return {write: async body => { pending = body; }, close: async () => { this.body = pending; this.writes++; }};
  }
}
class MemoryDirectory {
  kind = 'directory';
  children = new Map();
  permission = 'granted';
  requests = [];
  constructor(name) { this.name = name; }
  async *entries() { yield* this.children; }
  async queryPermission(options) { assert.equal(options.mode, 'readwrite'); return this.permission; }
  async requestPermission(options) { this.requests.push(options); this.permission = 'granted'; return this.permission; }
  async getDirectoryHandle(name, options = {}) { return this.child(name, 'directory', options); }
  async getFileHandle(name, options = {}) { return this.child(name, 'file', options); }
  child(name, kind, {create} = {}) {
    if (!this.children.has(name) && create) this.children.set(name, kind === 'directory' ? new MemoryDirectory(name) : new MemoryFile(name));
    const value = this.children.get(name);
    if (!value || value.kind !== kind) throw new DOMException('Missing entry', 'NotFoundError');
    return value;
  }
  async removeEntry(name) { this.children.delete(name); }
}
// Small asynchronous IDB double retains fake handles by reference: native handles are
// structured-cloneable, these JS doubles are not. Real IDB persistence is browser-tested.
function memoryIndexedDB(values = new Map()) {
  const db = {createObjectStore() {}, transaction() {
    const tx = {}; let pending = 0, timer;
    const schedule = fn => {
      pending++; clearTimeout(timer); const result = {};
      setTimeout(() => { result.result = fn(); result.onsuccess?.(); if (--pending === 0) timer = setTimeout(() => tx.oncomplete?.(), 0); }, 0);
      return result;
    };
    tx.objectStore = () => ({get: key => schedule(() => values.get(key)), put: (value, key) => schedule(() => values.set(key, value)), delete: key => schedule(() => values.delete(key))});
    return tx;
  }};
  return {open() { const r = {}; setTimeout(() => {r.result = db; r.onupgradeneeded?.(); r.onsuccess?.();}, 0); return r; }};
}

test('native folder adapter: read, createWritable save, conflict, stored handle permission re-request and copy readback', async () => {
  globalThis.indexedDB = memoryIndexedDB();
  globalThis.location = {origin: 'https://studio.invalid'};
  let picked = 0;
  const root = new MemoryDirectory('My projects'), project = await root.getDirectoryHandle('film', {create:true});
  const file = await project.getFileHandle('project.json', {create:true});
  const original = JSON.stringify({schema:'fframestudio.project/0', id:'film', title:'My film', canvas:{fps:30}, shots:[{id:'one',t0:0,t1:1}], media:{proxy:'film.mp4'}});
  file.body = original;
  (await project.getFileHandle('film.mp4', {create:true})).body = new Uint8Array([0,1,2,255]);
  globalThis.window = {showDirectoryPicker: async options => {assert.equal(options.mode, 'readwrite'); picked++; return root;}};
  const folder = await import('../../web/src/folder-host.js');
  await folder.initialize();
  assert.equal(await folder.openFolder(), true);
  assert.equal(picked, 1);
  const library = await (await folder.request('/lib/library.json')).json();
  assert.deepEqual(library.projects.map(p => p.id), ['film']);
  const url = '/fs?path=projects%2Ffilm%2Fproject.json';
  assert.equal((await (await folder.request(url)).json()).content, original);
  assert.match(folder.mediaURL('film', 'film.mp4'), /^blob:/);
  assert.equal(folder.mediaURL('film', '../secret'), '');
  const edited = JSON.stringify({...JSON.parse(original), title:'Edited locally'});
  const save = body => folder.request(url, {method:'PUT', headers:{'X-FFS-Expected': ''}, body});
  assert.equal((await folder.request(url, {method:'PUT', headers:{'X-FFS-Expected':await fileHash(original)}, body:edited})).status, 200);
  assert.equal(await (await file.getFile()).text(), edited);
  assert.equal(file.writes, 1);
  file.body = original;
  assert.equal((await folder.request(url, {method:'PUT', headers:{'X-FFS-Expected':await fileHash(edited)}, body:edited})).status, 409);
  assert.equal(file.body, original);
  assert.deepEqual([...project.children.keys()].sort(), ['film.mp4','project.json']);
  root.permission = 'prompt';
  const restored = await import('../../web/src/folder-host.js?restored');
  await restored.initialize();
  assert.equal(restored.status().permissionNeeded, true);
  assert.equal(restored.status().count, 0);
  await restored.openFolder();
  assert.equal(picked, 1, 'reconnect must request permission on the persisted handle, not a new picker');
  assert.equal(root.requests.length, 2);
  assert.equal(restored.status().permissionNeeded, false);
  assert.equal((await (await restored.request(url)).json()).content, original);
  const copy = {schema:'fframestudio.project/0',id:'saved-example',title:'Example copy',canvas:{fps:30},shots:[],media:{proxy:'media/example.mp4'}};
  await restored.saveCopy(copy, [{path:'media/example.mp4',blob:new Blob([new Uint8Array([0,255,42])])}]);
  const saved = await root.getDirectoryHandle('saved-example');
  assert.equal(JSON.parse(await (await (await saved.getFileHandle('project.json')).getFile()).text()).title, 'Example copy');
  assert.deepEqual([...new Uint8Array(await (await (await (await saved.getDirectoryHandle('media')).getFileHandle('example.mp4')).getFile()).arrayBuffer())], [0,255,42]);
  await assert.rejects(restored.saveCopy(copy,[{path:'../outside',blob:new Blob()}]), /inside the selected folder/);
  // An empty granted folder is not a permission failure.
  await restored.adoptDirectory(new MemoryDirectory('Empty'));
  assert.equal(restored.status().permissionNeeded, false);
  assert.equal(restored.status().count, 0);
  assert.equal((await save(edited)).status, 200);
});

// <input webkitdirectory> Files expose their folder-relative path; Node's File does not.
const picked = (path, body, type = '') => Object.defineProperty(new File([body], path.split('/').pop(), {type}), 'webkitRelativePath', {value: path});
const project = (id, extra = {}) => JSON.stringify({schema:'fframestudio.project/0', id, title:id, canvas:{fps:30}, shots:[{id:'one', t0:0, t1:1, thumb:'thumbs/one.png'}], media:{proxy:'film.mp4'}, ...extra});
const storedBytes = files => files.reduce((n, [, f]) => n + f.size, 0);

test('read-only import keeps only project files and referenced media out of thousands of selected files', async () => {
  const values = new Map();
  globalThis.indexedDB = memoryIndexedDB(values);
  globalThis.location = {origin: 'https://studio.invalid'};
  globalThis.window = {};
  const folder = await import('../../web/src/folder-host.js?read-only-import');
  await folder.initialize();
  const big = new Uint8Array(64 * 1024), files = [
    picked('cutkit-demo/projects/film/project.json', project('film', {metadata:{renders:[{label:'Master', file:'renders/master.mp4'}], source:{path:'/home/me/secret/master.mov'}}}), 'application/json'),
    picked('cutkit-demo/projects/film/film.mp4', big, 'video/mp4'),
    picked('cutkit-demo/projects/film/thumbs/one.png', new Uint8Array(10), 'image/png'),
    picked('cutkit-demo/projects/film/renders/master.mp4', big, 'video/mp4'),
    picked('cutkit-demo/projects/film/renders/unused-take.mp4', big, 'video/mp4'),
    picked('cutkit-demo/projects/film/notes/data.json', '{"id":"not-a-project"}'),
    picked('cutkit-demo/projects/film/.git/HEAD', 'ref: refs/heads/main'),
  ];
  for (let i = 0; i < 1000; i++) files.push(picked(`cutkit-demo/projects/film/frames/${i}.png`, big, 'image/png'));
  for (let i = 0; i < 1000; i++) files.push(picked(`cutkit-demo/node_modules/pkg${i}/index.js`, big));
  for (let i = 0; i < 993; i++) files.push(picked(`cutkit-demo/target/debug/obj${i}.o`, big));
  assert.equal(files.length, 3000);
  const summary = await folder.importFiles(files);
  const persisted = values.get('folder').files;
  assert.deepEqual(persisted.map(([p]) => p).sort(), ['film/film.mp4', 'film/project.json', 'film/renders/master.mp4', 'film/thumbs/one.png']);
  assert.equal(summary.selected, 3000);
  assert.equal(summary.kept, 4);
  assert.equal(summary.bytes, storedBytes(persisted));
  assert.ok(summary.bytes < 3 * big.length, `kept ${summary.bytes} bytes`);
  assert.deepEqual(folder.status().imported, summary);
  assert.deepEqual((await (await folder.request('/lib/library.json')).json()).projects.map(p => p.id), ['film']);
  await folder.request('/fs?path=projects%2Ffilm%2Fproject.json');
  assert.match(folder.mediaURL('film', 'film.mp4'), /^blob:/);
  assert.match(folder.mediaURL('film', 'renders/master.mp4'), /^blob:/);
  assert.equal(folder.mediaURL('film', 'renders/unused-take.mp4'), '', 'unreferenced media is not kept in memory either');

  // Reload restores exactly what was persisted.
  const reloaded = await import('../../web/src/folder-host.js?read-only-reload');
  await reloaded.initialize();
  assert.deepEqual(reloaded.status().imported, summary);
  assert.deepEqual((await (await reloaded.request('/lib/library.json')).json()).projects.map(p => p.id), ['film']);

  // A legacy entry that stored every selected file is pruned on the next visit.
  const legacy = [['film/project.json', files[0]], ['film/film.mp4', files[1]], ['film/thumbs/one.png', files[2]], ['film/renders/master.mp4', files[3]], ...files.slice(7, 507).map(f => [f.webkitRelativePath.slice('cutkit-demo/projects/'.length), f])];
  values.set('folder', {name:'cutkit-demo', scope:'legacy', files:legacy});
  const pruned = await import('../../web/src/folder-host.js?legacy-prune');
  await pruned.initialize();
  assert.equal(values.get('folder').files.length, 4);
  assert.equal(pruned.status().imported.selected, legacy.length);

  // A folder without projects keeps nothing.
  const empty = await folder.importFiles(files.slice(1007));
  assert.deepEqual(empty, {selected: 1993, kept: 0, bytes: 0});
  assert.deepEqual(values.get('folder').files, []);
});

test('read-only fframes timeline import keeps the synthesized project and its master video only', async () => {
  const values = new Map();
  globalThis.indexedDB = memoryIndexedDB(values);
  globalThis.location = {origin: 'https://studio.invalid'};
  globalThis.window = {};
  let asked = 0;
  globalThis.confirm = () => { asked++; return true; };
  const folder = await import('../../web/src/folder-host.js?timeline-import');
  await folder.initialize();
  const files = [picked('out/timeline.txt', '1280x720 @ 30 fps\n#0 Hook frames 0..30 0.0s..1.0s\n'), picked('out/master.mp4', new Uint8Array(100), 'video/mp4')];
  for (let i = 0; i < 200; i++) files.push(picked(`out/frames/${i}.png`, new Uint8Array(1000), 'image/png'));
  const summary = await folder.importFiles(files);
  assert.equal(asked, 1);
  assert.deepEqual(values.get('folder').files.map(([p]) => p).sort(), ['master.mp4', 'project.json']);
  assert.equal(summary.kept, 2);
  delete globalThis.confirm;
});
