// fframestudio web app: project library + project view + ACP assistant.
// Served by the local bridge (same origin), authenticated by the cookie the /open link sets.
import { bridgeApi, connectAgent } from '/app/dist/acp-client.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (t) => { t = Math.max(0, +t || 0); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
const BASE = location.origin, api = bridgeApi(BASE, null);
const url = (proj, p) => (!p ? '' : p.startsWith('/') ? `/file?path=${encodeURIComponent(p)}` : `/lib/${proj}/${p}`);
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); }

let ME = null, AGENTS = [], LIB = null;
async function boot() {
  try { ME = await fetch('/me').then((r) => (r.ok ? r.json() : null)); } catch {}
  if (!ME) { $('#bridge').innerHTML = '<span class="dot bad"></span>not signed in'; $('#view').innerHTML = `<div class="gate"><div class="cap">fframestudio</div><h1>Open the link the bridge printed</h1>
    <p>Start the bridge with <code>npm run bridge</code> and open the <code>/open?token=…</code> link it prints (also in <code>~/.config/fframestudio/bridge.json</code>). The link sets a same-site cookie so this page can reach your projects and agents.</p></div>`; return; }
  AGENTS = (await api.agents()).agents;
  $('#bridge').innerHTML = `<span class="dot ok"></span>bridge · ${AGENTS.filter((a) => a.available).length} agents`;
  api.events((e) => { if (CUR && e.path === `projects/${CUR.id}/project.json` && Date.now() - lastSave > 1500) reloadProject(true); if (e.path === 'projects/library.json') loadLib().then(route); });
  await loadLib(); addEventListener('hashchange', route); route();
}
async function loadLib() { LIB = await fetch('/lib/library.json').then((r) => (r.ok ? r.json() : { projects: [] })); }

