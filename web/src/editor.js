import { ACTIONS, action as studioAction } from './actions.js';
import { fpsOf, textOf, uid, rational } from './doc/project.js';
import { scope, COMMANDS, CommandStore, proposalCommand, recoveryCommand } from './doc/commands.js';
import { RecoveryJournal, fileHash } from './doc/journal.js';
import { setThemeSettings, themeInfo, onTheme, shotColorSlot } from './system-theme.js';
import { StudioView, colourSlot, clipKind, timecode, advanceFrame } from './studio.js';
import { PosterDecoder } from './poster-decoder.js';
import { proceduralShot, proceduralSource } from './procedural.js';
import { request, mediaURL, isLocal, isCopy, saveCopy, exportProject, preferences as storage } from './host.js';
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const button = (action, label) =>
  `<button class="pill" data-action="${action}">${label}</button>`;
export const defaults = {
  play: 'Space',
  reverse: 'j',
  pause: 'k',
  forward: 'l',
  previousFrame: 'ArrowLeft',
  nextFrame: 'ArrowRight',
  previousClip: 'ArrowUp',
  nextClip: 'ArrowDown',
  in: 'i',
  out: 'o',
  split: 's',
  delete: 'Delete',
  undo: 'Mod+z',
  redo: 'Mod+Shift+z',
  palette: 'Mod+k',
  save: 'Mod+s',
  duplicate: 'Mod+d',
  add: 'Mod+Shift+a',
  voice: 'v',
  move: 'Mod+Shift+m',
  trim: 't',
  replace: 'r',
  'edit-text': 'Enter',
  group: 'Mod+g',
  'set-beat-lock': 'b',
  retime: 'Shift+r',
  'edit-style': 'Mod+Shift+c',
  'save-version': 'Mod+Shift+s',
  'restore-version': 'Mod+Shift+v',
  compare: 'Mod+Shift+d',
  settings: 'Mod+,',
};
export class Editor {
  constructor(root, { api, onChange, toast, assistant }) {
    Object.assign(this, {
      root,
      api,
      onChange,
      toast,
      assistant,
      frame: 0,
      rate: 0,
      zoom: 1,
      selection: null,
      dirty: false,
      conflict: false,
      seq: 0,
      requests: new Map(),
      storyNodes: new Map(),
      laneNodes: new Map(),
    });
    try {
      this.settings = JSON.parse(storage.getItem('ffs.settings') || '{}');
    } catch {
      this.settings = {};
    }
    this.worker = new Worker('/app/src/doc/worker.js', { type: 'module' });
    this.worker.onmessage = ({ data: m }) => {
      const p = this.requests.get(m.id);
      this.requests.delete(m.id);
      if (m.error) p?.reject(Error(m.error));
      else {
        p?.resolve(m.result);
      }
    };
    this.thumbs = new Worker('/app/src/thumb-worker.js', { type: 'module' });
    this.thumbTargets = new Map();
    this.posterDecoder = new PosterDecoder(this);
    this.thumbs.onmessage = ({ data: m }) => {
      const canvas = this.thumbTargets.get(m.id);
      if (m.decode && canvas?.isConnected) { this.posterDecoder.request(m.id, canvas); return; }
      this.thumbTargets.delete(m.id);
      if (canvas?.isConnected && m.bitmap) {
        canvas.getContext('bitmaprenderer').transferFromImageBitmap(m.bitmap);
        canvas.dataset.ready = 'true';
      } else m.bitmap?.close();
    };
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            this.observer.unobserve(e.target);
            const id = ++this.seq;
            this.thumbTargets.set(id, e.target);
            if (e.target.dataset.video) this.thumbs.postMessage({ id, video:true, key:e.target.dataset.video + ':' + e.target.dataset.midpoint });
            else this.thumbs.postMessage({ id, url: e.target.dataset.thumb });
          }
      },
      { rootMargin: '100px' },
    );
    this.keyHandler = (e) => this.key(e);
    addEventListener('keydown', this.keyHandler);
    this.voiceRelease = e => { if(e.code === 'KeyV') this.voiceHeld = false; };
    addEventListener('keyup',this.voiceRelease);
    this.voiceBlur=()=>{this.voiceHeld=false;};addEventListener('blur',this.voiceBlur);
    this.beforeUnload = (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', this.beforeUnload);
  }
  rpc(type, value) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.requests.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, value });
    });
  }
  get doc() {
    return this.store?.doc;
  }
  get video() {
    return (
      this.doc.videos.find((v) => v.id === this.videoId) || this.doc.videos[0]
    );
  }
  get clip() {
    return this.video.clips.find((c) => c.id === this.selection);
  }
  get total() {
    const c = this.video.clips.at(-1);
    return c ? c.start + c.duration : 0;
  }
  path() {
    return `projects/${this.doc.id}/project.json`;
  }
  url(p) {
    return mediaURL(this.doc.id, p);
  }
  open(raw, absolute) {
    this.loading = true;
    this.root.inert = true;
    this.opening = this.load(raw, absolute).finally(() => {
      this.loading = false;
      this.root.inert = false;
    });
    return this.opening;
  }
  async load(raw, absolute) {
    this.metrics = { openStart: performance.now() };
    this.absolute = absolute;
    const opened = await this.rpc('open', raw);
    if (this.dead) return this;
    this.store = new CommandStore(opened.doc);
    this.metrics.workerDone = performance.now();
    this.baseRaw = raw;
    this.videoId = this.doc.videos[0].id;
    this.selection = this.video.clips[0]?.id || null;
    const journalOpening = this.openJournal(raw);
    this.mount();
    this.metrics.mountedAt = performance.now();
    this.onChange?.(this.doc);
    await journalOpening;
    this.metrics.journalDoneAt = performance.now();
    this.interactiveAt = performance.now();
    return this;
  }
  async openJournal(raw) {
    this.journal?.close();
    this.journal = null;
    try {
      const journal = await RecoveryJournal.open(this.absolute, raw, this.doc,
        (error) => this.toast('Autosave failed: ' + error.message));
      if (this.dead) { journal.close(); return; }
      this.journal = journal;
      if (journal.recovery.length) {
        await this.rpc('replay', { document: this.doc, entries: journal.recovery });
        $('#recovery').showModal();
      }
    } catch (error) {
      this.journal?.close();
      this.journal = null;
      this.toast('Recovery unavailable: ' + error.message);
    }
  }
  mount() {
    this.root.innerHTML = `<div class="ph-title"><h1>${esc(this.doc.title)}</h1><span class="cap">one video · many views</span></div>
  <div class="editor-tools"><select id="video-choice" aria-label="Video">${this.doc.videos.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select><span id="save-status" role="status">${isCopy(this.doc.id) ? 'Example copy · edits stay in this browser' : isLocal() ? 'Local folder · nothing uploaded' : 'Loaded · document v1'}</span>${button('undo', 'Undo ↶')}${button('redo', 'Redo ↷')}${button('save', 'Save')}${button('palette', 'Commands ⌘K')}${button('settings', 'Workspace')}${button('export', 'Export video')}${isLocal() || isCopy(this.doc.id) ? button('export-project', 'Export project.json') : ''}${isCopy(this.doc.id) ? button('save-copy', 'Save to my folder') : ''}</div>
  <dialog id="recovery" aria-labelledby="recovery-title"><h2 id="recovery-title">Recover unsaved changes?</h2><p>This project has local edits that were not saved to project.json.</p>${button('recover', 'Recover unsaved changes')}${button('discard-recovery', 'Discard')}</dialog>
  <div id="external" class="notice" hidden>File changed outside this editor. Your edits are preserved. ${button('reload-external', 'Load disk (discard local)')}${button('keep-local', 'Keep local / review overwrite')}</div>
  <div class="editor-grid"><section class="story-panel panel"><div class="panel-title">Story <span id="clip-count"></span>${button('toggle-story', 'Collapse')}</div><div id="story" tabindex="0" aria-label="Story clips"><div id="story-space"></div></div><div class="panel-foot">${button('add', 'Add clip')}${button('group', 'Group with next')}</div></section>
  <section class="canvas-panel panel"><div class="panel-title">Canvas <span id="selection-label"></span></div><div class="player" id="canvas" tabindex="0" aria-label="Canvas"><video id="preview-video" muted playsinline preload="metadata"></video><canvas id="preview-still" width="960" height="540"></canvas><div id="preview-text"></div></div><div class="preview-label">Editorial preview · source proxy / thumbnail + text. Final compositing not available.</div><div class="transport">${button('reverse', 'J ◀')}${button('play', 'Space · Play')}${button('pause', 'K ■')}${button('forward', 'L ▶')}<output id="time">0 f</output><input id="seek" type="range" min="0" value="0" aria-label="Playhead frame"></div></section>
  <section class="inspector-panel panel"><div class="panel-title">Inspector ${button('toggle-inspector', 'Collapse')}</div><div id="inspector"></div></section></div>
  <section class="timeline-panel panel"><div class="panel-title">Timeline <span id="scope" aria-live="polite">Select a clip to edit</span><label>Zoom <input id="zoom" type="range" min="0.5" max="8" step="0.25" value="1"></label><label><input id="snap" type="checkbox" checked> Snap</label></div><div id="timeline"><div id="timeline-space"><div id="beats"></div><div id="lane"></div><div id="playhead"></div></div></div><div class="panel-foot">${button('split', 'Split · S')}${button('duplicate', 'Duplicate')}${button('delete', 'Delete')}<span class="hint">Drag story cards to reorder · drag clip edges to trim · attached layers follow</span></div></section>
  <div class="secondary-grid"><section class="panel"><div class="panel-title">Takes <span>film versions</span></div><div class="version-tools"><input id="version-name" placeholder="Name this version" aria-label="Version name">${button('save-version', 'Save version')}<select id="version-a" aria-label="Version A"></select><select id="version-b" aria-label="Version B"></select>${button('compare', 'Compare')}${button('restore-version', 'Restore A')}</div><pre id="version-diff"></pre></section><section class="panel"><div class="panel-title">Assistant proposals <span>Inspect → Apply → Undo</span></div><div id="proposals">No pending proposal. Ask the assistant for an edit.</div></section></div>
  <details class="source-panel"><summary>Source & provenance</summary>${proceduralSource(this.doc.metadata, this.doc.metadata?.shots)}${this.doc.metadata?.example ? `<p>Example copy · ${esc(this.doc.metadata.example.author)} · ${esc(this.doc.metadata.example.licence)}</p><p>${esc(this.doc.metadata.example.credit)}</p><p><a href="${esc(/^https?:\/\//.test(this.doc.metadata.example.source_url) ? this.doc.metadata.example.source_url : '#')}" target="_blank" rel="noopener noreferrer">Original source ↗</a></p>` : ''}<p>${esc(this.doc.metadata?.source?.path || '')}</p><p>${esc((this.doc.metadata?.notes || []).join(' · '))}</p><dl class="kv">${Object.entries(
    this.doc.metadata?.docs || {},
  )
    .map(
      ([name, file]) =>
        `<dt>${esc(name)}</dt><dd><a href="${esc(this.url(file))}" target="_blank" rel="noopener">${esc(file.split('/').pop())}</a></dd>`,
    )
    .join(
      '',
    )}${(this.doc.metadata?.renders || []).map((r) => `<dt>${esc(r.label)}</dt><dd><a href="${esc(this.url(r.file))}" target="_blank" rel="noopener">${esc(r.width)}×${esc(r.height)} · ${esc(r.fps)} fps · source render</a></dd>`).join('')}</dl><p>Original media stays untouched. Project: ${esc(this.absolute)}</p></details>
  <div id="assistant-slot"></div><dialog id="palette"><div class="panel-title">Commands <button data-action="close-palette">Esc · close</button></div><input id="command-search" placeholder="Find a command…" aria-label="Search commands"><div id="command-list"></div></dialog>
  <dialog id="settings"><div class="panel-title">Workspace ${button('close-settings', 'Close')}</div><label>Theme <select id="theme"><option value="system">Follow system</option><option value="studio">Studio</option><option value="paper">Paper</option><option value="dark">Dark</option><option value="light">Light</option><option value="contrast">High contrast</option><option value="custom">Custom</option></select></label><p id="theme-source" class="hint" role="status"></p><div id="custom-tokens">${['bg', 'ink', 'acc'].map((k) => `<label>${k}<input type="color" data-token="${k}" value="${this.settings.tokens?.[k] || { bg: '#0a0a0b', ink: '#ecebe7', acc: '#7fd49a' }[k]}"></label>`).join('')}</div><p>Resize side panels using their lower-right handle. Collapse choices are remembered.</p><p>Key names: Mod+z, Mod+Shift+z, Space, ArrowLeft…</p><div class="keybindings">${Object.entries(
    defaults,
  )
    .map(
      ([k, v]) =>
        `<label>${k}<input data-binding="${k}" value="${esc(this.settings.keys?.[k] || v)}"></label>`,
    )
    .join('')}</div>${button('reset-settings', 'Reset workspace')}</dialog>`;
    this.studio = new StudioView(this);
    this.studio.mount();
    if (this.doc.metadata?.procedural && !this.doc.metadata.procedural.render_verified) {
      const notice = document.createElement('div');
      notice.className = 'source-no-render';
      notice.innerHTML = '<span class="cap">Source metadata only</span><strong>No rendered preview</strong><p>Inspect source scenes, camera and events in the slate.<br>A compatible source renderer must produce the film separately.</p>';
      $('#canvas').append(notice);
      $('.preview-label').textContent = 'Metadata-only import · no verified video or playable proxy';
    }
    $('.editor-tools',this.root).insertAdjacentHTML('beforeend',button('voice','Voice · hold V')+button('import-reference','Import reference')+(this.doc.metadata?.reference ? button('compare-reference','Compare reference') : ''));
    $('#recovery').oncancel = (e) => e.preventDefault();
    this.assistant?.($('#assistant-slot', this.root));
    this.root.onclick = (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action) this.action(action).catch((err) => this.toast(err.message));
      const node = e.target.closest('[data-select]');
      if (node && !e.target.closest('[data-edge]'))
        this.action('select', { clipId: node.dataset.select }).catch((err) => this.toast(err.message));
    };
    this.storyScroll = 0;
    this.timelineScroll = 0;
    $('#story').onscroll = (e) => {
      this.storyScroll = e.target.scrollTop;
      this.renderStory();
    };
    $('#timeline').onscroll = (e) => {
      this.timelineScroll = e.target.scrollLeft;
      this.renderTimeline();
    };
    $('#zoom').oninput = (e) => {
      this.zoom = +e.target.value;
      this.updateScale();
      this.renderTimeline();
    };
    $('#seek').oninput = (e) => this.seek(+e.target.value);
    $('#video-choice').onchange = (e) => {
      this.videoId = e.target.value;
      this.selection = this.video.clips[0]?.id;
      this.frame = 0;
      this.refresh();
    };
    $('#command-search').oninput = () => this.paletteItems();
    const updateThemeInfo = info => {
      const select = $('#theme'); if (!select) return;
      for (const source of info.available) {
        if (![...select.options].some(o => o.value === 'system:' + source)) {
          const option = document.createElement('option'); option.value = 'system:' + source;
          option.textContent = 'Follow ' + ({ omarchy: 'Omarchy', noctalia: 'Noctalia', wal: 'pywal / wallust', kde: 'KDE', gnome: 'GNOME' }[source] || source); select.append(option);
        }
      }
      select.value = this.settings.theme || info.choice;
      select.options[0].textContent = 'Follow system · ' + info.label;
      $('#theme-source').textContent = info.label + (info.adjustments.length ? ' · Contrast adjusted for readability: ' + info.adjustments.join('; ') : ' · Original palette contrast retained');
    };
    this.untheme?.(); this.untheme = onTheme(info => { updateThemeInfo(info); this.studio?.drawWave(); }); updateThemeInfo(themeInfo());
    $('#theme').onchange = (e) => {
      this.settings.theme = e.target.value;
      this.saveSettings();
    };
    $$('[data-token]').forEach(
      (e) =>
        (e.oninput = () => {
          (this.settings.tokens ||= {})[e.dataset.token] = e.value;
          this.saveSettings();
        }),
    );
    $$('[data-binding]').forEach(
      (e) =>
        (e.onchange = () => {
          (this.settings.keys ||= {})[e.dataset.binding] = e.value;
          this.saveSettings();
        }),
    );
    this.resize = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target.id === 'timeline')
          this.timelineWidth = e.contentRect.width;
        else this.storyHeight = e.contentRect.height;
      }
      this.updateScale();
      this.renderStory();
      this.renderTimeline();
    });
    this.resize.observe($('#timeline'));
    this.resize.observe($('#story'));
    this.panelResize = new ResizeObserver((entries) => {
      if (this.restoringLayout) return;
      for (const e of entries) {
        if (e.target !== this.resizingPanel) continue;
        if (e.target.classList.contains('collapsed')) continue;
        const k = e.target.classList.contains('story-panel')
          ? 'storyWidth'
          : 'inspectorWidth';
        if (innerWidth >= 1024)
          this.settings[k] = Math.round(e.borderBoxSize[0].inlineSize);
      }
      storage.setItem('ffs.settings', JSON.stringify(this.settings));
    });
    for (const panel of [$('.story-panel'), $('.inspector-panel')]) {
      panel.addEventListener('pointerdown', event => {
        const rect = panel.getBoundingClientRect();
        if (rect.right - event.clientX < 16 && rect.bottom - event.clientY < 16) this.resizingPanel = panel;
      });
    }
    this.panelResizeEnd = () => {
      const panel = this.resizingPanel;
      if (panel && !panel.classList.contains('collapsed') && innerWidth >= 1024) {
        this.settings[panel.classList.contains('story-panel') ? 'storyWidth' : 'inspectorWidth'] = Math.round(panel.getBoundingClientRect().width);
        storage.setItem('ffs.settings', JSON.stringify(this.settings));
      }
      this.resizingPanel = null;
    };
    addEventListener('pointerup', this.panelResizeEnd);
    this.applySettings();
    this.panelResize.observe($('.story-panel'));
    this.panelResize.observe($('.inspector-panel'));
    this.measure();
    this.refresh();
    this.tick = 0;
    const playhead = $('#playhead');
    const loop = (t) => {
      if (this.dead) return;
      const delta = this.tick ? Math.min(t - this.tick, 100) : 0;
      this.tick = t;
      if (this.rate) {
        this.frame = advanceFrame(this.frame, delta * this.rate * fpsOf(this.doc) / 1000, this.total, this.studio.loop ? this.studio.bounds() : null);
      }
      // No layout reads, text changes, reconciliation, or decoding in the animation loop.
      playhead.style.transform = `translateX(${this.frame * this.scale}px)`;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.previewTimer = setInterval(() => this.updatePreview(), 100);
  }
  saveSettings() {
    storage.setItem('ffs.settings', JSON.stringify(this.settings));
    this.applySettings();
  }
  applySettings() {
    this.restoringLayout = true;
    setThemeSettings(this.settings);
    for (const key of ['story', 'inspector']) {
      const p = $(`.${key}-panel`);
      p.classList.toggle('collapsed', !!this.settings[key + 'Collapsed']);
      const toggle = $(`[data-action="toggle-${key}"]`);
      toggle.textContent = this.settings[key + 'Collapsed'] ? 'Expand' : 'Collapse';
      toggle.setAttribute('aria-expanded', String(!this.settings[key + 'Collapsed']));
      p.style.width =
        innerWidth >= 1024 && this.settings[key + 'Width'] && !this.settings[key + 'Collapsed']
          ? this.settings[key + 'Width'] + 'px'
          : '';
    }
    this.studio?.layout?.windowResize?.();
    queueMicrotask(() => (this.restoringLayout = false));
  }
  measure() {
    this.timelineWidth = $('#timeline').clientWidth;
    this.storyHeight = $('#story').clientHeight;
    this.updateScale();
  }
  updateScale() {
    this.scale =
      Math.max(innerWidth < 768 ? 80 / Math.max(1, Math.min(...this.video.clips.map(c => c.duration))) : this.video.clips.length > 100 ? 0.4 : 0.02, this.timelineWidth / Math.max(this.total, 1)) * this.zoom;
  }
  refresh(result) {
    if ($('.ph-title h1').textContent !== this.doc.title)
      $('.ph-title h1').textContent = this.doc.title;
    this.updateScale();
    const count = `${this.video.clips.length} clips`;
    if ($('#clip-count').textContent !== count)
      $('#clip-count').textContent = count;
    $('#seek').max = Math.max(0, this.total - 1);
    $('#story-space').style.height = `${this.video.clips.length * 112}px`;
    $('#timeline-space').style.width =
      `${Math.max(this.total * this.scale, this.timelineWidth)}px`;
    this.renderStory();
    this.renderTimeline();
    this.renderInspector();
    this.studio?.inspector();
    this.renderVersions();
    this.updatePreview(true);
    if (result) {
      $('[data-action="undo"]').disabled = !result.undo;
      $('[data-action="redo"]').disabled = !result.redo;
    }
  }
  observeThumbs(root) {
    $$('canvas[data-thumb],canvas[data-video]', root).forEach((e) => {
      if (!e.dataset.observed) {
        e.dataset.observed = '1';
        this.observer.observe(e);
      }
    });
  }
  thumb(c, poster = false) {
    const image = c.thumb ? `<canvas width="160" height="90" data-thumb="${esc(this.url(c.thumb))}" aria-label="Clip thumbnail"></canvas>` : '';
    if (!poster) return image || '<span class="thumb-empty"></span>';
    const media = this.doc.media.find(m => m.id === c.mediaId && m.kind === 'video');
    const video = media?.file || this.doc.preview.proxy || this.doc.metadata?.renders?.[0]?.file;
    const midpoint = (media ? c.sourceIn + c.duration * c.speed.num / c.speed.den / 2 : c.start + c.duration / 2) / fpsOf(this.doc);
    const words = Object.values(textOf(c)).flat().join(' ') || c.name;
    return `<div class="shot-thumbnail" title="${esc(words)}"><span class="thumb-words">${esc(words)}</span>${image || (video ? `<canvas width="160" height="90" data-video="${esc(this.url(video))}" data-midpoint="${midpoint}" aria-label="Clip midpoint poster"></canvas>` : '')}</div>`;
  }
  reconcile(map, parent, rows, render) {
    const keep = new Set();
    for (const { c, index } of rows) {
      keep.add(c.id);
      let node = map.get(c.id);
      if (!node) {
        node = document.createElement('div');
        map.set(c.id, node);
        parent.append(node);
      }
      render(node, c, index);
    }
    for (const [id, node] of map)
      if (!keep.has(id)) {
        for (const canvas of $$('canvas', node)) this.observer.unobserve(canvas);
        node.remove();
        map.delete(id);
      }
  }
  renderStory() {
    if (!this.doc) return;
    const start = Math.max(0, Math.floor(this.storyScroll / 112) - 1),
      end = Math.min(
        this.video.clips.length,
        start + Math.ceil(this.storyHeight / 112) + 3,
      );
    const rows = this.video.clips
      .slice(start, end)
      .map((c, i) => ({ c, index: start + i }));
    this.reconcile(
      this.storyNodes,
      $('#story-space'),
      rows,
      (node, c, index) => {
        const signature = JSON.stringify([
            index,
            c.name,
            c.thumb,
            c.mediaId, c.sourceIn, c.start, c.speed,
            textOf(c),
            c.duration,
          ]),
          state = signature + (c.id === this.selection);
        if (node.storyState === state) return;
        node.storyState = state;
        node.className =
          'story-card' + (c.id === this.selection ? ' selected' : '');
        node.dataset.select = c.id;
        node.dataset.colour = colourSlot(clipKind(c));
        node.setAttribute('role', 'button');
        node.tabIndex = 0;
        node.setAttribute('aria-pressed', c.id === this.selection);
        node.draggable = true;
        node.style.transform = `translateY(${index * 112}px)`;
        if (node.signature !== signature) {
          node.signature = signature;
          const thumbKey = JSON.stringify([c.thumb, c.mediaId, c.sourceIn, c.start, c.duration, c.speed]);
          if (!node.firstChild || node.thumb !== thumbKey) {
            node.thumb = thumbKey;
            node.innerHTML = `${this.thumb(c, true)}<div class="story-copy"><div class="cap"></div><strong></strong><p></p></div>`;
            this.observeThumbs(node);
          }
          $('.cap', node).textContent = `${index + 1} · ${c.duration} f`;
          $('strong', node).textContent = c.name;
          $('strong', node).title = c.name;
          const words = Object.values(textOf(c)).flat().join(' ') || c.name;
          $('.thumb-words', node).textContent = words;
          $('.shot-thumbnail', node).title = words;
          $('p', node).textContent =
            Object.values(textOf(c)).flat().join(' ') ||
            'Add words in the inspector';
        }
        node.ondragstart = (e) => e.dataTransfer.setData('text/plain', c.id);
        node.ondragover = (e) => e.preventDefault();
        node.ondrop = (e) => {
          e.preventDefault();
          this.run({
            type: 'move',
            clipId: e.dataTransfer.getData('text/plain'),
            index,
          }).catch((err) => this.toast(err.message));
        };
        node.onkeydown = (e) => {
          if (e.key === 'Enter') {
            this.action('select', { clipId: c.id }).catch((err) => this.toast(err.message));
          }
        };
      },
    );
  }
  renderTimeline() {
    if (!this.doc) return;
    const x = this.timelineScroll,
      min = x / this.scale,
      max = (x + this.timelineWidth) / this.scale,
      rows = this.video.clips
        .map((c, index) => ({ c, index }))
        .filter(
          ({ c }) =>
            c.start +
              Math.max(
                c.duration,
                ...c.attached.map((a) => a.offset + a.duration),
              ) >=
              min && c.start <= max,
        );
    $('#timeline-space').style.width =
      `${Math.max(this.total * this.scale, this.timelineWidth)}px`;
    this.reconcile(this.laneNodes, $('#lane'), rows, (node, c) => {
      const state = JSON.stringify([
        c.start,
        c.duration,
        c.sourceIn,
        c.speed,
        c.name,
        c.thumb,
        c.attached,
        c.beatLock,
        this.scale,
        c.id === this.selection,
      ]);
      if (node.laneState === state) return;
      node.laneState = state;
      node.className =
        'timeline-clip' + (c.id === this.selection ? ' selected' : '');
      node.dataset.select = c.id;
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', c.name);
      node.setAttribute('aria-pressed', c.id === this.selection);
      node.dataset.colour = colourSlot(clipKind(c));
      node.title = `${c.name} · ${c.duration} frames · ${clipKind(c)}`;
      node.style.transform = `translateX(${c.start * this.scale}px)`;
      node.style.width = `${Math.max(2, c.duration * this.scale)}px`;
      const sig = JSON.stringify([
        c.name,
        c.thumb,
        c.attached,
        c.beatLock,
        this.scale,
      ]);
      if (node.signature !== sig) {
        node.signature = sig;
        node.innerHTML = `<div class="clip-body">${this.thumb(c)}<span>${esc(c.name)}${c.beatLock ? ' ◆' : ''}</span><button class="trim left" data-edge="in" aria-label="Trim in ${esc(c.name)}"></button><button class="trim right" data-edge="out" aria-label="Trim out ${esc(c.name)}"></button></div>`;
        this.observeThumbs(node);
      }
      $$('[data-edge]', node).forEach(
        (h) => (h.onpointerdown = (e) => this.dragTrim(e, c, h.dataset.edge)),
      );
    });
    $('#timeline-space').style.height =
      '152px';
    const beats = this.video.beats.filter((b) => b >= min && b <= max),
      beatSignature = JSON.stringify([this.scale, beats]);
    if (this.beatSignature !== beatSignature) {
      this.beatSignature = beatSignature;
      $('#beats').innerHTML = beats
        .map(
          (b) =>
            `<i style="transform:translateX(${b * this.scale}px)" title="Beat ${b} f"></i>`,
        )
        .join('');
    }
    this.studio?.timeline();
    $('#timeline-space').onpointerdown = (e) => {
      if (e.button !== 0) return;
      if (!e.target.closest('.timeline-clip')) {
        const rect = $('#timeline').getBoundingClientRect();
        this.seek(
          Math.round(
            (e.clientX - rect.left + $('#timeline').scrollLeft) / this.scale,
          ),
        );
      }
    };
  }
  dragTrim(e, c, edge) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX,
      scale = this.scale;
    let cmd;
    const scopeNode = $('#scope');
    scopeNode.textContent = `${scope({ type: 'trim', clipId: c.id })} · release to apply`;
    const move = (ev) => {
      let delta = Math.round((ev.clientX - x) / scale);
      let boundary = (edge === 'out' ? c.start + c.duration : c.start) + delta;
      if ($('#snap').checked) {
        const points = [
          ...this.video.beats,
          ...this.video.clips.flatMap((c) => [c.start, c.start + c.duration]),
        ];
        let best = boundary;
        for (const p of points)
          if (
            Math.abs(p - boundary) < Math.abs(best - boundary) ||
            (best === boundary && Math.abs(p - boundary) < 8 / scale)
          )
            best = p;
        boundary = best;
        delta = boundary - (edge === 'out' ? c.start + c.duration : c.start);
      }
      cmd = {
        type: 'trim',
        clipId: c.id,
        duration: edge === 'out' ? c.duration + delta : c.duration - delta,
        ...(edge === 'in'
          ? { sourceIn: c.sourceIn + (delta * c.speed.num) / c.speed.den }
          : {}),
      };
      scopeNode.textContent = `${scope(cmd)} · ${cmd.duration} f`;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (cmd) this.run(cmd).catch((err) => this.toast(err.message));
      else this.select(c.id).catch((err) => this.toast(err.message));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up, { once: true });
  }
  renderInspector() {
    const c = this.clip,
      box = $('#inspector');
    if (!c) {
      box.signature = null;
      box.innerHTML = '<p>Select a clip in Story or Timeline.</p>';
      return;
    }
    const signature = JSON.stringify([
      c.id,
      Object.keys({ title: '', ...textOf(c) }),
      this.doc.media.map((m) => m.id),
    ]);
    if (box.signature === signature) {
      const values = {
        '#source-in': c.sourceIn,
        '#duration': c.duration,
        '#speed': c.speed.num / c.speed.den,
        '#replace-media': c.mediaId || '',
        '#style-color': this.video.styles[c.styleId]?.color || '#ecebe7',
      };
      for (const [selector, value] of Object.entries(values)) {
        const e = $(selector, box);
        if (e && e.value !== String(value)) e.value = value;
      }
      $('#beat-lock').checked = c.beatLock;
      for (const e of $$('[data-field]', box)) {
        const v = textOf(c)[e.dataset.field] ?? '';
        const value = Array.isArray(v) ? v.join('\n') : v;
        if (e.value !== value) e.value = value;
      }
      const range = $('[data-range]', box),
        text = `IN ${timecode(c.start, fpsOf(this.doc))} · ${c.start} f · ${this.doc.fps.num}/${this.doc.fps.den} fps`;
      if (range.textContent !== text) range.textContent = text;
      return;
    }
    box.signature = signature;
    const active = document.activeElement?.dataset.field,
      selectionStart = document.activeElement?.selectionStart;
    const fields = { title: '', ...textOf(c) };
    box.innerHTML = `${proceduralShot(c)}<p class="scope-label">This clip: <b>${esc(c.name)}</b><br>Timing edits ripple downstream</p><fieldset><legend>Timing · integer frames</legend><label>Source in <input id="source-in" type="number" min="0" step="1" value="${c.sourceIn}"></label><label>Duration <input id="duration" type="number" min="1" step="1" value="${c.duration}"></label><label>Speed <input id="speed" type="number" min="0.01" step="0.25" value="${c.speed.num / c.speed.den}"></label><label><input id="beat-lock" type="checkbox" ${c.beatLock ? 'checked' : ''}> Beat lock (position + duration)</label><span class="hint" data-range>IN ${timecode(c.start, fpsOf(this.doc))} · ${c.start} f · ${this.doc.fps.num}/${this.doc.fps.den} fps</span></fieldset><fieldset><legend>Words · this clip only</legend>${Object.entries(
      fields,
    )
      .map(
        ([k, v]) =>
          `<label>${esc(k)}${Array.isArray(v) ? `<textarea data-field="${esc(k)}">${esc(v.join('\n'))}</textarea>` : `<input data-field="${esc(k)}" value="${esc(v)}">`}</label>`,
      )
      .join(
        '',
      )}</fieldset><details><summary>Media & shared appearance</summary><label>Replace source<select id="replace-media"><option value="">Generated / none</option>${this.doc.media.map((m) => `<option value="${esc(m.id)}" ${m.id === c.mediaId ? 'selected' : ''}>${esc(m.file.split('/').pop())}</option>`).join('')}</select></label><label>Shared style: ${esc(c.styleId)} · affects every instance<input id="style-color" type="color" value="${this.video.styles[c.styleId]?.color || '#ecebe7'}"></label><p class="hint">Source range changes never modify media files.</p></details>`;
    const act = (cmd) =>
      this.run(cmd).catch((err) => {
        this.toast(err.message);
        box.signature = null;
        this.renderInspector();
      });
    $('#duration').onchange = (e) =>
      act({ type: 'trim', clipId: c.id, duration: +e.target.value });
    $('#source-in').onchange = (e) =>
      act({ type: 'trim', clipId: c.id, sourceIn: +e.target.value });
    $('#speed').onchange = (e) =>
      act({ type: 'retime', clipId: c.id, speed: rational(+e.target.value) });
    $('#beat-lock').onchange = (e) =>
      act({ type: 'set-beat-lock', clipId: c.id, value: e.target.checked });
    $$('[data-field]', box).forEach(
      (e) =>
        (e.onchange = () =>
          act({
            type: 'edit-text',
            clipId: c.id,
            field: e.dataset.field,
            value: Array.isArray(fields[e.dataset.field])
              ? e.value.split('\n')
              : e.value,
          })),
    );
    $('#replace-media').onchange = (e) =>
      act({ type: 'replace', clipId: c.id, mediaId: e.target.value || null });
    $('#style-color').onchange = (e) =>
      act({ type: 'edit-style', styleId: c.styleId, color: e.target.value });
    if (active) {
      const e = $(`[data-field="${CSS.escape(active)}"]`, box);
      e?.focus();
      e?.setSelectionRange(selectionStart, selectionStart);
    }
  }
  renderVersions() {
    const signature = JSON.stringify([
      this.videoId,
      this.doc.versions.map((v) => [v.id, v.name]),
    ]);
    if (this.versionSignature === signature) return;
    this.versionSignature = signature;
    for (const id of ['version-a', 'version-b']) {
      const e = $('#' + id),
        old = e.value;
      e.innerHTML = this.doc.versions
        .filter((v) => v.videoId === this.video.id)
        .map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`)
        .join('');
      if (old) e.value = old;
    }
    if (this.doc.versions.length > 1)
      $('#version-b').value = this.doc.versions.at(-1).id;
  }
  async run(cmd) {
    if (this.loading) throw Error('Project is still opening');
    cmd = { videoId: this.videoId, ...cmd };
    const label = scope(cmd);
    if ($('#scope').textContent !== label) $('#scope').textContent = label;
    const before = this.doc;
    const result = this.store.commit(cmd);
    if (before === this.doc) return result;
    this.dirty = true;
    if ($('#save-status').textContent !== 'Unsaved changes')
      $('#save-status').textContent = 'Unsaved changes';
    this.patchViews(result);
    this.onChange?.(this.doc);
    this.journal?.append(
      cmd.type === 'undo' || cmd.type === 'redo' ? cmd : this.store.past.at(-1).cmd,
      this.doc.revision,
      cmd.type === 'undo' || cmd.type === 'redo'
        ? result.patches.filter((p) => p.path !== '/revision').map(({ path, after }) => ({ path, after }))
        : undefined,
    );
    return result;
  }
  patchViews(result) {
    const content = result.patches.filter((p) => p.path !== '/revision');
    const textOnly = content.every((p) =>
      /^\/videos\/\d+\/clips\/\d+\/textOverrides(\/|$)/.test(p.path),
    );
    if (textOnly) {
      this.renderStory();
      this.renderInspector();
      this.studio?.inspector();
      this.updatePreview(true);
      $('[data-action="undo"]').disabled = !result.undo;
      $('[data-action="redo"]').disabled = !result.redo;
    } else this.refresh(result);
  }
  async select(id, seek = true) {
    if (!this.video.clips.some((c) => c.id === id)) return;
    const previous = this.selection;
    this.selection = id;
    const receipt = this.store.commit({
      type: 'select',
      clipId: id,
      videoId: this.videoId,
    });
    this.renderStory();
    this.renderTimeline();
    this.renderInspector();
    this.studio?.inspector();
    $('#selection-label').textContent = this.clip.name;
    if (seek) this.seek(this.clip.start);
    return { ...receipt, inverse: { type:'select', clipId:previous } };
  }
  seek(frame) {
    if(!Number.isFinite(frame))throw Error('Choose a finite playhead frame');
    this.frame = Math.max(0, Math.min(this.total - 1, Math.round(frame)));
    this.updatePreview(true);
  }
  updatePreview(force = false) {
    if (!this.doc) return;
    if (!force && this.lastFrame === Math.floor(this.frame)) return;
    this.lastFrame = Math.floor(this.frame);
    const c = this.video.clips.find(
      (c) => this.frame >= c.start && this.frame < c.start + c.duration,
    );
    if (c) this.studio?.preview(c);
    this.reference?.sync();
    if (+$('#seek').value !== Math.floor(this.frame))
      $('#seek').value = Math.floor(this.frame);
    if (!c) return;
    const sig = JSON.stringify([c.id, textOf(c), this.video.styles[c.styleId]]);
    if (sig !== this.previewSignature) {
      this.previewSignature = sig;
      $('#preview-text').innerHTML = Object.entries(textOf(c)).flatMap(([field,value]) => (Array.isArray(value) ? value : [value]).filter(Boolean).map(line => `<span class="preview-line" data-word="${esc(field)}">${esc(line)}</span>`)).join('');
      $('#preview-text').dataset.select = c.id;
      $('#preview-video').dataset.select = c.id;
      $('#preview-still').dataset.select = c.id;
      const colour = this.video.styles[c.styleId]?.color || '';
      $('#preview-text').style.color = colour;
      $('#canvas').dataset.customInk = String(!!colour && colour !== '#ecebe7');
      const still = $('#preview-still'),
        src = c.thumb || this.doc.preview.poster;
      still.style.display = src ? 'block' : 'none';
      if (src && this.previewThumb !== src) {
        this.previewThumb = src;
        const id = ++this.seq;
        this.thumbTargets.set(id, still);
        this.thumbs.postMessage({ id, url: this.url(src) });
      }
    }
    const video = $('#preview-video');
    const proxy = this.doc.preview.proxy;
    // Imported master proxies can be mapped by original source frames. Independent sources use stills.
    const useProxy = proxy && c.mediaId === this.doc.media[0]?.id;
    video.hidden = !useProxy;
    if (useProxy) {
      const src = this.url(proxy);
      if (video.getAttribute('src') !== src) video.src = src;
      const t =
        (c.sourceIn + ((this.frame - c.start) * c.speed.num) / c.speed.den) /
        fpsOf(this.doc);
      if (force || Math.abs(video.currentTime - t) > 0.12)
        video.currentTime = t;
      video.playbackRate = Math.max(
        0.0625,
        Math.min(16, (c.speed.num / c.speed.den) * Math.max(1, this.rate)),
      );
      if (this.rate > 0) {
        video.play().catch(() => {});
      } else video.pause();
    }
  }
  async save() {
    if (this.loading) return false;
    if (this.saving) return this.saving;
    if (this.conflict) {
      this.toast('Resolve the external change before saving');
      return false;
    }
    const captured = this.doc,
      base = this.baseRaw;
    $('#save-status').textContent = 'Saving…';
    this.saving = (async () => {
      try {
        const body = await this.rpc('serialize', captured);
        await this.journal?.prepareSave(body, captured.revision).catch((error) => this.toast('Autosave failed: ' + error.message));
        const r = await request(`/fs?path=${encodeURIComponent(this.path())}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-FFS-Expected': await fileHash(base),
          },
          body,
        });
        if (r.status === 409) {
          this.externalConflict();
          return false;
        }
        if (!r.ok) throw Error('Save failed: ' + r.status);
        const read = await this.api.read(this.path());
        if (read.content !== body) {
          this.externalConflict();
          return false;
        }
        this.baseRaw = body;
        await this.journal?.checkpoint(body, captured.revision).catch((error) => this.toast('Autosave failed: ' + error.message));
        this.dirty = this.doc !== captured;
        $('#save-status').textContent = this.dirty
          ? 'Unsaved changes'
          : 'Saved';
        return true;
      } catch (e) {
        $('#save-status').textContent = 'Save failed';
        this.toast(e.message);
        return false;
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }
  externalConflict() {
    this.conflict = true;
    $('#external').hidden = false;
    $('#save-status').textContent = 'External conflict · local edits kept';
  }
  async external(path) {
    await this.opening;
    if (this.dead) return;
    if (path === this.path()) {
      if (this.saving) {
        await this.saving;
        return;
      }
      const r = await this.api.read(path);
      if (r.content === this.baseRaw) return;
      if (this.dirty || this.journal?.recovery.length) {
        this.externalConflict();
        return;
      }
      const previous = this.store, current = this.doc;
      const opened = await this.rpc('open', r.content);
      if (this.dead) return;
      if (this.store !== previous || this.doc !== current || this.dirty || this.journal?.recovery.length) {
        this.externalConflict();
        return;
      }
      this.loading = true;
      this.root.inert = true;
      try {
        this.store = new CommandStore(opened.doc);
        this.baseRaw = r.content;
        await this.openJournal(r.content);
      } finally {
        this.loading = false;
        this.root.inert = false;
      }
      this.refresh();
      this.onChange?.(this.doc);
      this.toast('Loaded external changes');
    } else if (
      path.startsWith(`projects/${this.doc.id}/proposals/`) &&
      path.endsWith('.json')
    ) {
      try {
        const r = await this.api.read(path);
        this.receiveProposal(JSON.parse(r.content), path);
      } catch (e) {
        this.toast('Proposal could not be read: ' + e.message);
      }
    }
  }
  async receiveProposal(p, path = 'proposal') {
    this.pendingProposal = p;
    this.proposalPath = path;
    const box = $('#proposals');
    box.innerHTML = `<b>${esc(p.title || 'Assistant edit')}</b><p>Revision ${esc(p.baseRevision)} · ${p.commands?.length || 0} commands</p>${button('inspect-proposal', 'Inspect')}${button('apply-proposal', 'Apply')}${button('reject-proposal', 'Reject')}<pre id="proposal-diff"></pre>`;
    this.studio.showTab('assistant');
    if (this.settings.inspectorCollapsed) { this.settings.inspectorCollapsed = false; this.saveSettings(); }
    await this.inspectProposal();
  }
  async inspectProposal() {
    try {
      const result = await this.rpc('proposal', { document: this.doc, command: this.pendingProposal });
      $('#proposal-diff').textContent =
        result.scope + '\n' + JSON.stringify(result.diff, null, 2);
      this.proposalValid = true;
    } catch (e) {
      $('#proposal-diff').textContent = e.message;
      this.proposalValid = false;
    }
    $('[data-action="apply-proposal"]').disabled = !this.proposalValid;
  }
  paletteItems() {
    const q = $('#command-search').value.toLowerCase();
    const names = Object.keys(ACTIONS).filter(n => ACTIONS[n].palette && !/^(close-|recover|discard-|keep-|reload-|inspect-|reject-|apply-)/.test(n));
    $('#command-list').innerHTML = names
      .filter((n) => [n, ACTIONS[n].title, ...ACTIONS[n].synonyms].join(' ').includes(q))
      .map(
        (n) =>
          `<button data-action="${n}" class="palette-row"><span>${esc(n.replaceAll('-', ' '))}</span><kbd>${esc(this.settings.keys?.[n] || defaults[n] || '—')}</kbd></button>`,
      )
      .join('');
  }
  async recover(discard) {
    if (this.recovering) return;
    this.recovering = true;
    try {
      if (discard) await this.journal.checkpoint(this.baseRaw, this.doc.revision, true);
      else {
        const entries = this.journal.recovery;
        await this.rpc('replay', { document: this.doc, entries });
        for (const entry of entries) await this.run(recoveryCommand(entry));
        await this.journal.flush();
        this.journal.recovery = [];
      }
      $('#recovery').close();
    } finally {
      this.recovering = false;
    }
  }
  shortcut(a) {
    return this.settings.keys?.[a] ?? defaults[a] ?? '';
  }
  contextItems(target) {
    if (this.loading || !this.doc || $('dialog[open]')) return null;
    const item = (id, label, disabled = false, clipId) => ({
      id, label, disabled, shortcut: this.shortcut(id),
      run: () => this.action(id, { clipId }),
    });
    const history = [item('undo', 'Undo', !this.store.past.length), item('redo', 'Redo', !this.store.future.length)];
    const clipNode = target.closest('.story-card,.timeline-clip');
    if (clipNode) {
      const c = this.video.clips.find((c) => c.id === clipNode.dataset.select);
      if (!c) return null;
      const clipItem = (id, label, disabled) => item(id, label, disabled, c.id);
      const at = Math.round(this.frame) - c.start;
      const inside = at > 0 && at < c.duration;
      const rippleLocked = this.video.clips.slice(this.video.clips.indexOf(c) + 1).some((clip) => clip.beatLock);
      return { label: 'Clip actions', invoker: clipNode, items: [
        clipItem('select', 'Select'),
        clipItem('play-here', 'Play from here'),
        clipItem('seek-start', 'Seek to start'),
        clipItem('edit-text', 'Edit title'), null,
        clipItem('group', 'Group with next', this.video.clips.at(-1) === c),
        clipItem('duplicate', 'Duplicate', rippleLocked),
        clipItem('split', 'Split at playhead', c.beatLock || !inside || !Number.isInteger(at * c.speed.num / c.speed.den)),
        clipItem('delete', 'Delete', c.beatLock || rippleLocked), null,
        item('add', 'Add clip'),
        clipItem('move', 'Move to position…', c.beatLock),
        clipItem('trim', 'Trim…', c.beatLock),
        clipItem('in', 'Set in at playhead', c.beatLock || rippleLocked || !inside || !Number.isInteger(at * c.speed.num / c.speed.den)),
        clipItem('out', 'Set out at playhead', c.beatLock || rippleLocked || !inside),
        clipItem('replace', 'Replace source…'),
        clipItem('set-beat-lock', c.beatLock ? 'Unlock beat' : 'Lock to beat'),
        clipItem('retime', 'Retime…', c.beatLock),
        clipItem('edit-style', 'Edit shared style…'), null, ...history,
      ] };
    }
    const canvas = target.closest('#canvas');
    if (canvas) return { label: 'Canvas actions', invoker: canvas, items: [
      item('play', this.rate ? 'Pause' : 'Play'),
      item('previousFrame', 'Previous frame', this.frame <= 0),
      item('nextFrame', 'Next frame', this.frame >= this.total - 1), null,
      item('copy-timecode', 'Copy timecode'),
    ] };
    return { label: 'Workspace actions', items: [
      item('palette', 'Command palette'), item('settings', 'Workspace settings'), null, ...history,
    ] };
  }
  ensureVoice() {
    return this.voiceLoading ||= import('./voice.js').then(({VoiceControl})=>{
      if(this.dead)throw Error('Editor closed');this.voice=new VoiceControl(this);return this.voice;
    });
  }
  ensureReference() {
    return this.referenceLoading ||= import('./reference.js').then(({ReferenceDesk})=>{
      if(this.dead)throw Error('Editor closed');this.reference=new ReferenceDesk(this);return this.reference;
    });
  }
  action(id, params = {}) {
    return Promise.resolve().then(() => studioAction(id).apply(this, params, { interactive: true }));
  }
  async performAction(a, params = {}) {
    const { clipId } = params;
    if (a === 'component-lab') return window.open('/app/labs/video-styles.html', '_blank', 'noopener,noreferrer');
    if (a === 'voice') return (await this.ensureVoice()).toggle();
    if (a === 'import-reference') return (await this.ensureReference()).open();
    if (a === 'compare-reference') return (await this.ensureReference()).compareProject();
    if (a === 'seek') return this.seek(params.frame);
    if (a === 'open-panel') { this.studio.showTab(params.panel); return; }
    if (this.loading) return;
    if (['loop-shot','loop-film','mute','screening'].includes(a)) return this.studio.action(a);
    if (a !== 'palette' && a !== 'close-palette' && $('#palette').open)
      $('#palette').close();
    if (a === 'recover' || a === 'discard-recovery') return this.recover(a === 'discard-recovery');
    if ($('#recovery').open) return;
    if (clipId) {
      if (!this.video.clips.some((c) => c.id === clipId)) return;
      if (a === 'select') return this.select(clipId);
      if (this.selection !== clipId) await this.select(clipId, false);
    }
    const c = this.clip;
    if (a === 'seek-start' || a === 'play-here') {
      if (!c) return;
      this.seek(c.start);
      if (a === 'play-here') return this.action('forward');
      return;
    }
    if (a === 'copy-timecode') {
      const frame = Math.floor(this.frame), fps = Math.round(fpsOf(this.doc));
      const seconds = Math.floor(frame / fps);
      const timecode = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frame % fps]
        .map((n) => String(n).padStart(2, '0')).join(':');
      await navigator.clipboard.writeText(timecode);
      this.toast('Copied ' + timecode);
      return;
    }
    if (a === 'save') return this.save();
    if (a === 'undo' || a === 'redo') {
      return this.run({ type: a });
    }
    if (a === 'play') {
      this.rate = this.rate ? 0 : 1;
      return;
    }
    if (a === 'pause') {
      this.rate = 0;
      return;
    }
    if (a === 'forward') {
      this.rate = 1;
      return;
    }
    if (a === 'reverse') {
      this.rate = -1;
      return;
    }
    if (a === 'previousFrame' || a === 'nextFrame') {
      this.rate = 0;
      this.seek(this.frame + (a === 'nextFrame' ? 1 : -1));
      return;
    }
    if (a === 'previousClip' || a === 'nextClip') {
      const i = this.video.clips.indexOf(c);
      this.select(
        this.video.clips[
          Math.max(
            0,
            Math.min(
              this.video.clips.length - 1,
              i + (a === 'nextClip' ? 1 : -1),
            ),
          )
        ]?.id,
      );
      return;
    }
    if (a === 'palette') {
      this.paletteItems();
      $('#palette').showModal();
      $('#command-search').focus();
      return;
    }
    if (a === 'close-palette') {
      return $('#palette').close();
    }
    if (a === 'settings') {
      return $('#settings').showModal();
    }
    if (a === 'close-settings') return $('#settings').close();
    if (a === 'reset-settings') {
      this.settings = {};
      this.saveSettings();
      return;
    }
    if (a.startsWith('toggle-')) {
      const k = a.slice(7) + 'Collapsed';
      this.settings[k] = !this.settings[k];
      this.saveSettings();
      return;
    }
    if (a === 'save-copy') { try { await saveCopy(this.doc); this.toast('Copy saved to your projects folder'); } catch(error) { this.toast(error.message); } return; }
    if (a === 'export-project') { exportProject(this.doc.id, await this.rpc('serialize', this.doc)); return; }
    if (a === 'export') {
      this.toast(
        isLocal() ? 'Video export needs the local bridge. Export project.json to keep your edits.' : 'Video export unavailable: compositing engine is not qualified. Your project can be saved.',
      );
      return;
    }
    if (a === 'reload-external') {
      if (!confirm('Discard local edits and load the disk version?')) return;
      const r = await this.api.read(this.path());
      this.store = new CommandStore((await this.rpc('open', r.content)).doc);
      this.baseRaw = r.content;
      await this.journal?.checkpoint(r.content, this.doc.revision, true);
      await this.openJournal(r.content);
      this.dirty = false;
      this.conflict = false;
      $('#external').hidden = true;
      $('#save-status').textContent = 'Loaded disk version';
      this.refresh();
      this.onChange?.(this.doc);
      return;
    }
    if (a === 'keep-local') {
      const r = await this.api.read(this.path());
      const changes = await this.rpc('compare', [
        JSON.parse(r.content),
        this.doc,
      ]);
      if (
        !confirm(
          `${changes.length} differences from disk. Replace disk with your local document on Save?`,
        )
      )
        return;
      this.baseRaw = r.content;
      this.conflict = false;
      $('#external').hidden = true;
      return;
    }
    if (a === 'inspect-proposal') return this.inspectProposal();
    if (a === 'reject-proposal') {
      this.pendingProposal = null;
      $('#proposals').textContent = 'Rejected · document unchanged';
      return;
    }
    if (a === 'apply-proposal') {
      await this.run(proposalCommand(this.pendingProposal, this.doc));
      $('#proposals').textContent = 'Applied · one undo step';
      this.pendingProposal = null;
      return;
    }
    if (a === 'save-version')
      return this.run({
        type: a,
        id: uid('version'),
        name:
          $('#version-name').value || `Version ${this.doc.versions.length + 1}`,
      });
    if (a === 'restore-version')
      return this.run({ type: a, id: $('#version-a').value });
    if (a === 'compare') {
      const va = this.doc.versions.find((v) => v.id === $('#version-a').value),
        vb = this.doc.versions.find((v) => v.id === $('#version-b').value);
      if (!va || !vb) return this.toast('Save two versions first');
      $('#version-diff').textContent = JSON.stringify(
        await this.rpc('compare', [va.video, vb.video]),
        null,
        2,
      );
      return;
    }
    if (a === 'add')
      return this.run({
        type: 'add',
        clip: {
          id: uid('clip'),
          name: 'New clip',
          duration: Math.round(fpsOf(this.doc) * 3),
        },
      });
    if (!c) return this.toast('Select a clip first');
    if (a === 'split')
      return this.run({
        type: a,
        clipId: c.id,
        at: Math.round(this.frame) - c.start,
        newId: uid('clip'),
      });
    if (a === 'in')
      return this.run({
        type: 'trim',
        clipId: c.id,
        sourceIn:
          c.sourceIn +
          ((Math.round(this.frame) - c.start) * c.speed.num) / c.speed.den,
        duration: c.duration - (Math.round(this.frame) - c.start),
      });
    if (a === 'out')
      return this.run({
        type: 'trim',
        clipId: c.id,
        duration: Math.round(this.frame) - c.start,
      });
    if (a === 'duplicate' || a === 'delete')
      return this.run({ type: a, clipId: c.id, newId: uid('clip') });
    if (a === 'group') {
      const i = this.video.clips.indexOf(c);
      return this.run({
        type: a,
        clipIds: this.video.clips.slice(i, i + 2).map((x) => x.id),
        id: uid('scene'),
        name: c.name + ' scene',
      });
    }
    if (a === 'set-beat-lock')
      return this.run({ type: a, clipId: c.id, value: !c.beatLock });
    if (a === 'move') {
      const i = prompt(
        'Move to clip position (1-based)',
        this.video.clips.indexOf(c) + 1,
      );
      if (i !== null)
        return this.run({ type: a, clipId: c.id, index: Number(i) - 1 });
      return;
    }
    const targets = {
      select: '#story',
      trim: '#duration',
      replace: '#replace-media',
      'edit-text': '[data-field="title"]',
      retime: '#speed',
      'edit-style': '#style-color',
    };
    if (targets[a]) {
      if (a !== 'select' && this.settings.inspectorCollapsed) {
        this.settings.inspectorCollapsed = false;
        this.saveSettings();
      }
      if (a !== 'select') this.studio.showTab('shot');
      $(targets[a])?.closest('details')?.setAttribute('open', '');
      $(targets[a])?.focus();
    }
  }
  key(e) {
    if(e.code==='KeyV'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&!e.target.isContentEditable&&!e.target.closest('input,textarea,select,[contenteditable]')&&!document.querySelector('dialog[open]')) {
      e.preventDefault();
      if(!e.repeat){this.voiceHeld=true;this.ensureVoice().then(v=>{if(this.voiceHeld){v.held=true;v.start();}}).catch(e=>{if(!this.dead)this.toast(e.message);});}
      return;
    }
    if (e.key === 'Escape') return;
    const typing = e.target.matches('input,textarea,select') || e.target.isContentEditable,
      mod = e.ctrlKey || e.metaKey;
    const key =
      (mod ? 'Mod+' : '') +
      (e.shiftKey ? 'Shift+' : '') +
      (e.code === 'Space'
        ? 'Space'
        : e.key.length === 1
          ? e.key.toLowerCase()
          : e.key);
    const bindings = { ...defaults, ...this.settings.keys };
    const action = Object.keys(bindings).find((a) => bindings[a] === key);
    if (!action || (typing && !mod)) return;
    if ($('#settings')?.open || $('#recovery')?.open) return;
    e.preventDefault();
    this.action(action).catch((err) => this.toast(err.message));
  }
  destroy() {
    this.dead = true;
    this.voice?.destroy();
    this.reference?.destroy();
    this.studio?.destroy();
    cancelAnimationFrame(this.raf);
    clearInterval(this.previewTimer);
    this.journal?.close();
    this.untheme?.();
    this.worker.terminate();
    this.thumbs.terminate();
    this.posterDecoder.destroy();
    this.observer.disconnect();
    this.resize?.disconnect();
    this.panelResize?.disconnect();
    removeEventListener('pointerup', this.panelResizeEnd);
    removeEventListener('keydown', this.keyHandler);
    removeEventListener('keyup',this.voiceRelease);removeEventListener('blur',this.voiceBlur);
    removeEventListener('beforeunload', this.beforeUnload);
  }
}
