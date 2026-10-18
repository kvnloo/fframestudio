// Read-only views over the procedural sidecar; never write Rust or imply a live shader.
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
  return head + body + `<h3>Provenance & credits</h3><p>${(p.credits || []).map(esc).join('<br>')}</p><p class="hint">Revision <code>${esc(p.source_revision || 'not recorded (synthetic or exported source)')}</code></p><details><summary>Source hashes & render dependency</summary>${kv(p.source_sha256)}<p>${esc((p.render_steps || []).join(' → '))}</p></details><p class="hint">Future writable surface: ${esc((p.future_write_surface || []).join(', '))}. Requires an isolated studio copy and rebuild; not implemented. Shader controls and measured arrays are informational. No source editing, resynthesis or export is performed here.</p></section>`;
}
