// Visitor-owned files only. No upload, telemetry, remote catalogue or runtime dependency.
import { fromV0 } from './doc/project.js';
import { fileHash } from './doc/journal.js';
let db, state = {}, entries = new Map(), projects = [], urls = new Map(), prefs = {}, permissionNeeded = false;
const req = r => new Promise((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
function transaction(mode, fn) {
  return new Promise((ok, bad) => {
    const tx = db.transaction('local', mode); const result = fn(tx.objectStore('local'));
    tx.oncomplete = () => ok(result); tx.onabort = tx.onerror = () => bad(tx.error || Error('Local storage failed'));
  });
}
const get = key => req(db.transaction('local').objectStore('local').get(key));
const put = (key, value) => transaction('readwrite', s => s.put(value, key));
const safe = p => { const parts = p.split('/'); if (!p || p.startsWith('/') || parts.some(x => !x || x === '..' || x === '.')) throw Error('Media must be inside the selected folder'); return parts; };
export async function initializePreferences() {
  if (!db) { const r = indexedDB.open('fframestudio.local', 1); r.onupgradeneeded = () => r.result.createObjectStore('local'); db = await req(r); }
  prefs = await get('preferences') || {};
}
export async function initialize() {
  await initializePreferences();
  state = await get('folder') || {};
  clearURLs(); entries = new Map(); projects = []; permissionNeeded = false;
  if (state.handle) {
    permissionNeeded = !!state.handle.queryPermission && await state.handle.queryPermission({ mode: 'readwrite' }) !== 'granted';
    if (!permissionNeeded) await scanHandle();
    else await discover();
  } else if (state.files) { entries = new Map(state.files); await discover(); }
  else await discover();
}
export function preference(key, value) {
  if (value === undefined) return prefs[key] ?? null;
  prefs[key] = value; put('preferences', prefs).catch(error => alert('Preferences were not saved: ' + error.message));
}
export const status = () => ({ name: state.name, readOnly: !state.handle, permissionNeeded, count: projects.length });
export async function openFolder() {
  if (!window.showDirectoryPicker) return false;
  const handle = state.handle && permissionNeeded ? state.handle : await window.showDirectoryPicker({ mode: 'readwrite', id: 'fframestudio-projects' });
  if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw Error('Folder permission was not granted');
  await adoptDirectory(handle, state.handle === handle ? state.scope : undefined); return true;
}
export async function adoptDirectory(handle, scope=crypto.randomUUID()) {
  if(handle.kind!=='directory')throw Error('A directory handle is required');
  state={handle,name:handle.name,scope};await scanHandle();await put('folder',state);
}
function clearURLs() { for (const u of urls.values()) URL.revokeObjectURL(u); urls = new Map(); }
async function scanHandle() {
  clearURLs(); entries = new Map(); permissionNeeded = false;
  let root = state.handle;
  try { root = await root.getDirectoryHandle('projects'); } catch {}
  const walk = async (dir, prefix = '') => { for await (const [name, h] of dir.entries()) { if (name.startsWith('.') || name.includes('.ffs-')) continue; const p = prefix + name; if (h.kind === 'directory') await walk(h, p + '/'); else entries.set(p, h); } };
  await walk(root); state.root = root;
  const imported=await get('import:'+state.scope);if(imported&&!entries.has('project.json'))entries.set('project.json',new File([imported],'project.json',{type:'application/json'}));
  await discover();
}
export async function importFiles(files) {
  clearURLs(); entries = new Map(); permissionNeeded = false;
  for (const file of files) { const rel = file.webkitRelativePath || file.name; const p = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel; safe(p); entries.set(p, file); }
  if([...entries.keys()].some(p=>/^projects\/[^/]+\/project\.json$/.test(p)))entries=new Map([...entries].filter(([p])=>p.startsWith('projects/')).map(([p,f])=>[p.slice(9),f]));
  state = { name: files[0]?.webkitRelativePath.split('/')[0] || 'Selected files', scope: crypto.randomUUID(), files: [...entries] };
  await discover(); state.files = [...entries]; await put('folder', state);
}
const fileOf = item => item?.kind === 'file' ? item.getFile() : Promise.resolve(item);
async function content(p) { const item = entries.get(p); if (!item) throw Error('File is not in this folder: ' + p); return (await fileOf(item)).text(); }
async function discover() {
  projects = [];
  // Additive browser imports never replace the visitor's open folder.
  for (const saved of await get('browser-projects') || []) {
    for (const [p, file] of saved.files) entries.set(p, file);
  }
  for (const [p] of entries) {
    if (!/(^|\/)project\.json$/.test(p) || p.split('/').length > 2) continue;
    try {
      const raw = await content(p), doc = fromV0(JSON.parse(raw)), prefix = p.slice(0, -'project.json'.length);
      if (!/^[\w.-]+$/.test(doc.id) || projects.some(v => v.id === doc.id)) continue;
      projects.push({ id: doc.id, title: doc.title, kind: doc.metadata?.kind || 'local film', shots: doc.videos[0].clips.length, renders: doc.preview.proxy ? 1 : 0, duration_s: doc.videos[0].clips.reduce((n,c) => n+c.duration, 0) * doc.fps.den / doc.fps.num, tags: ['local'], path: p, prefix });
    } catch { /* Unrelated JSON is not a project. Never execute imported project content. */ }
  }
  if (!projects.length && entries.has('timeline.txt')) {
    const video = [...entries.keys()].find(p => !p.includes('/') && /\.(mp4|webm|mov)$/i.test(p));
    if (video && confirm('Import this fframes timeline and master video? Original media stays untouched.')) await importTimeline(video);
  }
}
async function importTimeline(video) {
  const timeline = await content('timeline.txt'), header = timeline.match(/(\d+)x(\d+)\s*@\s*([\d.]+)\s*fps/);
  if (!header) throw Error('Unsupported timeline header');
  const shots = [...timeline.matchAll(/^#(\d+)\s+(.+?)\s+frames\s+(\d+)\.\.(\d+)\s+([\d.]+)s\.\.([\d.]+)s/gm)].map((m,i) => ({ id:'shot-'+i, name:m[2].trim(), t0:Number(m[3])/Number(header[3]), t1:Number(m[4])/Number(header[3]), text:{ title:m[2].trim() }, type:['S','H','M','R','T'][i%5] }));
  if (!shots.length) throw Error('No supported shots in timeline.txt');
  const doc = { schema:'fframestudio.project/0', id:'local-film', title:state.name, kind:'fframes-timeline', canvas:{ width:+header[1], height:+header[2], fps:+header[3] }, shots, media:{ proxy:video }, source:{ kind:'local-folder' }, notes:['Imported in this browser from timeline.txt and the master video. Original media unchanged.'] };
  const body = JSON.stringify(doc, null, 2); entries.set('project.json', new File([body], 'project.json', {type:'application/json'}));
  await put('import:'+state.scope, body);
  projects = [{ id:doc.id, title:doc.title, kind:doc.kind, shots:shots.length, renders:1, duration_s:shots.at(-1).t1, tags:['local'], path:'project.json', prefix:'' }];
}
export function mediaURL(id, p) {
  try {
    safe(p); const project = projects.find(x => x.id === id), key = (project?.prefix || '') + p;
    return urls.get(key) || '';
  } catch { return ''; }
}
async function prepareMedia(project) {
  for (const [key, item] of entries) {
    if (!key.startsWith(project.prefix) || urls.has(key) || !/\.(mp4|webm|mov|png|jpe?g|webp|svg|mp3|wav|ogg|m4a)$/i.test(key)) continue;
    urls.set(key, URL.createObjectURL(await fileOf(item)));
  }
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers:{'Content-Type':'application/json'} });
export async function request(url, options = {}) {
  if (/^(blob:|data:)/.test(url)) return fetch(url, options);
  const u = new URL(url, location.origin);
  if (u.pathname === '/theme') return response({ palette:null, source:null, available:[] });
  if (u.pathname === '/agents') return response({ agents:[] });
  if (u.pathname === '/lib/library.json') return response({ projects });
  if (u.pathname !== '/fs') return response({ error:'Not available in folder mode' }, 404);
  const p = u.searchParams.get('path'), match = /^projects\/([\w.-]+)\/project\.json$/.exec(p), project = projects.find(x => x.id === match?.[1]);
  if (!project) return response({ error:'Not in this folder' }, 404);
  const key = state.scope + ':' + project.path;
  const current = async () => await get('edit:'+key) ?? (project.path === 'project.json' ? await get('import:'+state.scope) : undefined) ?? await content(project.path);
  if (options.method === 'PUT') {
    const save = async () => {
      const old = await current(), expected = new Headers(options.headers).get('X-FFS-Expected');
      if (expected && await fileHash(old) !== expected) return response({ error:'File changed since load' }, 409);
      const body = String(options.body); fromV0(JSON.parse(body));
      if (state.handle && !(await get('browser-projects') || []).some(p=>p.id===project.id)) {
        const parts = safe(project.path); let dir = state.root;
        for (const part of parts.slice(0,-1)) dir = await dir.getDirectoryHandle(part);
        const name = parts.at(-1), tempName = name + '.ffs-' + crypto.randomUUID();
        const temp = await dir.getFileHandle(tempName, {create:true});
        try {
          const stream = await temp.createWritable(); await stream.write(body); await stream.close();
          if (await current() !== old) return response({ error:'File changed during save' }, 409);
          if (typeof temp.move === 'function') {
            try { await temp.move(name); } catch (error) { if (!['NotSupportedError','InvalidModificationError'].includes(error.name)) throw error; const target = await dir.getFileHandle(name,{create:true}); const out = await target.createWritable(); await out.write(body); await out.close(); }
          } else { const target = await dir.getFileHandle(name,{create:true}); const out = await target.createWritable(); await out.write(body); await out.close(); }
          entries.set(project.path, await dir.getFileHandle(name));
          await transaction('readwrite', s => { s.delete('edit:'+key); s.delete('import:'+state.scope); });
        } finally { await dir.removeEntry(tempName).catch(() => {}); }
      } else {
        // Compare again inside the committing transaction to protect other tabs.
        let conflict = false;
        await new Promise((ok,bad) => { const tx = db.transaction('local','readwrite'), store=tx.objectStore('local'), r=store.get('edit:'+key); r.onsuccess=()=>{ if (r.result !== undefined && r.result !== old) { conflict=true; return; } store.put(body,'edit:'+key); }; tx.oncomplete=ok; tx.onabort=tx.onerror=()=>bad(tx.error); });
        if (conflict) return response({error:'File changed since load'},409);
      }
      return response({ok:true});
    };
    return navigator.locks ? navigator.locks.request('ffs-save:'+key, save) : save();
  }
  await prepareMedia(project);
  return response({ path:p, absolute:'folder:'+key, content:await current() });
}
export async function saveCopy(doc, files) {
  if (!window.showDirectoryPicker && !state.handle) throw Error('Saving to a folder needs Chromium. Use Export project.json in this browser.');
  if (!state.handle || await state.handle.queryPermission({mode:'readwrite'}) !== 'granted') {
    const handle=await window.showDirectoryPicker({mode:'readwrite',id:'fframestudio-projects'});
    if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder permission not granted');
    state={handle,name:handle.name,scope:crypto.randomUUID()};await scanHandle();await put('folder',state);
  }
  const dir=await state.root.getDirectoryHandle(doc.id,{create:true});
  const write=async(p,body)=>{const parts=safe(p);let target=dir;for(const name of parts.slice(0,-1))target=await target.getDirectoryHandle(name,{create:true});const h=await target.getFileHandle(parts.at(-1),{create:true});const w=await h.createWritable();await w.write(body);await w.close();};
  for(const f of files)await write(f.path,f.blob);
  const body=JSON.stringify(doc,null,2);await write('project.json',body);
  const saved=await (await dir.getFileHandle('project.json')).getFile();if(await saved.text()!==body)throw Error('Saved copy readback failed');
  await scanHandle();
}
export async function createBrowserProject(doc, files) {
  fromV0(doc);
  const saved=await get('browser-projects') || [], prefix=doc.id+'/';
  if(saved.some(p=>p.id===doc.id))throw Error('Project ID already exists');
  const body=JSON.stringify(doc,null,2);
  const items=[[prefix+'project.json',new File([body],'project.json',{type:'application/json'})],...files.map(f=>[prefix+safe(f.path).join('/'),new File([f.blob],f.path,{type:f.blob.type})])];
  saved.push({id:doc.id,files:items});await put('browser-projects',saved);
  for(const [p,file] of items)entries.set(p,file);
  await discover();
  if(await content(prefix+'project.json')!==body)throw Error('Browser project readback failed');
  return doc.id;
}
export function exportProject(id, body) {
  const url=URL.createObjectURL(new Blob([body],{type:'application/json'})), a=document.createElement('a');
  a.href=url; a.download=id+'-project.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);
}
