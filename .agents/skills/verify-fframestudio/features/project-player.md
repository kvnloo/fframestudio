# Project player

The project view plays the project's proxy render in `#vid` and draws a timeline of shot blocks. Clicking a block seeks the video to that shot and selects it in the shot list.

## Sub-features

- `player-load` loads the proxy video in `#vid` with the project poster.
- `player-meta` shows the title, kind, canvas size, fps, duration and shot count.
- `player-timeline` renders one `.tl .s` block per shot, sized by shot length.
- `player-seek` seeks the video to a shot start when its block is clicked.
- `player-playhead` moves `#ph` as the video plays and highlights the active shot.
- `player-select` marks the active `.tl .s` and `.shot` with class `sel`.
- `player-list` lists every shot with its name, start, end and length, and an origin when present.
- `player-fallback` shows the poster or `no render yet` when there is no proxy render.
- `player-source` lists the edit app, folder, live link, docs, renders and project path.

## How to get to it (user POV)

- Open a project card from the library.
- Use the video controls, or choose a timeline block to jump to a shot.
- Read the shot list under the timeline.

## Driving it with Playwright

Preconditions:

- The library lists `Demo film`.
- The demo project has a proxy render, 4 shots and a 12 s duration.
- The browser was launched with `--autoplay-policy=no-user-gesture-required`.

- **Open the project.** Choose the card and wait for the player. Run `await page.click('.card');` and `await page.waitForSelector('#vid');`. The project view renders with `#vid`.
- **Wait for metadata.** Run `await page.waitForFunction(() => document.querySelector('#vid').readyState >= 2, null, { timeout: 15000 });`. The video is ready to seek.
- **Check the duration.** Run `await page.$eval('#vid', (v) => v.duration);`. It is 12 s within 0.5 s.
- **Count the shots.** Run `await page.$$eval('.tl .s', (e) => e.length);`. It is 4.
- **Seek to shot 3.** Choose the third block. Run `await page.click('.tl .s:nth-child(3)');` and `await page.waitForTimeout(400);` then `await page.$eval('#vid', (v) => v.currentTime);`. It lands near 6 s within 0.2 s.
- **Check the selection.** After the click the third block and its `.shot` both carry class `sel`, and the matching `.shot` is scrolled into view.
- **Fallback.** A project with no proxy render shows the poster image or the text `no render yet` instead of `#vid`.
- **Proof.** Screenshot the player. The harness writes `03-project.png`. It shows the video, the timeline and the shot list.

## Gotchas

- `#vid` exists only when the project has `renders.length` and `media.proxy`. Without them there is no player to drive.
- Clicking a block seeks to `t0 + 0.01`, not exactly `t0`. Allow a small tolerance.
- Blocks use `flex` from `t1 - t0`, with a floor of 0.2. The `nth-child` index follows shot order, not names.
- The playhead and active-shot highlight run on `timeupdate`. Wait for metadata, then let the video play for a moment before asserting.
- The seek test depends on the demo shots being contiguous at roughly 0, 3, 6 and 9 s.
- The whole project view re-renders on save and on external change. Re-query `#vid` and blocks after either.
