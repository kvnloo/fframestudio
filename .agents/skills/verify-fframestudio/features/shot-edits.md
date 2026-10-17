# Shot edits

Inspector lets a user change the selected shot's on-screen text. Change commits a local edit; Save writes the clip's `textOverrides` in `project.json`. Reload restores the value and source media stays unchanged.

## Sub-features

- `edit-slate` opens `[data-slate-tab="shot"]` when Direction or Narrative is selected. Shot retains frame timing, timecode, beat lock, text, replacement and shared-style controls.
- `edit-fields` shows `input[data-field]` or `textarea[data-field]` for the selected clip.
- `edit-merge` displays original text merged with saved overrides.
- `edit-commit` applies the field's `change` event to the local document.
- `edit-save` writes `videos[].clips[].textOverrides` with `[data-action="save"]`.
- `edit-status` shows Unsaved changes, Saving… and Saved in `#save-status`.
- `edit-persist` restores saved values after reload.
- `edit-source-safe` leaves the source video bytes and duration unchanged.
- `edit-external` loads external changes or preserves dirty local edits with a conflict notice.

## How to get to it (user POV)

- Open a project and choose a Story or Timeline clip.
- Edit a Words field in Inspector, then choose Save.
- Reload or reopen the project to confirm persistence.

## Driving it with Playwright

Preconditions:

- The demo editor is open with `input[data-field="title"]` present.
- The project file is `fframestudio/projects/demo/project.json` under the temp `HOME`.
- The source `fframestudio/demo-src/demo.mp4` has a recorded SHA-256 and 12 s duration before editing.

- **Select the first shot.** Run `await page.locator('#timeline .timeline-clip').first().click();`. Read its `data-select` ID from `#timeline .timeline-clip.selected`.
- **Read the title.** Run `const field = page.locator('input[data-field="title"]');` and `const before = await field.inputValue();`.
- **Edit.** Run `await field.fill(after);` and `await field.press('Tab');`. Wait until `#save-status` reads `Unsaved changes`.
- **Save.** Run `await page.click('[data-action="save"]');` and wait until `#save-status` reads `Saved`.
- **Confirm on disk.** Parse `project.json`, find the exact selected clip under `videos[].clips[]`, and assert `clip.textOverrides.title === after`.
- **Confirm persistence.** Run `await page.reload();`, wait for `input[data-field="title"]`, and assert its `inputValue()` equals `after`.
- **Confirm source safety.** Run `ffprobe` and assert the source duration remains 12 s within 0.5 s. Recompute SHA-256 and assert the source bytes are identical.
- **Proof.** `04-edited.png` shows the saved title after reload; `report.json` records the clip ID and source hash.

## Gotchas

- `change` applies a local command. It does not write to disk until Save.
- Inspector shows only the selected clip, and reload initially selects the first clip.
- Verify the same clip and field on disk, not an arbitrary matching string elsewhere in the document.
- A displayed value is not persistence proof; read the file and reload.
- Duration alone cannot prove source bytes are untouched. Compare the before/after hash too.
