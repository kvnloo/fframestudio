// Read-only views over the procedural sidecar; never write Rust or imply a live shader.
import { CAMERA_FIELDS, CAMERA_STAGES, CAMERA_SKIPPED, EVENT_KINDS, cameraKeys, changedCells, eventCount, eventSeconds, frameOf, isCameraSource, nearestEvent, sampleCamera, sourceKeys } from './procedural-camera.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kv = data => `<dl class="procedural-values">${Object.entries(data || {}).filter(([,v])=>v != null).map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(' → ') : v)}</dd>`).join('')}</dl>`;
export function proceduralShot(clip) {
  const s = clip?.metadata?.procedural;
  if (!s) return '';
  return `<section class="procedural-selected"><span class="cap">Source — read-only</span><h3>${esc(s.palette || 'Continuous camera take')}</h3>${kv({text:s.source_text ?? 'One take · no physical cuts',kind:s.scene_kind || s.camera_take,...(s.hero ? {hero:s.hero,size:s.size,focus:s.focus,focus_start:s.focus_start,focus_mid:s.focus_mid,focus_end:s.focus_end} : {})})}${s.camera ? '<h4>Cam · radians / logical px</h4>' + kv(s.camera) : ''}<p class="hint">Source controls are not writable. Timing and Words below edit only the editorial proxy, not this source film.</p></section>`;
}
function markerTrack(kind, frames, total, fps) {
  total = Number(total); fps = Number(fps);
  frames = frames.filter(f=>Number.isSafeInteger(f) && f >= 0);
  return `<div class="procedural-track"><span>${esc(kind)} <b>${frames.length}</b></span><div>${frames.map((f,i) => `<i data-source-event="${esc(kind)}" data-frame="${f}" style="left:${Math.max(0,Math.min(100,100*f/total))}%" title="${esc(kind)} ${i+1} · ${f} f · ${(f/fps).toFixed(3)} s"></i>`).join('')}</div></div>`;
}
export function proceduralSource(metadata, shots = []) {
  const p = metadata?.procedural;
  if (!p) return '';
  const head = `<section id="procedural-source" class="procedural-source"><span class="cap">Source — read-only</span><h2>${esc(p.family)}</h2><p>${esc(p.total_frames)} frames · ${esc(p.fps)} fps${p.bpm ? ` · ${esc(p.bpm)} BPM · 4/4` : ''}<br>${p.render_verified ? 'Baked render · not a live shader preview' : 'Metadata only · no verified render or playable proxy'}</p>`;
  let body;
  if (p.family === 'ff-tracking') {
    const palettes = Object.entries(p.palettes || {}).map(([name,colours]) => `<div class="source-palette"><span>${esc(name)}</span><div>${colours.filter(c=>/^#[\da-f]{6}$/i.test(c)).map(c=>`<i style="background:${c}" title="${c}"></i>`).join('')}</div></div>`).join('');
    body = `<h3>Named source palettes</h3><div class="source-palettes">${palettes}</div><h3>SceneDef · ${shots.length} source shots</h3><div class="source-shot-grid">${shots.map((s,i)=>`<details class="source-shot" data-source-shot="${esc(s.id)}"><summary><b>${String(i+1).padStart(2,'0')}</b> ${esc(s.procedural?.source_text || s.procedural?.scene_kind)}<small>${esc(s.procedural?.palette)} · ${Math.round(s.t0*p.fps)}–${Math.round(s.t1*p.fps)} f</small></summary>${kv({text:s.procedural?.source_text,palette:s.procedural?.palette,hero:s.procedural?.hero,size:s.procedural?.size,focus:s.procedural?.focus,focus_start:s.procedural?.focus_start,focus_mid:s.procedural?.focus_mid,focus_end:s.procedural?.focus_end})}${kv(s.procedural?.camera)}</details>`).join('')}</div>`;
  } else {
    // The upstream WAVE array contains measured, normalized music.wav peaks.
    // Reduce to <=240 columns; do not invent samples if the source has none.
    const wave = (p.waveform || []).filter(v=>Number.isFinite(v) && v>=0 && v<=1), columns = Math.min(240,wave.length);
    const bars = Array.from({length:columns},(_,i)=>Math.max(...wave.slice(Math.floor(i*wave.length/columns),Math.floor((i+1)*wave.length/columns))));
    body = `<h3>Master waveform · source measurements</h3>${columns ? `<svg class="source-wave" viewBox="0 0 480 72" role="img" aria-label="Measured music.wav peak waveform">${bars.map((v,i)=>`<line x1="${480*i/columns}" x2="${480*i/columns}" y1="${36-34*v}" y2="${36+34*v}"/>`).join('')}</svg>` : '<p>Waveform unavailable in this source revision.</p>'}<div class="source-time-range"><span>0 s / 0 f</span><span>${Number(p.total_frames)/Number(p.fps)} s / ${esc(p.total_frames)} f</span></div><h3>Events · source time → nearest frame</h3>${Object.entries(p.event_frames || {}).map(([kind,frames])=>markerTrack(kind,frames,p.total_frames,p.fps)).join('')}<p class="hint">${esc(p.bar_origin)}. Kick times are measured stem onsets; clap / token times are exported score events in generated.rs, not detected beats. Editorial markers are annotations, not cuts.</p>${markerTrack('editorial',p.editorial_marker_frames || [],p.total_frames,p.fps)}<h3>Camera keyframe track</h3>${markerTrack('camera',(p.camera_keyframes || []).map(k=>k.frame),p.total_frames,p.fps)}<p class="hint">${esc(p.camera_interpolation)}</p><details><summary>Camera values · ${p.camera_keyframes?.length || 0} keys</summary>${(p.camera_keyframes || []).map(k=>`<details class="source-camera"><summary>${esc(k.time_s)} s · ${esc(k.frame)} f · zoom ${esc(k.zoom)}</summary>${kv(k)}</details>`).join('')}</details><details><summary>Exact event timestamps</summary>${Object.entries(p.event_seconds || {}).map(([kind,times])=>`<p>${esc(kind)} · ${esc(times.map(t=>t+' s').join(' / '))}</p>`).join('')}</details>`;
  }
  return head + body + `<h3>Provenance & credits</h3><p>${(p.credits || []).map(esc).join('<br>')}</p><p class="hint">Revision <code>${esc(p.source_revision || 'not recorded (synthetic or exported source)')}</code></p><details><summary>Source hashes & render dependency</summary>${kv(p.source_sha256)}<p>${esc((p.render_steps || []).join(' → '))}</p></details><p class="hint">Future writable surface: ${esc((p.future_write_surface || []).join(', '))}. Requires an isolated studio copy and rebuild; not implemented${p.family === 'ff-unmute' ? ' — except camera keys, edited as overrides in the Studio working copy below' : ''}. Shader controls and measured arrays are informational. No source editing, resynthesis or export is performed here.</p></section>`;
}
// Studio working copy of ff-unmute camera keys. Separate from #procedural-source,
// which stays read-only; every value here is an override, never the source film.
export function cameraOverrides(metadata, { field = 'zoom', projectPath = '<project.json>', error = '' } = {}) {
  const p = metadata?.procedural;
  if (!isCameraSource(p)) return '';
  const keys = cameraKeys(metadata), source = sourceKeys(p), changed = changedCells(metadata), end = p.total_frames / p.fps;
  if (!CAMERA_FIELDS.slice(1).includes(field)) field = 'zoom';
  const W = 480, H = 96, samples = 240;
  const curve = ks => Array.from({length:samples+1},(_,i)=>sampleCamera(ks,end*i/samples)[field]);
  const a = curve(source), b = curve(keys), all = [...a, ...b], lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const y = v => (H - 14) - (H - 24) * (v - lo) / span, x = t => W * t / end;
  const line = vs => vs.map((v,i)=>`${(W*i/samples).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = EVENT_KINDS.flatMap(kind => Array.from({length:eventCount(p,kind)},(_,i)=>`<line class="cam-tick-${kind}" x1="${x(eventSeconds(p,kind,i+1)).toFixed(1)}" x2="${x(eventSeconds(p,kind,i+1)).toFixed(1)}" y1="${H-8}" y2="${kind==='bar'?H:H-3}"/>`)).join('');
  const dots = keys.map((k,i)=>`<circle data-camera-dot="${i}" cx="${x(k.time_s).toFixed(1)}" cy="${y(k[field]).toFixed(1)}" r="3"/>`).join('');
  const cell = (k,i,f) => {
    const diff = k[f] !== source[i][f], pinned = f === 'time_s' && i === 0;
    return `<td${diff ? ' class="changed"' : ''}><input type="number" step="any" data-camera-key="${i}" data-camera-field="${f}" value="${esc(k[f])}" aria-label="Camera key ${i+1} ${f}" title="source ${esc(source[i][f])}"${pinned ? ' disabled' : ''}></td>`;
  };
  const snap = (k,i) => i === 0 ? '<td></td>' : `<td><select data-camera-snap="${i}" aria-label="Snap camera key ${i+1} to an event"><option value="">Snap…</option>${EVENT_KINDS.map(kind=>{const e=nearestEvent(p,k.time_s,kind);return e?`<option value="${kind}:${e.index}"${e.seconds===k.time_s?' selected':''}>${e.seconds===k.time_s?'on ':''}${kind} ${e.index} · ${+e.seconds.toFixed(4)} s</option>`:'';}).join('')}</select></td>`;
  const rows = keys.map((k,i)=>`<tr data-camera-row="${i}"><th>${i+1}<small>${frameOf(k.time_s,p.fps)} f</small></th>${cell(k,i,'time_s')}${snap(k,i)}${CAMERA_FIELDS.slice(1).map(f=>cell(k,i,f)).join('')}<td>${CAMERA_FIELDS.some(f=>k[f]!==source[i][f]) ? `<button type="button" data-camera-reset="${i}" aria-label="Reset camera key ${i+1} to source">Reset</button>` : ''}</td></tr>`).join('');
  return `<section id="procedural-overrides" class="procedural-overrides"><span class="cap">Studio working copy · overrides</span><h3>Camera keys · ${changed.length ? `${changed.length} override${changed.length>1?'s':''}` : 'matches source'}</h3><p class="cam-status" role="status"><b>Not rendered.</b> Source checkout untouched; no live shader preview. ${changed.length ? `Needs ${CAMERA_STAGES.map(s=>esc(s.label)).join(' → ')}. Score unchanged: ${CAMERA_SKIPPED.map(esc).join(', ')} stay valid.` : 'Edit a value or snap a key to a bar / kick / clap / token.'}</p>${error ? `<p class="cam-error" role="alert">${esc(error)}</p>` : ''}<label class="cam-field">Curve <select data-camera-curve aria-label="Camera curve field">${CAMERA_FIELDS.slice(1).map(f=>`<option${f===field?' selected':''}>${f}</option>`).join('')}</select></label><svg class="cam-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(field)} sampled from camera keys: source dashed, working copy solid"><polyline class="cam-source" points="${line(a)}"/><polyline class="cam-remix" points="${line(b)}"/>${ticks}${dots}</svg><p class="hint">${esc(field)} ${+lo.toFixed(3)}–${+hi.toFixed(3)} · dashed = source keys, solid = working copy, both sampled with hud::camera's Catmull–Rom (f64 mirror, not a render). Ticks: bars, kicks, claps, tokens at exact source seconds.</p><div class="cam-table-wrap"><table class="cam-table"><thead><tr><th>Key</th><th>time_s</th><th>Snap to beat</th>${CAMERA_FIELDS.slice(1).map(f=>`<th>${f}</th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table></div>${changed.length ? `<details class="cam-export"><summary>Write a remixed working copy</summary><p>Copies the pinned source, rewrites only <code>KEYS</code> in hud/src/lib.rs, re-imports it to prove the round trip and runs <code>cargo test -p hud</code> (focus stays in frame). The original checkout is never written.</p><pre>python3 tools/procedural_overrides.py export --source &lt;ff-unmute checkout&gt; --project ${esc(projectPath)} --out &lt;new empty dir&gt; --cargo-test</pre></details>` : ''}</section>`;
}
export function bindCameraOverrides(box, run, rerender, metadata) {
  const send = cmd => run({type:'edit-procedural-camera',...cmd}).then(()=>rerender(''),e=>rerender(e.message));
  box.onchange = e => {
    const t = e.target;
    if (t.dataset.cameraCurve !== undefined) return rerender('', t.value);
    if (t.dataset.cameraField) {
      const v = Number(t.value);
      if (t.value.trim() === '' || !Number.isFinite(v)) return rerender(`Camera key ${Number(t.dataset.cameraKey)+1}: enter a number`);
      const key = Number(t.dataset.cameraKey), field = t.dataset.cameraField;
      // Re-rendering a focused input can fire a second change; no-op edits must not add undo steps.
      if (v === cameraKeys(metadata())[key]?.[field]) return;
      return send({key,changes:{[field]:v}});
    }
    if (t.dataset.cameraSnap && t.value) {
      const [kind,index] = t.value.split(':'), key = Number(t.dataset.cameraSnap), md = metadata();
      // A different event at the same instant (e.g. bar 4 and kick 5) is a no-op, not an undo step.
      if (eventSeconds(md.procedural,kind,Number(index)) === cameraKeys(md)[key]?.time_s) return rerender('', undefined, true);
      return send({key,snap:{kind,index:Number(index)}});
    }
  };
  box.onclick = e => {
    const r = e.target.closest('[data-camera-reset]');
    if (r) send({key:Number(r.dataset.cameraReset),reset:true});
  };
}
