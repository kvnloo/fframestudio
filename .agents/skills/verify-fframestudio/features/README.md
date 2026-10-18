# fframestudio verification map

This directory is the maintained source for verifying the user-facing behavior of fframestudio. Read the index before driving the app, then use the matching feature file as the recipe. The harness is Playwright, run through `test/verify.mjs`.

## Baseline preconditions

- Run `npm run setup` once per clone. It is idempotent.
- Run `npm run verify`, which is `node test/verify.mjs [--out DIR] [--keep]`. It builds an isolated world by itself.
- Verify makes a temp `HOME`, generates the 12 s demo film with `tools/make_demo.py`, imports it with `projects/sources.example.json`, and starts its own bridge on a free loopback port with a throwaway token.
- Ready means `GET /health` answered and the library lists `Demo film`.
- Verify never touches `~/fframestudio` or a bridge the user started. Two runs can go side by side.
- To drive the user's own instance instead, start `npm run bridge` and open the printed `/open?token=…` link. Do not drive an instance you did not start without asking.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Journeys run in order in one page and one context. Later journeys inherit earlier state.
- Treat every selector and call as literal. Keep the exact names and paths.
- Drive the page with Playwright page methods. Drive the bridge with `fetch`.
- Prefer the stable handles the app renders:

| handle | what |
| --- | --- |
| `.gate` | sign-in page shown without the token cookie |
| `/open?token=T` | sets the `ffs` cookie, redirects to the library |
| `.card`, `.card .t` | library cards and titles |
| `.pill[data-tag]` | library tag filter chips |
| `#preview-video` | project player (proxy video) |
| `#timeline .timeline-clip[data-select]` | timeline shot blocks; click seeks to the shot |
| `input[data-field]`, `textarea[data-field]` | selected clip text; `change` edits, `[data-action="save"]` writes `textOverrides` |
| `[data-agent]`, `#ask`, `#send`, `#chat` | assistant agent pills, prompt, send, transcript |

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- The run writes `verify-out/<timestamp>/report.json`, one entry per journey with measured values, console errors and failed requests, plus numbered screenshots.
- Open the screenshots and look at them. A passing exit code with a broken layout is a failure.
- Check side effects on disk: an edit lands in the library copy and the source video is unchanged.
- Report an unreachable path with the failed journey and the unmet precondition.
- Do not report a skipped journey as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with Playwright` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact Playwright call and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, calls, and observable proof.

When you change a feature, update its file and the matching journey in `test/verify.mjs` in the same commit. Never weaken a journey to make it pass.

## Features

| feature | file | journey in `test/verify.mjs` |
| --- | --- | --- |
| My Taste | [taste.md](./taste.md) | `taste: import file profile -> preview diff -> apply -> undo -> delete`; `hosted taste:` in `test/hosted-journey.mjs` |
| Hosted local-first Studio | [hosted.md](./hosted.md) | four `hosted:` journeys in `test/hosted-journey.mjs`, included by `test/verify.mjs` |
| Adaptive fitted layout | [layout.md](./layout.md) | `layout: fits and adapts across sizes` |
| Studio film desk | [studio.md](./studio.md) | `studio: themes, slate tabs, loops and screening room`; additional `tools/verify-studio.mjs` visual/audio proof |
| Library | [library.md](./library.md) | `library: open link, demo project listed` |
| Project player | [project-player.md](./project-player.md) | `project: plays and seeks by shot` |
| System theme | [system-theme.md](./system-theme.md) | `system theme: follows and live-updates` |
| Shot edits | [shot-edits.md](./shot-edits.md) | `edit: shot title saves and survives reload` |
| Context menu | [context-menu.md](./context-menu.md) | `context menu: native menu replaced, actions work` |
| Crash recovery and autosave | [recovery.md](./recovery.md) | `recovery: unsaved title survives page close, undo and explicit save` and the other `recovery:` journeys |
| Assistant | [assistant.md](./assistant.md) | `assistant: agents listed, unavailable ones disabled` |
| Bridge security | [bridge-security.md](./bridge-security.md) | `gate: app refuses without the link` |

Two cross-cutting journeys check the whole app and are not owned by one feature file:

- `mobile: 390 px has no horizontal overflow` covers the library and the project player at 390 px.
- `console clean` requires no console errors and no failed requests across all journeys.
