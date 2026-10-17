# Follow the desktop theme

Open **Workspace → Theme → Follow system**. A detected desktop palette is followed by default;
existing fixed/custom choices are preserved. The setting names the active provider and, for Omarchy,
the theme name. Detected providers also appear separately so you can choose wal even while Noctalia
is running. Dark, Light, High contrast and Custom opt out; the choice survives reload.

## Detection, in order

1. **Omarchy**: `~/.config/omarchy/current/theme/`, resolving the theme directory symlink.
   Read `alacritty.toml` primary/normal/bright colors, then `kitty.conf`, then `ghostty.conf`.
   `light.mode` marks light themes. The actual legacy format and the test fixtures come from
   [Omarchy v3.0.0 themes](https://github.com/basecamp/omarchy/tree/v3.0.0/themes).
   Also accept the newer `~/.local/state/omarchy/current/theme/colors.toml` and adjacent `theme.name`
   described in upstream [theme-set](https://github.com/basecamp/omarchy/blob/HEAD/bin/omarchy-theme-set)
   and [colors.toml](https://github.com/basecamp/omarchy/blob/HEAD/themes/tokyo-night/colors.toml).
2. **Noctalia**: `~/.config/noctalia/colors.json`, using Material surface/on-surface/primary/secondary/
   tertiary/outline/error/hover roles. Its ANSI slots are derived from these semantic colors.
3. **pywal / wallust**: `~/.cache/wal/colors.json`, with `special.background`, `special.foreground`
   and `colors.color0` through `color15`. Wallust must export the wal-compatible file.
4. **Desktop preference**: GNOME `gsettings get org.gnome.desktop.interface color-scheme`
   (`prefer-dark` or `prefer-light`), then KDE `~/.config/kdeglobals` window and selection colors.
5. **Browser preference**: when Follow system has no desktop provider, use `prefers-color-scheme`,
   including live changes. An installation that has never detected a desktop palette keeps the
   existing Dark default until Follow system is chosen.

macOS and Windows use the browser fallback; this change does not launch platform-specific probes.
Matugen, base16 and tinted-theming have user-selected output templates rather than one universal
palette file; no speculative config discovery is performed. They can export wal-compatible JSON.

## Read-only bridge contract

Authenticated `GET /theme` returns `{palette, source, available}`. Palette fields are `source`,
`name`, `dark`, `bg`, `surface`, `surface2`, `fg`, `muted`, `border`, `accent`, `accent2`, `danger`,
`success`, `warning` and 16 `ansi` colors, normalized to six-digit hex. No filenames, wallpaper
paths or arbitrary provider JSON are exposed. An explicit `?source=wal` overrides automatic order;
`--theme-source wal` chooses the bridge default. Unknown/unavailable sources fall back to detection.

Missing, invalid and oversized (>64 KiB) files are ignored. Only the named files are read; includes,
shell hooks, theme scripts and arbitrary config paths are never evaluated. `fs.watch` monitors known
containing directories with a 100 ms debounce and re-arms after rename/symlink replacement. Missing
parents are watched shallowly so newly installed providers become visible. GNOME uses a bounded
async command and `gsettings monitor`; there is no subprocess on the ordinary GET/cold-open path.
A named `theme` event on `/events` carries the same response, including an initial/reconnect snapshot.

`--theme-home <dir>` makes file detection hermetic and disables the host GNOME probe/monitor. Use it
with `--no-config` for fixtures, private bridges and read-only visual inspection. `--no-config` now
avoids even creating the fframestudio config directory. Test bridges use both flags.

## Token boundary and readability

`web/src/system-theme.js` owns **one** `TOKENS` table translating semantic palette roles into the
current studio CSS variables. Repoint only that table when merging `feat/studio-look`; no provider
or component should know the new token spelling. Six separate `--shot-1`…`--shot-6` tokens come
from ANSI 1–6; stable shot-type slots color timeline borders. Fixed themes remove all imported
variables. Document styles, original media and exported film colors do not change.

WCAG sRGB contrast is checked against all three surfaces. Foreground/muted text gets 4.5:1; UI-only
colors get 3:1. Because today's `--acc`, `--warn`, `--bad` and success roles also label small text,
those roles require 4.5:1 as well. Each deficient color is shifted minimally toward black or white
using a quantized binary search; passing colors and source backgrounds are retained. Workspace
lists the exact corrections instead of silently pretending the original palette was accessible.
The supplied theme fixtures and actual desktop palettes are covered by contrast tests.

## Evidence

- `npm test`: provider fixtures, priority, malformed/empty homes, contrast and atomic watcher changes,
  plus the existing document/ACP security gates.
- `npm run verify`: `system theme: follows and live-updates` checks computed backgrounds, no reload,
  <2 s updates, fixed-choice persistence, browser dark/light fallback, /theme auth and read-only config.
- `npm run test:perf`: existing cold-open/editor budgets unchanged; see [perf.md](perf.md).
- `node tools/theme-evidence.mjs <verify-home>/fframestudio <output-dir>` copies the demo library and
  starts an owned private bridge with `--no-config --theme-home $HOME`; it never changes real palettes.
  The real Noctalia/wal editor and Workspace screenshots plus measured contrast/timings are saved in
  `/mnt/zer0models/project-artifacts/fframestudio/ui-compare/system-theme/` on the qualification host.
