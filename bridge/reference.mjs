import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
export const MAX_REFERENCE_BYTES = 60_000_000;
const helper = new URL('./analyze-reference.py', import.meta.url).pathname;
const social = /(^|\.)(youtube\.com|youtu\.be|x\.com|twitter\.com|tiktok\.com|instagram\.com)$/i;
export function directURL(value) {
  let u; try { u = new URL(value); } catch { throw Error('Enter a direct http(s) video-file URL.'); }
  if (social.test(u.hostname)) throw Error('Social pages cannot be imported or bypassed. Download it using the service’s permitted download option and import the file.');
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.hash || !/\.(mp4|webm|mov|avi)$/i.test(u.pathname)) throw Error('Only direct http(s) MP4/WebM/MOV/AVI video URLs are supported. Download the video and import the file; pages, logins and embeds are not fetched.');
  return u;
}
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127 || a === 192 || a === 198 || a === 203 || a >= 224);
  }
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:/i.test(address);
}
export async function downloadDirect(value, signal) {
  const u = directURL(value);
  const host = u.hostname.replace(/^\[|\]$/g,'');
  const addresses = isIP(host) ? [{address:host,family:isIP(host)}] : await lookup(host,{all:true});
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw Error('Direct URL import refuses private, loopback and reserved network addresses. Import a local file instead.');
  const pinned = addresses[0];
  return new Promise((resolve,reject) => {
    const req = (u.protocol === 'https:' ? https : http).get(u, {
      signal, timeout:30000,
      lookup: (_host, options, cb) => cb(null, options.all ? [pinned] : pinned.address, pinned.family),
      headers:{Accept:'video/*','User-Agent':'fframestudio-reference/1'},
    }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(Error('URL did not return a public video (redirects, authentication and pages are not followed). Download it and import the file.')); return; }
      if (!/^video\/(mp4|webm|quicktime|x-msvideo)(?:;|$)/i.test(res.headers['content-type'] || '')) { res.destroy(); reject(Error('URL Content-Type must identify a supported video, not a webpage.')); return; }
      if (Number(res.headers['content-length']) > MAX_REFERENCE_BYTES) { res.destroy(); reject(Error('Reference limit is 60 MB.')); return; }
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > MAX_REFERENCE_BYTES) res.destroy(Error('Reference limit is 60 MB.')); else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Error('Video download timed out.'))); req.on('error',reject);
  });
}
const readBody = async (req, limit = MAX_REFERENCE_BYTES) => { const chunks=[]; let size=0; for await (const c of req) { size+=c.length; if(size>limit)throw Error('Request exceeds the size cap.'); chunks.push(c); } return Buffer.concat(chunks); };
const helpers = new Set();
export function stopReferenceHelpers() { for(const child of helpers) { try { process.kill(-child.pid,'SIGTERM'); } catch {} } }
function python(args, onProgress, signal) {
  return new Promise((resolve,reject) => {
    if(signal?.aborted) { reject(Error('Local operation cancelled'));return; }
    const child = spawn('python3',[helper,...args],{stdio:['ignore','pipe','pipe'],detached:true}); let result, error='', stderr='';
    helpers.add(child);
    const abort=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}};
    signal?.addEventListener('abort',abort,{once:true});
    child.once('close',()=>{helpers.delete(child);signal?.removeEventListener('abort',abort);});
    readline.createInterface({input:child.stdout}).on('line', line => { try { const d=JSON.parse(line); if(d.error)error=d.error; else if(d.result)result=d.result; else if(d.progress)onProgress?.(d); else result=d; } catch {} });
    child.stderr.on('data', d => { stderr=(stderr+d).slice(-600); });
    child.on('error',reject); child.on('exit', code => code === 0 && result ? resolve(result) : reject(Error(error || stderr || 'Local analysis stopped.')));
  });
}
export function referenceAPI({ root, safePath, send }) {
  const jobs = new Map(); let stt, transcribing=false;
  const directory = id => { if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid reference ID'); const p=safePath('references/'+id,true); if(!p)throw Error('Unsafe reference directory'); return p; };
  const sttBackend = () => {
    if(stt)return stt;
    if(spawnSync('python3',['-c','import importlib.util; raise SystemExit(0 if importlib.util.find_spec("faster_whisper") else 1)'],{timeout:3000,stdio:'ignore'}).status===0)return stt={engine:'faster-whisper',available:true,model:null};
    const model=process.env.FFS_WHISPER_MODEL;
    for(const engine of ['whisper','whisper-cli','whisper.cpp']) {
      if(spawnSync('sh',['-c','command -v "$1"','sh',engine],{timeout:1000,stdio:'ignore'}).status===0)return stt={engine,available:!!model&&fs.existsSync(model),model};
    }
    return stt={engine:null,available:false,model:null};
  };
  return async (req,res,u) => {
    if(!u.pathname.startsWith('/reference/'))return false;
    try {
      if(u.pathname === '/reference/capabilities' && req.method === 'GET') { send(res,200,{file:true,url:true,analysis:true,stt:sttBackend().available,sttEngine:sttBackend().engine,sttNote:'faster-whisper needs a cached tiny model. Whisper CLIs need FFS_WHISPER_MODEL pointing to installed weights. No weights are downloaded.',maxBytes:MAX_REFERENCE_BYTES}); return true; }
      if(u.pathname === '/reference/import' && req.method === 'POST') {
        const inputURL = u.searchParams.get('url');
        const bytes = inputURL ? await downloadDirect(inputURL,AbortSignal.timeout(45000)) : await readBody(req);
        if(!bytes.length)throw Error('Empty reference file.');
        const id=createHash('sha256').update(bytes).digest('hex'), dir=directory(id); fs.mkdirSync(dir,{recursive:true});
        const file=safePath('references/'+id+'/source.mp4',true);if(!file)throw Error('Unsafe reference file');
        if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});
        const info=await python([file,'--probe']);
        const source=inputURL ? directURL(inputURL).origin+directURL(inputURL).pathname : 'Local file';
        send(res,200,{id,info,source,mediaPath:'references/'+id+'/source.mp4'}); return true;
      }
      if(u.pathname === '/reference/analyze' && req.method === 'POST') {
        const id=u.searchParams.get('id'), dir=directory(id), threshold=Number(u.searchParams.get('threshold')||10), minLength=Number(u.searchParams.get('minLength')||0.3);
        if(!Number.isFinite(threshold)||threshold<1||threshold>100||!Number.isFinite(minLength)||minLength<0.1||minLength>30)throw Error('Invalid threshold or minimum shot length.');
        const cache=safePath(`references/${id}/analysis-${threshold}-${minLength}-v1.json`,true);if(!cache)throw Error('Unsafe analysis cache');
        if(fs.existsSync(cache)) { send(res,200,{state:'done',result:JSON.parse(fs.readFileSync(cache,'utf8')),cached:true}); return true; }
        if([...jobs.values()].filter(j=>j.state==='running').length>=2)throw Error('Two analyses are already running. Cancel or wait.');
        // Bound retained status records; completed caches remain on disk.
        for(const [key,j] of jobs)if(j.state!=='running'&&jobs.size>20)jobs.delete(key);
        const key=randomUUID(), controller=new AbortController(), job={state:'running',progress:0,stage:'Starting local ffmpeg',controller,id}; jobs.set(key,job);
        const source=safePath(`references/${id}/source.mp4`,false);if(!source)throw Error('Unsafe source');
        const timeout=setTimeout(()=>controller.abort(),300000);
        python([source,'--out',dir,'--threshold',String(threshold),'--min-length',String(minLength)],p=>Object.assign(job,p),controller.signal).then(result=>{
          if(controller.signal.aborted)return;
          result.contentHash=id;fs.writeFileSync(cache,JSON.stringify(result),{flag:'w'});Object.assign(job,{state:'done',result,progress:1});
        }).catch(e=>Object.assign(job,{state:controller.signal.aborted?'cancelled':'error',error:controller.signal.aborted?'Analysis cancelled':e.message})).finally(()=>clearTimeout(timeout));
        send(res,202,{job:key});return true;
      }
      if(u.pathname === '/reference/job') {
        const job=jobs.get(u.searchParams.get('id'));if(!job)throw Error('Analysis job not found.');
        if(req.method==='DELETE') { job.controller.abort(); job.state='cancelled'; }
        else if(req.method!=='GET')throw Error('Unsupported method');
        const {controller,...status}=job;send(res,200,status);return true;
      }
      if(u.pathname === '/reference/media' && req.method === 'GET') {
        const id=u.searchParams.get('id');directory(id);const name=u.searchParams.get('name');
        if(!/^(source\.mp4|shot-\d+\.jpg)$/.test(name))throw Error('Invalid evidence file');
        const file=safePath(`references/${id}/${name}`,false);if(!file)throw Error('Unsafe evidence path');
        const st=fs.statSync(file);res.writeHead(200,{'Content-Type':name.endsWith('.jpg')?'image/jpeg':'video/mp4','Content-Length':st.size});fs.createReadStream(file).pipe(res);return true;
      }
      if(u.pathname === '/reference/transcribe' && req.method === 'POST') {
        const backend=sttBackend();
        if(!backend.available)throw Error('No configured local Whisper backend. Use typed direction or consent to browser speech.');
        if(transcribing)throw Error('Local transcription is busy. Type your direction or try again.');
        transcribing=true;let folder;
        try {
          const bytes=await readBody(req,4_000_000);folder=safePath('references/stt-'+randomUUID(),true);if(!folder)throw Error('Unsafe transcription directory');fs.mkdirSync(folder,{recursive:true});
          const file=path.join(folder,'recording.webm');fs.writeFileSync(file,bytes,{flag:'wx'});
          const args=[file,'--transcribe','--engine',backend.engine];if(backend.model)args.push('--model',backend.model);
          send(res,200,await python(args,null,AbortSignal.timeout(120000)));
        } finally {transcribing=false;if(folder)fs.rmSync(folder,{recursive:true,force:true});}return true;
      }
      send(res,404,{error:'Reference endpoint not found'});
    } catch(e) { send(res,400,{error:e.message}); }
    return true;
  };
}
