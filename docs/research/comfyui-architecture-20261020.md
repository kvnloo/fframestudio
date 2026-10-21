# ComfyUI in fframestudio — architecture brainstorm (2026-10-20)

Status: **draft for the owner and Hermes to iterate on.** The scaffold on branch
`feat/comfyui-pane-20261020` implements the recommended core (sections 4–6). Everything marked
*open* is a decision for Kevin.

Owner's ask: *"add a small comfyui pane that i can drive w/ my voice and hermes will help me
brainstorm the ideal comfyui architecture using deep research & skill directory & comfyui docs &
comfyui skills & unsloth"*.

---

## 1. What already exists (reuse it, do not rebuild)

| Asset | Where | What we learned |
| --- | --- | --- |
| ComfyUI 0.30.0 (git `14b05228`, 2026-08-02), venv torch 2.13 cu130 | `<local>/comfyui` | Works on groot's RTX 3080 Ti. Not a service; launch as an owned process with isolated `--input/--output/--temp/--user-directory` and `--database-url sqlite:///:memory:` so the tree is never written. |
| Installed weights | `models/` | FLUX.2 Klein 4B / 9B fp8, Z-Image Turbo int8-convrot, SDXL base 1.0, Anima, ControlNet Union SDXL ProMax, RealESRGAN, SAM2.1, Depth-Anything-3 small; text encoders qwen_3_4b / qwen_3_06b; flux2 / qwen-image / z-image VAEs. **No video weights** (no Wan/LTX). |
| Custom nodes | `custom_nodes/` | GGUF, TRELLIS2 (+ modly GGUF ext), controlnet aux/advanced, IPAdapter plus, KJNodes, SAM2, essentials, TiledDiffusion. |
| 3080 Ti research harness + receipt | `<local>/home-offload/kvn/comfyui-3080ti-research/` | `run_comfy_case.py` renames node IDs per run to bust ComfyUI's cache (needed for honest repeat timing) and samples GPU/RAM. Receipt `fp8-sdpa-dynamic-refcache-off`: Klein 4B **edit** 1024², 20 steps, `--lowvram --reserve-vram 1.0`: **109 s wall, 11 624 MiB peak, 1.78 GB swap, host RAM floor 1.7 GB.** RAM, not VRAM, is the second bottleneck (qwen_3_4b TE is 8 GB). |
| Pokémon project workflows | `experiments/pokemon/assets/comfyui/workflows` | 25 API/GUI graphs: Klein 4B ReferenceLatent edits (~80–99 s per prompt in its log), SAM2 masking. Owner rule there: save both GUI and API JSON; launch with `--disable-all-custom-nodes --whitelist-custom-nodes …` and partner API nodes off. |
| TRELLIS.2 worktree | `.worktrees/deepseek-wave3-comfyui-trellis2` | A schema snapshot generated statically from installed node sources, one builder emitting GUI+API JSON (no drift), validators. Blocked only by sandbox/GPU exposure, not design. Good precedent for "templates as code, validated offline". |
| Codex ComfyUI skill kit | `home-offload/…/codex/skills/comfyui/` | Four layers (knowledge+client, `artokun/comfyui-mcp`, in-graph LLM nodes, node-building skills); `KNOWN_ISSUES.md` (int8 crash reports, Dynamic VRAM reload thrash → `--disable-dynamic-vram`), core `TrainLoraNode` exists, LTX-2 LoRAs via the Lightricks trainer. |
| Hermes `comfyui` skill v5.1 | profile skills | `extract_schema.py` param introspection, `template-integrity.md` (Reroute bypass, dotted dynamic keys, never strip template nodes), cloud quirks (302 `/view`, `/history_v2`). |
| Hermes `comfy-cloud` MCP manifest | `oss/hermes-agent/optional-mcps/comfy-cloud` | Official hosted MCP (OAuth, ~37 tools, curated 20). Paid credits; telemetry tool excluded. |
| Archived repos | `sft-svlm/…/2026-08-15/comfyui*` | Git bundles of ComfyUI + 5 node packs (training-data archive only). |
| Other local models | LOCAL-STACK.md | Hunyuan3D-2.1, TRELLIS.2 (12 GB flags: `pipeline_type=512`, `low_vram`), Unsloth 2026.10.5 venv, Ollama `qwen3:4b-instruct-2507`, `qwen2.5vl:3b`; GGUFs functiongemma-270m, xLAM-2-3b-fc-r, hammer2.1-3b/7b, Arch-Router-1.5B; faster-whisper tiny.en. |
| K3s / Kueue | `KUBECONFIG=~/.kube/k3s.yaml` | ClusterQueue `z0` owns the single `nvidia.com/gpu` (flavor `gpu-rtx3080ti`, nominal 1). `factory`/`lanes` are CPU-only. |

