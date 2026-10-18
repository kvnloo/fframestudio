# Video Style Component Lab

The Component Lab previews portable motion recipes without changing a project's story lane. Two takes share a scrubber, with independent copy, colors, timing and aspect. This is a DOM 2D preview, not a renderer or audio player.

## Sub-features

- `style-select`: three component cards and a matching menu.
- `style-seek`: exact integer-frame scrub, keyboard arrows, play/pause and safe guides.
- `style-edit`: active-take copy, three color tokens, motion scale, duration and rational fps.
- `style-compare`: independent Take A/B recipes, side-by-side desktop / stacked phone preview.
- `style-portable`: copy instance/definition JSON, download, import and invalid-import refusal.
- `style-parity`: actual DOM/CSS samples equal separate CLI eval output.

## How to get to it (user POV)

- Film library → **Video style components ↗** opens the lab.
- Open `/app/labs/video-styles.html` on the owned bridge or hosted static build.

## Driving it with Playwright

Preconditions: owned authenticated bridge context or a plain static build served with its generated CSP. The lab itself needs no bridge APIs or assets beyond bundled fonts.

- Select: `await page.selectOption('#component','headline-reveal')` → matching `[data-component]` is pressed and both previews have layers.
- Edit: `await page.fill('#primary','A real editable take')`, `await page.fill('#secondary','The visible result')` → active take's rendered text changes, inactive take stays independent.
- Colors: set `#background`, `#foreground`, `#accent` and dispatch `input` → computed canvas/ink/border colors match CLI samples.
- Timing: fill `#duration`, `#fps-num`, `#fps-den`, `#motion` and dispatch `change` → exported typed values and sampled state agree with CLI.
- Compare: `await page.click('[data-take="b"]')` → edits target B. `await page.uncheck('#compare')` → only A remains. The aspect menu `#aspect` edits the active take.
- Seek: fill `#frame` and dispatch `input`; press `ArrowRight` → stage `data-frame` and actual left/top/transform/opacity match the independently evaluated recipe. `#play` advances, then pauses.
- Copy: `await page.click('#copy-instance')` or `#copy-definition` → JSON appears in `#json`, available even if clipboard permission is denied.
- Import: fill `#json` with a validated edited recipe and click `#import` → active-take input changes. Malformed JSON → `#message` reports refusal and last valid take remains.
- Download: wait for `download`, click `#export`, parse the file → all edited props and the embedded definition survive.
- Prove: `test/style-components-journey.mjs` samples both takes at five frames for every component/aspect against real CLI subprocesses; includes copied JSON, changed tracks on import and downloadable readback.
- Measure: dispatch a real scrub input at each of 121 rAF callbacks (120 intervals), retain node identity, record work and all long tasks. Screenshots at 1896×880 and 390×780 must be inspected, not only saved.

## Gotchas

- Shorter takes clamp to their last frame. The shared scrubber is an absolute index, not synchronized seconds when FPS differs.
- Clip output is not available. Event cues do not play audio. This proves numeric preview parity, not cross-renderer pixels.
- The state is in-memory; export before leaving. No writes go to a project or shared bridge configuration.
- Text wraps within its declared width. Inspect long copy against guides in every aspect; intentional motion can leave the safe region.
- A JSON panel or phone page may scroll. Check that the actual stage fits within its mat and does not cover transport controls.
- Keep performance reports from failed attempts. Do not change thresholds or force-click an occluded Play button.
