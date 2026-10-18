// fframestudio web app: project library + project view + ACP assistant.
// Served by the local bridge (same origin), authenticated by the cookie the /open link sets.
import { Editor, defaults } from '/app/src/editor.js';
import { ContextMenu } from '/app/src/context-menu.js';
import { initSystemTheme, receiveTheme, setThemeSettings, themeInfo, onTheme } from '/app/src/system-theme.js';
import { colourSlot } from '/app/src/studio.js';
const connectAgent=async options=>(await import('/app/dist/acp-client.js')).connectAgent(options);
import * as host from '/app/src/host.js';
import { preferences as storage } from '/app/src/host.js';
const bridgeApi=()=>({read:host.read,agents:()=>host.request('/agents').then(r=>r.json()),events:fn=>host.events(fn,receiveTheme)});

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (t) => { t = Math.max(0, +t || 0); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
const BASE = location.origin, api = bridgeApi(BASE, null);
const url = (proj, p) => host.mediaURL(proj, p, false);
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); }

async function libraryAction(action, project) {
  if (action === 'open-project') location.hash = '#/p/' + project.id;
  if (action === 'reveal-path') {
    const file = await api.read(`projects/${project.id}/project.json`);
    const doc = JSON.parse(file.content);
    const source = (doc.metadata?.source || doc.source)?.path;
    if (!source?.startsWith('/')) throw Error('Absolute source path unavailable');
    await navigator.clipboard.writeText(source);
    toast('Copied source path');
  }
}
new ContextMenu((target) => {
  if (EDITOR) return EDITOR.contextItems(target);
  if (!ME?.ok) return null;
  const card = target.closest('.card');
  if (card) {
    const project = LIB.projects.find((p) => p.id === card.dataset.project);
    if (!project) return null;
    return { label: 'Project actions', invoker: card, items: [
      { id: 'open-project', label: 'Open project', run: () => libraryAction('open-project', project) },
      { id: 'reveal-path', label: 'Reveal path · copy source', run: () => libraryAction('reveal-path', project) },
    ] };
  }
  let keys = {};
  try { keys = JSON.parse(storage.getItem('ffs.settings') || '{}').keys || {}; } catch {}
  return { label: 'Workspace actions', items: [
    ...['palette', 'settings'].map((id) => ({ id, label: id === 'palette' ? 'Command palette' : 'Workspace settings', disabled: true, shortcut: keys[id] ?? defaults[id] })),
    null, ...['undo', 'redo'].map((id) => ({ id, label: id === 'undo' ? 'Undo' : 'Redo', disabled: true, shortcut: keys[id] ?? defaults[id] })),
  ] };
}, (error) => toast(error.message));

let ME = null, AGENTS = [], LIB = null;
async function boot() {
  try { ME = await host.initializeHost(); } catch (error) { toast(error.message); }
  if (!ME?.ok) { $('#bridge').innerHTML = '<span class="dot bad"></span>not signed in'; $('#view').innerHTML = `<div class="gate"><div class="cap">fframestudio</div><h1>Open the link the bridge printed</h1>
    <p>Start the bridge with <code>npm run bridge</code> and open the <code>/open?token=…</code> link it prints (also in <code>~/.config/fframestudio/bridge.json</code>). The link sets a same-site cookie so this page can reach your projects and agents.</p></div>`; return; }
  $('#bridge').innerHTML = host.isLocal() ? 'Local · nothing uploaded' : '<span class="dot ok"></span>bridge connected';
  if(host.isRemote()){const b=document.createElement('button');b.className='pill';b.textContent='Disconnect';b.onclick=host.disconnectBridge;$('#bridge').append(b);}
  initSystemTheme();
  api.events(e=>{EDITOR?.external(e.path).catch(err=>{console.error(err.stack);toast(err.message);});if(e.path==='projects/library.json')loadLib();});
  addEventListener('hashchange',route);if(location.hash.startsWith('#/p/')){loadLib();await route();}else{await loadLib();route();}
  api.agents().then(r=>{AGENTS=r.agents;renderAssistant($('#assistant-slot'));}).catch(()=>{});
}
async function loadLib() { LIB = await host.library(); }

