# Reference and voice direction

Import a reference, inspect timestamped evidence, recreate an editable source-linked approximation and direct core edits through the same commands as the palette, menu and keyboard. Local speech is optional; typed direction is always available.

## Sub-features

- registry: palette, context menu, keyboard and ACP proposal produce the same edit and ordinary undo.
- import: bridge video-file intake, strict direct public URL capability, social-link explanation.
- hosted-file: browser-local video import persists without replacing the visitor's folder or fetching URLs.
- analysis: detected shots, uncertainty, durations, palette and measured audio with click-to-seek thumbnails.
- recreate: source-linked ordinary editable project, palette look tokens, approximation/provenance labels.
- compare: original and current reconstruction follow the same scrubber.
- voice: live transcript/typed fallback, mic state, explicit destructive confirmation, undo/save/reopen.

## How to get to it (user POV)

- Choose **Import reference** in the library or editor; choose a video file or paste a direct video URL.
- With a local bridge, choose **Analyze locally**, inspect evidence, then **Recreate editable approximation**.
- In the recreated project choose **Compare reference** for side-by-side scrubbing.
- Choose **Voice** or hold V outside text inputs; typed direction is in the same desk.

## Driving it with Playwright

Preconditions: the owned verification bridge and demo project are ready; ffmpeg/ffprobe are installed. `test/reference-journey.mjs` is included by the normal verification runner. `node test/reference-e2e.mjs` is a targeted disposable runner.

- Shared inputs: `page.click('[data-action="palette"]')`, search duplicate, choose the palette row; undo, repeat through `[data-menu-action="duplicate"]`, Control+D and a reviewed ACP proposal. Compare resulting shot order; no proposal applies before Apply.
- Import: `page.click('[data-action="import-reference"]')`; `page.setInputFiles('#reference-file', fixture)`; wait for `#reference-analyze:enabled`.
- Analyze: `page.click('#reference-analyze')`; wait for `#reference-recreate:enabled`; verify three `[data-reference-shot]` rows from the generated CC0 three-colour/tone clip, with cuts at frames 90 and 180 (±1 frame).
- Evidence: `page.locator('[data-reference-shot="2"]').click()` seeks the original to 3 s. Capture `reference-breakdown.png`; repeat analysis and require the visible cached result.
- Recreate: `page.click('#reference-recreate')`; require three ordinary editable clips, copied source bytes and approximation/provenance in saved project.json.
- Compare: `page.click('[data-action="compare-reference"]')`; set `#reference-scrub` to 135 and dispatch input; require both players at 4.5 s, then capture `reference-side-by-side.png`.
- Typed voice: expose the desk, fill `#voice-transcript` with “shorten the second shot by one second” and submit `#voice-form`. Require no edit before `page.click('#voice-confirm')`; after confirm require 60-frame second shot. Select the second shot, change quoted text, then undo. Save/reload and read exact project.json; capture `voice-typed-fallback.png`.
- Hosted: use a real static build, fill a remote direct URL and require the capability message with no request to that host. Import a file, close/reload and open its new card; existing visitor cards remain, media decodes and Save survives reload.

## Gotchas

- Detected boundaries/confidence are suggestions, not truth. No typography, effect, motion or object interpretation is claimed.
- Browser-only imports explicitly assume 30 fps and cannot run local ffmpeg or fetch remote reference URLs.
- Speech-service consent is required for Web Speech; otherwise local Whisper must be installed/configured, or the user types. Real microphone and real speech-model decoding are NOT RUN in CI.
- Android share-sheet/PWA install real-device verification is NOT RUN. The manifest/handler are foundation only.
- Comparison is synchronized scrubbing, not a qualified dual-player playback engine or final rendered export.
- Keep all latency failures; do not weaken the existing menu/frame budgets to make a busy-host run pass.
