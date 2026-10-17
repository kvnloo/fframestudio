# Shot edits

Shot edits let a user change the on-screen text of a shot in the project view. A committed field is written under `edits` in `project.json`, marked as edited, and restored on reload. The source media is never written.

## Sub-features

- `edit-fields` renders one input per text field of each shot, tagged with `data-shot` and `data-k`.
- `edit-merge` shows the shot's text merged with saved edits.
- `edit-commit` saves on the input's `change` event.
- `edit-save` writes the project file under `edits[shot][key]`.
- `edit-toast` shows the `Saved` toast after a write.
- `edit-mark` adds class `edited` to a field whose value differs from the shot's original text.
- `edit-persist` restores saved values after a page reload.
- `edit-source-safe` leaves the source video unchanged on disk.
- `edit-external` reloads the project when the assistant changes `project.json`.

## How to get to it (user POV)

- Open a project.
- Edit an on-screen text field inside a shot.
- Reload the page or reopen the project to confirm the new value.
- Let the assistant change the project file and watch the view update.

## Driving it with Playwright

Preconditions:

- The project view is open and `.fld input` elements are present.
- The demo project file is `projects/demo/project.json` under the temp `HOME`.
- The source video is `fframestudio/demo-src/demo.mp4` and is 12 s long.

- **Read a field.** Take the first field and its value. Run `const field = page.locator('.fld input').first();` and `const before = await field.inputValue();`. The value is the merged text for the shot.
- **Edit and commit.** Type a new value and fire `change`. Run `await field.fill(after);` and `await field.dispatchEvent('change');`. The `Saved` toast appears and the view re-renders.
- **Wait for the save.** Run `await page.waitForFunction((v) => document.querySelector('.fld input')?.value === v, after, { timeout: 5000 });`. The first field shows the new value.
- **Confirm on disk.** Read the project file. Run `JSON.parse(fs.readFileSync(path.join(HOME, 'fframestudio/projects/demo/project.json'), 'utf8'));`. Some value under `file.edits` equals the new value.
- **Confirm it persists.** Reload and reopen. Run `await page.reload();` and `await page.waitForSelector('.fld input');` then `await page.locator('.fld input').first().inputValue();`. It equals the new value.
- **Confirm the source is safe.** Run `ffprobe -v error -show_entries format=duration -of json <source mp4>`. The duration is still 12 s.
- **Proof.** Screenshot the edited view. The harness writes `04-edited.png`. It shows the field with its new value.

## Gotchas

- Save fires on `change`, not on `input`. Use `dispatchEvent('change')` or blur the field, or nothing is written.
- The shown value is the merged text (`text` plus `edits`), so compare against the merged value, not the raw shot text.
- The whole view re-renders after a save. Re-query `.fld input` before reading it again.
- A visible value alone is not proof. Read `project.json` and confirm the value under `edits`.
- Reload is required to prove persistence. A value in the current DOM may only be local state.
- A green UI run does not prove the source is untouched. Check the source file with `ffprobe`.
- The save writes the whole project file without its `__abs` field. An external change made at the same moment can be overwritten.