function route() {
  const m = location.hash.match(/^#\/p\/([\w.-]+)/);
  if (m) return showProject(m[1]);
  if(EDITOR?.dirty&&!confirm('Leave unsaved edits?')){location.hash='#/p/'+EDITOR.doc.id;return;}EDITOR?.destroy();EDITOR=null;CUR=null;$('#crumbs').innerHTML='';showLibrary();
}

/* ---------------- library ---------------- */
let TAG = '';
function applyLibraryTheme() {
  let settings = {}; try { settings = JSON.parse(storage.getItem('ffs.settings') || '{}'); } catch {}
  setThemeSettings(settings); return settings;
}
onTheme(info => {
  const select = $('#library-theme'); if (!select) return;
  for (const source of info.available) if (![...select.options].some(o=>o.value==='system:'+source)) { const option=document.createElement('option'); option.value='system:'+source; option.textContent='Follow '+source; select.append(option); }
  select.options[0].textContent = 'Follow system · ' + info.label;
  select.value = info.choice;
});
function showLibrary() {
  const ps = LIB.projects, tags = [...new Set(ps.flatMap((p) => p.tags || []))].sort();
  const shown = ps.filter((p) => !TAG || (p.tags || []).includes(TAG));
  const settings=applyLibraryTheme();
  $('#view').innerHTML = `<label class="library-theme">WORKSPACE <select id="library-theme" aria-label="Library theme">${['system','studio','paper','dark','light','contrast','custom',...themeInfo().available.map(s=>'system:'+s)].map(t=>`<option value="${t}" ${t===themeInfo().choice?'selected':''}>${t==='system'?'Follow system · '+esc(themeInfo().label):t.startsWith('system:')?'Follow '+esc(t.slice(7)):t[0].toUpperCase()+t.slice(1)}</option>`).join('')}</select></label><div class="libhead"><div><div class="cap">THE FILM LIBRARY · ${ps.length} PRODUCTIONS</div><h1>Every film, <em>one place.</em></h1></div>
    <div class="chips"><button class="pill ${!TAG ? 'on' : ''}" data-tag="">all</button>${tags.map((t) => `<button class="pill ${TAG === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
  <div class="grid">${shown.map((p,index) => `<a data-project="${esc(p.id)}" data-colour="${colourSlot(p.kind)}" class="card brk" href="#/p/${esc(p.id)}"><div class="pv">${p.poster ? `<img src="${esc(host.libraryPoster(p.poster))}" loading="lazy" alt="">` : '<div class="none">no render yet</div>'}<span class="poster-index">CUT ${String(index+1).padStart(2,'0')} / ${esc(p.kind)}</span><span class="rt">RUNTIME ${fmt(p.duration_s)}</span></div>
    <div class="tx"><div class="t">${esc(p.title)}</div><div class="m"><span class="kind-chip">${esc(p.kind)}</span><span>${p.shots} shots</span><span>${p.renders} render${p.renders === 1 ? '' : 's'}</span><span>${(p.tags || []).map(esc).join(' · ')}</span></div>
    <div class="strip">${Array.from({ length: Math.min(40, p.shots || 1) }, () => '<i></i>').join('')}</div></div></a>`).join('')}</div>`;
  if (host.isLocal()) mountFolderControls();
  if (document.querySelector('meta[name="ffs-hosted"]')) mountExamples();
  $('#library-theme').onchange=e=>{settings.theme=e.target.value;storage.setItem('ffs.settings',JSON.stringify(settings));applyLibraryTheme();};
  $$('[data-tag]').forEach((b) => (b.onclick = () => { TAG = b.dataset.tag; showLibrary(); }));
  $$('.card').forEach((card) => (card.onclick = (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    libraryAction('open-project', LIB.projects.find((p) => p.id === card.dataset.project)).catch((error) => toast(error.message));
  }));
}

function mountFolderControls() {
  const s=host.folderStatus(), section=document.createElement('section');section.className='local-library';
  section.innerHTML=`<div><span class="cap">YOUR PROJECTS</span><h2>${s.name ? esc(s.name) : 'Your next film starts here.'}</h2><p>${s.readOnly && s.count ? 'Read-only folder · edits are cached in this browser. Export project.json to keep a portable copy.' : s.permissionNeeded ? 'Reconnect your folder to grant access again.' : 'Open your projects folder. Files stay on your device; nothing is uploaded.'}</p></div><div class="folder-actions"><button class="pill on" id="open-folder">${s.permissionNeeded ? 'Reconnect folder' : 'Open a folder'}</button><label class="pill folder-fallback">Open read-only<input id="folder-files" type="file" webkitdirectory multiple aria-label="Open a folder read-only"></label></div><p class="hint">Chromium can save directly to your folder. Firefox and Safari open read-only; Save, undo and recovery stay in IndexedDB. Video export needs the local bridge.</p>`;
  $('.grid').before(section);
  $('#open-folder').onclick=async()=>{try{if(!await host.openFolder()){$('#folder-files').click();return;}await loadLib();showLibrary();}catch(error){if(error.name!=='AbortError')toast(error.message);}};
  $('#folder-files').onchange=async e=>{try{if(!e.target.files.length)return;await host.importFiles([...e.target.files]);await loadLib();showLibrary();}catch(error){toast('Folder could not be opened: '+error.message);}};
}
function mountExamples() {
  const shelf=document.createElement('section');shelf.id='examples-shelf';shelf.className='examples-shelf';
  shelf.innerHTML='<div class="cap">EXAMPLES · NOT YOUR PROJECTS</div><h2>A few films to <em>make your own.</em></h2><p>Open an example as a browser-local copy. Originals are never changed.</p><div class="examples-grid" aria-live="polite"><p>Loading examples…</p></div>';
  $('#view').append(shelf);
  const observer=new IntersectionObserver(async entries=>{
    if(!entries.some(e=>e.isIntersecting))return;observer.disconnect();
    try{
      const examples=await import('/app/src/examples.js'), list=await examples.listExamples();
      if(!shelf.isConnected)return;
      const duration=e=>{const seconds=Math.round(e.duration||0);return seconds?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'';};
      shelf.querySelector('.examples-grid').innerHTML=list.length?list.map(e=>`<article class="example-card ${e.featured?'example-featured':''}" data-example="${esc(e.id)}">${e.poster?`<img loading="lazy" src="${esc(e.poster)}" alt="${esc(e.title)} film still">`:e.featured?'<div class="example-type" aria-hidden="true">fframes<span>Original launch film</span></div>':''}<div class="tx"><div class="example-meta"><span>${esc(e.category||'Short film')}</span><span>${duration(e)}</span>${e.featured?'<span>Featured</span>':''}</div><h3>${esc(e.title)}</h3><p>${esc(e.author)} · ${esc(e.licence)}</p><p class="hint">${esc(e.credit)}</p>${e.readiness!=='available'?`<p class="example-status">${e.readiness==='awaiting-permission'?'Awaiting media permission':'Local build only'}. Build the complete film on your machine; no media is hosted here.</p><details><summary>Open locally</summary><p>From a FrameStudio checkout:</p><code class="install-command">${esc(e.localCommand||'See source for local setup')}</code><p>Then use Open a folder above to select the generated project. Rust, native build tools and a supported GPU are required.</p><a href="https://github.com/kvnloo/fframestudio/blob/main/docs/HOSTED.md#original-launch-film-local-only" target="_blank" rel="noopener noreferrer">Local setup instructions ↗</a></details>`:''}<div class="folder-actions">${e.readiness==='available'?`<button class="pill" data-open-example="${esc(e.id)}">Open a copy ↗</button>`:''}${e.source_url?`<a href="${esc(e.source_url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:''}</div></div></article>`).join(''):'<p class="hint">Examples will appear here when available.</p>';
      shelf.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.replaceWith(Object.assign(document.createElement('p'),{className:'hint',textContent:'Poster unavailable. The project can still be opened.'}));});
      shelf.querySelectorAll('[data-open-example]').forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent='Loading project…';try{location.hash='#/p/'+await examples.openCopy(b.dataset.openExample);}catch(error){b.disabled=false;b.textContent='Retry opening';toast(error.message);}});
    }catch(error){shelf.querySelector('.examples-grid').innerHTML='<p role="alert">Examples unavailable. Reload this page to retry.</p>';toast('Examples unavailable: '+error.message);}
  });observer.observe(shelf);
}
/* ---------------- project ---------------- */
let CUR=null,AG=null,EDITOR=null;
async function showProject(id){
 if(EDITOR?.doc.id===id)return;
 if(EDITOR?.dirty&&!confirm('Leave unsaved edits?')){location.hash='#/p/'+EDITOR.doc.id;return;}
 EDITOR?.destroy();AG?.session?.close();AG=null;CHAT=[];
 let j;try { j=await api.read(`projects/${id}/project.json`); }catch(error){toast(error.message);location.hash='#/';return;}
 EDITOR=new Editor($('#view'),{api,toast,onChange:d=>{CUR={...d,__abs:j.absolute};},assistant:renderAssistant});
 await EDITOR.open(j.content,j.absolute);window.ffs=EDITOR;
 if (document.querySelector('meta[name="ffs-hosted"]')) window.scrollTo({top:0,left:0,behavior:'instant'});
 $('#crumbs').innerHTML=`<a href="#/">library</a> / <span title="${esc(CUR.title)}">${esc(CUR.title)}</span>`;
}
function renderProject(){renderAssistant($('#assistant-slot'));}
function renderAssistant(slot){if(!slot)return;
 if(host.isLocal() || host.isCopy(CUR?.id)) { slot.innerHTML=`<div class="box assistant-box"><h3>Agents run on your machine.</h3><p>No agent runs on this website. Your projects stay local.</p><p><a href="https://github.com/kvnloo/fframestudio" target="_blank" rel="noopener noreferrer">Get fframestudio ↗</a></p><pre class="install-command">git clone https://github.com/kvnloo/fframestudio
cd fframestudio && npm run setup
npm run bridge</pre><p class="hint">Open the hosted link printed by your bridge to connect your own agents.</p></div>`;return; }
 slot.innerHTML=`<div class="box assistant-box"><h3>Assistant <span>ACP · reviewable proposals</span></h3><div class="agents">${AGENTS.map(a=>`<button class="pill ${AG?.id===a.id?'on':''}" data-agent="${esc(a.id)}" ${a.available?'':'disabled'}>${esc(a.name)}</button>`).join('')}</div><div class="hint" id="aghint">${AG?'Connected to '+esc(AG.name):'Choose an agent. Proposed edits stay pending until you apply them.'}</div><div class="chat" id="chat"></div><div class="compose"><textarea id="ask" placeholder="Suggest a tighter opening…"></textarea><button class="pill on" id="send">send</button></div></div>`;
 $$('[data-agent]').forEach(b=>b.onclick=()=>connect(b.dataset.agent));$('#send').onclick=sendPrompt;$('#ask').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))sendPrompt();};chatRender();
}

