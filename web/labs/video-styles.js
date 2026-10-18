import { VIDEO_STYLE_PRESETS, instantiate, evaluateRecipe, serializeRecipe } from '../src/video-style/components.mjs';

const $ = id => document.getElementById(id);
const select = $('component'), stage = $('stage'), frameControl = $('frame');
for (const [id, preset] of Object.entries(VIDEO_STYLE_PRESETS)) {
  const option = document.createElement('option');
  option.value = id; option.textContent = preset.title; select.append(option);
}
let recipe, rafId = null, startMs = null;
const fields = () => Object.keys(recipe.props).filter(key => key !== 'background');
function stop() { if (rafId !== null) cancelAnimationFrame(rafId); rafId = null; startMs = null; $('play').textContent = 'Play'; }
function render(frame) {
  const state = evaluateRecipe(recipe, frame);
  stage.style.background = state.background;
  stage.replaceChildren();
  for (const layer of state.layers) {
    const element = document.createElement('div');
    element.className = 'layer role-' + layer.role;
    element.textContent = layer.text;
    element.style.left = 100 * layer.x + '%';
    element.style.top = 100 * layer.y + '%';
    element.style.transform = 'translateY(-50%) scale(' + layer.scale + ')';
    element.style.opacity = layer.opacity;
    stage.append(element);
  }
  frameControl.value = frame;
  $('position').textContent = (frame + 1) + ' / ' + recipe.durationFrames + ' · ' + state.seconds.toFixed(2) + 's';
}
function load() {
  stop(); recipe = instantiate(select.value);
  const [a,b] = fields();
  $('primary').value = recipe.props[a]; $('secondary').value = recipe.props[b];
  frameControl.max = recipe.durationFrames - 1;
  frameControl.value = 0; render(0);
}
select.onchange = load;
for (const [index, id] of ['primary','secondary'].entries()) {
  $(id).oninput = () => {
    const key = fields()[index];
    recipe.props[key] = $(id).value;
    render(Number(frameControl.value));
  };
}
frameControl.oninput = () => {stop(); render(Number(frameControl.value));};
$('play').onclick = () => {
  if (rafId !== null) {stop(); return;}
  $('play').textContent = 'Pause';
  const beginFrame = Number(frameControl.value);
  function tick(ms) {
    startMs ??= ms;
    const frame = Math.min(recipe.durationFrames - 1,
      beginFrame + Math.floor((ms - startMs) * recipe.fps.num / recipe.fps.den / 1000));
    render(frame);
    if (frame >= recipe.durationFrames - 1) stop();
    else rafId = requestAnimationFrame(tick); // Visual playback only; evaluateRecipe stays pure.
  }
  rafId = requestAnimationFrame(tick);
};
$('export').onclick = () => {
  const blob = new Blob([serializeRecipe(recipe)], { type: 'application/json' });
  const u = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = u; link.download = recipe.component + '.video-style.json';
  link.click(); URL.revokeObjectURL(u);
  $('message').textContent = 'Exported editable JSON recipe (not an MP4).';
};
load();
