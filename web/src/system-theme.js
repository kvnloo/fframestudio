import { request as hostRequest, preferences as storage } from './host.js';
// The ONLY desktop palette -> Studio token mapping. Structure never depends on a provider.
export const TOKENS = Object.freeze({ bg: 'bg', bg2: 'surface', bg3: 'surface2', ink: 'fg', mute: 'muted', faint: 'muted', line: 'border', line2: 'border', acc: 'accent', acc2: 'accent2', bad: 'danger', success: 'success', warn: 'warning', paper: 'paper', 'paper-ink': 'paperInk', 'paper-mute': 'paperMute', 'poster-accent': 'posterAccent', 'poster-lines': 'posterLines', 'wave-ink': 'muted', teal: 'ansi6', amber: 'ansi3', yellow: 'ansi5', coral: 'ansi1', green: 'ansi2', 'shot-1': 'ansi1', 'shot-2': 'ansi2', 'shot-3': 'ansi3', 'shot-4': 'ansi4', 'shot-5': 'ansi5', 'shot-6': 'ansi6' });
const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const color = a => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
export function luminance(c) { return rgb(c).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
// Minimal quantized sRGB lightness shift toward white/black. Binary-search both
// directions and retain the nearest passing color; never change the background.
export function readable(c, surfaces, ratio) {
  const passes = c => surfaces.every(s => contrast(c, s) >= ratio);
  if (passes(c)) return c;
  const from = rgb(c), candidates = [];
  for (const to of [0, 255]) {
    const at = t => color(from.map(v => v * (1 - t) + to * t));
    if (!passes(at(1))) continue;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (passes(at(m))) hi = m; else lo = m; }
    candidates.push({ c: at(hi), distance: from.reduce((s, v, i) => s + Math.abs(v - rgb(at(hi))[i]), 0) });
  }
  return candidates.sort((a, b) => a.distance - b.distance)[0]?.c || c;
}
export function ensureContrast(p) {
  const out = { ...p, ansi: [...p.ansi], adjustments: [] }, surfaces = [p.bg, p.surface, p.surface2];
  // acc/warn/bad also label small text in today's studio tokens; require text contrast.
  for (const [key, ratio] of [['fg', 4.5], ['muted', 4.5], ['accent', 4.5], ['accent2', 3], ['danger', 4.5], ['success', 4.5], ['warning', 4.5]]) {
    out[key] = readable(p[key], surfaces, ratio);
    if (out[key] !== p[key]) out.adjustments.push(`${key}: ${p[key]} → ${out[key]} (${ratio}:1)`);
  }
  // Paper stays warm and light in every palette; only a gentle foreground tint is allowed.
  const mix = (a, b, t) => color(rgb(a).map((v, i) => v * (1-t) + rgb(b)[i] * t));
  out.paper = mix('#efeee6', p.fg, 0.08);
  out.paperInk = readable(p.bg, [out.paper], 7);
  out.paperMute = readable(p.muted, [out.paper], 4.5);
  out.posterAccent = readable(p.accent, [out.paper], 4.5);
  out.posterLines = mix(out.paper, out.paperInk, 0.18);
  // Material palettes may repeat one accent across ANSI slots. Preserve the hue but
  // tint duplicates so five shot roles do not collapse into one undifferentiated rail.
  const used = new Set();
  for (let i = 1; i <= 6; i++) {
    let c = readable(p.ansi[i], surfaces, 4.5);
    for (let tint = 0.12; used.has(c) && tint < 0.9; tint += 0.12)
      c = readable(mix(p.ansi[i], luminance(p.ansi[i]) > 0.8 ? '#000000' : '#ffffff', tint), surfaces, 4.5);
    used.add(c); out['ansi'+i] = c;
  }
  return out;
}
export function shotColorSlot(type) {
  const known = ['statement', 'map', 'chart', 'quote', 'ask', 'title'];
  const n = known.indexOf(type); if (n >= 0) return n + 1;
  let hash = 0; for (const c of String(type || 'shot')) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash % 6 + 1;
}
let response = { palette: null, source: null, available: [] }, settings = {}, selectedSource = '', request = 0;
const listeners = new Set();
let followedSystem = false;
const choiceOf = () => settings.theme || (response.palette || followedSystem ? 'system' : 'studio');
let media;
function browserPalette() {
  const dark = media?.matches ?? true;
  return { source: 'browser', name: 'Browser', dark, ...(dark ? { bg: '#0a0a0b', surface: '#101012', surface2: '#171719', fg: '#ecebe7', muted: '#8b8a85', border: '#36363b', accent: '#7fd49a' } : { bg: '#f1f0e9', surface: '#faf9f4', surface2: '#ffffff', fg: '#20251f', muted: '#535c51', border: '#b0b9ab', accent: '#246940' }), accent2: '#8899cc', danger: '#ef7b6b', success: '#7fd49a', warning: '#e2b25c', ansi: ['#000000', '#ef7b6b', '#7fd49a', '#e2b25c', '#8899cc', '#c099ff', '#7dcfff', '#ecebe7', '#555555', '#ef7b6b', '#7fd49a', '#e2b25c', '#8899cc', '#c099ff', '#7dcfff', '#ffffff'] };
}
export function themeInfo() {
  const p = response.palette;
  return { ...response, choice: choiceOf(), label: p ? p.source === 'omarchy' ? `Omarchy · ${p.name}` : p.name : 'Browser', adjustments: lastPalette?.adjustments || [] };
}
let lastPalette;
export function applyTheme(next = settings) {
  settings = next;
  if (typeof document === 'undefined') return;
  performance.mark('system-theme-start');
  if (response.palette) followedSystem = true;
  const root = document.documentElement, choice = choiceOf();
  for (const k of [...Object.keys(TOKENS), ...Array.from({ length: 6 }, (_, i) => 'shot-' + (i + 1))]) root.style.removeProperty('--' + k);
  root.style.removeProperty('color-scheme');
  lastPalette = null;
  if (choice === 'system' || choice.startsWith('system:')) {
    const p = ensureContrast(response.palette || browserPalette()); lastPalette = p;
    root.dataset.theme = 'system'; root.style.colorScheme = p.dark ? 'dark' : 'light';
    for (const [token, key] of Object.entries(TOKENS)) root.style.setProperty('--' + token, p[key]);
  } else {
    root.dataset.theme = choice;
    root.style.colorScheme = ['light', 'paper'].includes(choice) ? 'light' : 'dark';
    if (choice === 'custom') for (const k of ['bg', 'ink', 'acc']) if (/^#[\da-f]{6}$/i.test(settings.tokens?.[k])) root.style.setProperty('--' + k, settings.tokens[k]);
  }
  for (const fn of listeners) fn(themeInfo());
  performance.measure('system-theme-apply', 'system-theme-start');
  performance.clearMarks('system-theme-start');
  // Bound instrumentation during long-running desktop theme sessions.
  const samples = performance.getEntriesByName('system-theme-apply');
  if (samples.length > 100) performance.clearMeasures('system-theme-apply');
}
export function onTheme(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setThemeSettings(next) {
  const source = next.theme?.startsWith('system:') ? next.theme.slice(7) : '';
  applyTheme(next);
  if (source !== selectedSource) { selectedSource = source; refreshTheme(); }
}
export async function refreshTheme() {
  const id = ++request;
  try {
    const r = await hostRequest('/theme' + (selectedSource ? '?source=' + encodeURIComponent(selectedSource) : ''));
    if (!r.ok) return;
    const next = await r.json(); if (id !== request) return;
    response = next; applyTheme();
  } catch { /* An absent bridge retains the fixed theme or browser fallback. */ }
}
export function receiveTheme(next) {
  if (selectedSource) return refreshTheme();
  // Supersede an in-flight initial GET so an older reply cannot undo an SSE update.
  ++request; response = next; applyTheme();
}
export function initSystemTheme() {
  try { settings = JSON.parse(storage.getItem('ffs.settings') || '{}'); } catch { settings = {}; }
  selectedSource = settings.theme?.startsWith('system:') ? settings.theme.slice(7) : '';
  media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', () => applyTheme());
  applyTheme(); return refreshTheme();
}
