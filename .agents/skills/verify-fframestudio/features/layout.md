# Fitted adaptive workspace

The film desk fits the window rather than scrolling the desktop document. Canvas, Story, slate panels, transport and the complete timeline share one workspace; each long panel scrolls internally, and phone panels follow the canvas and timeline in a single column.

## Sub-features

- `layout-fit` keeps desktop documents at 100dvh with the whole timeline visible at all six tested desktop sizes.
- `layout-aspect` aspect-fits the uncropped canvas to its available box using the project's dimensions.
- `layout-slate` retains Shot, Narrative, Direction, Takes, Assistant (including proposals), and Source in mounted tab panels.
- `layout-story` keeps the windowed Story rail on desktop and moves the same rail to the Story tab below 1024 px.
- `layout-resize` persists the keyboard/pointer timeline splitter and native side-panel widths in Workspace preferences, without persisting automatic responsive shrinkage.
- `layout-collapse` persists Story and slate collapse states and retains their expand buttons.
- `layout-phone` wraps or ellipsizes text, provides 40 px controls, and uses a horizontally scrollable timeline with larger shot/trim targets.
- `layout-posters` shows clip-midpoint posters when video exists, otherwise type-coloured cards carrying the shot's actual words; never empty thumbnail boxes.

## How to get to it (user POV)

- Open a project and resize the window; the timeline stays below the canvas, not below the document fold.
- Select any slate tab. Choose Takes for film versions, Assistant for ACP and proposals, Source for provenance.
- Collapse/expand Story or Film slate using the panel heading button. On tablet or phone open the Story tab first.
- Drag the horizontal divider above transport, or focus it and use ArrowUp/ArrowDown/Home/End, to resize the timeline.
- Resize desktop side panels using their lower-right native handle. Reload to check preferences.

## Driving it with Playwright

Preconditions:

- `npm run verify` creates both the demo and a generated 48-clip project using the demo's real sine-audio proxy.
- The `layout: fits and adapts across sizes` journey owns a fresh cookie-authenticated context, so workspace changes do not leak into earlier journeys.

- **Viewport matrix.** Loop 2560×1340, 1896×880, 1440×800, 1366×680, 1280×640, 1024×700, 768×960 and 390×780 on both projects. Assert page widths, desktop heights, timeline bounds, canvas bounds/aspect, leaf text overflow and escaped elements. Save one screenshot per project/size.
- **All views.** Click each `[data-slate-tab]`; assert its controlled panel is visible and re-run overflow checks. At desktop click a `.story-card` and collapse/expand `[data-action="toggle-story"]`; below 1024 px click the Story tab instead.
- **Persistence.** Drag `#timeline-splitter`, read `aria-valuenow`, reload and compare it. Collapse both panels, reload, and assert `.story-panel.collapsed` and `.inspector-panel.collapsed` before expanding again.
- **Real posters.** Wait for `.story-card canvas[data-video][data-ready="true"]` on the thumbnail-free fixture. Its surrounding `.thumb-words` always retains the actual fallback copy.
- **Phone controls.** Every tab repeats the horizontal/text checks, verifies no panel/timeline overlap, and gates visible button/input/select dimensions at 40 px.
- **Performance.** `npm run test:perf` retains all previous budgets and adds a resize matrix plus two seconds of frame-driven splitter movement, checking frame intervals and >50 ms long tasks separately.
- **Private visual proof.** Run `FFS_EVIDENCE=<directory> node tools/layout-evidence.mjs`; it uses `cp -a` into a disposable root and an owned `--no-config --theme-home` bridge. Inspect owner-size, short-laptop and phone screenshots; original project hashes and mtimes must match.

## Gotchas

- Phone documents intentionally scroll vertically; desktop and tablet shells do not. Horizontal timeline scrolling is internal, not document overflow.
- Native video seeking is unavailable in workers. A single detached paused decoder extracts video frames; the existing thumbnail worker resizes/caches them. It never seeks the playing preview or changes original files.
- Some source-spec projects have no video at all. Their colourful word posters are intentional, not missing media.
- Select Takes before driving version inputs and return to Shot before editing timing. Tab switches keep existing state mounted.
- Frame intervals measure animation scheduling, not physical compositor presentation. Resize, splitter, command-ready and next-rAF results remain separate.
