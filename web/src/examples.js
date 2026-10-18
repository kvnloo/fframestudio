import { fromV0 } from './doc/project.js';
import { fileHash } from './doc/journal.js';
let database, manifest;
const requestResult = r => new Promise((ok,bad) => { r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error); });
async function db() { if (!database) { const r=indexedDB.open('fframestudio.examples',1);r.onupgradeneeded=()=>r.result.createObjectStore('copies');database=await requestResult(r); } return database; }
const get = async id => requestResult((await db()).transaction('copies').objectStore('copies').get(id));
async function put(id, body, expected) {
  const hash = expected ? await fileHash((await get(id)) || '') : null;
  if (expected && hash !== expected) return false;
  return new Promise(async (ok,bad) => {
    const tx=(await db()).transaction('copies','readwrite'), s=tx.objectStore('copies'), read=s.get(id);let conflict=false;
    read.onsuccess=()=>{ if(expected && read.result !== undefined && read.result !== lastRead.get(id)){conflict=true;return;}s.put(body,id); };
    tx.oncomplete=()=>ok(!conflict);tx.onabort=tx.onerror=()=>bad(tx.error);
  });
}
const lastRead=new Map();
export const isCopy = id => String(id).startsWith('example-copy-');
export function assetPath(value, relativeTo='/examples/manifest.json') {
  const u=new URL(value, new URL(relativeTo,location.origin));
  if(u.origin!==location.origin || !u.pathname.startsWith('/examples/') || u.search || u.hash) throw Error('Example assets must be same-origin files under /examples/');
  return u.pathname;
}
export const sourceLink = value => { try { const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:''; }catch{return '';} };
export async function listExamples() {
  if(manifest)return manifest;
  const r=await fetch('/examples/manifest.json');
  if(!r.ok)throw Error('Examples catalog could not be loaded. Reload to retry.');
  const value=await r.json();if(!Array.isArray(value))throw Error('Invalid examples manifest');
  manifest=value.filter(e=>/^[\w.-]+$/.test(e.id)).map(e=>{
    const readiness=e.readiness||'available';
    if(!['available','local-build-only','awaiting-permission'].includes(readiness))throw Error('Invalid example readiness');
    return {...e,readiness,project:readiness==='available'?assetPath(e.project):'',video:readiness==='available'?assetPath(e.video):'',poster:readiness==='available'&&e.poster?assetPath(e.poster):'',source_url:sourceLink(e.source_url)};
  });
  return manifest;
}
export async function openCopy(id) {
  const entry=(await listExamples()).find(e=>e.id===id);if(!entry)throw Error('Example not found');
  if(entry.readiness!=='available')throw Error('This example must be built and opened locally; media permission is unresolved.');
  const copyId='example-copy-'+id;
  if(!await get(copyId)) {
    const r=await fetch(entry.project);if(!r.ok)throw Error('Example project unavailable');
    const doc=fromV0(await r.json());doc.id=copyId;doc.title=entry.title+' · copy';
    // Resolve only rendering references; provenance remains text, never executable content.
    const remap = object => { if(!object || typeof object!=='object')return;for(const [key,value]of Object.entries(object)){if(['file','proxy','poster','thumb'].includes(key)&&typeof value==='string'&&value)object[key]=assetPath(value,entry.project);else if(key!=='metadata')remap(value);} };
    remap(doc);doc.preview.proxy=entry.video;if(entry.poster)doc.preview.poster=entry.poster;
    doc.metadata={...doc.metadata,example:{id:entry.id,author:entry.author,licence:entry.licence,credit:entry.credit,source_url:entry.source_url},notes:[...(doc.metadata?.notes||[]),entry.credit,`${entry.author} · ${entry.licence}`,entry.source_url].filter(Boolean)};
    await put(copyId,JSON.stringify(doc,null,2));
  }
  return copyId;
}
export async function readCopy(id) {
  const body=await get(id);if(!body)throw Error('Example copy not found. Open it from Examples first.');lastRead.set(id,body);
  return {absolute:'example:'+id,path:`projects/${id}/project.json`,content:body};
}
export async function copyRequest(id, options={}) {
  if(options.method!=='PUT')return Response.json(await readCopy(id));
  const body=String(options.body);fromV0(JSON.parse(body));
  const write=()=>put(id,body,new Headers(options.headers).get('X-FFS-Expected'));
  const ok=navigator.locks?await navigator.locks.request('ffs-example:'+id,write):await write();
  return Response.json(ok?{ok:true}:{error:'Copy changed in another tab'},{status:ok?200:409});
}
export function copyMedia(id,p) { if(!isCopy(id)||!p)return null;try{return assetPath(p);}catch{return '';} }
export async function packageCopy(document) {
  const doc=structuredClone(document), assets=new Map();
  const walk=async object=>{if(!object||typeof object!=='object')return;for(const [key,value]of Object.entries(object)){if(['file','proxy','poster','thumb'].includes(key)&&typeof value==='string'&&value){const src=assetPath(value), name=src.slice('/examples/'.length);assets.set(name,src);object[key]='media/'+name;}else if(key!=='metadata')await walk(value);}};
  await walk(doc);doc.id='my-'+doc.id.replace(/^example-copy-/,'')+'-'+crypto.randomUUID().slice(0,8);doc.title=doc.title.replace(/ · copy$/,'');
  const files=[];for(const [name,src]of assets){const r=await fetch(src);if(!r.ok)throw Error('Example asset unavailable');files.push({path:'media/'+name,blob:await r.blob()});}
  return {doc,files};
}
