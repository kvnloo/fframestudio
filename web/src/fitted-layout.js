// One mounted set of views; only the Story rail changes parent at the drawer breakpoint.
const $ = s => document.querySelector(s);
export class FittedLayout {
  constructor(editor) { this.e = editor; }
  mount() {
    const e = this.e, root = e.root;
    document.body.classList.add('editing');
    const stage = document.createElement('div');
    stage.className = 'canvas-stage';
    $('#canvas').before(stage); stage.append($('#canvas'));
    root.append($('.transport'), $('.timeline-panel'));
    const splitter = document.createElement('div');
    splitter.id = 'timeline-splitter'; splitter.tabIndex = 0;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-label', 'Timeline height');
    splitter.setAttribute('aria-orientation', 'horizontal');
    $('.transport').before(splitter);
    const source = $('.source-panel');
    const takes = $('.version-tools').closest('section');
    const proposals = $('#proposals').closest('section');
    $('#takes-pane').append(takes);
    $('#assistant-pane').append($('#assistant-slot'), proposals);
    $('#source-pane').append(source);
    source.open = true;
    $('.secondary-grid').remove();
    this.storyHome = $('.editor-grid');
    this.media = matchMedia('(max-width: 1023px)');
    this.adapt = () => {
      if (this.media.matches) $('#story-pane').append($('.story-panel'));
      else this.storyHome.prepend($('.story-panel'));
      if (!this.media.matches && e.studio.tab === 'story') e.studio.showTab('shot');
      e.applySettings();
    };
    this.media.addEventListener('change', this.adapt); this.adapt();
    const set = height => {
      const max = Math.max(236, Math.min(420, innerHeight * .5));
      this.height = Math.round(Math.max(236, Math.min(max, height)));
      root.style.setProperty('--timeline-height', this.height + 'px');
      splitter.setAttribute('aria-valuemin', '236');
      splitter.setAttribute('aria-valuemax', String(Math.floor(max)));
      splitter.setAttribute('aria-valuenow', String(this.height));
    };
    set(e.settings.timelineHeight || 244);
    this.windowResize = () => set(e.settings.timelineHeight || 244);
    addEventListener('resize', this.windowResize);
    const save = () => {
      e.settings.timelineHeight = this.height;
      localStorage.setItem('ffs.settings', JSON.stringify(e.settings));
    };
    splitter.onpointerdown = ev => {
      if (ev.button !== 0) return;
      ev.preventDefault(); splitter.setPointerCapture(ev.pointerId);
      const start = ev.clientY, height = this.height;
      let wanted = height;
      const update = () => { this.raf = 0; set(wanted); };
      splitter.onpointermove = event => {
        wanted = height + start - event.clientY;
        if (!this.raf) this.raf = requestAnimationFrame(update);
      };
      splitter.onlostpointercapture = () => {
        cancelAnimationFrame(this.raf); update(); save();
        splitter.onpointermove = null;
      };
      splitter.onpointerup = event => splitter.releasePointerCapture(event.pointerId);
      splitter.onpointercancel = splitter.onpointerup;
    };
    splitter.onkeydown = ev => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)) return;
      ev.preventDefault();
      set(ev.key === 'Home' ? 236 : ev.key === 'End' ? 420 : this.height + (ev.key === 'ArrowUp' ? 16 : -16)); save();
    };
    const aspect = e.doc.canvas.width / e.doc.canvas.height;
    root.style.setProperty('--film-aspect', aspect);
    root.style.setProperty('--film-ratio', `${e.doc.canvas.width} / ${e.doc.canvas.height}`);
    // Labels that deliberately ellipsize retain their complete accessible hover text.
    const titled = '.ph-title h1,#shot-readout,.poster-hud span,.cut-meta b,.preview-label,#save-status,#scope,.film-footer span,.timeline-panel .hint';
    this.titles = new MutationObserver(records => {
      for (const record of records) {
        const node = record.target.nodeType === 3 ? record.target.parentElement : record.target;
        if (node?.matches(titled)) node.title = node.textContent;
      }
    });
    this.titles.observe(root, { childList: true, characterData: true, subtree: true });
    for (const node of root.querySelectorAll(titled)) node.title = node.textContent;
  }
  destroy() {
    this.media.removeEventListener('change', this.adapt);
    removeEventListener('resize', this.windowResize);
    cancelAnimationFrame(this.raf); this.titles.disconnect();
    document.body.classList.remove('editing');
  }
}
