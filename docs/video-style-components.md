# Video Style Components

The initial prototype has advanced to the portable schema, deterministic runtime, complete CLI
and two-take Component Lab described in [style-components.md](style-components.md).

The library still contains `headline-reveal`, `foreground-fly-through`, and `ui-action-result`.
Recipes remain independent of `fframestudio.project/1`. The preview is DOM/CSS, not a video
renderer; no fframes adapter, audio playback or MP4 export is shipped.
