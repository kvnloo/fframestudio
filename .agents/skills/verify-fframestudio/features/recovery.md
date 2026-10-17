# Crash recovery and autosave

Committed edits autosave locally after a short debounce. Reopening the project offers recovery or discard without changing its saved file. Recovered commands support Undo and Redo. Only Save writes project.json.

## Sub-features

- `recovery-journal` persists committed edits, including Undo and Redo, in local browser storage.
- `recovery-offer` offers Recover unsaved changes and Discard when reopening an unsaved project.
- `recovery-undo` replays recovered edits through normal undo history.
- `recovery-discard` keeps the disk document and clears the offer.
- `recovery-save` saves recovered content through the normal Save action.
- `recovery-pending-save` preserves edits made while Save is pending, including a crash after the file reaches disk.
- `recovery-history` restores Undo and Redo actions even when their original history preceded Save.
- `recovery-conflict` keeps the pending recovery choice if another writer changes the saved file.

## How to get to it (user POV)

- Open a project, edit a Words field, and leave without saving.
- Reopen the same project in the same browser and choose Recover unsaved changes or Discard.
- Use Undo, Redo and Save as with any other edit.

## Driving it with Playwright

Preconditions:

- The demo editor is open with `input[data-field="title"]` present.
- Record the exact project.json bytes under the verification run's temporary HOME.
- Keep the browser context when closing and reopening a page so its local storage survives.

- **Edit.** Run `await page.locator('input[data-field="title"]').fill(recovered);` and `await page.locator('input[data-field="title"]').press('Tab');`. Wait with `await page.waitForFunction(() => window.ffs?.journal?.persistedVersion === window.ffs.doc.revision);`. Confirm project.json bytes still match the baseline.
- **Close without Save.** Run `await page.close();`, `page = await ctx.newPage();`, and `await page.goto(base + '/#/p/demo');`.
- **Offer.** Run `await page.waitForSelector('[data-action="recover"]');`. Capture `06-recovery-offer.png`.
- **Recover.** Run `await page.click('[data-action="recover"]');`. Wait for the title field to equal `recovered`. Confirm project.json is still byte-identical.
- **Undo and redo.** Run `await page.click('[data-action="undo"]');` and assert the original title. Run `await page.click('[data-action="redo"]');` and assert the recovered title. Capture `06-recovery-restored.png`.
- **Save.** Run `await page.click('[data-action="save"]');` and wait for `#save-status` to read `Saved`. Check that the PUT carries the SHA-256 of the previous disk bytes in `x-ffs-expected`, then read project.json and assert the recovered title. Reload and assert `await page.locator('#recovery').isHidden()`.
- **Discard.** Make another unsaved edit, wait for journal persistence, close the page and reopen. Run `await page.click('[data-action="discard-recovery"]');` and `await page.waitForFunction(() => !document.querySelector('#recovery').open);`. Assert the saved title remains and reload does not offer recovery again.
- **Edit during Save.** Hold the Save PUT with `page.route`, commit another title, and release the PUT. Assert disk contains the captured Save title. Close and reopen, recover, and assert the later title returns with a working Undo to the saved title.
- **Undo across Save.** Edit a title, Save, then choose Undo. Wait for journal persistence, close and reopen, and recover. Assert the undone title returns and Undo can restore the saved title.
- **Crash after PUT.** Hold the Save PUT and its following GET using `page.route`. Commit another title while PUT is pending and wait for its journal entry. Release PUT, wait for the GET, and close the page before releasing that read. Reopen, recover and assert the later title returns while disk still holds the captured Save title.
- **External conflict during recovery.** While the recovery dialog is open, update the project through `await page.request.put(base + '/fs?path=projects/demo/project.json', { data: disk });`. Wait with `await page.waitForFunction(() => window.ffs.conflict);`, recover, and assert the local title returns while the external file bytes remain unchanged. Confirm Save returns false until the conflict is resolved. Accept the browser confirmation, choose `[data-action="reload-external"]`, and verify the external project title loads.
- **Proof.** `report.json` records the recovery journeys, their titles, the recovered version and the expected disk hash.

## Gotchas

- The debounce leaves a brief crash window. Wait for journal persistence before deliberately closing the page.
- Local recovery belongs to a browser profile and origin. A fresh context or a different bridge port does not share it.
- Recovery does not Save. Read disk bytes before and after recovering to prove this.
- A journal from a different disk hash is retained and reported as unavailable rather than replayed onto an unrelated document.
- Browser storage refusal or quota failures show an autosave/recovery error. Explicit Save remains available.
