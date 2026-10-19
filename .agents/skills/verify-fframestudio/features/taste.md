# My Taste (issue #11 A/B)

My Taste previews human-reviewed aggregate visual preferences beside Direction, explains changed dials, applies one undoable edit, and lets the visitor delete the local profile without uploading references.

## Sub-features

- `opt-in`: file import starts Off; strength 0–100 and per-signal toggles affect preview only.
- `local-palette`: PNG/JPEG/WebP screenshot selection measures colors on-device and previews them without saving; a separate approval stores only the aggregate palette and leaves Taste Off.
- `evidence`: counts, confidence, uncertainty and unknown signals remain visible.
- `comparison`: original vs adjusted palette/type/pace studies plus an explained dial diff.
- `apply`: one undoable direction edit and aggregate project receipt, saved through normal Save.
- `delete`: local profile and preview disappear; reload stays disconnected.
- `read-only`: explicit AgentWeb Read returns actual bridge state; no token input or social access.

## How to get to it (user POV)

Open a project → Film slate → My Taste, immediately beside Direction, or choose `apply-taste` in Commands (opens review, never applies automatically). Import aggregate JSON from your device, or analyze local screenshot colors and explicitly approve the measured palette. Then opt in, inspect the changes, and Apply direction separately. Task/project scope does not change a durable user default. Delete applies only to the local file profile.

## Driving it with Playwright

Preconditions: the standard isolated bridge or CSP-served static hosted verification fixture is open, with no pre-existing Taste profile. The aggregate-import path uses `test/fixtures/taste/synthetic.json`; the screenshot path uses owned controlled image fixtures, never personal screenshots or live services.

- Import: `page.click('#tab-taste')`, then `page.locator('#taste-file').setInputFiles(fixture)`. `#taste-state` reports 12 evidence items and two sources; `#taste-on` remains unchecked. Reload preserves the profile but remains Off.
- Screenshot preview: choose one to six controlled PNG/JPEG/WebP images in Analyze screenshot colors. Require visible measured swatches, no profile/storage changes before approval, and loss of an unapproved preview after reload. Reject seven files and unsupported SVG input without persistence.
- Screenshot approval: click `#taste-image-use` separately. Read the actual IndexedDB record: only aggregate palette/count/confidence/provenance, no image bytes or filenames; all other preference signals remain unknown. Taste stays Off after approval and reload.
- Screenshot application: enable Taste, review the diff, then use the existing Apply/Save/Undo path. Require a matching aggregate receipt, restored original on Undo, and authoritative existing brand locks. Delete and reload must leave the local profile disconnected.
- Preview: `page.locator('#taste-on').check()`. `#taste-studies` shows original/adjusted studies; `#taste-diff [data-taste-diff="pacing"]` explains the weighted change. The project is unchanged.
- Signals: uncheck `[data-taste-signal="pacing"]`; its diff disappears. Unknown `[data-taste-signal="soundtrack"]` is disabled. Low-confidence density remains visibly uncertain.
- Apply: `page.click('#taste-apply')`, then normal Save. Read back the exact saved project and require a matching profile revision, task scope, intensity and changed pacing dial in its receipt.
- Undo: `page.click('[data-action="undo"]')`; the project content returns to the original, excluding its monotonic revision. Save the restored project.
- Delete: `page.click('#taste-delete')`; `#taste-state[data-state="disconnected"]` appears and `#taste-studies` is absent. Reload and require IndexedDB readback still disconnected.
- Layout: capture inspector controls, comparison and explained diff at 1896×880 and 390×780. No horizontal overflow; the slate scrolls internally. The layout matrix visits Taste at every viewport.

The `taste: import file profile -> preview diff -> apply -> undo -> delete` journey runs these actions in `test/verify.mjs`; `hosted taste:` repeats them against the static build with real IndexedDB and no external requests.

## Gotchas

- Turning Off stops preview/application; use Undo to reverse a previously committed direction.
- Palette/type update editorial shared styles; other dials are direction tokens, not source-footage retiming or a final compositor. The study phrase is sample text, not generated footage.
- Delete does not erase a project's intentionally retained aggregate receipt/history or delete remote social data.
- AgentWeb PR #57 is unmerged. Its response lacks per-visual evidence, so those signals remain unknown. Tests use mocked HTTP only; never point verification at a live service.
- Native social/video source imports (C/D), voice/feedback (E), and preference evaluation (F) remain unproven. Local screenshot analysis measures palette colors only, not motion, typography, pacing or human preference efficacy. See `docs/TASTE.md`.
