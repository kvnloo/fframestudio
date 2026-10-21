# Upstream refresh — 2026-10-20

Scope: every upstream that fframestudio pins or registers, compared with what is pinned in this repository at `origin/main` `aba0198`. Each claim names the SHA it was read at. Collected 2026-10-20 (UTC) with `gh api` (`repos/<r>`, `compare/<pin>...HEAD`, `releases`, `pulls/<n>`, `contents/<path>?ref=<sha>`) and `npm view`. This is research plus two small UX integrations; it is **not** a qualification of any new upstream renderer.

## Factory evidence

Static checkouts ran as oss-factory `discover` jobs (batch `ffs-upstream-refresh-20261020`, submitted with `tools/factory/factory submit`, pumped with `factory run`). The checkout was `oss-factory-integrate-20261020` (`bde6321`). `factory report`: 8/8 ok, 0 failed, **all 8 placed on node `mbp`** (flavor `node-mbp`), sandbox probe 8/8 ok with no leaks, wall time 17 s, job p50 14 s. Per-job results (static file, ecosystem and CI discovery; no repo code executed):

| Repo @ SHA | Files | Ecosystems | Test files | CI workflows |
|---|---:|---|---:|---:|
| dmtrKovalenko/fframes @ `44745c09a6c8` (pinned) | 2457 | cargo, node | 1147 | 1 |
| dmtrKovalenko/fframes @ `69174f0187b5` (v1.3.0) | 2542 | cargo, node | 1160 | 1 |
| mrsarac/ff-tracking @ `55abcd62a04c` | 46 | cargo | 5 | 0 |
| mrsarac/ff-unmute @ `3ba661da9b15` | 31 | cargo | 0 | 0 |
| agentclientprotocol/typescript-sdk @ `c2b1a8633745` (v2.0.0) | 116 | node | 20 | 2 |
| kevinraymond/fosfora @ `6e495e450c0e` | 952 | cargo | 4 | 4 |

The factory has no diff task, so the content diffs below come from `gh api compare` and `contents?ref=` reads, not from the pods. Two jobs (cinetic and OpenTimelineIO) also finished on mbp. Their HEAD equals the registry pin, so they are not tabulated.

## Summary table

Effort: **S** = under a day, inside an existing module; **M** = a new bounded module with tests; **L** = new backend or migration work that needs qualification.