/* ---------------- assistant (ACP) ---------------- */
let CHAT = [], BUSY = false;
function chatRender() {
  const c = $('#chat'); if (!c) return;
  c.innerHTML = CHAT.map((m, i) => m.kind === 'you' ? `<div class="msg you">${esc(m.text)}</div>` : m.kind === 'agent' ? `<div class="msg agent">${esc(m.text)}</div>`
    : m.kind === 'tool' ? `<div class="tool ${m.status || ''}"><b>${esc(m.status === 'completed' ? '✓' : m.status === 'failed' ? '✗' : '…')}</b> ${esc(m.title)}</div>`
    : m.kind === 'perm' ? `<div class="perm">${esc(m.title)}${m.answered ? `<div class="hint">${esc(m.answered)}</div>` : `<div class="opts">${m.options.map((o) => `<button class="pill" data-perm="${i}" data-opt="${esc(o.optionId)}">${esc(o.name)}</button>`).join('')}</div>`}</div>`
    : `<div class="hint">${esc(m.text)}</div>`).join('');
  c.scrollTop = c.scrollHeight;
  $$('[data-perm]').forEach((b) => (b.onclick = () => { const m = CHAT[+b.dataset.perm]; m.answered = b.textContent; m.resolve(b.dataset.opt); chatRender(); }));
}
const push = (m) => { CHAT.push(m); chatRender(); return m; };
async function connect(id) {
  if (AG?.session) AG.session.close();
  const a = AGENTS.find((x) => x.id === id); AG = { id, name: a.name }; CHAT = []; renderProject(); push({ kind: 'note', text: `Starting ${a.name}…` });
  const tools = new Map();
  try {
    AG.session = await connectAgent({ ...host.agentOptions(), agent: id, cwd: CUR.__abs.replace(/\/project\.json$/, ''), handlers: {
      update: (n) => { const u = n.update;
        if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') { const last = CHAT.at(-1); if (last?.kind === 'agent') last.text += u.content.text; else push({ kind: 'agent', text: u.content.text }); chatRender(); }
        else if (u.sessionUpdate === 'tool_call') tools.set(u.toolCallId, push({ kind: 'tool', title: u.title || u.kind, status: u.status }));
        else if (u.sessionUpdate === 'tool_call_update') { const t = tools.get(u.toolCallId); if (t) { if (u.status) t.status = u.status; if (u.title) t.title = u.title; chatRender(); } } },
      permission: (req) => new Promise((resolve) => push({ kind: 'perm', title: `${a.name} wants to: ${req.toolCall?.title || 'run a tool'}`, options: req.options, resolve })),
      root:ME.root,
      canWrite:p=>!p.split('/').includes('..') && p.startsWith(`${ME.root}/projects/${CUR.id}/proposals/`) && /^\d+\.json$/.test(p.split('/').pop()),
      wroteFile:p=>EDITOR.external(p.startsWith(ME.root+'/')?p.slice(ME.root.length+1):p),
      closed: (why) => push({ kind: 'note', text: `${a.name} disconnected: ${why}` }),
    } });
    CHAT.at(-1).text = `${a.name} ready · ${AG.session.init.agentInfo?.name || ''} ${AG.session.init.agentInfo?.version || ''}`; chatRender();
    $('#aghint').textContent = `Connected to ${a.name}. Edits arrive as proposals for review.`;
  } catch (e) { push({ kind: 'note', text: `Could not start ${a.name}: ${e.message}` }); AG = null; }
}
async function sendPrompt() {
  const text = $('#ask').value.trim(); if (!text || BUSY) return;
  if (!AG?.session) { toast('Pick an agent first'); return; }
  $('#ask').value = ''; push({ kind: 'you', text }); BUSY = true;
  if(!(await EDITOR.save())){BUSY=false;return;}
  const proposalPath=`${ME.root}/projects/${CUR.id}/proposals/${Date.now()}.json`;
  const ctx=`You are the assistant inside fframestudio. NEVER edit project.json or source media. Read ${CUR.__abs}, schema fframestudio.project/1. Write ONLY a proposal to ${proposalPath}. Format: {"schema":"fframestudio.proposal/1","projectId":"${CUR.id}","baseRevision":${CUR.revision},"title":"short description","commands":[...]}. Commands: edit-text {clipId,field,value}, trim {clipId,duration,sourceIn?} (INTEGER FRAMES), move {clipId,index}, split {clipId,at,newId} (at is clip-local frames), duplicate {clipId,newId}, delete {clipId}, replace {clipId,mediaId}, group {clipIds,id,name}, set-beat-lock {clipId,value}, retime {clipId,speed:{num,den}}. Every command may include videoId. Text values are strings or string arrays. Existing IDs must match. New IDs must be unique. Beat-locked timing edits require explicit unlocking. Scope is this clip unless edit-style {styleId,color} explicitly changes all clips using the style. No code in JSON. The user will Inspect, Apply or Reject. Do not claim the project changed. Selection: ${EDITOR.selection}. Video: ${EDITOR.videoId}. Be brief. Request: `;
  try { const r = await AG.session.prompt(ctx + text); push({ kind: 'note', text: `turn ended: ${r.stopReason}` }); await EDITOR.external(proposalPath.slice(ME.root.length+1)); }
  catch (e) { push({ kind: 'note', text: `error: ${e.message}` }); }
  BUSY = false;
}
boot();
