# System theme

The studio follows the desktop palette without a reload. Workspace lets a user keep following, select a detected provider explicitly, or opt out with Dark, Light, High contrast or Custom. Source/name and contrast corrections are visible beside Theme; timeline shot accents use the same palette.

## Sub-features

- `theme-detect` defaults to Follow system when a desktop palette is found.
- `theme-source` names Omarchy, Noctalia, pywal / wallust or GNOME/KDE.
- `theme-live` updates the palette within two seconds of a desktop change.
- `theme-fixed` persists fixed themes and stops following live changes.
- `theme-browser` follows the browser light/dark preference when Follow system has no desktop provider.
- `theme-readable` keeps text at 4.5:1 and UI accents at 3:1 against studio surfaces.

## How to get to it (user POV)

- Open any project, choose Workspace, then Theme → Follow system.
- Choose a detected provider to override automatic priority.
- Choose Dark, Light, High contrast or Custom to stop following.
- Change the global desktop theme while keeping the studio open.

## Driving it with Playwright

Preconditions:

- Start a private bridge with `--no-config --theme-home <temporary-home>` and a disposable demo library. Seed `.cache/wal/colors.json` with the wal fixture. This fixture flag disables host GNOME probing.
- Open the signed-in demo editor in Chromium.

- **Default.** Read `await page.locator('#theme').inputValue()`; expect `system`. Assert `getComputedStyle(document.body).backgroundColor` matches the fixture background.
- **Live update.** Rewrite the temporary colors.json with background `#102c30`; `await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(16, 44, 48)', null, { timeout: 2000 })`. Confirm `performance.timeOrigin` is unchanged. Capture `07-system-theme-before.png` and `07-system-theme-after.png`.
- **Fixed.** `await page.click('[data-action="settings"]'); await page.selectOption('#theme','light'); await page.click('[data-action="close-settings"]')`. Rewrite the fixture again; background stays fixed, system shot tokens are removed. Capture `07-system-theme-fixed.png`; reload and confirm `#theme` still reads `light`.
- **Budget.** Collect `performance.getEntriesByName('system-theme-apply')` for 30 applications; every measured application must be below 16 ms. Retain samples in report.json.
- **Read-only.** Confirm no `.config/fframestudio` was created in the temporary home, and unsigned GET `/theme` returns 401.

## Gotchas

- Never edit a user's real colors.json to test live updates. Copy fixtures into a throwaway home.
- Read computed colors, not only CSS token strings. Color normalization and readability can change accents; backgrounds are preserved exactly.
- Theme timing measures token preparation/writes, not compositor presentation. No forced layout is used by the application.
- Noctalia wins over wal when both are present; choose Follow pywal / wallust explicitly to inspect wal.
- Media content and document styles are not desktop chrome; changing a theme must not recolor exported film content.
