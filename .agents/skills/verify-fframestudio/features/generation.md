# Generate shot

Explore locally generated variations from the Generate slate, then insert a new
shot without replacing originals. Editing never requires a GPU or paid API.

## Sub-features

- G01: model availability, limits, cost and weight licence are visible.
- G02: prompt/duration/aspect-resolution/FPS/seed create asynchronous jobs.
- G03: progress, cancel, retry and provenance stay available in the variation cards.
- G04: preview a completed result and insert a new referenced asset/clip; Undo,
  Redo, Save and reopen preserve the ordinary project contract.
- G05: hosted/folder projects show local inference unavailable without requests.

## How to get to it (user POV)

Open a bridge-library project → Film slate → **Generate**. Text-to-video is the
pilot; playhead image conditioning is explicitly not enabled. The test provider
is labelled **fake / not AI** and only exists in explicitly configured tests.

## Driving it with Playwright

Preconditions: `npm run verify` owns an isolated library and a bridge with
`--no-config --generation-fake`. `test/generation-journey.mjs` is invoked by
`test/verify.mjs`; never point it at a real user library.

- **Open**: `page.locator('[data-slate-tab="generate"]').click()`; `#gen-status`
  reports availability and `#gen-model` identifies the fake test-pattern model.
- **Generate**: `page.locator('#gen-prompt').fill(prompt)` and
  `page.locator('#gen-seed').fill('123')`, then `#gen-submit.click()`;
  `[data-gen-job]` shows queued/running/completed progress and `.gen-preview video`
  decodes a real H.264 synthetic pattern, not an AI benchmark.
- **Stay interactive**: execute a text command/Undo while the worker is active.
- **Insert**: `[data-gen-action="insert"].click()` appends one clip referencing a
  new asset. Provenance carries seed/model/licence. Read actual saved project.json.
- **Undo/Redo**: `[data-action="undo"].click()` restores all original clips without
  deleting generated media; Redo restores the new clip. Save, reload, inspect seed.
- **Failure/cancel**: `[data-gen-action="cancel"]` and
  `[data-gen-action="retry"]` act on their card; retry preserves the seed.
- **Variation**: `[data-gen-action="variation"]` creates a new seed/attempt.
- **Phone**: set 390px viewport, reach the job card with `scrollIntoViewIfNeeded`,
  and capture the result. Every adaptive-layout journey reaches Generate too.

## Gotchas

- Generate loads lazily. Ordinary startup must not start workers/load weights.
- Hosted/folder/example copies must disable submission and make no generation API
  requests. An explicitly connected bridge library project is a separate mode.
- Node tests cover actual bridge SIGKILL recovery, strict settings, symlink/path
  safety, raw error redaction and no-secret responses, SSE, journal, logs and bundles.
- `npm run gen:smoke` is local-only real LTX, never CI fake output. It skips
  busy/no-GPU/missing optional setup; attempted inference failure exits nonzero.
  A real qualification needs latency/VRAM and inspection of its contact sheet.
- Scroll the internally scrolling slate to capture form **and** result. A result
  below the fold is reachable, not evidence that its preview is visible.
- The experimental LTX fit, i2v/playhead capture and free hosted video are not yet
  qualified. See `docs/generation.md`; never claim a GPU fit from a fake pass.
