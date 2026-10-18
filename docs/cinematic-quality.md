# Cinematic-quality integration catalog

The source-backed survey is tracked in [Issue #5](https://github.com/kvnloo/fframestudio/issues/5). The structured catalog in `projects/cinematic-engines.json` contains **19 research candidates**, including the cinetic directing toolkit and restricted-license Remotion. It is not a claim that all entries are permissive OSS or rendering engines. `status: research` means listing a candidate does not establish FrameStudio integration, measured quality, GPU compatibility or redistribution approval.

List priorities without GPU, remote APIs or extra npm dependencies:

    node tools/cinematic-catalog.mjs
    node tools/cinematic-catalog.mjs now
    node tools/cinematic-catalog.mjs next procedural

The first positional argument is `now`, `next` or `evaluate`; the optional second is a capability. Supported capabilities are `procedural`, `timeline`, `audio-reactive`, `shader`, `camera`, `color` and `compositing`. Unknown or extra arguments fail with a nonzero exit status. An empty match is successful and prints nothing. The CLI works from outside the repository.

## Evidence contract

Every entry records:

- `checked_at` and `evidence_url`: UTC observation time and the GitHub repository API endpoint used to establish repository existence and metadata.
- `upstream.revision`, `commit_url`, `last_commit_at` and `stars`: pinned default-branch HEAD, its **committer date** (not repository update/push time), and the observed `stargazers_count`. Stars are not a quality score.
- `upstream.license_spdx`: GitHub's literal detected SPDX value, including `NOASSERTION` or `null`. `license_url` pins the inspected license or manifest, while `license_note` explains split, dual, missing and special-license cases. These notes are not legal advice or distribution clearance.
- `feature_evidence`: an exact short quotation and pinned source URL for **every** capability. Tags describe upstream functionality or documented interfaces, not support implemented in this editor. `limitations` records important scope and maturity caveats.

The offline validator rejects duplicate IDs and repositories (case-insensitive), unsupported capabilities, duplicate features, incomplete metadata, missing or unpinned evidence, malformed timestamps and premature integration claims. It cannot authenticate a quotation or determine licensing correctness; refresh those through GitHub before adopting an engine. See [the verification ledger and scoped follow-up](research/06-cinematic-engines.md) for collection commands, corrections and the next unchecked issue item.

## Integration order

1. **Now — source-aware fframes footage:** [ff-tracking](https://github.com/mrsarac/ff-tracking) and [ff-unmute](https://github.com/mrsarac/ff-unmute) run on the existing fframes pipeline. First qualify the source-timing adapter, then a read-only HUD/event inspector. See [#3](https://github.com/kvnloo/fframestudio/issues/3), [#4](https://github.com/kvnloo/fframestudio/issues/4) and the unmerged [ingest PR #6](https://github.com/kvnloo/fframestudio/pull/6).
2. **Now — Fosfora evaluation:** map a measured event stream to one external shader parameter, proving frame alignment rather than merely showing a reactive animation.
3. **Next — Motion Canvas / Theatre.js / shader tools:** prototype edit-preserving interchange for text, camera and visual properties; test that a rendered fixture survives round trip. Theatre Studio and Theatre core have different licenses. A future camera-path adapter is not a camera renderer supplied by Theatre itself.
4. **Next — cinetic recipes:** inspect seeded timing recipes as attribution-preserving fframes components. Cinetic is an MIT skill/toolkit, not a native renderer; its default Remotion engine is separately licensed. Do not copy reference films or infer audio-reactivity from scored sound.
5. **Next — OTIO / OCIO:** implement narrow loss-aware timeline interchange and explicit color-space conversion. FrameStudio project/1 is not yet a general compositor graph.
6. **Evaluate — EffectCraft, FilmCraft, Natron, Blender, Cables, Hydra, Ghost Arcade, Rust Motion, Remotion:** demand tested output, actual workflow need and license review before adding a dependency. GPL, AGPL and special licensing require review even when communicating with an external process.

## Gate before a candidate becomes an integration

- Record pinned upstream revision, a concrete interface/API, and exact redistribution license. Perform legal review where needed.
- Define an editable control surface with reversible actions. Never modify the user's original source checkout implicitly.
- Publish a reproducible fixture with frame count, rational FPS, source-to-timeline mapping, audio timing, color-space declaration and export provenance.
- Measure cold/warm preview latency, per-frame render cost, and actual peak GPU memory on the hardware used.
- Compare rendered reference and output frames and verify exports after reopening, including a human visual quality check.
- Add tests and an honest fallback for unsupported effects. Showing an MP4 proxy does **not** mean the studio implements that shader renderer.
- Only promote a catalog entry from `research` after integration code and tests land. The current validator intentionally rejects premature support claims.

Run `node --test test/doc/cinematic-engines.test.mjs`; this is automatically included in the existing `npm test` glob. Credit remains with each upstream author and contributor.
