import { VIDEO_STYLE_PRESETS, ASPECTS, instantiate, evaluateRecipe, serializeRecipe, parseRecipe, validateRecipe } from '../src/video-style/components.mjs';
import { parseCineticPicks } from '../src/video-style/cinetic.mjs';

const $ = id => document.getElementById(id);
const select = $('component'), frameControl = $('frame');
for (const [id, preset] of Object.entries(VIDEO_STYLE_PRESETS)) {
  const option = document.createElement('option');
  option.value = id; option.textContent = preset.title; select.append(option);
}
const recipes = {};
const mounted = {a:[],b:[]};
let active = 'a', rafId = null, startMs = null;
const recipe = () => recipes[active];
const fields = () => Object.entries(recipe().definition.controls).filter(([,c]) => c.type === 'text').map(([k]) => k);
function stop() { if (rafId !== null) cancelAnimationFrame(rafId); rafId = null; startMs = null; $('play').textContent = '▶ Play'; }
function mount(take) {
  const stage = $('stage-'+take);
  mounted[take] = recipes[take].definition.layers.slice().sort((a,b) => a.z-b.z).map(layer => {
    const element = document.createElement('div');
    element.className = 'layer role-'+layer.role; element.dataset.layer = layer.id;
    return element;
  });
  const guide = document.createElement('div'); guide.className = 'safe-area'; guide.setAttribute('aria-hidden','true');
  stage.replaceChildren(...mounted[take],guide);
}
function render(frame) {
  for (const take of ['a','b']) {
    if (take === 'b' && !$('compare').checked) continue;
    const r = recipes[take], state = evaluateRecipe(r, Math.min(frame,r.durationFrames-1)), stage = $('stage-'+take);
    stage.style.backgroundColor = state.background;
    stage.dataset.frame = state.frame;
    stage.classList.toggle('portrait',r.aspect === '9:16'); stage.classList.toggle('square',r.aspect === '1:1');
    stage.setAttribute('aria-label',`Take ${take.toUpperCase()}, frame ${state.frame}: ${state.layers.filter(l=>l.opacity>.1).map(l=>l.text).join(' · ')}`);
    for (const [i,layer] of state.layers.entries()) {
      const element = mounted[take][i];
      if (element.textContent !== layer.text) element.textContent = layer.text;
      element.style.left = 100*layer.x+'%'; element.style.top = 100*layer.y+'%';
      element.style.width = 100*layer.maxWidth+'%';
      element.style.transform = `translateY(-50%) scale(${layer.scale})`;
      element.style.opacity = layer.opacity; element.style.zIndex = layer.z;
      element.style.color = layer.color; element.style.borderColor = layer.accent;
    }
    const safe = stage.lastElementChild;
    for (const [key,value] of Object.entries(state.safeArea)) safe.style[key] = value*100+'%';
    $('sample-'+take).textContent = `${String(state.frame).padStart(3,'0')}f / ${state.seconds.toFixed(2)}s`;
  }
  frameControl.value = frame;
  $('position').textContent = `${frame} / ${frameControl.max}`;
}
function sync() {
  const r = recipe(), [a,b] = fields();
  if(![...select.options].some(o=>o.value === r.component)){
    const option=document.createElement('option');option.value=r.component;option.textContent=r.definition.title+' (imported)';option.disabled=true;select.append(option);
  }
  select.value = r.component;
  $('primary').value = r.props[a]; $('secondary').value = r.props[b];
  $('primary').maxLength = r.definition.controls[a].maxLength; $('secondary').maxLength = r.definition.controls[b].maxLength;
  $('primary-label').textContent = a[0].toUpperCase()+a.slice(1);
  $('secondary-label').textContent = b[0].toUpperCase()+b.slice(1);
  for (const key of ['background','foreground','accent']) $(key).value = r.props[key];
  $('duration').value = r.durationFrames; $('motion').value = r.props.motionScale;
  $('fps-num').value = r.fps.num; $('fps-den').value = r.fps.den; $('aspect').value = r.aspect;
  frameControl.max = Math.max(recipes.a.durationFrames,$('compare').checked ? recipes.b.durationFrames : 0)-1;
  $('description').textContent = r.definition.description;
  for (const button of document.querySelectorAll('[data-component]')) button.setAttribute('aria-pressed',String(button.dataset.component === r.component));
  for (const button of document.querySelectorAll('[data-take]')) button.setAttribute('aria-pressed',String(button.dataset.take === active));
  render(Math.min(Number(frameControl.value),Number(frameControl.max)));
}
function load() {
  stop();
  recipes.a = instantiate(select.value);
  recipes.b = instantiate(select.value,{background:'#30263e',foreground:'#f8eddc',accent:'#c4b0f2'},{id:select.value+'-remix'});
  active = 'a'; mount('a'); mount('b'); sync();
}
function update(fn) {
  stop();
  try {
    const candidate = structuredClone(recipe()); fn(candidate); validateRecipe(candidate);
    recipes[active] = candidate; sync(); $('message').textContent = `Take ${active.toUpperCase()} updated. Export keeps these exact values.`;
  } catch (error) { $('message').textContent = error.message; }
}
select.onchange = load;
for (const button of document.querySelectorAll('[data-component]')) button.onclick = () => {select.value = button.dataset.component;load();};
for (const button of document.querySelectorAll('[data-take]')) button.onclick = () => {stop();active = button.dataset.take;if(active === 'b') {$('compare').checked = true;compare();} sync();};
for (const [index,id] of ['primary','secondary'].entries()) $(id).oninput = () => update(r => {r.props[fields()[index]] = $(id).value;});
for (const key of ['background','foreground','accent']) $(key).oninput = () => update(r => {r.props[key] = $(key).value;});
$('duration').onchange = () => update(r => {r.durationFrames = Number($('duration').value);});
$('motion').onchange = () => update(r => {r.props.motionScale = Number($('motion').value);});
for (const part of ['num','den']) $('fps-'+part).onchange = () => update(r => {r.fps[part] = Number($('fps-'+part).value);});
$('aspect').onchange = () => update(r => {r.aspect = $('aspect').value;r.size = {...ASPECTS[r.aspect]};});
frameControl.oninput = () => {stop();render(Number(frameControl.value));};
function compare() { $('figure-b').hidden = !$('compare').checked; $('previews').classList.toggle('single',!$('compare').checked);sync(); }
$('compare').onchange = () => {stop();if (!$('compare').checked) active = 'a';compare();};
$('guides').onchange = () => $('previews').classList.toggle('hide-guides',!$('guides').checked);
$('play').onclick = () => {
  if (rafId !== null) {stop();return;}
  $('play').textContent = 'Ⅱ Pause';
  const beginFrame = Number(frameControl.value) >= Number(frameControl.max) ? 0 : Number(frameControl.value);
  const fps = {...recipe().fps};
  function tick(ms) {
    startMs ??= ms;
    const frame = Math.min(Number(frameControl.max),beginFrame+Math.floor((ms-startMs)*fps.num/fps.den/1000));
    render(frame);
    if (frame >= Number(frameControl.max)) stop(); else rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
};
function showJSON(text) {
  $('json').value = text; $('json-panel').hidden = false; $('json-toggle').setAttribute('aria-expanded','true');
}
async function copy(text) {
  showJSON(text);
  try { await navigator.clipboard.writeText(text); $('message').textContent = 'JSON copied. The editable source is also available below.'; }
  catch { $('json').focus();$('json').select();$('message').textContent = 'Clipboard unavailable. JSON selected below — use your copy shortcut.'; }
}
$('copy-instance').onclick = () => copy(serializeRecipe(recipe()));
$('copy-definition').onclick = () => copy(JSON.stringify(recipe().definition,null,2)+'\n');
$('json-toggle').onclick = () => { const hidden = !$('json-panel').hidden; $('json-panel').hidden = hidden;$('json-toggle').setAttribute('aria-expanded',String(!hidden));if(!hidden)$('json').value = serializeRecipe(recipe()); };
$('import').onclick = () => {
  stop();
  try { const candidate = parseRecipe($('json').value); if (Object.values(candidate.definition.controls).filter(c=>c.type === 'text').length !== 2) throw Error('Lab requires two text controls'); recipes[active] = candidate;mount(active);sync();$('message').textContent = 'Recipe imported into Take '+active.toUpperCase()+'.'; }
  catch(error) {$('message').textContent = 'Import refused: '+error.message;}
};
$('export').onclick = () => {
  const u = URL.createObjectURL(new Blob([serializeRecipe(recipe())],{type:'application/json'}));
  const link = document.createElement('a');link.href = u;link.download = recipe().id+'.video-style.json';link.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
  $('message').textContent = 'Downloaded editable sidecar JSON — not an MP4.';
};
// This file picker is an intentionally *non-executing* creative planning surface.
let cineticRead = 0;
$('cinetic-file').onchange = async event => {
  const input = event.currentTarget, file = input.files?.[0], read = ++cineticRead;
  const status = $('cinetic-status'), list = $('cinetic-list');
  input.value = '';
  list.replaceChildren();
  if (!file) { status.textContent = 'No plan selected.'; return; }
  if (file.size > 131072) { status.textContent = 'Plan rejected: limit 128 KiB.'; return; }
  status.textContent = 'Reading plan locally…';
  try {
    const text = await file.text();
    if (read !== cineticRead) return; // A newer selection owns the panel.
    const plan = parseCineticPicks(text);
    const fragment = document.createDocumentFragment();
    for (const pick of plan.picks) {
      const item = document.createElement('li');
      item.className = 'cinetic-item';
      const heading = document.createElement('strong');
      heading.textContent = pick.name;
      const meta = document.createElement('small');
      meta.textContent = pick.category.replaceAll('_',' ') + ' · ' + pick.role + ' · ' + pick.sourceId;
      item.append(heading, meta);
      if (pick.suggestion) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.cineticSuggest = pick.sourceId;
        button.textContent = 'Preview related ' + pick.suggestion.component + ' ↗';
        button.onclick = () => {
          // Keep current takes if they already use this component; otherwise start fresh.
          if (recipe().component !== pick.suggestion.component) { select.value = pick.suggestion.component; load(); }
          if (!$('json-panel').hidden) $('json').value = serializeRecipe(recipe());
          $('message').textContent = 'Conceptual-only suggestion for ' + pick.name +
            '. This is a FrameStudio starting point, not an implementation of the cinetic technique.';
        };
        item.append(button);
      } else {
        const missing = document.createElement('span');
        missing.className = 'cinetic-unmatched';
        missing.textContent = 'Not implemented in FrameStudio';
        item.append(missing);
      }
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    status.textContent = plan.picks.length + ' choices · seed ' + plan.provenance.seed +
      ' · ' + (plan.provenance.format || 'selected category') + ' · ' +
      plan.picks.filter(p => p.suggestion).length + ' conceptual previews available. No source code executed.';
  } catch {
    if (read !== cineticRead) return;
    status.textContent = 'Invalid cinetic picks file. Export it using cinetic pick.py --json.';
  }
};
load();
