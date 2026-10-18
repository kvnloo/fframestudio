# Procedural source inspector

Open a procedural fframes film and inspect its source-defined scenes, camera and music data without pretending a baked proxy is an editable Rust/shader composition.

## Sub-features

- `procedural.tracking`: twelve source-defined 15-frame shots; seven named source palettes; SceneDef/Cam/focus values.
- `procedural.unmute`: one 480-frame take; measured waveform; authored bar grid; kick/clap/token tracks; camera keys.
- `procedural.readonly`: source controls have no inputs/setters; future write surface and pipeline boundary are labelled.
- `procedural.provenance`: source revision/hashes and credits survive migration and Save/reopen.
- `procedural.local`: optional real-source journey copies a supplied library, skips cleanly if absent, distinguishes metadata-only imports from playable renders.

## How to get to it (user POV)

- Import a procedural-fframes checkout with an existing render, or explicitly choose source-only metadata in its source registry.
- Open the film from the library. Select **Source** in the right-hand slate for the scene/event grid; **Shot** shows selected source fields.
- Expand a scene or camera values to inspect data. Save and reopen preserves provenance, not a reconstructed render.

## Driving it with Playwright

Preconditions: `npm run verify` creates labelled synthetic source fixtures through the real importer in a temporary library. No GPU or upstream downloads are needed.

- **Open source:** `await page.click('[data-slate-tab="source"]')`; `#procedural-source` is visible with “Source — read-only”.
- **Tracking grid:** `await page.locator('[data-source-shot]').count()` is 12; `.source-palette>span` lists Paper, Thermal, Mono, Phosphor, Amber, Navy, Neon. Expand `summary` to reveal source text, hero/focus and camera values.
- **Unmute take:** `window.ffs.video.clips` has one clip of duration 480. `.source-wave line` exists; `[data-source-event="bar"]`, `kick`, `clap`, `token` carry exact `data-frame` values from the imported sidecar, not fabricated cuts.
- **Camera:** `[data-source-event="camera"]` frames match imported keyframes. Expand the Camera values details to inspect all keys.
- **Read-only:** `#procedural-source input, #procedural-source textarea, #procedural-source select, #procedural-source button` count is zero. Credits include Mustafa Saraç and, for tracking, optional-score author nooga.
- **Save/reopen:** click `[data-action="save"]`, wait for `#save-status` “Saved”, read the temporary project.json and compare its procedural sidecar, reload and find `.procedural-selected` in Shot.
- **Local real sources:** set `FFS_PROCEDURAL_LIBRARY` and run `node test/verify-procedural-real.mjs --out <evidence>`; it copies inputs, starts its own no-config bridge, saves 1896×880 source/shot screenshots, and records renderVerified separately. Without the library it prints SKIP.

## Gotchas

- SHOT_FRAMES are editorial annotations, not physical cuts. Tracking has twelve shots; unmute is one take.
- Kick timestamps are measured stem onsets; clap/token timestamps are exported score events. The bar grid comes from the authored score tempo, not detected beats.
- Metadata-only source imports have no verified video or playable proxy. Their waveform is source-derived measurement data, not proof of local video rendering.
- Source fields are read-only; ordinary timing/text controls affect only the editorial document. No source writeback, GPU rebuild, voice action or native A/V export is tested here.
- Keep all original upstream files unchanged. Local bridge launchers must use `--no-config`; never connect to or stop someone else's bridge.
