// One boundary for bridge transport; folder storage is loaded only on static hosts.
let mode = 'bridge', base = '', token = null, folder, preferenceStore;
export const isLocal = () => mode === 'folder';
export const isRemote = () => !!base;
export const agentOptions = () => ({ bridge: base || location.origin, token });
export const preferences = {
  getItem: key => preferenceStore ? preferenceStore.preference(key) : localStorage.getItem(key),
  setItem: (key, value) => preferenceStore ? preferenceStore.preference(key, value) : localStorage.setItem(key, value),
};
const validBridge = value => {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error('Bridge must be a loopback HTTP URL');
  return u.origin;
};
export async function initializeHost() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('bridge')) {
    // Clear secrets before any request or route handling. Never persist the token to disk.
    history.replaceState(null, '', location.pathname + location.search);
    base = validBridge(fragment.get('bridge')); token = fragment.get('token');
    if (!token || !/^[\w.-]+$/.test(token)) throw Error('Invalid bridge token');
    sessionStorage.setItem('ffs.bridge', JSON.stringify({ base, token }));
  } else {
    const saved = sessionStorage.getItem('ffs.bridge');
    if (saved) { const v = JSON.parse(saved); base = validBridge(v.base); token = v.token; }
  }
  const hosted = !!document.querySelector('meta[name="ffs-hosted"]');
  if (hosted) { preferenceStore=await import('./folder-host.js'); await preferenceStore.initializePreferences(); }
  if (base || !hosted) {
    try { const me = await request('/me').then(r => r.json()); if (typeof me.ok === 'boolean') return me; } catch (error) { if (base) throw Error('Cannot connect to the local bridge. Start it and open its hosted link again. ' + error.message); }
  }
  mode = 'folder';
  folder = await import('./folder-host.js');
  await folder.initialize(); preferenceStore=folder;
  return { ok: true, root: 'local-folder' };
}
export function request(url, options) {
  const copy = /^\/fs\?path=/.test(url) && /^projects\/(example-copy-[\w.-]+)\/project\.json$/.exec(new URL(url, location.origin).searchParams.get('path'));
  if (copy) return import('./examples.js').then(m => m.copyRequest(copy[1], options));
  if (url.startsWith('/examples/')) return fetch(url, options);
  if (folder) return folder.request(url, options);
  if (!base || /^(blob:|data:)/.test(url)) return fetch(url, options);
  const headers = new Headers(options?.headers); headers.set('Authorization', 'Bearer ' + token);
  return fetch(base + url, { ...options, headers, credentials: 'omit' });
}
export function mediaURL(project, p, encoded = true) {
  if (!p) return '';
  if (isCopy(project)) { try { const u=new URL(p,location.origin); return u.origin===location.origin && u.pathname.startsWith('/examples/') ? u.pathname : ''; } catch { return ''; } }
  if (folder) return folder.mediaURL(project, p);
  const url = p.startsWith('/') ? `/file?path=${encodeURIComponent(p)}` : `/lib/${encoded ? encodeURIComponent(project) : project}/${encoded ? p.split('/').map(encodeURIComponent).join('/') : p}`;
  return base ? remoteMedia.get(url) || '' : url;
}
const remoteMedia = new Map();
export function libraryPoster(p) { return folder ? folder.mediaURL('', p) : base ? remoteMedia.get('/lib/' + p) || '' : '/lib/' + p; }
export async function library() {
  const lib = await request('/lib/library.json').then(r => r.ok ? r.json() : { projects: [] });
  if (base) await Promise.all(lib.projects.filter(p => p.poster).map(p => cacheMedia('/lib/' + p.poster)));
  return lib;
}
async function cacheMedia(url) {
  if (remoteMedia.has(url)) return;
  const r = await request(url); if (r.ok) remoteMedia.set(url, URL.createObjectURL(await r.blob()));
}
export async function read(p) {
  const r = await request('/fs?path=' + encodeURIComponent(p));
  if (!r.ok) throw Error('Read failed: ' + r.status);
  const file = await r.json();
  if (base && !isCopy(p.split('/')[1]) && p.endsWith('/project.json')) {
    const doc = JSON.parse(file.content), id = p.split('/')[1], files = new Set();
    const walk = value => { if (!value || typeof value !== 'object') return; for (const [key, v] of Object.entries(value)) { if (['file', 'proxy', 'poster', 'thumb'].includes(key) && typeof v === 'string' && v) files.add(v); else if (key !== 'metadata' && key !== 'source' && key !== 'docs') walk(v); } };
    walk(doc);
    await Promise.all([...files].map(f => cacheMedia(f.startsWith('/') ? '/file?path=' + encodeURIComponent(f) : '/lib/' + encodeURIComponent(id) + '/' + f.split('/').map(encodeURIComponent).join('/'))));
  }
  return file;
}
export function events(onEvent, onTheme) {
  if (folder) return () => {};
  if (!base) {
    const es = new EventSource('/events');
    es.addEventListener('theme', e => onTheme(JSON.parse(e.data)));
    es.onmessage = e => onEvent(JSON.parse(e.data)); return () => es.close();
  }
  // Fetch streaming carries the bearer header without putting credentials in a URL.
  const controller = new AbortController();
  request('/events', { signal: controller.signal }).then(async r => {
    if (!r.ok) return;
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader(); let buffer = '';
    while (!controller.signal.aborted) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += value; let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
        if (data) (block.startsWith('event: theme') ? onTheme : onEvent)(JSON.parse(data));
      }
    }
  }).catch(() => {});
  return () => controller.abort();
}
export const openFolder = () => folder.openFolder();
export const importFiles = files => folder.importFiles(files);
export const folderStatus = () => folder?.status();
export const isCopy = id => String(id).startsWith('example-copy-');
export const exportProject = async (id, body) => (folder || await import('./folder-host.js')).exportProject(id, body);
export async function saveCopy(document) {
  const {doc,files}=await (await import('./examples.js')).packageCopy(document);
  if(folder) { await folder.saveCopy(doc,files); return doc.id; }
  const { fileHash }=await import('./doc/journal.js');
  const write=async(p,body,type,expected)=>{const r=await request('/fs?path='+encodeURIComponent(p),{method:'PUT',headers:{'Content-Type':type,...(expected?{'X-FFS-Expected':expected}:{})},body});if(!r.ok)throw Error('Copy save failed: '+r.status);};
  for(const f of files)await write('projects/'+doc.id+'/'+f.path,f.blob,'application/octet-stream');
  const body=JSON.stringify(doc,null,2);await write('projects/'+doc.id+'/project.json',body,'application/json');
  const check=await read('projects/'+doc.id+'/project.json');if(check.content!==body)throw Error('Copy readback failed');
  const lib=await request('/fs?path=projects%2Flibrary.json').then(r=>r.ok?r.json():{content:'',path:'projects/library.json'});
  const data=lib.content?JSON.parse(lib.content):{projects:[]};data.projects.push({id:doc.id,title:doc.title,kind:'example copy',shots:doc.videos[0].clips.length,renders:1,duration_s:doc.videos[0].clips.reduce((n,c)=>n+c.duration,0)*doc.fps.den/doc.fps.num,tags:['local']});
  await write('projects/library.json',JSON.stringify(data,null,2),'application/json',await fileHash(lib.content));
  return doc.id;
}
export async function disconnectBridge() { sessionStorage.removeItem('ffs.bridge'); location.href = location.pathname; }
