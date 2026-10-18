import { request, isLocal, createProject } from './host.js';
import { recreateReference, unanalysedReference } from './recreate.js';
import { fpsOf, textOf } from './doc/project.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class ReferenceDesk {
  constructor(editor = null) {
    this.editor=editor;this.urls=[];
    this.panel=document.createElement('dialog');this.panel.id='reference-desk';this.panel.className='reference-desk';
    this.panel.innerHTML=`<header><h2>Reference desk</h2><button id="reference-close">Close</button></header><p>Import → Analyze → Recreate → Refine. Local processing; no reference is sent to an AI provider.</p><label>Import a video file (60 MB / ten minutes)<input id="reference-file" type="file" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"></label><form id="reference-url-form"><label>Direct video URL<input id="reference-url" type="url" placeholder="https://…/reference.mp4"></label><button>Import URL via local bridge</button></form><p class="hint">Social links (X, YouTube, TikTok): download it using the service’s permitted option and import the file. No pages, private links or authentication bypass.</p><output id="reference-status" role="status">Choose a file. URL import and analysis require your local bridge.</output><div class="reference-comparison"><figure><figcaption>Original reference</figcaption><video id="reference-original" controls playsinline muted></video></figure><figure id="reference-reconstruction" hidden><figcaption>Editable approximation · source-linked shots / look tokens</figcaption><div class="reference-rebuilt"><video playsinline muted></video><span></span></div></figure></div><label id="reference-scrub-label" hidden>Synced project scrubber<input id="reference-scrub" type="range" min="0" value="0" step="1"></label><div class="reference-stage"><label>scdet threshold<input id="reference-threshold" type="number" min="1" max="100" value="10"></label><label>Minimum shot (s)<input id="reference-min" type="number" min="0.1" max="30" step="0.1" value="0.3"></label><button id="reference-analyze" disabled>Analyze locally</button><button id="reference-cancel" hidden>Cancel analysis</button><button id="reference-recreate" disabled>Recreate editable approximation</button></div><progress id="reference-progress" max="1" value="0" hidden></progress><section id="reference-breakdown" aria-label="Timestamped breakdown"></section>`;
    document.body.append(this.panel);
    const q=s=>this.panel.querySelector(s);this.q=q;this.status=q('#reference-status');this.original=q('#reference-original');
    q('#reference-close').onclick=()=>{this.original.pause();this.panel.close();};
    q('#reference-file').onchange=e=>this.importFile(e.target.files[0]).catch(e=>this.error(e));
    q('#reference-url-form').onsubmit=e=>{e.preventDefault();this.importURL(q('#reference-url').value).catch(e=>this.error(e));};
    q('#reference-analyze').onclick=()=>this.analyze().catch(e=>this.error(e));
    q('#reference-cancel').onclick=()=>this.cancel().catch(e=>this.error(e));
    q('#reference-recreate').onclick=()=>this.recreate().catch(e=>this.error(e));
    q('#reference-scrub').oninput=e=>{if(this.editor)this.editor.seek(+e.target.value);this.sync(+e.target.value);};
  }
  open() { this.panel.classList.remove('reference-comparing');if(!this.panel.open)this.panel.showModal(); }
  error(e) { this.status.textContent=e.message; }
  async json(url, options) { const r=await request(url,options); const d=await r.json();if(!r.ok)throw Error(d.error || 'Reference operation failed');return d; }
  async blob(url) { const r=await request(url);if(!r.ok)throw Error('Evidence unavailable');return r.blob(); }
  objectURL(blob) { const url=URL.createObjectURL(blob);this.urls.push(url);return url; }
  async reset() { await this.cancel();this.analysis=null;this.q('#reference-breakdown').replaceChildren();this.q('#reference-recreate').disabled=true;this.q('#reference-analyze').disabled=true;this.ref=null; }
  async importFile(file) {
    if(!file)return;
    if(file.size>60_000_000)throw Error('Reference limit is 60 MB.');
    await this.reset();this.status.textContent='Importing local file…';this.file=file;
    if(isLocal()) {
      if(!/^video\//.test(file.type))throw Error('Choose a video file, not a page or playlist.');
      this.original.src=this.objectURL(file);
      await new Promise((ok,bad)=>{this.original.onloadedmetadata=ok;this.original.onerror=()=>bad(Error('This browser cannot decode that video. Try MP4 or WebM.'));});
      const duration=this.original.duration;if(!Number.isFinite(duration)||duration<=0||duration>600)throw Error('Reference limit is ten minutes.');
      const info={fps:{num:30,den:1},duration,frames:Math.round(duration*30),width:this.original.videoWidth,height:this.original.videoHeight};
      const id='reference-'+crypto.randomUUID();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const doc=unanalysedReference(info,{id,title:file.name,source:'Local file · '+file.name,contentHash:hash});
      await createProject(doc,[{path:'source.mp4',blob:file}]);
      dispatchEvent(new Event('ffs-library-updated'));
      this.status.textContent='Imported into this browser’s library · frame rate assumed 30 fps. Analysis and URL fetching require your local bridge; no URL will be fetched by this hosted page.';
      this.localProject=id;return;
    }
    this.ref=await this.json('/reference/import',{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream'}});
    this.ref.source='Local file · '+file.name;this.original.src=this.objectURL(file);this.ready();
  }
  async importURL(url) {
    if(/(?:youtube\.com|youtu\.be|x\.com|twitter\.com|tiktok\.com)/i.test(url))throw Error('Social links cannot be fetched. Download it using the service’s permitted option and import the file.');
    if(isLocal())throw Error('URL import requires your local bridge. This hosted page does not fetch remote videos or arbitrary webpages. Download it and import the file.');
    await this.reset();this.status.textContent='Downloading direct public video via your local bridge…';
    this.ref=await this.json('/reference/import?url='+encodeURIComponent(url),{method:'POST'});
    this.file=await this.blob('/reference/media?id='+this.ref.id+'&name=source.mp4');this.original.src=this.objectURL(this.file);this.ready();
  }
  ready() { this.status.textContent='Reference ready · '+this.ref.info.duration.toFixed(2)+' s · local ffmpeg analysis';this.q('#reference-analyze').disabled=false; }
  async analyze() {
    if(!this.ref)return;this.q('#reference-analyze').disabled=true;this.q('#reference-cancel').hidden=false;this.q('#reference-progress').hidden=false;
    const epoch=this.epoch=(this.epoch||0)+1;
    try {
      let d=await this.json('/reference/analyze?id='+this.ref.id+'&threshold='+encodeURIComponent(this.q('#reference-threshold').value)+'&minLength='+encodeURIComponent(this.q('#reference-min').value),{method:'POST'});
      this.job=d.job;
      while(d.state!=='done') {
        if(epoch!==this.epoch||this.dead)return;
        if(['error','cancelled'].includes(d.state))throw Error(d.error||'Analysis cancelled');
        this.status.textContent=d.stage||'Analyzing with local ffmpeg…';this.q('#reference-progress').value=d.progress||0;
        await new Promise(r=>setTimeout(r,250));if(epoch!==this.epoch||this.dead)return;
        d=await this.json('/reference/job?id='+this.job);
      }
      if(epoch!==this.epoch||this.dead)return;
      this.analysis=d.result;this.status.textContent=(d.cached?'Cached analysis':'Analysis complete')+' · detected candidates, not ground truth';
      this.q('#reference-progress').value=1;await this.breakdown();this.q('#reference-recreate').disabled=false;
    } finally {this.q('#reference-cancel').hidden=true;this.q('#reference-analyze').disabled=false;}
  }
  async cancel() { this.epoch=(this.epoch||0)+1;if(this.job){const id=this.job;this.job=null;await this.json('/reference/job?id='+id,{method:'DELETE'});this.status.textContent='Analysis cancelled';} }
  async breakdown() {
    const a=this.analysis, host=this.q('#reference-breakdown');
    host.innerHTML=`<h3>Detected shots · ${a.shots.length} · mean ${a.pace.meanShotSeconds.toFixed(2)} s</h3><p>${a.audio?'Audio: measured RMS loudness + onset candidates':'No audio track detected'}</p><p class="hint">${a.limitations.map(esc).join(' ')}</p><div class="reference-shots"></div>`;
    for(const shot of a.shots) {
      const row=document.createElement('button');row.className='reference-shot';row.dataset.referenceShot=shot.index;
      row.innerHTML=`<img alt="Evidence midpoint for detected shot ${shot.index}"><span><b>${shot.index} · ${shot.start.toFixed(2)}–${shot.end.toFixed(2)} s</b><br>${shot.duration.toFixed(2)} s${shot.audio ? ' · RMS '+shot.audio.rmsDb+' dBFS' : ''} · detected · confidence ${shot.confidence===null?'n/a (opening)':shot.confidence}<br>${shot.palette.map(p=>`<i style="background:${esc(p.color)}" title="${esc(p.color)}"></i>`).join('')}</span>`;
      row.querySelector('img').src=this.objectURL(await this.blob('/reference/media?id='+this.ref.id+'&name='+shot.keyframe));
      row.onclick=()=>{this.original.currentTime=shot.start;this.editor?.seek(shot.startFrame);};host.querySelector('.reference-shots').append(row);
    }
    if(a.audio) { const p=document.createElement('p');p.textContent=a.audio.method+' · onset candidates (s): '+a.audio.onsets.slice(0,30).join(', ');host.append(p); }
  }
  async recreate() {
    const id='recreated-'+crypto.randomUUID(),doc=recreateReference(this.analysis,{id,source:this.ref.source});
    const files=[{path:'source.mp4',blob:this.file}];
    await createProject(doc,files);this.status.textContent='Saved editable approximation · opening project';
    this.panel.close();location.hash='#/p/'+id;
  }
  async compareProject() {
    const e=this.editor, r=e.doc.metadata?.reference;if(!r)return;
    this.open();this.panel.classList.add('reference-comparing');this.q('#reference-reconstruction').hidden=false;this.q('#reference-scrub-label').hidden=false;
    this.original.controls=false;this.panel.scrollTop=0;
    this.original.src=e.url(e.doc.preview.proxy);this.q('.reference-rebuilt video').src=this.original.src;
    this.status.textContent='Approximation · synchronized project time. Left is the unedited original; right follows editable clip source ranges and title/look tokens. Not a synthesized remake.';
    this.sync();
  }
  sync(frame=this.editor?.frame) {
    if(!this.editor || !this.panel.open || this.q('#reference-reconstruction').hidden)return;
    const e=this.editor,c=e.video.clips.find(c=>frame>=c.start&&frame<c.start+c.duration),fps=fpsOf(e.doc);if(!c)return;
    this.q('#reference-scrub').max=e.total-1;this.q('#reference-scrub').value=Math.floor(frame);
    const originalTime=frame/fps, rebuiltTime=(c.sourceIn+(frame-c.start)*c.speed.num/c.speed.den)/fps;
    if(Math.abs(this.original.currentTime-originalTime)>0.05)this.original.currentTime=originalTime;
    const v=this.q('.reference-rebuilt video');if(Math.abs(v.currentTime-rebuiltTime)>0.05)v.currentTime=rebuiltTime;
    const text=this.q('.reference-rebuilt span');text.textContent=Object.values(textOf(c)).flat().join(' ');text.style.color=e.video.styles[c.styleId]?.color||'';
  }
  destroy() {this.dead=true;this.cancel().catch(()=>{});this.original.pause();this.q('.reference-rebuilt video').pause();this.panel.remove();for(const u of this.urls)URL.revokeObjectURL(u);}
}
