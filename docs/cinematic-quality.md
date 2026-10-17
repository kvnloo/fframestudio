# Cinematic-quality integration catalog

The source-backed engine survey is tracked in [Issue #5](https://github.com/kvnloo/fframestudio/issues/5). The structured catalog in `projects/cinematic-engines.json` is for **candidate triage only**. `status: research` means none of the candidates is integrated, benchmarked or approved for redistribution merely because it is listed.

List priorities without GPU, remote APIs or extra npm dependencies:

    node tools/cinematic-catalog.mjs
    node tools/cinematic-catalog.mjs now
    node tools/cinematic-catalog.mjs next camera

## Integration order

1. **Now — source-aware fframes footage:** [ff-tracking](https://github.com/mrsarac/ff-tracking) and [ff-unmute](https://github.com/mrsarac/ff-unmute) run on the existing fframes pipeline. First build the source-timing adapter, then a read-only HUD/event inspector. See [#3](https://github.com/kvnloo/fframestudio/issues/3) and [#4](https://github.com/kvnloo/fframestudio/issues/4).
2. **Now — Fosfora evaluation:** map a measured event stream to one external shader parameter, proving frame alignment rather than merely showing a reactive animation.
3. **Next — Motion Canvas / Theatre.js / shader tools:** prototype edit-preserving interchange for text, camera and visual properties; test that a rendered fixture survives round trip. Theatre Studio and Theatre core have different licenses.
4. **Next — OTIO / OCIO:** implement narrow loss-aware timeline interchange and explicit color-space conversion. FrameStudio project/1 is not yet a general compositor graph.
5. **Evaluate — EffectCraft, FilmCraft, Natron, Blender, Cables, Hydra, Ghost Arcade, Rust Motion, Remotion:** demand tested output, actual workflow need and license review before adding a dependency. GPL, AGPL and special licensing may require an external-tool boundary.

## Gate before a candidate becomes an integration

- Record pinned upstream revision, a concrete interface/API, and exact redistribution license. Perform legal review where needed.
- Define an editable control surface with reversible actions. Never modify the user's original source checkout implicitly.
- Publish a reproducible fixture with frame count, rational FPS, source-to-timeline mapping, audio timing, color-space declaration and export provenance.
- Measure cold/warm preview latency, per-frame render cost, and actual peak GPU memory on the hardware used.
- Compare rendered reference and output frames and verify exports after reopening, including a human visual quality check.
- Add tests and an honest fallback for unsupported effects. Showing an MP4 proxy does **not** mean the studio implements that shader renderer.
- Only promote a catalog entry from `research` after integration code and tests land. The current validator intentionally rejects premature support claims.

Run `node --test test/doc/cinematic-engines.test.mjs`; this is automatically included in the existing `npm test` glob. Credit remains with each upstream author and contributor.
