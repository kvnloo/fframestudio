# Video Style Components

Issue [#9](https://github.com/kvnloo/fframestudio/issues/9), PR A + PR B. These are portable,
source-editable **sidecar recipes**, not MP4s, project clips or a native renderer. The existing
`fframestudio.project/1` story lane is unchanged. There are no new runtime dependencies.

## Use the library

```sh
node tools/video-style-components.mjs list
node tools/video-style-components.mjs show headline-reveal
node tools/video-style-components.mjs export headline-reveal '{"headline":"Make the next move"}' '{"aspect":"9:16","fps":{"num":30000,"den":1001},"durationFrames":120}' > headline.video-style.json
node tools/video-style-components.mjs import headline.video-style.json
node tools/video-style-components.mjs eval headline.video-style.json 45
node tools/video-style-components.mjs eval foreground-fly-through 45
node tools/video-style-components.mjs export ui-action-result | node tools/video-style-components.mjs import -
```

`show` prints the entire component definition. `export` prints a validated instance **including
its definition**, so imported tracks are the source of truth, not a lookup into a mutable preset.
`import FILE|-` validates and emits the same editable recipe. `eval NAME FRAME [PROPS_JSON]
[OPTIONS_JSON]` or `eval FILE|- FRAME` prints exact frame state. `frame` remains an alias for `eval`.
Errors go to stderr with exit 1; stdout remains machine-readable. Named instances accept options
`id`, `aspect`, `fps`, `durationFrames`. No file is modified by these commands.

| Component | Mechanism | Default frames at 30/1 fps |
| --- | --- | --- |
| `headline-reveal` | Headline lands while the kicker establishes hierarchy | 90 |
| `foreground-fly-through` | A foreground actor enlarges and reveals the next title | 75 |
| `ui-action-result` | An action gives way to its visible result | 90 |

## Data contract

The distributable [JSON Schema](../web/src/video-style/recipe.schema.json) describes the shape;
`validateDefinition` / `validateRecipe` in `web/src/video-style/components.mjs` also enforce
cross-field constraints. Unknown recipe/definition fields, unsupported effects/assets, malformed
tracks, mismatched identity/version, invalid fps, dimensions and props fail closed. Imports are
limited to 256 KiB. JSON only: no scripts, HTML, remote asset fetches or dynamic code evaluation.

### Definition: `fframestudio.style-component/1`

| Field | Meaning |
| --- | --- |
| `id`, `version` | Kebab-case identity and semver, currently `1.0.0` |
| `title`, `description`, `author`, `license`, `provenance` | Authorship, license and source-of-ideas credit; preserved on export |
| `capabilities`, `requiredAssets` | Supported mechanisms; no external assets in this slice |
| `renderCapabilities` | DOM 2D supported properties and explicit unsupported renderer/effect list |
| `units` | x/y are canvas fractions from top-left; scale is unitless; time is integer frames |
| `fps`, `durationFrames` | Positive rational fps (1–240), integer duration (2–36,000 frames) |
| `controls` | Text (max 120 chars for bundled definitions), six-digit sRGB colors and bounded numeric motion scale; each declares a typed default and bounds |
| `timingControls` | Integer duration and rational fps controls, not strings or floating seconds |
| `lookTokens` | Canvas, ink and accent mapped to typed color props |
| `variants` | 16:9 (1920×1080), 9:16 (1080×1920), 1:1 (1080×1080), each with normalized safe-area insets and text-width constraint |
| `layers` | Stable identity, text-prop binding, role, z order, x/y/scale/opacity keyframe tracks |
| `anchors` | Explicit `start`, `end`, `carry` layer references; evaluated x/y are actor origins |
| `cues` | Integer-frame markers, labels and kinds; events only, never audio playback |

Each key is `[integerFrame, numericValue, easing]`, in strictly increasing frame order. A track
holds before its first key and after its last. The destination key selects the segment's easing:

| Easing | Interpolation weight at normalized segment time t |
| --- | --- |
| `linear` | t |
| `hold` | 0 until the destination frame; exactly 1 there |
| `in-cubic` | t³ |
| `out-cubic` | 1 − (1 − t)³ |
| `in-out-cubic` | 4t³ before 0.5; 1 − (−2t + 2)³/2 afterwards |

### Instance: `fframestudio.video-style/1`

`id`, `component`, `version`, embedded `definition`, `props`, `fps`, `size`, `aspect`, and
`durationFrames` are all explicit. The instance's identity/version must agree with its definition.
Props must exactly match the definition's controls. Size must match its aspect variant. Recipe
fps is retained as a rational, without rounding 30000/1001 to 30. Reordering JSON object keys has
no semantic effect. The earlier prototype's definition-less recipes are not accepted: re-export
with this CLI; there was no persistent project migration.

`evaluateRecipe(recipe, frame)` validates and samples any integer frame in `[0, durationFrames)`.
It maps that frame to `frame * (definition.durationFrames - 1) / (recipe.durationFrames - 1)`;
retiming changes elapsed seconds but keeps exact start/end poses. Cues use nearest integer-frame
mapping under the same retime. Multiple events may share a frame. Returned seconds are derived,
never a clock input. Motion scale multiplies sampled scales. No previous seek, random source,
wall-clock read, DOM, GPU or module state affects evaluation. Returned objects never alias inputs.

The result includes layers, look colors, safe-area insets, text width, cues and evaluated anchors.
Safe areas are layout constraints/guides, **not a guarantee that every user-written paragraph
fits**. The DOM wraps within the declared width; inspect long copy in every aspect. Entrances and
the fly-through deliberately cross safe guides. Position is the left/middle origin;
DOM applies `translateY(-50%) scale(s)` around that origin. There is no rotation, perspective,
font shaping contract or pixel parity across renderers yet.

## Component Lab

Open **Video style components** in the film library, or `/app/labs/video-styles.html` directly.
The Studio-like lab works on the bridge and the CSP-protected static build:

- Select a visual component card or the component menu.
- Scrub any integer frame (including keyboard arrows), play/pause, inspect safe areas.
- Select Take A or Take B; edit copy, canvas/ink/accent, duration, fps numerator/denominator and
  motion scale. Change each take's aspect independently. Compare both takes side by side on
  desktop; they stack on phone. A shared absolute frame index clamps shorter takes at their end;
  time labels show each take's own clock. Playback uses the active take's fps.
- Copy instance or definition JSON, download a recipe, or import JSON into the active take.
  Clipboard denial leaves a selected, editable textarea for manual copy. Invalid import preserves
  the last valid take. Edits are in-memory; export before navigating away.

The DOM consumes the **same evaluated state**, retains its mounted layers on scrub, uses
`textContent`, and performs no project/API reads or writes. Preview is DOM/CSS and has no audio.
The browser journey compares actual computed colors, transforms, opacity, z, positions, safe
insets and copy against **separate CLI eval subprocesses**, not a preview-owned debug object.
This is numeric property parity, not a claim of fframes pixel equality or cinematic quality.

## Minimal composition (PR C subset)

`joinComponents(a, b, {fromAnchor:'carry', toAnchor:'start'})` returns an explicit sidecar
composition. Same aspect and equivalent rational fps are required. B is translated by the
end-of-A carry position minus the start-of-B anchor position. `evaluateComposition` samples the
appropriate instance and translates all of B's layer origins/anchors. Tests check the two actual
actor origins immediately across the cut in all three aspects. Recipes are cloned at join time.

This proves **position only**: identity/content matching is caller-owned. Opacity, scale, glyphs,
velocity, continuity of an invisible actor and an aesthetic match cut are not certified. There is
no composition UI, automatic scene planning, brand-kit UI, audio sync or rendered film yet.

## Planned fframes adapter contract — not implemented (PR D)

A future adapter must:

1. Accept a validated immutable recipe/composition plus explicit output frame, rational output
   time, pinned font/assets and a declared renderer version. Return SVG/scene data derived only
   from that frame state. Never derive export state from lab playback or wall-clock deltas.
2. Convert normalized x/y/text width to exact output pixel units, retain z/opacity/uniform scale,
   sRGB colors, origin/transform order, safe-area policy, cue timing and instance identities.
   Text wrapping/shaping needs a pinned shared layout specification before pixel parity can be
   claimed. DOM font metrics are not silently treated as Rust metrics.
3. Negotiate `renderCapabilities` before work. Reject unsupported 3D, shaders, blur, assets or
   audio playback explicitly; do not replace them with stills or pretend DOM is an encoder.
4. Keep recipe manifests separately from project/1 and final MP4; preserve authorship, licenses,
   provenance and any reused source notices in every distributed kit.
5. Prove supported numeric properties against CLI samples, golden frames including cut
   boundaries/aspects, and an actual 5 s H.264/AAC decode/ffprobe smoke with measured latency,
   exact rational timing, artifact bytes and explicit audio behavior. Those gates do not exist
   in this PR and **no fframes adapter is shipped here**.

## Verification

```sh
npm test
node tools/verify-style-components.mjs
npm run verify                 # includes bridge + hosted lab parity journeys
npm run test:perf               # includes full-validation evaluation microbenchmarks
npm run build:site
bash scripts/check-no-local-paths.sh
```

`FFS_EVIDENCE` directs standalone lab screenshots/reports; `FFS_STYLE_EVIDENCE` directs raw Node
microbenchmarks. Browser scrub measures 120 rAF intervals with real input events, mounted-node
identity and long tasks separately. 60 Hz is checked with the existing 17.5 ms mean-interval
clock-jitter tolerance; it is not physical presentation or renderer throughput. See [perf.md](perf.md)
for actual measurements and retained failures.

## Credits and boundaries

[echris6/motion-video-kit](https://github.com/echris6/motion-video-kit) (MIT text/scripts) informs
motion-grammar naming and ideas. This implementation is original; **no upstream code, footage,
logos or media were copied**. The supplied X video remains an unverified visual reference, not a
claim of exact reconstruction. [fframes](https://github.com/dmtrKovalenko/fframes) is the intended
future renderer, not an implemented integration. PR E/F reference deconstruction and film factory
are outside this delivery.
