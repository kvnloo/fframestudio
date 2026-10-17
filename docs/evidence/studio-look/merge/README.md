# Studio merge qualification

Base: `main` at `c27b698`. Runtime code measured: `30f1c47`; subsequent commit contains evidence only. No main merge or push.

## Outcome

- Studio's poster/paper/slate structure survives fixed and desktop themes. Follow system is the default when a palette is found; otherwise Studio is the default. A single isolated mapping recolours surfaces, paper accents and ANSI-derived shot roles. Duplicate Material ANSI entries receive readable tints so the five roles stay distinct.
- The studio export had only music credits/ID. The importer now resolves the selected ID in `music/tracks.json`; audio paths are relative to the studio page, not the repository root. A real reimport produced 48 shots, `media/soundtrack.mp3` and 358 detected beats. Copied audio bytes match the selected original. Existing libraries need reimport; the owner's library was not changed.
- Timeline text-attachment chips are gone from the DOM; text editing remains in Shot. Real source PCM drives the waveform and RMS energy. GEV's capture manifest has no audio, so its waveform remains absent.
- Paper's focused menu shortcuts initially measured 4.216:1; inheriting focused label ink fixed this. The final minimum enabled-label/shortcut contrast across Studio, Paper, real Noctalia and wal is 5.092:1.

## Gates

`summary.json`, `gates.txt`, `run-{1,2,3}/report.json`, `perf/` and `visual-report.json` contain actual outputs. All sixteen journeys passed in three consecutive runs, including native menus and live system following. There are 60 passing document/theme tests plus ACP security checks. Build leaves `web/dist` unchanged.

Final browser perf: 148.7 ms cold open; 8.3 ms worst command paint-ready; 16.8 ms worst next-frame rendering-opportunity interval (median frame 16.7 ms); 60.006 fps scrubbing, no long tasks; 42,914 gzip bytes. Acceptance budgets were not modified. Next-frame measurements do not certify physical compositor presentation.

The screenshot harness captured 44 images: eight library screens, 24 editor screens, eight native menus and four Workspace dialogs, covering both 1600×1000 and 1280×800. Four contact sheets and two reference comparisons are in the external artifact set. Representative screenshots and comparisons are versioned here. Real Noctalia used the owner's home read-only on a private `--no-config --theme-home` bridge; wal used a fixture. Source project bytes/mtime and bridge discovery bytes/mtime were unchanged.

## Retained failures and fixes

- `merged-first/report.json`: the old Studio-default assertion conflicted with a detected system palette; keyboard-menu tests also needed to settle the newly distant Story focus scroll.
- `merged-second/report.json`: Canvas keyboard-menu focus had the same delayed-scroll dismissal; all keyboard invokers now focus/reveal and settle two rAFs before invocation.
- `paper-contrast-failed.json`: genuine Paper menu shortcut contrast failure, fixed rather than weakening the threshold.
- Old branch evidence contained local paths; those paths were scrubbed without altering measurements. The local-path gate passes over the complete tracked tree.

`tools/verify-studio-merge.mjs` reproduces the real-project/theme matrix on private library copies. `cache-proof.json` additionally proves nonzero peak/RMS data, waveform-cache reuse, narrow-clip selection, looping, mute, fullscreen, and retained legacy themes.
