# Project player

The editor plays the source proxy in `#preview-video`. Clicking a Timeline clip seeks the preview to that clip and selects it in Story and Inspector.

## Sub-features

- `player-load` loads the proxy video in `#preview-video`.
- `player-timeline` mounts visible `.timeline-clip[data-select]` blocks inside `#timeline`.
- `player-seek` seeks to a clip start when its block is clicked.
- `player-play` starts playback with `[data-action="play"]` and pauses with `[data-action="pause"]`.
- `player-playhead` moves `#playhead` as the video plays.
- `player-select` marks the active Timeline clip and Story card with class `selected` and shows its fields in Inspector.
- `player-fallback` shows a thumbnail or text when there is no usable proxy.
- `player-source` lists the source and renders under Source & provenance.

## How to get to it (user POV)

- Open a project card from the library.
- Choose Play or a Timeline clip to jump to a shot.
- Read the selected shot in Story and Inspector.

## Driving it with Playwright

Preconditions:

- The library lists `Demo film`, with a proxy render, 4 shots and a 12 s duration.
- Chromium supports H.264 and was launched with `--autoplay-policy=no-user-gesture-required`.

- **Open the project.** Run `await page.click('.card');` and `await page.waitForSelector('#preview-video');`.
- **Wait for metadata.** Run `await page.waitForFunction(() => document.querySelector('#preview-video').readyState >= 2, null, { timeout: 15000 });`.
- **Check duration.** Run `await page.$eval('#preview-video', v => v.duration);`. Assert 12 s within 0.5 s.
- **Count shots.** Run `await page.locator('#timeline .timeline-clip').count();`. Assert 4.
- **Play and pause.** Run `await page.click('[data-action="play"]');`, wait for `#preview-video.currentTime > 0.2`, then `await page.click('[data-action="pause"]');`.
- **Seek to shot 3.** Run `await page.locator('#timeline .timeline-clip').nth(2).click();`, wait 400 ms, then read `#preview-video.currentTime`. Assert 6.0 s within 0.2 s.
- **Check selection.** The clicked `.timeline-clip` and matching `.story-card` carry class `selected`.
- **Proof.** `03-project.png` shows the preview, Story, Timeline and Inspector.

## Gotchas

- `#preview-video` exists even without a proxy; assert decodable media, not only the element.
- Pause before asserting a seek time, since playback advances the clock.
- Timeline and Story are windowed. The demo's four clips all fit; larger projects require scrolling.
- Clip IDs live in `data-select`; DOM order can differ from story order after structural edits.
- The demo shots start at 0, 3, 6 and 9 s.
- The 390 px journey checks both library and project scroll widths and captures both pages.
