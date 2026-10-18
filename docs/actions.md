# Studio actions: one contract, multiple inputs

`web/src/actions.js` is the dependency-free registry shared by the editor, the document worker,
ACP proposals and deterministic voice grammar. **Extend this registry, not a parallel voice or
agent command list.** It exports `ACTIONS`, `action(id)`, `actionManifest()`, `validateCommand()`
and `resolveClip()`. There is no web runtime dependency or executable-code interface.

Each entry has a stable `id`, display `title`, search `synonyms`, JSON-compatible typed `schema`,
`scope`, `destructive` / `bulk` flags, `preview(context, params)`, `apply(context, params)` and
`inverse(receipt)`. Timings are integer **project frames**, indices zero-based, object references
stable IDs. `actionManifest()` omits functions and can be sent to the user's ACP agent. This is
runtime schema typing, not a TypeScript build or an external JSON Schema validator.

```js
const edit = { id: 'trim', params: { clipId: 'shot-2', duration: 60 } };
const entry = action(edit.id);
const preview = entry.preview(editor, edit.params); // scope, diff, after; no mutation
// Present the scope/diff and obtain confirmation when destructive or bulk.
const receipt = await entry.apply(editor, edit.params);
// Content changes use Editor.run -> CommandStore -> patches, journal, ordinary undo/redo.
```

## Input adapters and compatibility

- **Palette** searches registry IDs, titles and synonyms. Keyboard bindings and context menus
  resolve those same IDs through `Editor.action()`; the existing inspector/dialog gathers missing
  parameters for interactive invocations. Existing labels, disabled-state rules and custom
  shortcuts remain intact. `V` is reserved for hold-to-talk outside text inputs and dialogs.
- **ACP** retains `fframestudio.proposal/1`, exact project/base revision, 1–100 commands, Inspect /
  Apply / Reject and one undoable transaction. Both existing `{type,...parameters}` commands and
  `{id,params}` registry actions are accepted. They use the same registry schema validator and
  existing document/source-handle/beat-lock validation. Transport/UI actions are not allowed in
  proposals. No arbitrary code, internal restore commands or hidden rebasing is accepted.
- **Voice** resolves one utterance to `{id,params}`. Unsupported or ambiguous instructions return
  clarification, never an approximate edit. `this shot` uses selection, then playhead;
  `the second clip` resolves the second clip in the current video. The resolved stable ID and
  parameters are captured in the preview. A destructive/bulk confirmation is invalidated if the
  document revision changes. Keyboard/menu actions retain their established immediate-edit
  semantics; they do not acquire unexpected voice confirmation dialogs.
- **Inverse**: content receipts expose the existing store's validated `restore-document` inverse;
  selection has its own inverse without dirtying content. Transport, panel navigation, saves,
  downloads and microphone activation have no content inverse (`null`). Undo/redo remain history
  operations. Do not promise to undo external downloads or microphone permission decisions.

Internal recovery/batch/restore commands remain private to the store. Ordinary content actions,
including agent proposals and voice edits, still use the existing synchronous edit/patch path;
analysis never enters the animation loop. Reference/voice modules and desk DOM load only when requested; ordinary project cold-open does not fetch these optional surfaces. Add a schema and inverse round-trip test whenever a
new content action is introduced. Do not add an action to a string list in a new feature module.

## Reference intake and local analysis

**Import reference** is available in the library and editor. Files are capped at 60 MB and ten
minutes. In hosted/folder mode an imported video becomes an additive IndexedDB project, with
SHA-256 provenance and its actual bytes; the existing open folder is not replaced or written.
The browser-only fallback assumes 30 fps and says so. No hosted URL/media fetch or analysis is
pretended. Reopening and saving a browser reference use normal recovery/storage.

With a bridge, authenticated `/reference/*` endpoints handle upload, capability reporting,
analysis jobs, evidence media and local transcription. Direct URLs must be public HTTP(S)
MP4/WebM/MOV/AVI files: no credentials, fragments, redirects, arbitrary pages, cookies or auth
bypass. DNS is checked and pinned to a public address; private/reserved IPv4/IPv6, mixed private
DNS answers and unsupported types fail closed. The policy deliberately rejects some reserved
and special-purpose global ranges too. Both declared and streamed sizes are bounded; response
Content-Type and local ffprobe container/video/duration checks are required. Social links
(X/YouTube/TikTok) explain: **download it using the service's permitted option and import the
file**. Only import media you have rights to use. URL provenance omits query parameters.

`bridge/analyze-reference.py` runs local ffmpeg in a child process, not browser/main-thread
analysis. Media decoding permits file/pipe protocols only, not network protocols. The MVP is:

