# Hosted local-first Studio

The static Studio opens only visitor-owned folders or the visitor's loopback bridge. Examples are a separate attributed shelf opened as browser-local editable copies. No account or upload is involved.

## Sub-features

- `empty`: a fresh visitor sees zero productions, folder actions and a separate Examples shelf; no bridge API probes or non-same-origin requests.
- `folder`: Chromium read/write directory permission and remembered handle; a read-only folder input fallback with IndexedDB edits and project download.
- `recovery`: unsaved edits, undo/redo and workspace preferences survive reload in IndexedDB.
- Source attribution is shown both for hosted example copies and locally generated documents with `metadata.source.author`, licence, credit and a safe HTTP(S) source link. Do not label a local build as a browser example copy.
- `intro`: featured original launch film at 1896×880 and 390×780, pinned source/credits, 2:08 and Long-form; public awaiting-permission card has no image or watch button and exposes `npm run example:fframes-intro` through Open locally. Metadata remains discoverable with no example assets. Loading and failure states stay inside the shelf.
- `examples`: lazy manifest/posters, author/licence/source attribution, independent copies, Save to my folder.
- `bridge`: fragment-only connection token, cleared URL, session-scoped connection, local media, ACP proposal review and saved-file readback.
- `layout`: Studio editor and hosted library at owner, laptop and phone sizes without horizontal overflow.

## How to get to it (user POV)

Build with `npm run build:site` and serve `site/` with a static server. Choose Open a folder or Open read-only, or Open a copy from Examples. Open the hosted link printed by your own bridge to use local agents. Do not use a bridge that another person or test started.

## Driving it with Playwright

Preconditions: system Chromium with H.264 support, disposable files and a plain static server. `test/hosted-journey.mjs` constructs its own fixture, site and bridge, is included by `npm run verify`, and also runs through `npm run verify:hosted`. It does not deploy or use the production host.

- **Empty:** `await page.goto(base)`; `await page.waitForSelector('#open-folder')`; assert zero `.card[data-project]`, no `.gate`, and no HTTP requests beyond the static origin or to `/me`, `/fs`, `/agents`, `/events`, `/theme`.
- **Preferences:** `await page.selectOption('#library-theme','paper')`; reload and assert the selection remains while `localStorage.getItem('ffs.settings')` is null; switch back to Studio.
- **Read-only import footprint:** a no-`showDirectoryPicker` phone context (Android Chrome stand-in) sees only `label#open-folder` with the privacy note; `setInputFiles` a synthetic 3,000-file folder and assert IndexedDB keeps only `project.json` + referenced media, zero off-origin requests and no non-GET methods. `node tools/folder-import-footprint.mjs [--site <built-site>] [--layout library|project]` prints before/after IndexedDB bytes for any built site.
- **Read-only folder:** `await page.locator('#folder-files').setInputFiles(fixtureDirectory)`; click `.card[data-project="visitor-film"]`; wait for `window.ffs.interactiveAt`, playable `#preview-video` and analysed `#audio-wave`.
- **Edit/recover:** open `#tab-shot`, fill `[data-field="title"]`, dispatch `change`; reload after autosave and click `[data-action="recover"]`; verify Undo and Redo, Save, reload and persisted text. Check the original fixture file remains byte-identical.
- **Download:** pair `page.waitForEvent('download')` with `[data-action="export-project"]`; parse the downloaded JSON and assert the edited title.
- **Examples:** scroll `#examples-shelf` into view; click `[data-open-example="synthetic"]`; edit, Save and reload. `#tab-source` exposes the author/licence and source link in `#source-pane`. Assert published example bytes stay unchanged.
- **Bridge:** open the disposable bridge's fragment link without logging it; assert an empty location hash and a sessionStorage connection, then library/media playback. In `#tab-assistant`, choose `[data-agent="fixture"]`, send with `#ask` and `#send`; inspect and Apply the proposal via `[data-action="apply-proposal"]`, Save and read the exact project back from disk. The deterministic ACP fixture is not a live paid-provider claim.
- **Save copy:** open the example while bridge-connected; click `[data-action="save-copy"]`; read back the new project, library entry and media bytes from the owned bridge root.
- **Local real film:** `FFS_INTRO_ARTIFACT=<generated-intro-folder> FFS_EVIDENCE=<directory> npm run verify:intro` copies only project/proxy/poster into a disposable folder, opens through file input, seeks actual first/middle/last scenes, verifies decoded embedded audio + measured waveform, plays, checks source attribution and reloads. It skips cleanly if no artifact is configured. Upstream advertises 128s; the pinned structured CLI reports 7650 frames/60fps = 127.5s. Never fabricate a padded 128-second timeline or beats. Inspect local contact sheet and editor screenshots separately.
- **Visual:** `FFS_EVIDENCE=<directory> node tools/capture-hosted.mjs` serves the actual built site and captures empty library, attributed examples shelf and opened example at 1896×880, 1366×680 and 390×780. Inspect the images, not just the exit status.

## Gotchas

- Native picker dialogs cannot be driven headlessly here. `test/hosted/folder-host.test.mjs` exercises a directory-handle fake including permission re-request, native-style writes and conflict hashes; it does not certify native browser UI or cross-browser permissions.
- Files chosen with `webkitdirectory` are read-only snapshots; only project files and referenced media are persisted. Chrome's native “Upload N files” prompt cannot be captured headlessly. Save must never mutate original bytes. Clearing site data removes cached files, copies, preferences and recovery history.
- A fresh visitor must never inherit a developer's demo library. Synthetic verification media is explicitly labelled; real upstream Examples remain attributed and separate.
- A production HTTPS-to-loopback permission prompt/PNA policy can differ from a headless loopback static test. `npm test` separately exercises the real hosted Origin, PNA preflight and rejected origins/hosts/tokens.
- Never log a real fragment link or include tokens in screenshots. Every test bridge uses `--no-config`; the ACP suite checks the real discovery file's bytes and mtime are unchanged.
- Run performance acceptance serially without capture jobs. Retain failures and all repeated run reports; do not relax budgets.