function route() {
  const m = location.hash.match(/^#\/p\/([\w.-]+)/);
  if (m) return showProject(m[1]);
  CUR = null; $('#crumbs').innerHTML = ''; showLibrary();
}

/* ---------------- library ---------------- */
let TAG = '';
function showLibrary() {
  const ps = LIB.projects, tags = [...new Set(ps.flatMap((p) => p.tags || []))].sort();
  const shown = ps.filter((p) => !TAG || (p.tags || []).includes(TAG));
  $('#view').innerHTML = `<div class="libhead"><div><div class="cap">library · ${ps.length} projects</div><h1>Every film, <em>one place.</em></h1></div>
    <div class="chips"><button class="pill ${!TAG ? 'on' : ''}" data-tag="">all</button>${tags.map((t) => `<button class="pill ${TAG === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
  <div class="grid">${shown.map((p) => `<a class="card brk" href="#/p/${esc(p.id)}"><div class="pv">${p.poster ? `<img src="/lib/${esc(p.poster)}" loading="lazy" alt="">` : '<div class="none">no render yet</div>'}<span class="rt">${fmt(p.duration_s)}</span></div>
    <div class="tx"><div class="t">${esc(p.title)}</div><div class="m"><span>${esc(p.kind)}</span><span>${p.shots} shots</span><span>${p.renders} render${p.renders === 1 ? '' : 's'}</span><span>${(p.tags || []).map(esc).join(' · ')}</span></div>
    <div class="strip">${Array.from({ length: Math.min(40, p.shots || 1) }, () => '<i></i>').join('')}</div></div></a>`).join('')}</div>`;
  $$('[data-tag]').forEach((b) => (b.onclick = () => { TAG = b.dataset.tag; showLibrary(); }));
}

/* ---------------- project ---------------- */
let CUR = null, SEL = null, lastSave = 0, AG = null;
const TEXT = (s) => ({ ...(s.text || {}), ...((CUR.edits || {})[s.id] || {}) });
async function reloadProject(external) {
  const j = await api.read(`projects/${CUR.id}/project.json`); CUR = JSON.parse(j.content); CUR.__abs = j.absolute;
  renderProject(); if (external) toast('Project updated by the assistant');
}
async function showProject(id) {
  CUR = { id }; await reloadProject(false);
  $('#crumbs').innerHTML = `<a href="#/">library</a> / <span>${esc(CUR.title)}</span>`;
}
function renderProject() {
  const P = CUR, dur = P.duration_s || (P.shots.at(-1)?.t1 ?? 0), proxy = P.media?.proxy, poster = P.media?.poster;
  const vid = P.renders.length && proxy ? `<video id="vid" src="${url(P.id, proxy)}" poster="${url(P.id, poster)}" controls preload="metadata"></video>` : poster ? `<img src="${url(P.id, poster)}" alt="">` : '<div class="none" style="position:absolute;inset:0;display:grid;place-items:center;color:var(--faint)">no render yet</div>';
  const fields = (s) => { const t = TEXT(s), orig = s.text || {}; return Object.keys(t).filter((k) => typeof t[k] === 'string').map((k) => `<div class="fld"><label>${esc(k)}</label><input data-shot="${esc(s.id)}" data-k="${esc(k)}" value="${esc(t[k])}" class="${t[k] !== orig[k] ? 'edited' : ''}"></div>`).join(''); };
  const scroll = scrollY;
  $('#view').innerHTML = `<div class="ph-title"><h1>${esc(P.title)}</h1><span class="cap">${esc(P.kind)} · ${P.canvas ? `${P.canvas.width}×${P.canvas.height} @ ${P.canvas.fps}` : ''} · ${fmt(dur)} · ${P.shots.length} shots</span></div>
  <div class="proj"><div>
    <div class="player">${vid}</div>
    <div class="tl" id="tl">${P.shots.map((s) => `<div class="s ${s.id === SEL ? 'sel' : ''}" data-id="${esc(s.id)}" style="flex:${Math.max(0.2, s.t1 - s.t0)}" title="${esc(s.name)} · ${fmt(s.t0)}">${s.thumb ? `<img src="${url(P.id, s.thumb)}" loading="lazy" alt="">` : ''}<span>${esc((s.name || s.id).slice(0, 18))}</span></div>`).join('')}<div class="ph" id="ph"></div></div>
    <div class="shots">${P.shots.map((s) => `<div class="shot ${s.id === SEL ? 'sel' : ''}" id="shot-${esc(s.id)}">${s.thumb ? `<img src="${url(P.id, s.thumb)}" loading="lazy" alt="">` : '<div></div>'}
      <div><div class="hd"><b>${esc(s.name || s.id)}</b><span>${fmt(s.t0)} → ${fmt(s.t1)} · ${(s.t1 - s.t0).toFixed(2)} s${s.origin ? ` · from ${esc(s.origin)}` : ''}</span></div><div class="flds">${fields(s)}</div></div></div>`).join('')}</div>
  </div>
  <aside class="side">
    <div class="box"><h3>Assistant <span>ACP · your subscription</span></h3>
      <div class="agents">${AGENTS.map((a) => `<button class="pill ${AG?.id === a.id ? 'on' : ''}" data-agent="${a.id}" ${a.available ? '' : 'disabled'} title="${esc(a.login)}">${esc(a.name)}</button>`).join('')}</div>
      <div class="hint" id="aghint">${AG ? `Connected to ${esc(AG.name)}. It can read and edit this project's file.` : 'Pick an agent. It runs on this machine with its own login, so no API key is needed here.'}</div>
      <div class="chat" id="chat" style="margin-top:10px"></div>
      <div class="compose"><textarea id="ask" placeholder="e.g. Tighten the hook to under 3 s and rewrite shot 2's headline"></textarea><button class="pill on" id="send">send</button></div></div>
    <div class="box"><h3>Source</h3><dl class="kv">
      <dt>edit in</dt><dd>${esc(P.edit_in?.app || '')}</dd>
      <dt>folder</dt><dd>${esc(P.source?.path || '')}</dd>
      ${P.edit_in?.url ? `<dt>live</dt><dd><a href="${esc(P.edit_in.url)}" target="_blank" rel="noopener">${esc(P.edit_in.url)}</a></dd>` : ''}
      ${Object.entries(P.docs || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd><a href="${url(P.id, v)}" target="_blank">${esc(v.split('/').pop())}</a></dd>`).join('')}
      ${P.renders.map((r) => `<dt>${esc(r.label)}</dt><dd>${r.width}×${r.height} · ${r.fps} fps · ${fmt(r.duration_s)}</dd>`).join('')}
      <dt>project</dt><dd>${esc(CUR.__abs || '')}</dd></dl>
      ${(P.notes || []).map((n) => `<div class="hint">${esc(n)}</div>`).join('')}</div>
  </aside></div>`;
  scrollTo(0, scroll);
  chatRender();
  const v = $('#vid');
  if (v) v.ontimeupdate = () => { $('#ph').style.left = `${(v.currentTime / (dur || 1)) * 100}%`; const s = P.shots.find((x) => v.currentTime >= x.t0 && v.currentTime < x.t1); if (s && s.id !== SEL) { SEL = s.id; $$('.tl .s').forEach((e) => e.classList.toggle('sel', e.dataset.id === SEL)); $$('.shot').forEach((e) => e.classList.toggle('sel', e.id === 'shot-' + SEL)); } };
  $$('.tl .s').forEach((e) => (e.onclick = () => { const s = P.shots.find((x) => x.id === e.dataset.id); SEL = s.id; if (v) { v.currentTime = s.t0 + 0.01; } $('#shot-' + CSS.escape(s.id))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $$('.tl .s').forEach((x) => x.classList.toggle('sel', x === e)); }));
  $$('.fld input').forEach((i) => (i.onchange = () => saveEdit(i.dataset.shot, i.dataset.k, i.value)));
  $$('[data-agent]').forEach((b) => (b.onclick = () => connect(b.dataset.agent)));
  $('#send').onclick = sendPrompt; $('#ask').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt(); };
}
async function saveEdit(shot, k, v) {
  CUR.edits ||= {}; (CUR.edits[shot] ||= {})[k] = v;
  const { __abs, ...clean } = CUR; lastSave = Date.now();
  await api.write(`projects/${CUR.id}/project.json`, JSON.stringify(clean, null, 1)); toast('Saved'); renderProject();
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
      wroteFile: (p) => { if (p.endsWith(`/projects/${CUR.id}/project.json`)) setTimeout(() => reloadProject(true), 200); },
      closed: (why) => push({ kind: 'note', text: `${a.name} disconnected: ${why}` }),
    } });
    CHAT.at(-1).text = `${a.name} ready · ${AG.session.init.agentInfo?.name || ''} ${AG.session.init.agentInfo?.version || ''}`; chatRender();
    $('#aghint').textContent = `Connected to ${a.name}. It can read and edit this project's file.`;
  } catch (e) { push({ kind: 'note', text: `Could not start ${a.name}: ${e.message}` }); AG = null; }
}
async function sendPrompt() {
  const text = $('#ask').value.trim(); if (!text || BUSY) return;
  if (!AG?.session) { toast('Pick an agent first'); return; }
  $('#ask').value = ''; push({ kind: 'you', text }); BUSY = true;
  const first = !CHAT.some((m) => m.kind === 'agent');
  const ctx = first ? `You are the assistant inside fframestudio, a video editor. The open project is ${CUR.__abs} (schema fframestudio.project/0). ` +
    `Shots are in "shots" (id, name, t0, t1 in seconds, text). To change on-screen words, write them under "edits": {"<shot id>": {"<field>": "new text"}} rather than editing "text". ` +
    `Retiming = change t0/t1 and keep shots contiguous. Keep the file valid JSON and every other key unchanged. Be brief in replies.\n\nRequest: ` : '';
  try { const r = await AG.session.prompt(ctx + text); push({ kind: 'note', text: `turn ended: ${r.stopReason}` }); }
  catch (e) { push({ kind: 'note', text: `error: ${e.message}` }); }
  BUSY = false;
}
boot();
