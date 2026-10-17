// fframestudio web app: project library + project view + ACP assistant.
// Served by the local bridge (same origin), authenticated by the cookie the /open link sets.
import { Editor, defaults } from '/app/src/editor.js';
import { ContextMenu } from '/app/src/context-menu.js';
import { initSystemTheme, receiveTheme } from '/app/src/system-theme.js';
const connectAgent=async options=>(await import('/app/dist/acp-client.js')).connectAgent(options);
const bridgeApi=()=>({read:async p=>{const r=await fetch('/fs?path='+encodeURIComponent(p));if(!r.ok)throw Error('Read failed: '+r.status);return r.json();},agents:async()=>{const r=await fetch('/agents');return r.json();},events:fn=>{const es=new EventSource('/events');es.addEventListener('theme',e=>receiveTheme(JSON.parse(e.data)));es.onmessage=e=>fn(JSON.parse(e.data));return ()=>es.close();}});

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (t) => { t = Math.max(0, +t || 0); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
const BASE = location.origin, api = bridgeApi(BASE, null);
const url = (proj, p) => (!p ? '' : p.startsWith('/') ? `/file?path=${encodeURIComponent(p)}` : `/lib/${proj}/${p}`);
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
    return { label: 'Project actions', invoker: card, items: [
      { id: 'open-project', label: 'Open project', run: () => libraryAction('open-project', project) },
      { id: 'reveal-path', label: 'Reveal path · copy source', run: () => libraryAction('reveal-path', project) },
    ] };
  }
  let keys = {};
  try { keys = JSON.parse(localStorage.getItem('ffs.settings') || '{}').keys || {}; } catch {}
  return { label: 'Workspace actions', items: [
    ...['palette', 'settings'].map((id) => ({ id, label: id === 'palette' ? 'Command palette' : 'Workspace settings', disabled: true, shortcut: keys[id] ?? defaults[id] })),
    null, ...['undo', 'redo'].map((id) => ({ id, label: id === 'undo' ? 'Undo' : 'Redo', disabled: true, shortcut: keys[id] ?? defaults[id] })),
  ] };
}, (error) => toast(error.message));

let ME = null, AGENTS = [], LIB = null;
async function boot() {
  try { ME = await fetch('/me').then((r) => r.json()); } catch {}
  if (!ME?.ok) { $('#bridge').innerHTML = '<span class="dot bad"></span>not signed in'; $('#view').innerHTML = `<div class="gate"><div class="cap">fframestudio</div><h1>Open the link the bridge printed</h1>
    <p>Start the bridge with <code>npm run bridge</code> and open the <code>/open?token=…</code> link it prints (also in <code>~/.config/fframestudio/bridge.json</code>). The link sets a same-site cookie so this page can reach your projects and agents.</p></div>`; return; }
  $('#bridge').innerHTML='<span class="dot ok"></span>bridge connected';
  initSystemTheme(); // One small fetch in parallel with agents, library and project loading.
  api.agents().then(r=>{AGENTS=r.agents;renderAssistant($('#assistant-slot'));}).catch(()=>{});
  api.events(e=>{EDITOR?.external(e.path).catch(err=>{console.error(err.stack);toast(err.message);});if(e.path==='projects/library.json')loadLib();});
  addEventListener('hashchange',route);if(location.hash.startsWith('#/p/')){loadLib();route();}else{await loadLib();route();}
}
async function loadLib() { LIB = await fetch('/lib/library.json').then((r) => (r.ok ? r.json() : { projects: [] })); }

function route() {
  const m = location.hash.match(/^#\/p\/([\w.-]+)/);
  if (m) return showProject(m[1]);
  if(EDITOR?.dirty&&!confirm('Leave unsaved edits?')){location.hash='#/p/'+EDITOR.doc.id;return;}EDITOR?.destroy();EDITOR=null;CUR=null;$('#crumbs').innerHTML='';showLibrary();
}

/* ---------------- library ---------------- */
let TAG = '';
function showLibrary() {
  const ps = LIB.projects, tags = [...new Set(ps.flatMap((p) => p.tags || []))].sort();
  const shown = ps.filter((p) => !TAG || (p.tags || []).includes(TAG));
  $('#view').innerHTML = `<div class="libhead"><div><div class="cap">library · ${ps.length} projects</div><h1>Every film, <em>one place.</em></h1></div>
    <div class="chips"><button class="pill ${!TAG ? 'on' : ''}" data-tag="">all</button>${tags.map((t) => `<button class="pill ${TAG === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
  <div class="grid">${shown.map((p) => `<a class="card brk" data-project="${esc(p.id)}" href="#/p/${esc(p.id)}"><div class="pv">${p.poster ? `<img src="/lib/${esc(p.poster)}" loading="lazy" alt="">` : '<div class="none">no render yet</div>'}<span class="rt">${fmt(p.duration_s)}</span></div>
    <div class="tx"><div class="t">${esc(p.title)}</div><div class="m"><span>${esc(p.kind)}</span><span>${p.shots} shots</span><span>${p.renders} render${p.renders === 1 ? '' : 's'}</span><span>${(p.tags || []).map(esc).join(' · ')}</span></div>
    <div class="strip">${Array.from({ length: Math.min(40, p.shots || 1) }, () => '<i></i>').join('')}</div></div></a>`).join('')}</div>`;
  $$('[data-tag]').forEach((b) => (b.onclick = () => { TAG = b.dataset.tag; showLibrary(); }));
  $$('.card').forEach((card) => (card.onclick = (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    libraryAction('open-project', LIB.projects.find((p) => p.id === card.dataset.project)).catch((error) => toast(error.message));
  }));
}

/* ---------------- project ---------------- */
let CUR=null,AG=null,EDITOR=null;
async function showProject(id){
 if(EDITOR?.doc.id===id)return;
 if(EDITOR?.dirty&&!confirm('Leave unsaved edits?')){location.hash='#/p/'+EDITOR.doc.id;return;}
 EDITOR?.destroy();AG?.session?.close();AG=null;CHAT=[];
 const j=await api.read(`projects/${id}/project.json`);
 EDITOR=new Editor($('#view'),{api,toast,onChange:d=>{CUR={...d,__abs:j.absolute};},assistant:renderAssistant});
 await EDITOR.open(j.content,j.absolute);window.ffs=EDITOR;
 $('#crumbs').innerHTML=`<a href="#/">library</a> / <span>${esc(CUR.title)}</span>`;
}
function renderProject(){renderAssistant($('#assistant-slot'));}
function renderAssistant(slot){if(!slot)return;
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
    AG.session = await connectAgent({ bridge: BASE, token: null, agent: id, cwd: CUR.__abs.replace(/\/project\.json$/, ''), handlers: {
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
