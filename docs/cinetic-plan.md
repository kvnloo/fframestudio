# Cinetic plan interchange (experimental)

This adapter is a **metadata-only**, local-first integration for [Leonxlnx/cinetic](https://github.com/Leonxlnx/cinetic) (MIT film-directing skill). Its goal is to bring technique *choices* from a cinetic brief into FrameStudio's emerging video-style component workflow, without bundling Remotion, copying upstream techniques/footage, or claiming visual parity.

## Try with your own cinetic checkout

Generate a seeded plan in cinetic:

    python3 scripts/pick.py --format launch --energy high --seconds 25 --seed 41 --json out/qa/picks.json

Then import the picks into FrameStudio:

    node tools/import-cinetic-plan.mjs /path/to/cinetic/out/qa/picks.json > motion-plan.json

Output schema: `fframestudio.cinetic-plan/1`. The adapter accepts cinetic's actual `pick.py --json` envelope (`seed`, `format`, `energy`, `category`, `picks`). It records source technique IDs, names, categories and roles, keeps the draw's seed, and proposes local components *by broad creative category* where there is a sensible starting point:

- `typography_motion` / `opening_hook` → `headline-reveal`.
- `transition` → `foreground-fly-through`.
- `ui_choreography` / `product_demo` → `ui-action-result`.
- Other categories are **needs-implementation**; nothing is dropped from the plan.

**These are suggestions, not translations.** A cinetic velocity-matched cut is not automatically implemented by FrameStudio's foreground-fly-through. Every suggested component carries `fidelity: conceptual-only`. Do not render or export a matched-video claim from this data without manually implementing and verifying the named technique.

## Security and boundaries

Input is max 128 KiB, strict key vocabulary, max 32 unique picks and source provenance only; no scripts, source text, reference media, URLs or credentials. It does not invoke cinetic's Python runtime or any network call. The output is safe to inspect as **data**, not to execute. The local CLI never uploads the input.

Test with `node --test test/doc/cinetic-plan.test.mjs`; this is part of the existing `npm test` doc test glob. FrameStudio video-style definitions are inherited from PR #10, and must land before merging this stacked PR.

## Next

Build a reviewed visual plan inspector, then one actual cinetic-inspired technique rendered in fframes and visually compared at pinned FPS/seed, with audio/BT.709/color proof. Respect cinetic's MIT notices and Remotion's **separate** license. References: #5 (cinematic ecosystem), #9 (video-style components).

Credit: [Leonxlnx](https://github.com/Leonxlnx) (cinetic) and [Dmitriy Kovalenko](https://github.com/dmtrKovalenko) (fframes).
