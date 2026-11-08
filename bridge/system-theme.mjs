// Read-only desktop adapters. No config evaluation, recursive scans, or executable theme hooks.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const hex = v => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v.toLowerCase() : null;
// Bound file work; a theme is a tiny color document, not arbitrary media.
function read(file) { try { const s = fs.statSync(file); return s.isFile() && s.size <= 65536 ? fs.readFileSync(file, 'utf8') : ''; } catch { return ''; } }
function json(file) { try { return JSON.parse(read(file)); } catch { return null; } }
function fields(text) {
  const out = {}; let section = '';
  for (const line of text.split('\n')) {
    const s = line.trim().match(/^\[([^\]]+)\]$/); if (s) { section = s[1]; continue; }
    const m = line.match(/^\s*([\w.-]+)\s*=\s*["']?([^"'\r\n]+?)["']?\s*$/);
    if (m) out[(section ? section + '.' : '') + m[1]] = m[2].trim();
  }
  return out;
}
const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const blend = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v * (1 - t) + rgb(b)[i] * t).toString(16).padStart(2, '0')).join('');
const isDark = c => rgb(c).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0) < 128;
export function normalize(source, name, values) {
  const bg = hex(values.bg), fg = hex(values.fg); if (!bg || !fg) return null;
  const dark = values.dark ?? isDark(bg), edge = dark ? '#ffffff' : '#000000';
  const ansi = Array.from({ length: 16 }, (_, i) => hex(values.ansi?.[i]) || [bg, '#e75e78', '#89b482', '#d8bc75', '#82aaff', '#c099ff', '#7dcfff', fg][i % 8]);
  return { source, name, dark, bg, surface: hex(values.surface) || blend(bg, edge, 0.035), surface2: hex(values.surface2) || blend(bg, edge, 0.07), fg,
    muted: hex(values.muted) || blend(fg, bg, 0.25), border: hex(values.border) || blend(bg, fg, 0.22),
    accent: hex(values.accent) || ansi[4], accent2: hex(values.accent2) || ansi[5], danger: hex(values.danger) || ansi[1], success: hex(values.success) || ansi[2], warning: hex(values.warning) || ansi[3], ansi };
}
const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const omarchyDirs = home => ['.config/omarchy/current/theme', '.local/state/omarchy/current/theme'].map(p => path.join(home, p));
export function omarchy(home) {
  // Legacy layout + real fixture source: https://github.com/basecamp/omarchy/tree/v3.0.0/themes
  // v3 uses alacritty.toml + light.mode under ~/.config/omarchy/current/theme (symlink).
  // New format: https://github.com/basecamp/omarchy/blob/HEAD/themes/tokyo-night/colors.toml
  // and bin/omarchy-theme-set: ~/.local/state/omarchy/current/theme + theme.name.
  for (const dir of omarchyDirs(home)) {
    const a = fields(read(path.join(dir, 'alacritty.toml')));
    const modern = fields(read(path.join(dir, 'colors.toml')));
    let v = { bg: a['colors.primary.background'], fg: a['colors.primary.foreground'], ansi: ['normal', 'bright'].flatMap(s => names.map(n => a[`colors.${s}.${n}`])) };
    if (!hex(v.bg) || !hex(v.fg)) {
      const k = Object.fromEntries(read(path.join(dir, 'kitty.conf')).split('\n').map(l => l.trim().split(/\s+/, 2)));
      v = { bg: k.background, fg: k.foreground, ansi: Array.from({ length: 16 }, (_, i) => k['color' + i]) };
    }
    if (!hex(v.bg) || !hex(v.fg)) {
      const g = fields(read(path.join(dir, 'ghostty.conf')));
      const ansi = []; for (const m of read(path.join(dir, 'ghostty.conf')).matchAll(/^\s*palette\s*=\s*(\d+)\s*=\s*#?([\da-f]{6})\s*$/gmi)) if (+m[1] < 16) ansi[+m[1]] = '#' + m[2];
      const color = s => s && (s.startsWith('#') ? s : '#' + s);
      v = { bg: color(g.background), fg: color(g.foreground), ansi };
    }
    if (!hex(v.bg) || !hex(v.fg)) v = { bg: modern.background, fg: modern.foreground, accent: modern.accent, surface: modern.lighter_background,
      ansi: names.map(n => modern[n === 'black' ? 'background' : n === 'white' ? 'foreground' : n]).concat(names.map(n => modern['bright_' + n])) };
    v.dark = !fs.existsSync(path.join(dir, 'light.mode')) && modern.mode !== 'light';
    let name = read(path.join(path.dirname(dir), 'theme.name')).trim().slice(0, 100);
    try { name ||= path.basename(fs.realpathSync(dir)); } catch {}
    const p = normalize('omarchy', name || 'Omarchy', v); if (p) return p;
  }
  return null;
}
export function noctalia(home) {
  const c = json(path.join(home, '.config/noctalia/colors.json')); if (!c) return null;
  return normalize('noctalia', 'Noctalia', { bg: c.mSurface, surface: c.mSurfaceVariant, surface2: c.mHover, fg: c.mOnSurface, muted: c.mOnSurfaceVariant, border: c.mOutline, accent: c.mPrimary, accent2: c.mSecondary, danger: c.mError,
    ansi: [c.mSurface, c.mError, c.mSecondary, c.mPrimary, c.mPrimary, c.mTertiary, c.mSecondary, c.mOnSurface, c.mOutline, c.mError, c.mSecondary, c.mPrimary, c.mPrimary, c.mTertiary, c.mSecondary, c.mOnSurface] });
}
export function wal(home) {
  const c = json(path.join(home, '.cache/wal/colors.json')); if (!c) return null;
  return normalize('wal', 'pywal / wallust', { bg: c.special?.background, fg: c.special?.foreground, ansi: Array.from({ length: 16 }, (_, i) => c.colors?.['color' + i]) });
}
export function kde(home) {
  const c = fields(read(path.join(home, '.config/kdeglobals')));
  const color = s => { const n = s?.split(',').map(Number); return n?.length === 3 && n.every(v => Number.isInteger(v) && v >= 0 && v <= 255) ? '#' + n.map(v => v.toString(16).padStart(2, '0')).join('') : null; };
  return normalize('kde', 'KDE', { bg: color(c['Colors:Window.BackgroundNormal']), fg: color(c['Colors:Window.ForegroundNormal']), accent: color(c['Colors:Selection.BackgroundNormal']) });
}
export function desktopPalette(source, dark) {
  return normalize(source, source === 'gnome' ? 'GNOME' : 'Browser', dark ? { bg: '#0a0a0b', fg: '#ecebe7', accent: '#7fd49a' } : { bg: '#f1f0e9', fg: '#20251f', accent: '#246940' });
}
export async function gnome(run = exec, platform = process.platform) {
  if (platform !== 'linux') return null;
  try {
    const { stdout } = await run('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'], { timeout: 800, maxBuffer: 4096 });
    const mode = stdout.trim().replaceAll("'", '');
    return mode === 'prefer-dark' || mode === 'prefer-light' ? desktopPalette('gnome', mode === 'prefer-dark') : null;
  } catch { return null; }
}
export async function detectTheme({ home = os.homedir(), source, desktop = true, gnomeProvider = gnome } = {}) {
  const palettes = [omarchy(home), noctalia(home), wal(home)].filter(Boolean);
  // Probe once off the request path; include GNOME in available even if a file palette wins.
  const g = desktop ? await gnomeProvider() : null;
  const k = kde(home); if (g) palettes.push(g); if (k) palettes.push(k);
  const palette = (source && palettes.find(p => p.source === source)) || palettes[0] || null;
  return { palette, source: palette?.source || null, available: palettes.map(p => p.source) };
}
export function watchTheme({ home = os.homedir(), source, desktop = true, onChange }) {
  let state = { palette: null, source: null, available: [] }, closed = false, timer, running = false, again = false;
  const watches = new Map();
  const dirs = [...omarchyDirs(home).flatMap(d => [path.dirname(path.dirname(d)), path.dirname(d), d]), path.join(home, '.config/noctalia'), path.join(home, '.cache/wal'), path.join(home, '.cache'), path.join(home, '.config')];
  function attach() {
    // Re-arm after directory replacement, including Omarchy's atomic symlink swaps.
    for (const w of watches.values()) w.close(); watches.clear();
    for (let dir of dirs) {
      // Watch the nearest existing parent too: a theme engine may be installed after launch.
      while (!fs.existsSync(dir) && dir !== home && dir.startsWith(home + path.sep)) dir = path.dirname(dir);
      try { if (!watches.has(dir) && fs.statSync(dir).isDirectory()) { const w = fs.watch(dir, schedule); w.on('error', schedule); watches.set(dir, w); } } catch {}
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 100); timer.unref(); }
  async function refresh() {
    if (closed) return; if (running) { again = true; return; } running = true;
    try { const next = await detectTheme({ home, source, desktop }); if (closed) return;
      if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; onChange?.(state); }
      attach();
    } finally { running = false; if (again) { again = false; schedule(); } }
  }
  // No polling or sync subprocess on the HTTP/cold-open path. File changes are debounced.
  const ready = refresh();
  let monitor;
  if (desktop && process.platform === 'linux') {
    monitor = spawn('gsettings', ['monitor', 'org.gnome.desktop.interface', 'color-scheme'], { stdio: ['ignore', 'pipe', 'ignore'] });
    monitor.on('error', () => {}); monitor.stdout.on('data', schedule);
  }
  return { ready, get state() { return state; }, close() { closed = true; clearTimeout(timer); for (const w of watches.values()) w.close(); monitor?.kill(); } };
}
