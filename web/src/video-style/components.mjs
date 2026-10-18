// Pure, seekable motion grammar. All spatial coordinates are canvas fractions.
// These data-only components are not a replacement for a video renderer.
export const VIDEO_STYLE_SCHEMA = 'fframestudio.video-style/1';

const mechanisms = {
  'headline-reveal': {
    title: 'Kinetic headline',
    description: 'A legible opening that lands before the supporting line arrives.',
    durationFrames: 90,
    props: { headline: 'Make something remarkable', kicker: 'INTRODUCING', background: '#101218' },
    layers: [
      { id: 'kicker', role: 'eyebrow', text: 'kicker', z: 1,
        tracks: { x: [[0, .08]], y: [[0, .24]], scale: [[0, 1]], opacity: [[0, 1]] } },
      { id: 'headline', role: 'title', text: 'headline', z: 2,
        tracks: { x: [[0, -.45], [.26, .08, 'out-cubic']], y: [[0, .47]], scale: [[0, 1.05], [.26, 1, 'out-cubic']], opacity: [[0, 1]] } },
    ],
    cues: [{ at: .26, kind: 'arrival', label: 'headline lands' }],
  },
  'foreground-fly-through': {
    title: 'Foreground fly-through',
    description: 'One recognizable actor expands to reveal the next composition behind it.',
    durationFrames: 75,
    props: { subject: 'YOUR PRODUCT', next: 'The next chapter', background: '#101218' },
    layers: [
      { id: 'next', role: 'title', text: 'next', z: 1,
        tracks: { x: [[0, .09]], y: [[0, .48]], scale: [[0, .82], [.95, 1.05, 'in-out-cubic']], opacity: [[0, 0], [.45, 0], [.78, 1, 'out-cubic']] } },
      { id: 'subject', role: 'hero', text: 'subject', z: 2,
        tracks: { x: [[0, .1], [.95, -.15, 'in-cubic']], y: [[0, .47]], scale: [[0, 1], [.42, 1.1, 'in-out-cubic'], [1, 8, 'in-cubic']], opacity: [[0, 1], [.83, 1], [1, 0, 'in-cubic']] } },
    ],
    cues: [{ at: .7, kind: 'transition', label: 'foreground crosses camera' }],
  },
  'ui-action-result': {
    title: 'Action → visible result',
    description: 'A product interaction that resolves into an understandable outcome.',
    durationFrames: 90,
    props: { action: 'Generate report', result: 'Report ready', background: '#101218' },
    layers: [
      { id: 'action', role: 'ui-control', text: 'action', z: 1,
        tracks: { x: [[0, .12]], y: [[0, .46]], scale: [[0, 1], [.53, 1.03, 'out-cubic'], [.61, 1]], opacity: [[0, 1], [.65, 1], [.8, .2, 'out-cubic']] } },
      { id: 'result', role: 'confirmation', text: 'result', z: 2,
        tracks: { x: [[0, .12]], y: [[0, .59], [.83, .48, 'out-cubic']], scale: [[0, .92], [.83, 1, 'out-cubic']], opacity: [[0, 0], [.57, 0], [.79, 1, 'out-cubic']] } },
    ],
    cues: [{ at: .52, kind: 'ui-click', label: 'action confirmed' }],
  },
};

