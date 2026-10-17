export function nativeTextMenu(target) {
  return target instanceof Element && (
    target.closest('input,textarea') || target.isContentEditable
  );
}

export class ContextMenu {
  constructor(resolve, onError) {
    this.resolve = resolve;
    this.onError = onError;
    this.menu = document.createElement('div');
    this.menu.className = 'context-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.tabIndex = -1;
    this.menu.hidden = true;
    document.body.append(this.menu);
    document.addEventListener('contextmenu', (event) => {
      if (nativeTextMenu(event.target)) { this.close(false); return; }
      event.preventDefault();
      if (this.menu.contains(event.target)) return;
      this.open(event.target, event.clientX, event.clientY);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        if (nativeTextMenu(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this.menu.hidden) return;
        const rect = event.target.getBoundingClientRect();
        this.open(event.target, rect.left, rect.bottom);
        return;
      }
      if (this.menu.hidden) return;
      // Keep menu keys out of the editor's customizable shortcut handler.
      event.stopImmediatePropagation();
      const items = [...this.menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (index >= 0) items[index].click();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        this.close();
      }
    }, true);
    document.addEventListener('pointerdown', (event) => {
      if (!this.menu.contains(event.target)) this.close();
    }, true);
    document.addEventListener('focusin', (event) => {
      if (!this.menu.hidden && !this.menu.contains(event.target)) this.close(false);
    });
    document.addEventListener('scroll', (event) => {
      if (!this.menu.contains(event.target)) this.close();
    }, true);
    addEventListener('resize', () => this.close());
    addEventListener('hashchange', () => this.close(false));
    addEventListener('blur', () => this.close());
  }
  open(target, x, y) {
    this.close(false);
    for (const name of ['open', 'ready', 'first-paint']) performance.clearMarks('context-menu:' + name);
    for (const name of ['open-ready', 'open-paint']) performance.clearMeasures('context-menu:' + name);
    performance.mark('context-menu:open');
    const context = this.resolve(target);
    if (!context?.items.length) return;
    this.invoker = context.invoker || target;
    if (!this.invoker.matches('a,button,input,select,textarea,[tabindex]'))
      this.invoker.tabIndex = -1;
    const host = target.closest('dialog[open]') || document.body;
    host.append(this.menu);
    this.menu.setAttribute('aria-label', context.label);
    this.menu.replaceChildren();
    for (const item of context.items) {
      if (!item) {
        const separator = document.createElement('div');
        separator.setAttribute('role', 'separator');
        this.menu.append(separator);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.dataset.menuAction = item.id;
      button.disabled = !!item.disabled;
      button.setAttribute('aria-disabled', String(button.disabled));
      const label = document.createElement('span');
      label.textContent = item.label;
      const shortcut = document.createElement('kbd');
      shortcut.textContent = item.shortcut || '';
      button.append(label, shortcut);
      button.onclick = () => {
        if (button.disabled) return;
        this.close();
        Promise.resolve().then(item.run).catch(this.onError);
      };
      button.onpointermove = () => { if (!button.disabled) button.focus(); };
      this.menu.append(button);
    }
    this.menu.hidden = false;
    this.menu.style.transform = 'translate(0px, 0px)';
    const rect = this.menu.getBoundingClientRect(), margin = 6;
    const left = Math.max(margin, Math.min(x, innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(y, innerHeight - rect.height - margin));
    // Position on the menu's own layer without a second layout after measuring.
    this.menu.style.transform = `translate(${left}px, ${top}px)`;
    (this.menu.querySelector('[role="menuitem"]:not(:disabled)') || this.menu).focus({ preventScroll: true });
    performance.mark('context-menu:ready');
    performance.measure('context-menu:open-ready', 'context-menu:open', 'context-menu:ready');
    // The task after rAF runs after the browser's first rendering opportunity.
    this.paintFrame = requestAnimationFrame(() => {
      this.paintTask = setTimeout(() => {
        performance.mark('context-menu:first-paint');
        performance.measure('context-menu:open-paint', 'context-menu:open', 'context-menu:first-paint');
      }, 0);
    });
  }
  close(restoreFocus = true) {
    cancelAnimationFrame(this.paintFrame);
    clearTimeout(this.paintTask);
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    if (restoreFocus && this.invoker?.isConnected) this.invoker.focus({ preventScroll: true });
  }
}
