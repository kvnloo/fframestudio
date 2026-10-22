# Local-first shot generation (issue #1, first slices)

## Status and boundaries

The provider/queue contract and Studio workflow are implemented and exercised with
an explicitly labelled **fake test-pattern provider**. The offline LTX worker is
experimental: one short low-res t2v and one i2v clip have run for real on the shared
12 GB GPU (measurements below); full-size fit, longer clips and visual quality are
**not yet qualified**. Do not interpret a fake-provider pass or an installed CUDA runtime as
a real generation benchmark. The [qualification receipt](evidence/generation-first-slices.json)
retains the executed gates, including failed timing/performance runs and the busy-GPU skip.

The worker runs outside the browser and has no connection to playback, the
preview rAF, or document commands. Editing works without it. Hosted/folder and
example-copy projects show **local inference unavailable** and make no generation
requests. A hosted page explicitly connected to its user's authenticated bridge
can generate for projects in that bridge's library; Vercel never executes models.

## Asset and insertion contract

- The canonical document is `fframestudio.project/1`; see [project-format.md](project-format.md).
  A generation job does not mutate `project.json`, original media, the library
  index, or any existing shot.
- Each attempt gets a new UUID and writes only
  `projects/<projectId>/media/generated/<jobId>/result.mp4` plus `result.json`.
  Retry creates another job ID and directory, links `retryOf`, and preserves the
  seed/settings. New variation increments the seed. There is no overwrite mode.
- **One supported output: H.264 in MP4, yuv420p, constant requested FPS, no audio**.
  Before publishing `done`, native ffprobe checks codec, dimensions, pixel format,
  frame rate and duration; FFmpeg then decodes the entire output with `-xerror`.
  A failed or cancelled attempt never exposes an importable result.
- JSON sidecar `fframestudio.generation/1`: prompt, seed, model, version, settings,
  weight licence/notice/link, cost, generation timestamp, machine-generated flag,
  media dimensions/FPS/duration/bytes/SHA-256. Prompts are local creative data, not
  credentials; never put credentials in a prompt.
- **Insert into timeline** re-reads the job, then calls the internal
  `import-generated` command through `Editor.run`. This transaction adds a new
  media record and an appended clip with stable UUIDs. Clip `mediaId` references
  the new asset. `media.generation` embeds sidecar provenance. It does not replace
  existing clips and is intentionally not in the external ACP proposal allowlist.
- Source/timeline durations are integer **project** frames. Insert uses
  `floor(probedSeconds * projectFPS)` to avoid claiming nonexistent source handles;
  sourceIn = 0 and speed = 1/1. The model's 8n+1-frame constraint can produce a
  slightly different duration than the requested seconds. The probed value wins.
- Preview is nonmutating; one Undo removes both the clip and its media record;
  Redo restores both. Undo never deletes the generated file. Save uses the existing
  journal and compare-and-swap path; reopening preserves asset/settings. A project
  JSON download references media; it is not a self-contained media archive.

## Provider interface

`bridge/generation/providers.mjs` exports capabilities with schema
`fframestudio.generation-provider/1`. Required data: provider ID/name, model/version,
implemented modes (`t2v` / `i2v`), maximum seconds, explicit resolution pairs/FPS,
minimum free VRAM, measured peak (null until measured), cost kind/amount/currency,
and licence name/URL/conditions. `validateCapability` rejects malformed adapters.

An adapter implements:

```js
{ capability,
  async probe() { return { available, reason, /* optional GPU / qualification */ }; },
  async generate(settings, { output, signal, progress }) { /* write this one MP4 */ }
}
```

Availability is probed at the authenticated endpoint and again before local
execution, not inferred from a model catalogue or free marketing tier. Capability
responses contain public metadata only. Settings are allowlisted: providerId,
projectId, prompt, seed, duration, width, height, fps, mode, reference. User-supplied
URLs, executable paths, output paths, image bytes inside settings, credential fields
and unknown keys are rejected.

### Image-to-video from the playhead

`mode` is `t2v` (default; old journals without `mode` stay valid) or `i2v`. The bridge
accepts `i2v` **only when the provider's capability `modes` includes `i2v`**
(`unsupported-mode` otherwise); the Generate panel disables "From playhead frame" for
such providers instead of silently ignoring the reference. The fake test provider
advertises both; `local-ltx` advertises i2v after one real i2v run on this host
(480×480, see below). The browser journey exercises capture/upload/insert with the
fake provider only.

1. **Capture** reads the clip under the playhead from the document, not the preview
   element. Own media maps through `sourceIn + (frame - start) * speed`; a master proxy
   uses timeline frames, mirroring poster mapping. The existing detached, paused poster
   decoder (serialized with poster work) seeks a quarter-frame into that source frame;
   the thumbnail worker cover-crops it to the selected resolution and encodes PNG off
   the UI thread. The playing preview is never seeked.
