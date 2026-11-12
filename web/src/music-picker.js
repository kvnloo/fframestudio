// <ffs-music-picker>: audition a shortlist of soundtracks, scrub each waveform, heart favourites
// and share picks as a URL. Standalone (src="tracks.json") or inside the studio (.tracks = [...]).
// Manifest: { title, note, tracks: [{ id, file, title, author, license, license_url, source_url,
//   bpm, duration_s, group, peaks: [0..1] }] }. Emits "ffs-pick" ({ detail: track }) when `selectable`.
const CSS = `
:host{--bg:#0b0c0b;--bg2:#111311;--ink:#eeede6;--mute:#93958b;--line:#292d27;--line2:#454a40;--acc:#79c9a7;--wave:#454a40;
 display:block;color:var(--ink);font:14px/1.4 "Instrument Sans",system-ui,sans-serif}
*{box-sizing:border-box}button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
.head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px}
h2{font:400 clamp(22px,5vw,34px)/1 "Archivo Black",system-ui,sans-serif;margin:0;letter-spacing:-.01em}
.note{color:var(--mute);margin:6px 0 0;max-width:60ch}
.cap{font:11px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.group{margin:18px 0 6px}
.row{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:10px 12px;border:1px solid var(--line);
 border-radius:10px;background:var(--bg2);margin:6px 0;transition:border-color .15s}
.row.on{border-color:var(--acc)}.row.fav{box-shadow:inset 3px 0 var(--acc)}
.play{width:44px;height:44px;border-radius:50%;border:1px solid var(--line2);display:grid;place-items:center;font-size:15px}
.row.on .play{background:var(--acc);color:var(--bg);border-color:var(--acc)}
.meta{min-width:0}.t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.a{color:var(--mute);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.a a{color:inherit}
.side{display:flex;align-items:center;gap:10px}.chip{border:1px solid var(--line2);border-radius:99px;padding:2px 8px}
.heart{font-size:20px;width:36px;height:36px;color:var(--mute)}.heart[aria-pressed=true]{color:var(--acc)}
.use{border:1px solid var(--acc);color:var(--acc);border-radius:99px;padding:4px 10px;font-size:12px}
.wave{grid-column:1/-1;position:relative;height:44px;cursor:pointer;touch-action:none;border-radius:6px}
canvas{width:100%;height:100%;display:block}
.time{position:absolute;right:4px;top:2px;font:11px "IBM Plex Mono",ui-monospace,monospace;color:var(--ink);background:var(--bg);border-radius:4px;padding:1px 5px;pointer-events:none}.time:empty{display:none}
.bar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px;margin-top:14px;
 background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-top:1px solid var(--line)}
.share{background:var(--acc);color:var(--bg);border-radius:99px;padding:8px 14px;font-weight:700}
.theirs{color:var(--acc)}
@media (max-width:520px){.row{grid-template-columns:44px minmax(0,1fr)}.side{grid-column:1/-1;justify-content:space-between}}`;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safe = (u) => (/^https?:\/\//.test(u || '') ? u : null);

export class MusicPicker extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.current = null;
    this.data = { tracks: [] };
    this.favs = new Set();
    this.theirs = new Set();
    for (const k of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata']) this.audio.addEventListener(k, () => this.tick());
    this.audio.addEventListener('ended', () => this.step(1));
  }
  static observedAttributes = ['src'];
  async attributeChangedCallback(name, _, value) {
    if (name !== 'src' || !value) return;
    const base = new URL(value, location.href);
    const data = await fetch(base).then((r) => { if (!r.ok) throw Error(`tracks ${r.status}`); return r.json(); });
    data.tracks = data.tracks.map((t) => ({ ...t, url: new URL(t.file, base).href }));
    this.manifest = data;
  }
  set tracks(list) { this.manifest = { tracks: list }; }
  set manifest(data) {
    this.data = data;
    // Picks travel in the hash, so a friend can send their shortlist straight back.
    const hash = new URLSearchParams(location.hash.slice(1));
    this.theirs = new Set((hash.get('picks') || '').split(',').filter(Boolean));
    this.render();
  }
  disconnectedCallback() { this.audio.pause(); }
  get selectable() { return this.hasAttribute('selectable'); }
  render() {
    const d = this.data, groups = [...new Set(d.tracks.map((t) => t.group || ''))];
    this.root.innerHTML = `<style>${CSS}</style>
<div class="head"><div>${d.title ? `<h2>${esc(d.title)}</h2>` : ''}${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}</div>
<span class="cap">${d.tracks.length} tracks · space play · ←→ seek · ↑↓ track</span></div>
${this.theirs.size ? `<p class="cap theirs">♥ ${this.theirs.size} picked in this link</p>` : ''}
${groups.map((g) => `${g ? `<div class="cap group">${esc(g)}</div>` : ''}${d.tracks.filter((t) => (t.group || '') === g).map((t) => this.row(t)).join('')}`).join('')}
<div class="bar"><span class="cap" id="count"></span><button class="share" id="share">Copy link with my picks</button></div>`;
    this.root.querySelectorAll('.row').forEach((row) => {
      const t = d.tracks.find((x) => x.id === row.dataset.id);
      row.querySelector('.play').onclick = () => this.toggle(t);
      row.querySelector('.heart').onclick = (e) => {
        this.favs.has(t.id) ? this.favs.delete(t.id) : this.favs.add(t.id);
        e.currentTarget.setAttribute('aria-pressed', String(this.favs.has(t.id)));
        row.classList.toggle('fav', this.favs.has(t.id) || this.theirs.has(t.id));
        this.count();
      };
      row.querySelector('.use')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('ffs-pick', { detail: t, bubbles: true, composed: true })));
      const wave = row.querySelector('.wave');
      const seek = (e) => {
        const r = wave.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        if (this.current !== t) this.load(t);
        const go = () => { this.audio.currentTime = f * (this.audio.duration || t.duration_s || 0); this.audio.play().catch(() => {}); };
        this.audio.readyState >= 1 ? go() : this.audio.addEventListener('loadedmetadata', go, { once: true });
      };
      wave.onpointerdown = (e) => { wave.setPointerCapture(e.pointerId); seek(e); wave.onpointermove = seek; };
      wave.onpointerup = wave.onpointercancel = () => (wave.onpointermove = null);
      this.draw(row, t);
    });
    this.root.getElementById('share').onclick = () => this.share();
    this.count();
    if (!this.keys) {
      this.keys = true;
      this.tabIndex = 0;
      this.addEventListener('keydown', (e) => this.key(e));
    }
  }
  row(t) {
    const src = safe(t.source_url), lic = safe(t.license_url);
    return `<div class="row${this.theirs.has(t.id) ? ' fav' : ''}" data-id="${esc(t.id)}">
<button class="play" aria-label="Play ${esc(t.title)}">▶</button>
<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${src ? `<a href="${esc(src)}" target="_blank" rel="noopener">${esc(t.author)}</a>` : esc(t.author)}</div></div>
<div class="side"><span class="cap chip">${lic ? `<a style="color:inherit" href="${esc(lic)}" target="_blank" rel="noopener">${esc(t.license)}</a>` : esc(t.license || '')}</span>
${t.bpm ? `<span class="cap">${esc(t.bpm)} bpm</span>` : ''}${t.duration_s ? `<span class="cap">${fmt(t.duration_s)}</span>` : ''}
${this.selectable ? '<button class="use">Use</button>' : ''}<button class="heart" aria-label="Favourite ${esc(t.title)}" aria-pressed="false">♥</button></div>
<div class="wave" role="slider" aria-label="Scrub ${esc(t.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><canvas></canvas><span class="time"></span></div></div>`;
  }
  draw(row, t) {
    const c = row.querySelector('canvas'), r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr);
    const g = c.getContext('2d'), css = getComputedStyle(this), peaks = t.peaks?.length ? t.peaks : Array(120).fill(0.35);
    const played = this.current === t && this.audio.duration ? this.audio.currentTime / this.audio.duration : 0;
    const w = c.width / peaks.length;
    peaks.forEach((p, i) => {
      g.fillStyle = i / peaks.length < played ? css.getPropertyValue('--acc') : css.getPropertyValue('--wave');
      const h = Math.max(2 * dpr, p * c.height * 0.9);
      g.fillRect(i * w + w * 0.15, (c.height - h) / 2, w * 0.7, h);
    });
    row.querySelector('.time').textContent = this.current === t ? `${fmt(this.audio.currentTime)} / ${fmt(this.audio.duration || t.duration_s || 0)}` : '';
    row.querySelector('.wave').setAttribute('aria-valuenow', String(Math.round(played * 100)));
  }
  rowOf(t) { return t && this.root.querySelector(`.row[data-id="${window.CSS.escape(t.id)}"]`); }
  load(t) {
    const prev = this.current;
    this.current = t;
    this.audio.src = t.url || t.file;
    if (prev) { this.rowOf(prev)?.classList.remove('on'); this.draw(this.rowOf(prev), prev); }
    this.rowOf(t)?.classList.add('on');
  }
  toggle(t) {
    if (this.current !== t) this.load(t);
    this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause();
  }
  step(n) {
    const list = this.data.tracks, i = list.indexOf(this.current);
    const t = list[(i + n + list.length) % list.length];
    if (t) { this.load(t); this.audio.play().catch(() => {}); this.rowOf(t)?.scrollIntoView({ block: 'nearest' }); }
  }
  tick() {
    const row = this.rowOf(this.current);
    if (!row) return;
    row.querySelector('.play').textContent = this.audio.paused ? '▶' : 'Ⅱ';
    this.draw(row, this.current);
  }
  key(e) {
    if (e.target !== this) return;
    if (e.key === ' ') { e.preventDefault(); this.toggle(this.current || this.data.tracks[0]); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.step(e.key === 'ArrowDown' ? 1 : -1); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && this.current) { e.preventDefault(); this.audio.currentTime += e.key === 'ArrowRight' ? 5 : -5; }
  }
  count() {
    const n = this.favs.size;
    this.root.getElementById('count').textContent = n ? `♥ ${n} picked` : 'Tap ♥ on the ones you like';
  }
  shareURL() {
    const u = new URL(location.href), h = new URLSearchParams(u.hash.slice(1));
    h.set('picks', [...this.favs].join(','));
    u.hash = h.toString();
    return u.href;
  }
  async share() {
    const url = this.shareURL(), btn = this.root.getElementById('share');
    try {
      if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: this.data.title || 'Music picks', url });
      else await navigator.clipboard.writeText(url);
      btn.textContent = 'Link copied ✓';
    } catch { btn.textContent = 'Copy failed — long-press the address bar'; }
    setTimeout(() => (btn.textContent = 'Copy link with my picks'), 2000);
  }
}
if (!customElements.get('ffs-music-picker')) customElements.define('ffs-music-picker', MusicPicker);