export const DEFINITION_SCHEMA = 'fframestudio.style-component/1';
export const EASINGS = Object.freeze(['linear', 'hold', 'in-cubic', 'out-cubic', 'in-out-cubic']);
export const ASPECTS = Object.freeze({'16:9': {width:1920,height:1080}, '9:16': {width:1080,height:1920}, '1:1': {width:1080,height:1080}});
const TRACKS = ['x','y','scale','opacity'];
const identifier = /^[a-z0-9][a-z0-9-]{0,99}$/;
const color = /^#[0-9a-f]{6}$/i;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const integer = (v,min,max) => Number.isSafeInteger(v) && v >= min && v <= max;
const check = (condition,message) => { if (!condition) throw Error(message); };
function exact(v,keys,label) {
  check(object(v) && Object.keys(v).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(v,k)), 'Invalid '+label+' fields');
}
function same(a,b) {
  if (object(b)) return object(a) && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(k => same(a[k],b[k]));
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v,i) => same(a[i],v));
  return a === b;
}
function freeze(v) {
  if (object(v) || Array.isArray(v)) { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
const renderCapabilities = {preview:'dom-2d',supported:['text','x','y','scale','opacity','z','srgb-colors'],unsupported:['fframes','audio-playback','mp4','3d','shaders','motion-blur']};
const units = {position:'canvas-fraction',scale:'unitless',time:'integer-frame'};
const timingControls = {durationFrames:{type:'integer',min:2,max:36000},fps:{type:'rational',min:1,max:240}};
const lookTokens = {background:'background',ink:'foreground',accent:'accent'};
export const VIDEO_STYLE_PRESETS = freeze(Object.fromEntries(Object.entries(mechanisms).map(([id,m]) => {
  const props = {...m.props,foreground:'#f7f0df',accent:'#e9ae60',motionScale:1};
  const actor = id === 'headline-reveal' ? 'headline' : id === 'foreground-fly-through' ? 'next' : 'result';
  return [id, {schema:DEFINITION_SCHEMA,id,version:'1.0.0',title:m.title,description:m.description,
    author:'fframestudio contributors',license:'Apache-2.0',
    provenance:[{url:'https://github.com/echris6/motion-video-kit',author:'echris6',license:'MIT',usage:'Motion-grammar ideas and naming only; no code or media copied.'}],
    capabilities:['text','transform-2d','opacity','event-cues','carry-anchors'],requiredAssets:[],renderCapabilities,units,
    fps:{num:30,den:1},durationFrames:m.durationFrames,
    controls:Object.fromEntries(Object.entries(props).map(([k,v]) => [k, k === 'motionScale' ? {type:'number',default:v,min:.5,max:1.5} : {type:color.test(v)?'color':'text',default:v,maxLength:color.test(v)?7:120}])),
    timingControls,lookTokens,
    variants:Object.fromEntries(Object.entries(ASPECTS).map(([aspect,size]) => [aspect,{size,safeArea:{left:.08,top:.12,right:.08,bottom:.12},textWidth:.8}])),
    anchors:{start:{layer:actor},end:{layer:actor},carry:{layer:actor}},
    layers:m.layers.map(l => ({...l,tracks:Object.fromEntries(Object.entries(l.tracks).map(([k,keys]) => [k,keys.map(([at,value,easing='linear']) => [Math.round(at*(m.durationFrames-1)),value,easing])]))})),
    cues:m.cues.map(({at,...cue}) => ({frame:Math.round(at*(m.durationFrames-1)),...cue})),
  }];
})));
function rational(fps) {
  exact(fps,['num','den'],'fps');
  check(integer(fps.num,1,1000000) && integer(fps.den,1,1000000) && fps.num/fps.den >= 1 && fps.num/fps.den <= 240,'Invalid fps');
}
function validateProp(c,v,k) {
  if (c.type === 'number') check(Number.isFinite(v) && v >= c.min && v <= c.max,'Invalid number: '+k);
  else if (c.type === 'color') check(typeof v === 'string' && color.test(v),'Invalid '+k+' color');
  else check(typeof v === 'string' && v.length <= c.maxLength && !/[\u0000-\u001f]/.test(v),'Invalid text: '+k);
}
export function validateDefinition(d) {
  exact(d,['schema','id','version','title','description','author','license','provenance','capabilities','requiredAssets','renderCapabilities','units','fps','durationFrames','controls','timingControls','lookTokens','variants','anchors','layers','cues'],'definition');
  check(d.schema === DEFINITION_SCHEMA && typeof d.id === 'string' && identifier.test(d.id) && typeof d.version === 'string' && /^\d+\.\d+\.\d+$/.test(d.version),'Unknown definition/version');
  for (const k of ['title','description','author','license']) check(typeof d[k] === 'string' && d[k].length > 0 && d[k].length <= 1000,'Invalid metadata: '+k);
  check(Array.isArray(d.provenance) && d.provenance.length <= 20,'Invalid provenance');
  for(const p of d.provenance){exact(p,['url','author','license','usage'],'provenance');check(Object.values(p).every(v=>typeof v === 'string' && v.length>0 && v.length<=2000) && /^https:\/\//.test(p.url),'Invalid provenance');}
  check(Array.isArray(d.capabilities) && d.capabilities.length <= 32 && d.capabilities.every(s => typeof s === 'string' && s.length>0 && s.length<=1000),'Invalid capabilities');
  check(Array.isArray(d.requiredAssets) && !d.requiredAssets.length,'Assets unsupported in dom-2d slice');
  check(same(d.renderCapabilities,renderCapabilities) && same(d.units,units) && same(d.timingControls,timingControls) && same(d.lookTokens,lookTokens),'Unsupported render contract');
  rational(d.fps); check(integer(d.durationFrames,2,36000),'Invalid frame duration');
  check(object(d.controls) && Object.keys(d.controls).length <= 32,'Invalid controls');
  for (const [k,c] of Object.entries(d.controls)) {
    check(/^[a-z][a-zA-Z0-9]*$/.test(k) && object(c),'Invalid control');
    if (c.type === 'number') { exact(c,['type','default','min','max'],'number control'); check(Number.isFinite(c.min) && Number.isFinite(c.max) && c.min <= c.max,'Invalid control bounds'); }
    else { exact(c,['type','default','maxLength'],'string control'); check(['text','color'].includes(c.type) && integer(c.maxLength,1,512),'Invalid control type'); }
    validateProp(c,c.default,k);
  }
  for (const k of ['background','foreground','accent']) check(d.controls[k]?.type === 'color','Missing look color');
  check(d.controls.motionScale?.type === 'number' && d.controls.motionScale.min >= .5 && d.controls.motionScale.max <= 1.5,'Invalid motionScale');
  exact(d.variants,Object.keys(ASPECTS),'variants');
  for (const [aspect,v] of Object.entries(d.variants)) {
    exact(v,['size','safeArea','textWidth'],'variant'); check(same(v.size,ASPECTS[aspect]),'Invalid aspect size');
    exact(v.safeArea,['left','top','right','bottom'],'safe area');
    check(Object.values(v.safeArea).every(n => Number.isFinite(n) && n >= 0 && n <= .4) && Number.isFinite(v.textWidth) && v.textWidth > 0 && v.textWidth <= 1-v.safeArea.left-v.safeArea.right+1e-9,'Invalid safe area/text width');
  }
  check(Array.isArray(d.layers) && d.layers.length > 0 && d.layers.length <= 16,'Invalid layers');
  const ids = new Set();
  for (const l of d.layers) {
    exact(l,['id','role','text','z','tracks'],'layer');
    check(typeof l.id === 'string' && identifier.test(l.id) && !ids.has(l.id) && ['eyebrow','title','hero','ui-control','confirmation'].includes(l.role) && d.controls[l.text]?.type === 'text' && integer(l.z,0,100),'Invalid layer'); ids.add(l.id);
    exact(l.tracks,TRACKS,'tracks');
    for (const k of TRACKS) {
      const keys = l.tracks[k]; check(Array.isArray(keys) && keys.length > 0 && keys.length <= 128,'Invalid timeline');
      let previous = -1;
      for (const key of keys) {
        check(Array.isArray(key) && key.length === 3 && integer(key[0],0,d.durationFrames-1) && key[0] > previous && Number.isFinite(key[1]) && Math.abs(key[1]) <= 100 && EASINGS.includes(key[2]),'Invalid keyframe/easing'); previous = key[0];
        if (k === 'opacity') check(key[1] >= 0 && key[1] <= 1,'Invalid opacity');
        if (k === 'scale') check(key[1] > 0,'Invalid scale');
      }
    }
  }
  exact(d.anchors,['start','end','carry'],'anchors');
  check(Object.values(d.anchors).every(a => object(a) && Object.keys(a).length === 1 && ids.has(a.layer)),'Invalid anchor');
  check(Array.isArray(d.cues) && d.cues.length <= 128,'Invalid cues');
  for(const c of d.cues){exact(c,['frame','kind','label'],'cue');check(integer(c.frame,0,d.durationFrames-1) && typeof c.kind === 'string' && typeof c.label === 'string','Invalid cues');}
  return d;
}
export function validateRecipe(v) {
  exact(v,['schema','id','component','version','definition','fps','size','aspect','durationFrames','props'],'recipe');
  check(v.schema === VIDEO_STYLE_SCHEMA && typeof v.id === 'string' && identifier.test(v.id),'Unknown video style schema/id');
  const d = validateDefinition(v.definition); check(v.component === d.id && v.version === d.version,'Component identity/version mismatch');
  rational(v.fps); check(integer(v.durationFrames,2,36000),'Invalid frame duration');
  check(Object.hasOwn(ASPECTS,v.aspect) && same(v.size,ASPECTS[v.aspect]),'Invalid canvas/aspect');
  exact(v.props,Object.keys(d.controls),'props');
  for (const [k,c] of Object.entries(d.controls)) validateProp(c,v.props[k],k);
  return v;
}
export function instantiate(component,overrides={},options={}) {
  check(Object.hasOwn(VIDEO_STYLE_PRESETS,component),'Unknown component'); check(object(overrides),'Invalid props'); check(object(options),'Invalid options');
  for (const k of Object.keys(overrides)) check(Object.hasOwn(VIDEO_STYLE_PRESETS[component].controls,k),'Unsupported prop: '+k);
  for (const k of Object.keys(options)) check(['id','fps','aspect','durationFrames'].includes(k),'Unsupported option: '+k);
  const definition = structuredClone(VIDEO_STYLE_PRESETS[component]), aspect = options.aspect ?? '16:9';
  return validateRecipe({schema:VIDEO_STYLE_SCHEMA,id:options.id ?? component+'-instance',component,version:definition.version,definition,
    fps:options.fps ?? {...definition.fps},size:{...ASPECTS[aspect]},aspect,durationFrames:options.durationFrames ?? definition.durationFrames,
    props:{...Object.fromEntries(Object.entries(definition.controls).map(([k,c]) => [k,c.default])),...overrides}});
}
function ease(t,curve) {
  switch (curve) {
    case 'hold': return 0;
    case 'in-cubic': return t**3;
    case 'out-cubic': return 1-(1-t)**3;
    case 'in-out-cubic': return t < .5 ? 4*t**3 : 1-(-2*t+2)**3/2;
    case 'linear': return t;
    default: throw Error('Unknown easing');
  }
}
export function interpolate(keys,frame) {
  check(Array.isArray(keys) && keys.length && Number.isFinite(frame),'Invalid timeline');
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i=1;i<keys.length;i++) {
    const [end,value,curve='linear'] = keys[i];
    if (frame <= end) { const [start,previous] = keys[i-1]; return frame === end ? value : previous+(value-previous)*ease((frame-start)/(end-start),curve); }
  }
  return keys.at(-1)[1];
}
export function evaluateRecipe(recipe,frame) {
  validateRecipe(recipe); check(integer(frame,0,recipe.durationFrames-1),'Frame out of bounds');
  const d = recipe.definition, sourceFrame = frame*(d.durationFrames-1)/(recipe.durationFrames-1), variant = d.variants[recipe.aspect];
  const layers = d.layers.map(l => ({id:l.id,role:l.role,text:recipe.props[l.text],z:l.z,
    ...Object.fromEntries(TRACKS.map(k => [k,interpolate(l.tracks[k],sourceFrame)])),
    color:l.role === 'eyebrow' ? recipe.props.accent : recipe.props.foreground,accent:recipe.props.accent,maxWidth:variant.textWidth,
  })).sort((a,b) => a.z-b.z);
  for (const l of layers) l.scale *= recipe.props.motionScale;
  return {component:recipe.component,frame,seconds:frame*recipe.fps.den/recipe.fps.num,size:{...recipe.size},background:recipe.props.background,safeArea:{...variant.safeArea},layers,
    anchors:Object.fromEntries(Object.entries(d.anchors).map(([k,a]) => { const l=layers.find(l => l.id === a.layer); return [k,{layer:a.layer,x:l.x,y:l.y}]; })),
    cues:d.cues.filter(c => Math.round(c.frame*(recipe.durationFrames-1)/(d.durationFrames-1)) === frame).map(({kind,label}) => ({kind,label})),
  };
}
export function serializeRecipe(recipe) { return JSON.stringify(validateRecipe(recipe),null,2)+'\n'; }
export function parseRecipe(source) { check(typeof source === 'string' && source.length <= 262144,'Recipe exceeds 256 KiB'); return structuredClone(validateRecipe(JSON.parse(source))); }
// Minimal composition: explicit positional carry, not a blend or video renderer.
export function joinComponents(from,to,{fromAnchor='carry',toAnchor='start'}={}) {
  validateRecipe(from); validateRecipe(to);
  check(from.aspect === to.aspect && from.fps.num*to.fps.den === to.fps.num*from.fps.den,'Join requires same aspect and fps');
  const a=evaluateRecipe(from,from.durationFrames-1).anchors[fromAnchor], b=evaluateRecipe(to,0).anchors[toAnchor]; check(a && b,'Unknown handoff anchor');
  return {schema:'fframestudio.style-composition/1',from:structuredClone(from),to:structuredClone(to),fromAnchor,toAnchor,offset:{x:a.x-b.x,y:a.y-b.y},durationFrames:from.durationFrames+to.durationFrames};
}
export function evaluateComposition(c,frame) {
  check(integer(frame,0,c.durationFrames-1),'Frame out of bounds');
  if (frame < c.from.durationFrames) return evaluateRecipe(c.from,frame);
  const state=evaluateRecipe(c.to,frame-c.from.durationFrames);
  for (const l of state.layers) { l.x+=c.offset.x; l.y+=c.offset.y; }
  for (const a of Object.values(state.anchors)) { a.x+=c.offset.x; a.y+=c.offset.y; }
  return state;
}