2. **Upload** `POST /generation/references?projectId=<id>` (`Content-Type: image/png`,
   ≤ 8 MiB, same token/Origin checks). The bridge checks PNG signature and IHDR size
   (32–4096 px), decodes it fully with FFmpeg, then publishes
   `projects/<id>/media/generated/references/<uuid>.png` with a no-overwrite link.
   Response: `{ id, file, width, height, bytes, sha256 }`; no absolute path.
3. **Submit** `{ ..., mode: 'i2v', reference: { id, videoId, clipId, clipName,
   mediaId, frame, sourceTime } }`. The bridge resolves the file itself (lstat-checked
   path), requires its dimensions to equal the requested resolution
   (`reference-mismatch`), and records its SHA-256 in the job. Immediately before the
   worker runs it re-hashes; changed bytes fail the job as `unknown-reference`.
   Retry and New variation reuse the stored reference.
4. **Provenance**: job and `result.json` gain `mode` and `reference` (file, hash,
   dimensions, source clip/media/video, timeline frame, source seconds). Insert embeds
   this in `media.generation`; it stays the same single undoable `import-generated`
   transaction. Undo never deletes the generated clip or the reference PNG.

### HTTP / events

All routes use the bridge's existing loopback Host, Origin and token checks.
Cross-origin preflights include POST; generation credentials never use URL params.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/generation/providers` | runtime capability/availability list |
| GET | `/generation/jobs?projectId=<id>` | persisted job snapshots |
| POST | `/generation/jobs` | validated request → 202 queued job |
| GET | `/generation/jobs/<id>` | authoritative job snapshot |
| POST | `/generation/jobs/<id>/cancel` | cancel queued/running; await owned worker exit |
| POST | `/generation/jobs/<id>/retry` | failed/cancelled → new attempt, same settings |

Existing `/events` SSE receives ordinary `data:` messages
`{ "ev": "generation", "job": { ... } }`. Progress is bounded to [0, 1], with
1 reserved for validated completion. The slate also periodically reads jobs to
heal missed events. Opening Generate lazily loads its module/CSS and probes;
ordinary cold opens do not load or execute generation UI code.

### Persistence / trust / secrets

Queue states: `queued → running → done | failed | cancelled`; cancellation also
works from queued. One worker runs at a time per bridge; at most 32 outstanding
jobs. Each state/progress update is fsynced to a new 0600 file, atomically renamed
and the directory fsynced under `.generation/jobs/<id>.json` **before** REST/SSE
publishes it. After a restart, unfinished queued/running jobs become
`failed / interrupted`; explicit Retry is required. No surprise expensive resume.
Corrupt journals fail startup rather than silently lose jobs. There is no
cross-bridge GPU scheduler: run one generation bridge per library/GPU.

Generation paths are server-selected. Every existing ancestor is checked with
lstat and symlinks rejected, including final output and state entries. Traversal,
absolute paths, backslashes and unknown project IDs are rejected. Local OS and
installed worker code are trusted, as for `/fs`; this is not a sandbox against a
malicious local process swapping parent directories during a syscall. Incomplete
outputs are kept for diagnostics but never imported. No automatic deletion/GC.

No provider key is accepted by the browser API or saved in jobs/projects. Future
hosted adapters must read credentials only from server environment or user-owned
config and explicitly pick public fields for responses. Raw provider stdout/stderr,
exceptions and tracebacks are not logged or sent to REST/SSE. Local workers receive
a minimal environment and offline mode, not the bridge's API credentials. The
current disabled hosted skeleton performs no network requests and reads no keys.

## Experimental local LTX setup

Optional Python 3.12 worker environment, weights, Hugging Face cache, generated
smoke media and screenshots **must stay outside Git**. Choose an artifacts folder:

```sh
uv venv "$GEN_ARTIFACTS/.venv" --python 3.12
uv pip install --python "$GEN_ARTIFACTS/.venv/bin/python" -r tools/requirements-generation.txt
"$GEN_ARTIFACTS/.venv/bin/python" tools/prepare-generation.py --dir "$GEN_ARTIFACTS/models"
export FFS_GEN_PYTHON="$GEN_ARTIFACTS/.venv/bin/python"
export FFS_GEN_MODEL_DIR="$GEN_ARTIFACTS/models"
npm run bridge -- --root "$DISPOSABLE_LIBRARY" --no-config
# Separate run; SMOKE_DIR must be a new external artifacts directory:
FFS_GEN_SMOKE_DIR="$SMOKE_DIR" npm run gen:smoke
```

Downloads are explicit and pinned to Hugging Face revision
`8984fa25007f376c1a299016d0957a37a2f797bb` of `Lightricks/LTX-Video`, checkpoint
`ltxv-2b-0.9.6-distilled-04-25.safetensors`. That checkpoint uses the 0.9.5 VAE and
scheduler layout, so `prepare-generation.py` also fetches four small JSON configs from
`Lightricks/LTX-Video-0.9.5` at `e58e28c39631af4d1468ee57a853764e11c1d37e` into
`config-0.9.5/` (the 0.9.0 base config fails: decoder 512 vs 1024 channels). T5 is
loaded from `base/text_encoder` because the single-file checkpoint has no T5 weights. Generation is offline-only after setup.
No runtime web dependency is added. CUDA visibility is the first NVIDIA device;
the pilot requires at least **9216 MiB free** (nvidia-smi) and checks again in the
worker, allowing 512 MiB for the worker's own CUDA context (measured: 9309 MiB free
in nvidia-smi read as 9053 MiB in torch after context creation; without the allowance
every admitted run failed as busy).
Busy/no-GPU/missing optional install cleanly skips `gen:smoke`; an attempted model
inference or validation failure exits nonzero. It never falls back to fake output.

Low-memory preset: bf16, CPU T5 prompt encoding, release text encoder, model CPU
offload, tiled VAE, eight uniform steps (diffusers 0.35 `LTXPipeline` derives its own
sigmas and rejects a custom timestep list), guidance=1, deterministic seed.
Bit-exact reproducibility across GPU/software versions is not promised. A real
run writes latency (load + encoding + denoise + decode + encode), PyTorch peak
allocated/reserved MiB, GPU/runtime versions and frame count to `result.metrics.json`.
Smoke emits a validated clip and a 2×2 contact sheet; inspect the sheet before
claiming visual qualification. Optional smoke overrides: `FFS_GEN_SMOKE_SIZE=480x480`,
`FFS_GEN_SMOKE_SECONDS=2`, `FFS_GEN_SMOKE_REFERENCE=<png at that size>` (real i2v).

### First real measurements (2026-10-20, RTX 3080 Ti shared, one run each)

[Receipt](evidence/generation-i2v-real-clip.json), including every failed attempt.

| Mode | Size / frames | Worker latency | CPU prompt encode | Denoise + decode | Peak VRAM (torch alloc / nvidia-smi process) |
| --- | --- | --- | --- | --- | --- |
| t2v | 480×480 / 49 @ 24 fps | 130 s | 91 s | 34 s | 3779 / 4624 MiB |
| i2v | 480×480 / 49 @ 24 fps | 170 s | 89 s | 77 s | 6253 / 7108 MiB |

Both clips passed queue validation and were viewed: coherent subject, little motion.
CPU T5 encoding dominates and depends on free host RAM (one swap-bound run spent
~17 minutes there). 704×480 and 3–5 s remain **unmeasured**; the 9216 MiB admission
threshold is unchanged.

## Licence and provider research

Checked against the following public documentation (2026-10-17):

1. [LTX model card](https://huggingface.co/Lightricks/LTX-Video) lists the 2B
   distilled checkpoint and constraints. [Diffusers LTX docs](https://huggingface.co/docs/diffusers/api/pipelines/ltx_video)
   document t2v/i2v, single-file loading, offload/casting and distilled settings.
   Documentation VRAM claims are not measurements on this host.
2. [Actual weight licence](https://huggingface.co/Lightricks/LTX-Video/blob/8984fa25007f376c1a299016d0957a37a2f797bb/LTX-Video-Open-Weights-License-0.X.txt):
   **LTXV Open Weights License 0.X**, not MIT/Apache. Use restrictions apply;
   machine-generated disclosure is required; entities with >= $10M annual revenue
   require a separate paid commercial agreement. Lightricks generally claims no
   output rights, subject to the agreement. UI and sidecar display this notice.
   Do not market this as unconditional free commercial use.
3. [Unsloth Desktop docs](https://unsloth.ai/docs/desktop#image-and-video-generation)
   now explicitly advertise local diffusion video with **LTX and Wan**. Therefore
   “Unsloth only supports LLMs” would be inaccurate. This slice uses the documented
   Diffusers Python pipeline directly, not an invented FastLanguageModel video API
   and not an Unsloth adapter. Unsloth's installed-runtime/video API and 12 GB
   behaviour have not been qualified here.
4. [Nous Portal](https://portal.nousresearch.com/) advertises free model options and
   separately billed Tool Gateway usage. That does not establish a free video
   generation endpoint, output licence or limits. No such endpoint was qualified;
   the hosted adapter remains disabled, unknown cost, no API call.
5. [Space Bunny API docs](https://spacebunny.app/docs) explicitly accept video/images
   as **input** and return **text/JSON/tool calls**, not video. They list a live
   chat-completions route, but no paid/credentialed call was attempted here.
   It is not a video backend; optional storyboard/prompt/analysis integration is
   deferred. A previously retired preview is not evidence of current availability.

## Verification

`npm test` includes capability/settings, success/failure/invalid-media, queued and
mid-run cancellation, same-seed retry, path/symlink safety, transaction rollback,
secret-leak and actual bridge SIGKILL/restart tests. The `npm run verify` journey
`generate: fake provider -> job -> insert -> undo -> reopen` uses an isolated
library, renders a real H.264 **test pattern**, drives Studio, checks disk Save,
media preservation and phone layout. Fake is only registered with explicit
`--generation-fake`; it is never an automatic fallback or an AI benchmark.
