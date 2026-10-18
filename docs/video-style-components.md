# Video Style Components — first slice

See https://github.com/kvnloo/fframestudio/issues/9 for the full plan. A component is a deterministic, editable **recipe**, not an MP4 or a drop-in fframes scene. This implementation defines three launch-film primitives and a browser preview laboratory without added dependencies.

## Try it

From the project root:

    node tools/video-style-components.mjs list
    node tools/video-style-components.mjs export headline-reveal > headline.video-style.json
    node tools/video-style-components.mjs export ui-action-result '{"action":"Generate film","result":"Film ready"}'
    node tools/video-style-components.mjs frame foreground-fly-through 45

Preview at /app/labs/video-styles.html when using the local bridge or hosted static site. Change text, scrub any frame, and export editable JSON. It intentionally does **not** claim native composition, soundtrack playback, or MP4 export.

## Contract

- The fframestudio.video-style/1 recipe stores component name, rational FPS, canvas, duration in integer frames, and validated string props.
- evaluateRecipe(recipe, frame) is a pure function of its arguments. It returns normalized x/y, scale, opacity, and frame-local audio-event **cues**, not sound samples.
- instantiate, serializeRecipe and parseRecipe round-trip a recipe. No video footage, third-party logos or source assets are copied.
- Browser text renders via textContent, not HTML interpolation. No dynamic code evaluation, third-party APIs, or secrets.
- Preview is DOM/CSS. A real fframes/Rust renderer, visually verified scene handoffs and voice editing are follow-up PRs.

## Tests

    node --test test/doc/video-style-components.test.mjs

This test is included in the existing npm test doc glob. It covers deterministic seeking, presets, serialization, input validation and easing. The results verify **structure**, not cinematic quality or renderer parity.

## Credits

Motion research informed by [Motion Video Kit](https://github.com/echris6/motion-video-kit) by echris6 (MIT text/scripts) and [fframes](https://github.com/dmtrKovalenko/fframes) by Dmitriy Kovalenko. The component code here is new and does not copy source footage or logos.
