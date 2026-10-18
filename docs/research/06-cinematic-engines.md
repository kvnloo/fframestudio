# Cinematic candidates: verified catalog and scoped next proof

## Decision and scope

The original 18 entries from [issue #5](https://github.com/kvnloo/fframestudio/issues/5) and candidate #19, **Leonxlnx/cinetic**, all resolve to real GitHub repositories. The machine-readable source of truth is [`projects/cinematic-engines.json`](../../projects/cinematic-engines.json). Every entry remains `research`; no engine was installed, rendered, benchmarked, bundled or promoted to an integration by this work.

Cinetic is an MIT **agent directing skill/toolkit**, not a native fframes renderer. Its procedural recipe and beat-grid claims are supported by its pinned README. “273 techniques” is an upstream inventory claim, not our measurement. Remotion is retained as a source-available comparison with a special license, not described as unrestricted OSS. A shader capability does not imply SkSL/WGSL/GLSL interchange, and an external-process boundary does not itself settle licensing obligations.

The bounded next issue item is **planned below, not implemented**. The one browser verification run also has unresolved timing failures; this receipt does not declare the PR fully merge-ready.

## Collection and re-check method

For each repository, collection used authenticated `gh api` (credentials were not recorded):

```sh
gh api repos/OWNER/REPO
gh api repos/OWNER/REPO/commits/DEFAULT_BRANCH
# Use the returned full commit SHA for all source reads below.
gh api 'repos/OWNER/REPO/readme?ref=SHA'
gh api 'repos/OWNER/REPO/license?ref=SHA'
gh api 'repos/OWNER/REPO/contents/PATH?ref=SHA'
```

`checked_at` is the UTC observation time in each entry. `stars` is the observed repository `stargazers_count`. `last_commit_at` is the selected default-branch HEAD commit's **committer date**, not `updated_at`/`pushed_at`. Activity and star counts are dated observations, not production quality scores. License detection is copied verbatim from the GitHub API; `NOASSERTION`, legacy SPDX identifiers and `null` are deliberately not normalized into invented grants.

All 19 public READMEs were bulk-read using `/usr/bin/opencode run --standalone -m opencode/deepseek-v4.1-flash-free` with a JSON-only evidence request. The model's summary was not accepted as authority: repository identity, stars, commit date and SPDX detection were compared with API responses, and all 44 retained capability quotations were checked against pinned README/source text. Thin or ambiguous READMEs required source reads (Cables patch/shader APIs, Blender camera/color/geometry definitions, Theatre sequence state, Remotion Sequence frames and Ghost Arcade legacy audio/shader source).

Re-run the API reads before selecting a release or dependency. Offline tests enforce evidence structure, not authenticity, image fidelity, Linux/Vulkan compatibility or legal approval. Pinned source/license URLs and per-feature quotations are in the JSON rather than duplicated here.

## Observation ledger

API license values below are **detection results**, not resolved distribution licenses. Dates are UTC. Each date links to the exact inspected commit.

| Candidate | Stars | Default HEAD committer date (UTC) | API SPDX |
|---|---:|---|---|
| [dmtrKovalenko/fframes](https://github.com/dmtrKovalenko/fframes) | 2,834 | [2026-10-17T03:39:58Z](https://github.com/dmtrKovalenko/fframes/commit/44745c09a6c8c51071609097326a820cf59d087b) | `MIT` |
| [kevinraymond/fosfora](https://github.com/kevinraymond/fosfora) | 57 | [2026-10-17T09:25:22Z](https://github.com/kevinraymond/fosfora/commit/43e31eb0e7110a5f2f8bc0122cdc92558706342e) | `Apache-2.0` |
| [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) | 19,375 | [2026-07-02T20:01:32Z](https://github.com/motion-canvas/motion-canvas/commit/7b91435c301d530351dcf5ebb91dd139c002e405) | `MIT` |
| [ossia/score](https://github.com/ossia/score) | 2,079 | [2026-10-15T20:25:07Z](https://github.com/ossia/score/commit/dad5bd37336d0e962207c3641bc6a7ecc22e217c) | `NOASSERTION` |
| [theatre-js/theatre](https://github.com/theatre-js/theatre) | 12,774 | [2024-04-11T09:35:04Z](https://github.com/theatre-js/theatre/commit/6ea82b938ea49609489f6377ded693ccc6ee8f5b) | `Apache-2.0` |
| [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) | 2,887 | [2026-09-09T19:35:45Z](https://github.com/pmndrs/postprocessing/commit/9cf03cff26615636a564d8bfddf765edb8917441) | `Zlib` |
| [shader-park/shader-park-core](https://github.com/shader-park/shader-park-core) | 827 | [2024-05-28T12:37:30Z](https://github.com/shader-park/shader-park-core/commit/dd5e26c39963b63a7280c5b6bc20463c75258d62) | `MIT` |
| [AcademySoftwareFoundation/OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | 2,024 | [2026-10-17T17:51:16Z](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/commit/f8a2f36df61ce88eb6b73a57df393a87d3e3e42e) | `Apache-2.0` |
| [AcademySoftwareFoundation/OpenColorIO](https://github.com/AcademySoftwareFoundation/OpenColorIO) | 2,133 | [2026-10-01T01:27:18Z](https://github.com/AcademySoftwareFoundation/OpenColorIO/commit/22dd9c4faa0d1b7cfb3d64d1a6e9cb454acc6cfd) | `BSD-3-Clause` |
| [storytold/effectcraft](https://github.com/storytold/effectcraft) | 7,177 | [2026-10-18T01:43:07Z](https://github.com/storytold/effectcraft/commit/f36b2b3e6bd121dc52b00503cdf8d60f42ac242a) | `Apache-2.0` |
| [storytold/filmcraft](https://github.com/storytold/filmcraft) | 14,594 | [2026-10-18T01:43:10Z](https://github.com/storytold/filmcraft/commit/4a69a038d32761f604b3c7e4845b21fb40b3cbe4) | `Apache-2.0` |
| [NatronGitHub/Natron](https://github.com/NatronGitHub/Natron) | 5,584 | [2026-07-24T09:48:49Z](https://github.com/NatronGitHub/Natron/commit/3763d805d7d277d10af10025ae41af677682b3e6) | `GPL-2.0` |
| [blender/blender](https://github.com/blender/blender) | 21,003 | [2026-10-17T13:51:33Z](https://github.com/blender/blender/commit/3f4216e1bad1e76e9c2d4a00b4a9d09954593f47) | `NOASSERTION` |
| [cables-gl/cables](https://github.com/cables-gl/cables) | 569 | [2026-10-17T05:57:50Z](https://github.com/cables-gl/cables/commit/b8e22d168b7780b3ffb94df752207135b8df913c) | `null` |
| [hydra-synth/hydra-synth](https://github.com/hydra-synth/hydra-synth) | 401 | [2026-07-16T18:47:51Z](https://github.com/hydra-synth/hydra-synth/commit/9d29a9f4fd8f9081b9759943f38db36f05b9a88f) | `AGPL-3.0` |
| [riskcapital/ghost-arcade](https://github.com/riskcapital/ghost-arcade) | 75 | [2026-09-30T21:35:07Z](https://github.com/riskcapital/ghost-arcade/commit/a2c62b104fab82f93081382cd592826f0457fd01) | `AGPL-3.0` |
| [sjkim1127/rust-motion](https://github.com/sjkim1127/rust-motion) | 3 | [2026-10-17T03:43:46Z](https://github.com/sjkim1127/rust-motion/commit/9f65321dbcc5687d8d3033c55f443a10e17e1927) | `Apache-2.0` |
| [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | 64,795 | [2026-10-17T13:26:34Z](https://github.com/remotion-dev/remotion/commit/02109419d34bea9ddfb45883b6dbf1ec477379e6) | `NOASSERTION` |
| [Leonxlnx/cinetic](https://github.com/Leonxlnx/cinetic) | 278 | [2026-10-18T00:18:57Z](https://github.com/Leonxlnx/cinetic/commit/ecfa6605de1adb9345ce937724810dc32267d068) | `MIT` |

## Corrections and boundaries

- **Missing provenance:** added observation timestamps, repository API evidence URLs, full commit SHAs, committer dates, stars, literal API SPDX results, pinned license evidence and capability quotations for every candidate.
- **Duplicate repository bug:** the original validator rejected duplicate IDs but accepted the same repository under another ID. Repositories are now compared case-insensitively. Missing/invalid metadata, unpinned or path-normalized-away evidence, duplicate features, invalid date rollovers, unknown filters and extra CLI arguments are rejected.
- **Cinetic:** added as a `technique`/`reference` candidate. Its MIT grant does not cover its default Remotion engine or reference films. Scored sound is not an audio-reactive analysis path.
- **Theatre / Postprocessing:** removed their `camera` tags. Animating arbitrary variables or processing depth-of-field is not itself a camera renderer or choreography system. Theatre retains procedural and sequence timing evidence. A future camera-path interchange probe remains useful but unimplemented.
- **ossia score:** removed `audio-reactive`; the inspected README substantiates sequencing and ISF scripting, not a specific measured audio-analysis-to-parameter path. GitHub returns `NOASSERTION`; its license text contains GPLv3 plus third-party notices.
- **Hydra:** GitHub detects `AGPL-3.0`; do not assume permissive embedding for an npm/JavaScript library.
- **Cables:** the license API returns 404 and repository metadata has no detected license; `package.json` declares MIT, which is recorded as a caveat, not treated as license clearance. Its thin README is not used to infer shader or procedural features; pinned source APIs substantiate those tags.
- **Blender:** root API license is `NOASSERTION`, while README says GPL Version 3 for Blender as a whole with compatible individual file terms. Record both rather than replacing the API result. The GitHub mirror is not proof of a working external Cycles adapter.
- **Theatre split license:** root/core Apache-2.0 does not cover the AGPL Studio UI. The public default HEAD is from 2024 and README discloses private development; future public releases are unverified.
- **Fosfora / EffectCraft / FilmCraft / Rust Motion:** GitHub detects Apache-2.0 while upstream declarations permit MIT OR Apache-2.0. Fosfora's optional Ableton Link build has GPL obligations. Young compositor/editor READMEs describe maturity/fidelity gaps; no parity or performance claims are promoted here.
- **Ghost Arcade:** default source is legacy 1.9 even though the README advertises 2.x on another branch. Capability evidence is tied to legacy source/architecture; no 2.x Rust/wgpu, Vulkan, native export or hardware support is asserted for this pin.
- **Remotion:** `NOASSERTION` is the API detection; the source contains the special Remotion License. A commercial render license is not automatically unrestricted editor redistribution permission.

## Next unchecked item: read-only source-aware inspector

**Disposition: scoped plan, not a measured prototype.** The next unchecked issue checkbox is the inspector, before the external audio-reactive experiment. At review time [PR #6](https://github.com/kvnloo/fframestudio/pull/6) was still open/unmerged. This branch's `tools/import_projects.py` supports baked fframes proxies and timeline logs but does not include the `procedural-fframes` ingest contract; the source/event fields are also absent from the browser. No source-aware inspector fixtures are present here. Adding a synthetic-only panel would not prove the issue's real source semantics.

A complete dependency-free proof therefore cannot responsibly be treated as a sub-hour catalog follow-up: it first needs the ingest contract and disposable, source-authentic fixtures, then UI correctness, immutability and browser timing qualification. Estimate a separate **2–4 hour** focused follow-up after ingest is qualified; this is an estimate, not measured execution. Do not cherry-pick or change another worktree to bypass that dependency.

### Proposed implementation slice

1. Pin the accepted PR #6 ingest revision and source revisions for ff-tracking/ff-unmute. Copy only necessary source metadata into disposable fixtures; hash source bytes before/after import and viewing. Keep source checkout and shared project library read-only.
2. Add a pure read-only view model for source provenance, text, palette, original frame/time coordinates and explicit unsupported fields. Consume the actual accepted ingest schema; do not invent a second persisted project format or silently flatten procedural state into `project/1` clips.
3. Display **12 source-authored ff-tracking shots**, text and palette. Display ff-unmute as **one continuous camera take**, with editorial boundaries in a separately labeled lane and KICKS/CLAPS/TOKENS plus their source references in event lanes. Do not turn the editorial lane into camera cuts.
4. Mount an inspector for the selected source/shot with escaped text and bounded event-list rendering. Seek the existing proxy using rational source FPS and clip/source mapping; make no source writeback or native shader-render claim. A read-only panel must expose no procedural mutation actions.
5. Exercise the real imported fixtures in an owned bridge with `--no-config`; never overwrite shared discovery or original project data. Check source/project hashes, document revision and undo stack before/after inspecting and seeking, then reload and repeat.

### Acceptance and measurement contract

- Real fixture assertions: 12 source-authored shots for ff-tracking; one camera take for ff-unmute; separately preserved editorial boundaries; exact event labels and source-time/frame values. Compare against the pinned source, not arbitrary synthetic cut counts.
- Read-only assertions: unchanged source bytes, imported procedural metadata, project revision and undo/redo history after open/select/seek/reload; missing/unsupported metadata is labeled rather than fabricated.
- Record repeated selection-to-inspector-ready and seek-to-decoded-frame samples with fixture size, Node/browser version and viewport; retain every sample and failure. Layout-ready or next-rAF measures are not physical presentation. Use decoded-frame callbacks where available and label the boundary measured.
- Gate command-to-layout-ready work at the repository's existing frame budget without relaxing thresholds. Report cold/warm results separately. Do not include catalog/API collection time in edit-latency measurements.
- Add model/unit and real browser fixture tests to existing harnesses without runtime packages. Stop and rescope if a new renderer/dependency or ingest schema change is necessary.

### Subsequent measured audio-reactive proof (not run)

Only after inspector/event provenance passes, map actual ff-unmute onset timestamps to **one named parameter** in an external Fosfora stage. Preserve its WGSL; do not substitute GLSL/SkSL text or synthesize beats from BPM. Pin stage/API version, source events, seed, FPS, resolution and color declaration. Compare onset event frame, submitted parameter frame and observed rendered effect frame; collect actual GPU timestamps and output frame evidence, plus baseline/modified GPU time and peak memory. If GPU instrumentation or an external Fosfora installation is unavailable, report that limitation rather than calling CPU scheduling time “GPU time.” No external stage was installed or tested in this PR.

## Local qualification

[`docs/evidence/cinematic-engines/qualification.json`](../evidence/cinematic-engines/qualification.json) preserves the measured result and every collected context-menu sample:

- `npm test`: **PASS**, 69 Node tests including 7 catalog tests, plus ACP security checks. Discovery config content and mtime remained unchanged. No paid agent prompts were run by this gate.
- `bash scripts/check-no-local-paths.sh`: **PASS**. Evidence committed here uses no machine-local absolute paths.
- `npm run verify`: **FAIL**, one run only; 19 of 21 journeys passed. Theme application exceeded the frame budget at **39 ms**; context-menu open-ready work reached **41.30000001192093 ms** against the existing 16 ms gate. These failures were not hidden by retries or threshold changes.
- The browser runtime and verification harness are unchanged from the rebased main revision. That narrows code scope but does **not** establish an environmental cause or a passing baseline. A quiet-host baseline/current investigation remains necessary before claiming full merge readiness. The failed theme/menu journeys may skip later assertions within those journeys.

No new runtime dependencies, source ingest, shader compositor, procedural writeback, export backend or voice controls are shipped by this catalog.