Upstream state (checked 2026-10-20): ComfyUI **v0.42.1** (2026-10-19). Relevant since our 0.30.0:
v0.40 attaches caller metadata to WS messages of a prompt (PR 16763 — cleaner job correlation),
local asset export API, **custom-node governance enforcement** (PR 16167); v0.41 FLUX 3 Image,
`ReferenceMultiLatent`, a core default-workflow route. Local 0.30.0 already has targeted
`/interrupt {prompt_id}` and `/api/jobs` routes.

## 2. External landscape

| Option | Shape | Pros | Cons |
| --- | --- | --- | --- |
| **Direct REST+WS** (`/prompt`, `/ws`, `/history`, `/view`, `/object_info`, `/interrupt`, `/queue`) | Our bridge is the client | Stable for years; works local and Cloud (`/api` prefix, `X-API-Key`); full control of trust, queue, provenance | We own param mapping and dependency checks |
| Comfy **Cloud MCP** (`cloud.comfy.org/mcp`, public beta) | Agent tool surface | Template search, prompting guides, schemas, no GPU; Hermes manifest exists | Paid credits; cloud-only models; beta surface; ~9–22k tokens of tools per call |
| Comfy **Local MCP** (`Comfy-Org/comfy-local-mcp`) | First-party stdio MCP over comfy-cli | Official, local models | **Private test, not installable today** |
| `artokun/comfyui-mcp` (★849, MIT, ~90 tools) | Community MCP + sidebar agent | Rich: validate/modify graphs, model download, VRAM | Huge tool surface, includes `download_model`/restart — too much authority for voice |
| `joenorton/comfyui-mcp-server` (★411, Apache-2.0) | Lightweight Python MCP | Small | Last push 2026-02 |
| `ATH-MaaS/ComfyUI-Copilot` (★5.5k, MIT) | In-canvas copilot (graph build/debug) | Best for *authoring* graphs inside ComfyUI | Lives in the ComfyUI UI, not ours |
| `MieMieeeee/comfyui-agent-skill` (★118, Apache-2.0) | "Registered workflows" CLI for agents | Same idea as our registry | Separate CLI |
| ComfyUI **App mode** (frontend ≥ 1.41.13) | Author picks inputs/outputs of a graph | Native, author-defined typed surface | Stored in the editor-format workflow; not an API contract; our install pins frontend 1.47.12 |
| comfy-cli `comfy generate` (beta) | Partner-API one-shots | Scripts/CI | No workflow JSON, partner credits |

Voice-specific ComfyUI projects are TTS node packs, not voice *control*. Nobody ships "voice →
typed param edits → queue"; that is our differentiator.

## 3. Unsloth — where it fits (and where it does not)

Unsloth (Apache-2.0/AGPL split, ★78k; local venv 2026.10.5) now **runs and trains image/video
diffusion** in Unsloth Studio: image LoRA training with aspect buckets and fused AdamW, FP8 LoRA for
FLUX and Z-Image on Ada+ (not our Ampere card), LoRA export to reusable files, diffusion GGUFs
documented for ComfyUI (via ComfyUI-GGUF, already installed). It also fine-tunes small LLMs/VLMs.
Fits, in priority order:

1. **Voice-intent / prompt-rewrite LM (best fit).** Fine-tune `functiongemma-270m` or
   `qwen3:4b-instruct` on our *own* typed-action logs (utterance → `{id, params}` using the action
   manifest as the function schema) and on accepted prompt edits. Serve via Ollama/llama.cpp. It
   replaces the regex grammar only as a *fallback parser*; output is still validated by
   `validateParams` and never executes free text.
