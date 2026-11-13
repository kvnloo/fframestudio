// CSS immersive mode moves the existing preview stack, never replaces its media.
const $ = (selector, root = document) => root.querySelector(selector);

export class ReviewViewer {
  constructor(desk) {
    this.desk = desk;
    this.editor = desk.editor;
    this.moves = [];
    this.shell = document.createElement('section');
    this.shell.id = 'review-viewer';
    this.shell.hidden = true;
    this.shell.setAttribute('aria-label', 'Film review viewer');
    this.shell.innerHTML = `<nav class="review-viewer-head" aria-label="Viewer controls"><button type="button" class="pill" data-feedback="exit">← Edit</button><span class="review-film-title"></span><button type="button" class="pill" data-feedback="conversation" aria-expanded="false" aria-controls="review-conversation">Conversation</button><details id="review-menu"><summary aria-label="More review controls">•••</summary><div><button type="button" class="pill" data-feedback="fullscreen">Fullscreen</button><button type="button" class="pill" data-feedback="changes">Review changes</button><button type="button" class="pill" data-feedback="undo-edit">Undo edit</button><button type="button" class="pill" data-feedback="redo-edit">Redo edit</button><button type="button" class="pill" data-feedback="save-edit">Save</button><button type="button" class="pill" data-feedback="clear">Clear ink</button><button type="button" class="pill" data-feedback="download-movie">Download recording</button><button type="button" class="pill" data-feedback="download-json">Download sidecar</button><button type="button" class="pill" data-feedback="discard">Discard draft</button><button type="button" class="pill" data-feedback="voice">Short voice command</button></div></details></nav><div id="review-stage"></div><div id="review-transport"></div><div id="review-instruction"></div><aside id="review-conversation" aria-label="Assistant conversation"><div class="review-conversation-head"><strong>Conversation</strong><button type="button" class="pill" data-feedback="conversation">Close</button></div><button type="button" class="pill" data-feedback="changes">Review changes</button><div id="review-cards"></div><div id="review-assistant"></div><div id="review-changes"></div></aside>`;
    $('.review-film-title', this.shell).textContent = this.editor.doc.title;
    const offline = document.createElement('button');
    offline.type = 'button'; offline.className = 'pill'; offline.dataset.feedback = 'record';
    offline.textContent = 'Record offline review';
    $('#review-menu > div', this.shell).append(offline);
    this.editor.root.append(this.shell);
    this.shell.onclick = event => {
      const action = event.target.closest('[data-feedback]')?.dataset.feedback;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      desk.command(action).catch(error => desk.fail(error));
    };
    this.escape = event => {
      if (!desk.active || event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (this.shell.classList.contains('conversation-open')) this.conversation(false);
      else desk.exit(false);
    };
    addEventListener('keydown', this.escape);
    this.resize = new ResizeObserver(() => {
      if (!desk.active) return;
      desk.sizeInk();
      desk.paintInk();
    });
    this.resize.observe($('#canvas'));
  }

  move(node, target) {
    if (!node) return;
    const marker = document.createComment('review viewer home');
    node.before(marker);
    this.moves.push({ node, marker });
    $(target, this.shell).append(node);
  }

  enter() {
    this.scroll = { x: scrollX, y: scrollY };
    this.focus = document.activeElement;
    this.shell.hidden = false;
    this.move($('.canvas-stage', this.editor.root), '#review-stage');
    this.move($('.transport', this.editor.root), '#review-transport');
    this.frameSteps = document.createElement('span');
    this.frameSteps.className = 'review-frame-steps';
    this.frameSteps.innerHTML = `<button type="button" class="pill" data-action="previousFrame" aria-label="Previous frame">‹</button><button type="button" class="pill" data-action="nextFrame" aria-label="Next frame">›</button>`;
    $('.transport', this.shell).prepend(this.frameSteps);
    this.move($('#assistant-slot', this.editor.root), '#review-assistant');
    this.refreshAssistant();
    this.move($('#proposals', this.editor.root)?.closest('section'), '#review-changes');
    this.overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.editor.root.classList.add('reviewing');
    // Inert only the detailed editor, not its mounted preview or assistant.
    this.inert = [...this.editor.root.children].filter(node => node !== this.shell && node.tagName !== 'DIALOG');
    this.inert.forEach(node => { node.inert = true; });
    $('#canvas').focus({ preventScroll: true });
  }

  refreshAssistant() {
    const slot = $('#assistant-slot', this.editor.root);
    const draft = slot?.querySelector('#ask')?.value || '';
    this.editor.assistant?.(slot);
    const input = slot?.querySelector('#ask');
    if (input) input.value = draft;
  }

  conversation(open = !this.shell.classList.contains('conversation-open')) {
    this.shell.classList.toggle('conversation-open', open);
    $('[aria-controls="review-conversation"]', this.shell).setAttribute('aria-expanded', String(open));
    if (open) {
      $('#review-conversation', this.shell).scrollTop = 0;
      if (innerWidth <= 767) $('.review-conversation-head button', this.shell).focus({ preventScroll: true });
    } else if (innerWidth <= 767) $('[aria-controls="review-conversation"]', this.shell).focus({ preventScroll: true });
  }

  async fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (this.shell.requestFullscreen) await this.shell.requestFullscreen();
    else this.editor.toast('Fullscreen is unavailable. The immersive viewer remains open.');
  }

  exit() {
    if (document.fullscreenElement === this.shell) document.exitFullscreen().catch(() => {});
    this.frameSteps?.remove();
    for (const { node, marker } of this.moves.reverse()) marker.replaceWith(node);
    this.moves = [];
    this.inert?.forEach(node => { node.inert = false; });
    this.shell.hidden = true;
    this.editor.root.classList.remove('reviewing');
    if (!this.desk.destroyed) this.refreshAssistant();
    document.body.style.overflow = this.overflow || '';
    if (this.scroll) window.scrollTo({ left: this.scroll.x, top: this.scroll.y, behavior: 'instant' });
    if (this.focus?.isConnected) this.focus.focus({ preventScroll: true });
  }

  destroy() {
    if (!this.shell.hidden) this.exit();
    this.resize.disconnect();
    removeEventListener('keydown', this.escape);
    this.shell.remove();
  }
}
