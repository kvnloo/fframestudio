# My Taste (issue #11 A/B)

My Taste previews human-reviewed aggregate visual preferences beside Direction, explains changed dials, applies one undoable edit, and lets the visitor delete the local profile without uploading references.

## Sub-features

- `opt-in`: file import starts Off; strength 0–100 and per-signal toggles affect preview only.
- `evidence`: counts, confidence, uncertainty and unknown signals remain visible.
- `comparison`: original vs adjusted palette/type/pace studies plus an explained dial diff.
- `apply`: one undoable direction edit and aggregate project receipt, saved through normal Save.
- `delete`: local profile and preview disappear; reload stays disconnected.
- `read-only`: explicit AgentWeb Read returns actual bridge state; no token input or social access.

## How to get to it (user POV)

Open a project → Film slate → My Taste, immediately beside Direction, or choose `apply-taste` in Commands (opens review, never applies automatically). Import aggregate JSON from your device, opt in, inspect the changes, then Apply direction. Task/project scope does not change a durable user default. Delete applies only to the local file profile.

## Driving it with Playwright

Preconditions: the standard isolated bridge or CSP-served static hosted verification fixture is open, with no pre-existing Taste profile. Use only `test/fixtures/taste/synthetic.json`.

- Import: `page.click('#tab-taste')`, then `page.locator('#taste-file').setInputFiles(fixture)`. `#taste-state` reports 12 evidence items and two sources; `#taste-on` remains unchecked. Reload preserves the profile but remains Off.
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
- Real source imports (C/D), voice/feedback (E), and preference evaluation (F) remain left. See `docs/TASTE.md`.