2. **Style/character LoRAs for Klein/SDXL/Z-Image** trained from project stills, exported as
   safetensors into `models/loras`, consumed by a `LoraLoader` template param. Unsloth vs ComfyUI's
   core `TrainLoraNode` vs Lightricks trainer (LTX) is open; all three produce ComfyUI-loadable LoRAs.
3. **Captioner / critic VLM** (`qwen2.5vl:3b` fine-tune) to caption LoRA datasets and score
   variations against the brief (taste loop, issue #11).

Not a fit: Unsloth Studio as a ComfyUI replacement in the editor (second GPU arbiter fighting
ComfyUI for 12 GB). Training is a *batch* job behind the Kueue GPU queue, never interactive.

## 4. Recommended architecture (implemented as scaffold)

```
voice (Web Speech / local whisper / typed)     palette ⌘K      pane buttons      Hermes via ACP
            │                                     │                 │                  │
            ▼                                     ▼                 ▼                  ▼
   parseIntent → comfyIntent()  ──►  typed actions (web/src/actions.js, requires:'comfy')
                                       comfy · comfy-set-prompt · comfy-set-param · comfy-use-template
                                       comfy-run · comfy-variations · comfy-cancel     (never proposal commands)
                                                     │ validateParams
                                                     ▼
                              ComfyDesk (web/src/comfy.js) — template + typed values only
                                                     │ POST /comfy/jobs {templateId, params, count}
                                                     ▼
 bridge/comfy-api.mjs  ──►  ComfyRunner (serial, journaled, SSE `ev:'comfy'`, provenance sidecars)
                              │  WorkflowRegistry: bridge/generation/comfy-templates/*.json
                              │   extractSchema() → typed params (prompt/negative traced through
                              │   the sampler graph; coupled width/height targets) + object_info refinement
                              ▼
                        ComfyClient: REST + WS (/prompt, /ws, /history, /view, /interrupt{prompt_id}, /queue delete)
                              ▼
                 local ComfyUI on groot (owned process)  |  optional Comfy Cloud (/api, X-API-Key)

 Video templates additionally appear as ordinary GenerationQueue providers (`comfy-<id>`),
 so the existing Generate tab, journal, provenance and insert-into-timeline work unchanged.
```

### Key decisions

1. **ComfyUI is a provider, not a second app.** Video templates implement the existing
   `fframestudio.generation-provider/1` contract (probe/generate). ComfyUI's typical
   `yuv444p` output is normalised to the queue's H.264 `yuv420p` contract with ffmpeg — without
   that, real ComfyUI videos would fail `validateMedia`. Image/edit/3D outputs use the pane's
   `ComfyRunner` (same journal/SSE/provenance conventions) until GenerationQueue grows
   provider-supplied settings schemas and media validators (after issue #1's i2v work lands).
2. **Templates are the trust boundary.** A workflow is arbitrary code. Only repo/owner template
   directories (`--comfy-templates DIR`) are loaded; the browser, voice and ACP agents may only
   *name* a template and send values validated against its typed schema. The bridge rewrites
   `filename_prefix` to `fframestudio/<jobId>` and names local files itself (hostile server
   filenames are tested). Cancel uses targeted `/interrupt {prompt_id}` or `/queue delete` for our
   own prompt — never `clear`, never `/free` another user's models. Plain HTTP only to loopback /
   tailnet; Cloud key only from env, never sent to `/view` redirects or ACP children.
3. **Typed params by introspection + override.** `extractSchema` (same idea as the skill's
   `extract_schema.py`) finds prompt vs negative by tracing `CFGGuider/KSampler.positive/negative`
   through `ReferenceLatent`/`FluxGuidance`/Reroute; binds coupled inputs (Klein's latent *and*
   `Flux2Scheduler` width) to one param; `/object_info` refines enums/ranges (handles V3
   `['COMBO', {options}]`). Templates add labels, tighter VRAM-safe ranges, hidden params,
   voice aliases. Never strip template nodes (template-integrity rule).
4. **Voice = deterministic grammar first, small LM second.** Anchored grammar
   (`comfy, set prompt to …`, `comfy steps twelve`, `comfy run`, `give me three more variations`,
   `comfy cancel`, `comfy use sdxl`); bare verbs stay with the editor; out-of-range values are
   refused, not clamped. A local function-calling LM (functiongemma-270m / xLAM-2-3b-fc /
   qwen3:4b via Ollama) is the next step for free-form utterances, constrained to the action
   manifest and still validated.
5. **Hermes plans, the user applies.** Hermes (ACP, already a built-in agent) gets the template
   catalog + schemas (`GET /comfy/templates`) and proposes *typed* plans ("use flux2-klein, prompt
   …, steps 20, 4 variations") the pane shows for one-tap/one-word confirmation — same pattern as
   document proposals. Hermes never posts graphs. For template *discovery/authoring*, Hermes can use
   the Comfy Cloud MCP (search_templates / get_template_schema / get_prompting_guide) offline from
   the session; a new template enters the registry only by an owner-reviewed commit.

### Provider catalog on groot (what the registry should grow into)

| Lane | Template(s) | State |
| --- | --- | --- |
| Image t2i | `flux2-klein-4b-t2i` (shipped), `sdxl-base-t2i` (shipped), Z-Image Turbo (todo; int8-convrot has open crash reports upstream) , Klein 9B fp8 (todo; RAM-heavy) | **Klein 4B real run measured below** |
| Image edit / reference | Klein `ReferenceLatent` edit (pokemon graphs), SDXL + ControlNet Union ProMax, IPAdapter | needs image-input params (`upload/image` + playhead frame) |
| Masking | SAM2 graphs (pokemon) | ready nodes |
| Video | `wan22-ti2v-5b-t2v` (shipped as provider; **weights not installed**) | needs owner approval to download ~16 GB |
| 3D | ComfyUI-TRELLIS2 (`512`, low-VRAM), Hunyuan3D-2.1 (own venv) | separate lane; TRELLIS2 node pack is installed |
| Upscale | RealESRGAN x4 / AnimeSharp | trivial template |
| Voice intent / planning LMs | Ollama qwen3:4b-instruct, functiongemma-270m, xLAM-2-3b-fc, hammer2.1 | not wired yet |

## 5. VRAM scheduling (12 GB, shared)

Measured today from the pane (owned ComfyUI 0.30.0, `--lowvram --reserve-vram 1.0
--disable-all-custom-nodes`, Klein 4B fp8, 512², 20 steps, euler, cfg 5):

| Run | ComfyUI execution | Click→image | Device VRAM (nvidia-smi, 0.5 s) |
| --- | --- | --- | --- |
| cold (TE 7.7 GB + DiT 3.9 GB staged) | **57.36 s** | 62.3 s | 2 903 → **11 693 MiB** peak (others held ~2.9 GB) |
| identical prompt+seed again | 0.05 s (ComfyUI execution cache hit — not a generation) | 0.9 s | — |
| warm, seed 43 | **10.15 s** | 10.8 s | 10 801 → 11 249 MiB |

After a run ComfyUI keeps ~7.9 GiB resident. Policy:

- **Interactive lane (pane):** one owned ComfyUI process, serial runner (one prompt in flight from
  us), `--lowvram --reserve-vram 1.0`. Idle-unload after N minutes via `/free {unload_models}` on
  *our own* server only — open: N. Repeat-timing harnesses must bust the cache (rename node IDs)
  as `run_comfy_case.py` does.
- **Batch lane (variations ×16, LoRA training, TRELLIS/Hunyuan 3D, Wan video):** a Kueue Job in
  ClusterQueue `z0` requesting `nvidia.com/gpu: 1` (the only GPU quota). The interactive
  ComfyUI must hold a matching *lease* or be stopped while a batch Job runs — K8s cannot see a host
  process. Proposal: run ComfyUI itself as a Kueue-admitted Deployment-like Job on groot
  (`gpu-rtx3080ti` flavor) so both lanes share one admission point.
- Pre-flight in `probe()`: refuse to queue when free VRAM < template `minimumFreeMiB`
  (implemented for video providers; the pane shows free VRAM).

## 6. Security summary

- Workflows/custom nodes = arbitrary Python. Registry is code-reviewed files only; raw graphs are
  rejected at the HTTP boundary (`invalid-request`), not merely ignored.
- Launch ComfyUI with `--disable-all-custom-nodes --whitelist-custom-nodes <needed>` and
  `--disable-api-nodes` (no partner credits) per template; loopback bind only.
- Error details are summarised (node id/class/exception type, ≤240 chars); tracebacks never reach
  the browser. Output size/count caps (64 MiB, 8 files).
- Comfy Cloud: key in env only, `X-API-Key` stripped on `/view` 302, tier/credit cost surfaced as
  `cost.kind: unknown`.

## 7. What the scaffold does (branch `feat/comfyui-pane-20261020`)

- `bridge/generation/comfyui.mjs` — client, `extractSchema`/`refineSchema`/`applyParams`,
  `loadTemplates`, `checkDependencies`, `ComfyRunner`, `comfyGenerationProviders`.
- `bridge/generation/comfy-templates/` — Klein 4B t2i, SDXL t2i, Wan 2.2 TI2V 5B t2v.
- `bridge/comfy-api.mjs` + small `bridge.mjs` hunk — `/comfy/status|templates|jobs|jobs/:id/cancel|cancel-all`,
  `/me.features.comfy`, enabled only by `--comfy-url URL` (or `FFS_COMFY_URL`); dormant hidden
  providers keep old journals loadable.
- `web/src/comfy.js`, `web/comfy.css` — lazy desk; `actions.js` (7 typed actions, `requires:'comfy'`),
  `intent.js` (grammar), `editor.js` (toolbar/palette gating, lazy import), `host.js` (`hostFeature`).
- Tests: `test/generation/comfyui.test.mjs` (10, mock server), `test/doc/comfy-intent.test.mjs`,
  `test/comfy-journey.mjs` (`npm run test:comfy`; `--real URL [--seed N]` for an owned real server),
  mock server `test/helpers/mock-comfyui.mjs` (REST + hand-rolled WS, PNGs, real ffmpeg yuv444p
  video; `node test/helpers/mock-comfyui.mjs` for manual demos).

Run it against a real local ComfyUI:

```sh
env -u PYTHONPATH -u PYTHONHOME <local>/comfyui/.venv/bin/python main.py --listen 127.0.0.1 --port 8189 \
  --input-directory $S/input --output-directory $S/output --temp-directory $S/temp --user-directory $S/user \
  --database-url sqlite:///:memory: --disable-all-custom-nodes --disable-api-nodes --lowvram --reserve-vram 1.0 --preview-method none
npm run bridge -- --comfy-url http://127.0.0.1:8189      # then ComfyUI button / ⌘K "comfy" / hold V: "comfy, set prompt to …"
```

## 8. Open questions for the owner

1. **Pane placement:** floating left desk (now; mirrors the voice desk) or a `comfy` slate tab
   beside Generate? Floating overlaps the left quarter of the canvas at 1440×900.
2. **Confirmation policy:** run immediately on "comfy run" locally (now) — require a spoken
   "confirm" for Cloud runs (credits) or for batches > N?
3. **Interactive vs Kueue:** keep ComfyUI as a host process with an idle-unload, or run it as a
   Kueue-admitted workload in `z0` so batch jobs and the pane share one GPU admission point?
4. **Downloads:** approve Wan 2.2 TI2V 5B (~16 GB) for real local video, or keep video on LTX
   (issue #1) and use ComfyUI for stills/edits/3D only? Z-Image Turbo int8 — accept the upstream
   int8 crash risk?
5. **Images on the timeline:** import stills as held shots (duration N frames) via a new
   `import-generated` variant, or only as references for i2v-from-playhead?
6. **Unsloth first target:** intent-parser LM from our own action logs, or a project style LoRA?
   (Training data = your utterances/stills; both stay local.)
7. **Hermes tool surface:** expose `/comfy/templates` + typed plan proposals via ACP only, or also
   enable the Comfy Cloud MCP in Hermes for template research (paid account, OAuth)?
8. **Update ComfyUI 0.30 → 0.42?** Gains WS prompt metadata, governance, FLUX 3; costs a
   requalification of the Klein receipts. Not done here (no tree changes).