- ffmpeg `scdet`, threshold default 10, minimum shot duration default 0.3 s;
- frame-indexed boundaries, midpoint evidence JPEGs and deterministic 4-cluster k-means on
  downscaled RGB midpoint frames;
- shot durations and mean-shot pace;
- measured per-shot/global RMS dBFS, timestamped 100 ms RMS windows and rising-energy onset
  candidates when an audio stream exists. These are **not** beats or integrated LUFS.

The timestamped breakdown labels detection uncertainty. Confidence is normalized scdet score,
**not calibrated probability**; the opening boundary has no detection confidence. Motion,
objects, typography, composition, transitions and effects are not inferred. Constant-frame-rate
mapping is qualified; variable-frame-rate mapping is explicitly approximate. Limits are ten
minutes / 120 fps / 200 detected shots / two concurrent analyses. Python/ffmpeg processing is
bounded; cancel and bridge shutdown terminate owned process groups, including decoder children.

References and evidence live inside the bridge root, keyed by actual SHA-256 bytes. Analysis
cache keys also include threshold, minimum length and algorithm version. Jobs expose progress
and explicit cancel. Errors are visible, not fabricated observations. Analysis reruns after a
cancellation; there is no partial-analysis resume in this foundation.

## Editable reconstruction and comparison

**Recreate editable approximation** saves an ordinary v1 project with independently editable
shot timing/source ranges and palette-derived shared look tokens. The source file is retained
in the new project's media, with content hash and attribution/provenance. It is deliberately a
**source-linked editorial approximation**, not a synthesized scene remake or a claim that
opaque source effects became separate layers. Unsupported semantics are recorded as limitations.

**Compare reference** exposes the original and current source-mapped reconstruction at shared
project time, plus the same editable text/look tokens. Scrubbing seeks both players and the
editor. After trim/reorder the original retains original time while the reconstruction follows
edited source ranges. Continuous dual-player playback and a qualified final render/export are
not implemented here. Ordinary project Save/reopen and undo remain available.

## Speech and privacy

Tap **Voice** or hold `V` (release/blur stops recording); typed input is always available. Mic
state and interim browser transcript are visible. Starting input cancels browser speech feedback
(barge-in); no spoken feedback is generated by this foundation. No always-on listening.

Browser Web Speech is used only after checking its explicit consent box: it **may use the
browser vendor's speech service**. Without that consent the bridge probes for local
`faster-whisper`, `whisper`, `whisper-cli` or `whisper.cpp`. No packages or weights are installed
implicitly. Faster-whisper uses an already cached `tiny` model (`local_files_only=True`);
Whisper CLIs require `FFS_WHISPER_MODEL` to name installed local weights. Missing backend/model,
permission denial or transcription failure leaves a clear typed fallback. Local recordings are
limited to 30 seconds / 4 MB and deleted after transcription. Real microphone/backend decoding
is **NOT RUN** in automated qualification on a machine without a configured speech model.

Core grammar: play/pause, seek seconds, select shot N, trim/shorten by seconds, split at current
playhead, delete, duplicate, move to position, undo/redo, save, open named panel, and quoted
`change the text to '…'`. Compound instructions, missing amounts and unsupported effect changes
ask for clarification. The existing ACP proposal path can accept registry JSON; an automatic
LLM utterance resolver and multimodal providers are deferred, not silently called.

## Web Share Target and boundaries

`web/manifest.webmanifest` declares a multipart POST share target. The same-origin
`share-worker.js` handles intake into a small IndexedDB inbox and redirects to Studio. Files
are imported locally; shared links are only placed into the URL input and require an explicit
bridge import. The worker does not cache app traffic, fetch shared URLs or provide an offline
shell. Android/PWA install/share-sheet real-device verification is **NOT RUN**.

## Qualification

- `npm test`: schemas, every content inverse, 100+ utterance table including clarification,
  generated CC0 solid-colour/tone analysis, API authentication/policy/cache/cancel, existing suites.
- `npm run verify`: existing journeys plus shared-registry equivalence, reference import →
  analyze → recreate → compare, typed voice preview/confirm → text → undo → Save/reopen, and
  hosted additive local-file reference import without remote URL fetching.
- `node test/reference-e2e.mjs`: isolated targeted journey runner; `FFS_EVIDENCE` chooses output.
- `bash scripts/check-no-local-paths.sh`, three browser verification runs, unchanged
  `npm run test:perf`, `npm run build:site`. Keep failed timing samples alongside later passes.

No native picker, real mic, Android device, paid agent, multimodal inference or final rendered
video export is certified by the typed-fallback/headless checks.