| Lib | Pinned | Latest (default HEAD) | Notable changes since pin | UX opportunity | Effort |
|---|---|---|---|---|---|
| fframes | `44745c09a6c8c51071609097326a820cf59d087b` (2026-10-17, after v1.2.0) | `69174f0187b5d8e92329246898f70250b59f08f2` = tag **v1.3.0** (2026-10-20). 9 commits, 199 files. | #236 Lottie via `frame.play_lottie` (feature `lottie`); #235 `frame/strip/onion/inspect` convert frames on 1–4 threads and the **`snapshot` command is removed**; #233 `fframes::three_d` (features `3d`, `wgpu`); #221 `ctx.render_svgr` nesting svgr↔3D. The `TimelineReport`/`SceneReport` schema is **byte-identical** in `preview.rs` at both SHAs. `examples/fframes-intro` changed only its `Cargo.toml` version (1.2.0→1.3.0). | **Done here:** revision-aware CLI review recipes for the selected shot, and an upstream-status block in Source & provenance. Next: pin bump of the launch-film example (needs a rebuild to re-obtain `timeline --json`); Lottie/3D asset badges in Source. | S (done) / M (pin bump) |
| ff-tracking | `55abcd62a04c96eeb3ab51d7d75df64d068bd1e6` | same (2026-10-14; tag v1.0.0) | None since pin. The last PRs (#1, #3 Windows Vulkan, #4 Slab score Rust port) closed before the pin. | No refresh needed. The Linux Metal-feature build blocker in [procedural-fframes.md](../procedural-fframes.md) still applies at this SHA. | — |
| ff-unmute | `3ba661da9b150433c277948f0c24b9033a5bfa96` | same (2026-10-10; tag v1.1.0) | None since pin. | None from upstream; #4 UX work continues on the existing sidecar. | — |
| @agentclientprotocol/sdk | 1.9.0 (tag → `1db4d43286d993545e729376346b7f9098748159`) | **2.0.0** (tag → `c2b1a8633745dd859a2732b4e17d5ed61e869bb6`, 2026-10-19) | **Breaking:** `ClientSideConnection`/`AgentSideConnection` and legacy interfaces are removed. Use `agent()`/`client()` apps. The default import is stable-only ACP v1, and unstable features need `/unstable`. The default protocol is still v1. | Keep the 1.9.0 pin. `web/src/acp-client.mjs:4` and `tern/acp.mjs:3` import `ClientSideConnection`. A migration must audit every unstable capability/handler (per `MIGRATION_STABLE_UNSTABLE.md` @ `c2b1a86`) and re-run `npm run test:acp` plus the live ACP journey. | M |
| esbuild | ^0.25.0 (lock 0.25.12) | 0.28.2 (npm) | Three minor lines. The caret range keeps 0.25.x. | Only `build:acp` bundles. Bump together with the ACP SDK migration, not alone. | S |
| playwright | ^1.64.1 (lock 1.64.1) | 1.64.1 | — | — | — |
| LTX-Video weights (bridge/generation) | HF `8984fa25007f376c1a299016d0957a37a2f797bb` | same (`lastModified` 2025-07-16) | — | — | — |
| fosfora (registry, *now*) | `43e31eb0e7110a5f2f8bc0122cdc92558706342e` | `6e495e450c0e7ea58ba961f79ae8125eff59eb2c` (12 ahead). Release v2.6.0 tag → `72aa35fb002bff188b4e235ed4c71191021d0399` | Trained beat-activation model inside the beat detector. v2.6.0 notes: beats land on the kick, drop-warning calibration fixed. | Strengthens the #4 plan (map a measured event stream to one parameter). Refresh the catalog entry's quotes at the new SHA before relying on it. | S (catalog) / M (probe) |
| ossia-score (*next*) | `dad5bd37336d0e962207c3641bc6a7ecc22e217c` | `7391d18e82b6055a59215d0c86ce55189aa1279c` (82 ahead; v3.9.0 2026-10-15) | Video decode (ProRes/FFV1 on Vulkan), JS consolidate/archive API, add-on SDK. | Research only. | — |
| effectcraft / filmcraft (*evaluate*) | `f36b2b3e6bd1…` / `4a69a038d327…` | `9db7f3b21700fd821f215782ed1c82afe077880f` (141 ahead, release 0.13.0 in log) / `70f0fc7a75f2681bc18302e67eaf0c9d41c68873` (116 ahead, 0.10.0) | Fast-moving and mostly repo housekeeping in the sampled log (Dependabot, badges, competitor-reference removal, text-panel graphics tab). | Re-collect evidence before any evaluation. The pins are 2 days old and already far behind. | — |
| blender / cables / remotion (*evaluate*) | `3f4216e1…` / `b8e22d16…` / `02109419…` | `fbe82a46101643c5cf8d7ab331d6a47566008fa7` (173) / `d60b0296972d5e3186645dc3a7dba3e661ed6ff8` (42) / `f29e9f3fd9ed66d6c7cbe8043c983a2947ea893f` (211; v4.0.537) | Routine development. Remotion keeps its special license. | None this wave. | — |
| motion-canvas, theatre, postprocessing, shader-park, OTIO, OCIO, Natron, hydra, ghost-arcade, rust-motion, cinetic | registry pins | **identical** to pin (compare `status: identical`) | — | — | — |

Raw API output (compare/commit lists, release tags, factory envelopes) stayed in the task scratch directory. Only the CLI surface extract is committed, as [`docs/evidence/fframes-cli-surface-20261020.json`](../evidence/fframes-cli-surface-20261020.json). It records the per-revision `Command` enum, the arg-struct fields, short flags, global flags, the inspect findings exit code, and the sha256 of each `cli.rs` read.

## fframes 44745c0 → v1.3.0 in detail

Commits (`compare/44745c09…69174f01`): `28356c5b5473` Lottie (#236), `50923ac08944` multi-threaded CLI (#235), `6c20994ee76a` 3D (#233), `26f7524475bc`/`61cda3a7b800`/`df8d76bc9679`/`51d78c257e17`/`bba9d52a6be3` render_svgr + wgpu textures + examples + test fix (#221), `69174f0187b5` release.

- **CLI surface** (`fframes/src/renderer/cli.rs` read at both SHAs). Commands at the pin: `render frame strip onion svg timeline inspect snapshot audio preview`. At v1.3.0 `snapshot` and `SnapshotArgs` are gone and every other arg struct is unchanged. The global flags are still `--json --scale --renderer {cpu,skia-cpu,gpu}`. `inspect` still returns `ExitCode::from(2)` when it finds problems at or above `--fail-on`, and `ExitCode::FAILURE` when it fails to run. The time spec help (`120`, `3.2s`, `50%`, `Intro@1.2s`, `a..b` end-exclusive) is unchanged.
- **Threads** (#235 body, merge `50923ac0`): conversion runs on a quarter of `get_thread_count()` (`FFRAMES_NUM_THREADS`), clamped to 1–4, while the renderer still draws in order. Upstream reports unchanged pixels and reports, and 1.23–1.42× faster `inspect --pops` on an M4 Max. We did **not** re-measure this.
- **Timeline JSON**: the `TimelineReport {fps,width,height,duration_frames,duration_seconds,scenes[],audio[]}` and `SceneReport {index,name,full_name,start_frame,end_frame,start_seconds,end_seconds}` definitions are unchanged. Upstream documents scene frames as "including overlaps with the neighbours, end exclusive". `tools/example_fframes_intro.py` still rejects non-contiguous scenes (fail-closed). Overlap-aware import is a separate follow-up.
- **New authoring features** (Lottie, 3D, nested svgr) are Cargo features of a film's own crate. They are not CLI flags, and Studio has no runtime for them. The honest UX is provenance badges ("uses Lottie/3D at revision X") on fframes sources. It is not a preview.

## Integration in this branch

1. **Revision-aware "Review in fframes CLI" recipes** (`web/src/fframes-cli.js`, Shot tab). For a clip of an `fframes`-kind film that uses the film render, Studio derives the native half-open range from `sourceIn/duration/speed`. It uses frames when the project rate equals the film's integer fps and explicit seconds otherwise. Studio then shows copyable `timeline`, `frame --ids`, `strip`, `onion`, `inspect --pops --fail-on warning` and `render --draft` commands for the film's recorded revision:
   - Known revisions come from a table matched by test against the committed `cli.rs` extract.
   - Unknown or unrecorded revisions get only the commands common to both verified revisions, plus a `--help` warning.
   - `snapshot` is never offered.
   - A trim updates the recipes in place and keeps the disclosure open.
   - The exit-code meanings (0 pass / 2 findings / other failed) are shown, because a produced report is not a passed gate.
   - Copy-only: Studio does not execute native builds.
2. **Upstream status in Source & provenance** (`fframesUpstreamSource`, Source tab). For an `fframes` film it names the revision the film was built with (verified label, `unverified <sha>` or `not recorded`) and the newest verified upstream release. If the film is behind, it lists what v1.3.0 changes (Lottie, 3D, nested svgr, threaded CLI conversion, `snapshot` removed) and says that adopting it needs a rebuild and a new `timeline --json`. Studio never rebuilds or re-imports by itself. A film with no recorded revision is asked to record `provenance.revision`. Real local films such as `hermes-launch` record no revision today, so they get the common-commands fallback and this prompt. Static facts only: no network calls.
3. **Single pin guard.** A test requires the same fframes revision in `examples/catalog.json`, `source_url`, `tools/example_fframes_intro.py` and the verified CLI table. A future bump to v1.3.0 then fails until the CLI table and the render script move together.

Not changed: the pin itself. Bumping `fframes-intro` to v1.3.0 needs a rebuilt binary to re-obtain `timeline --json` and re-verify frames, audio and duration (per the long-form example rules). That was not run here.

Limit: the recipes assume the film binary calls `fframes::cli::new(..).run()` (feature `cli`), which the upstream examples do. A film with its own `build.sh`/`export.sh` may not expose these commands. That is why unrecorded revisions get the `--help` warning.

## Follow-ups (not done)

- Bump the `fframes-intro` pin to `69174f01` after a local Vulkan build: re-run `npm run example:fframes-intro`, then compare the timeline JSON and ffprobe receipts with the 44745c0 receipt.
- ACP SDK 2.0 migration (M), with the esbuild bump.
- Overlap-aware scene import for `timeline --json` (S/M).
- Refresh fosfora's catalog evidence at `6e495e45` / v2.6.0 for #4.
- Optional "Run locally" for review recipes through the bridge. That needs a separate native-execution trust boundary (DESIGN.md) and is out of scope for copy-only recipes.
