# Library

The library is the app's home. It lists every imported project as a card with a poster, runtime, kind, shot count, render count and tags, and lets a user filter by tag and open a project.

## Sub-features

- `library-themes` uses `#library-theme` to select Studio/Paper or retained legacy themes; the selection is shared with Workspace. Cards carry `.kind-chip` and stable `data-colour` values.
- `library-open` opens the library from the `/open?token=…` link and lands on route `#/`.
- `library-list` renders one `.card` per project with a title in `.card .t`.
- `library-meta` shows kind, shot count, render count and tags on each card.
- `library-poster` loads the project poster image on each card.
- `library-runtime` shows the duration badge on each card.
- `library-tags` shows one chip per tag plus an `all` chip and filters the grid.
- `library-open-project` opens a project from a card and routes to `#/p/<id>`.
- `library-live` reloads the grid when `projects/library.json` changes on disk.

## How to get to it (user POV)

- Open the `/open?token=…` link the bridge prints.
- Land on the default route (`#/`).
- Choose a tag chip to filter the grid.
- Choose a card to open the project.

## Driving it with Playwright

Preconditions:

- The harness built its isolated world and started its own bridge.
- The imported library contains `Demo film`.
- The page is in one context created by `chromium.launch`.

- **Open the link.** Go to the one-time link. Run `await page.goto(`${base}/open?token=${token}`);` and `await page.waitForSelector('.card', { timeout: 10000 });`. The library renders and the URL is `#/`.
- **Read the cards.** Collect the titles. Run `await page.$$eval('.card .t', (e) => e.map((x) => x.textContent));`. The list contains `Demo film`.
- **Check the poster.** Assert the image decoded. Run `await page.$eval('.card img', (i) => i.complete && i.naturalWidth > 0);`. It is true.
- **Filter by tag.** Choose a tag chip. Run `await page.click('.pill[data-tag="<tag>"]');`. Only cards with that tag stay in `.grid`, and the chip gets class `on`.
- **Clear the filter.** Choose the `all` chip. Run `await page.click('.pill[data-tag=""]');`. Every card returns.
- **Open a project.** Choose a card. Run `await page.click('.card');` then `await page.waitForSelector('#preview-video');`. The hash becomes `#/p/<id>` and the project view renders.
- **Live reload.** Change `projects/library.json` on disk. The `/events` stream fires, `loadLib()` reads `library.json` and `route()` re-renders. The grid updates without a reload.
- **Proof.** Screenshot the populated grid. The harness writes `02-library.png`. It shows the header, the cards and the poster.

## Gotchas

- An empty grid is a failure even when the exit code is 0. Assert the titles, not just that `.card` exists.
- The poster is `loading="lazy"`. Assert `complete && naturalWidth > 0`, not only that the element is present.
- A card with no render shows `no render yet` instead of an image.
- The library reads `/lib/library.json`. The event path the app matches is exactly `projects/library.json`.
- Tag chips rebuild the grid through `showLibrary()`. Re-query chips after a filter, since the DOM is replaced.
- Cards are anchors. Opening one changes browser state, so reopen the library before proving another card.
