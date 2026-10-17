---
name: verify-fframestudio
description: Drive the fframestudio web app (library, project player, shot edits, assistant) in Chromium and capture evidence. Use before claiming any web, bridge or importer change works.
---

# Verify fframestudio

The surfaces are the web app served by the local bridge and the static local-first site (see [hosted](features/hosted.md) and [HOSTED.md](../../../docs/HOSTED.md)). `test/verify.mjs` is the harness: it builds
an isolated world, drives Chromium through the journeys in `features/`, and keeps the evidence.

## Launch

```sh
npm run setup        # once per clone; idempotent
npm run verify       # = node test/verify.mjs [--out DIR] [--keep]
```

Verify makes a temp `HOME`, generates the 12 s demo film (`tools/make_demo.py`), imports it with
`projects/sources.example.json`, and starts its own bridge on a free loopback port with a throwaway
token. Ready means `GET /health` answered and the library page lists "Demo film". It never touches
`~/fframestudio` or a bridge the user is running, so two runs can go side by side.

To drive the user's own instance instead (their real projects), start `npm run bridge` and open the
printed `/open?token=…` link. Do not drive an instance you did not start without asking.

## Doctor

```sh
npm run doctor                          # node>=20, npm, python3, ffmpeg, ffprobe, optional uv, agents
curl -s 127.0.0.1:<port>/health         # {"ok":true,"name":"fframestudio-bridge",...}
```

## Drive

Playwright (`playwright` devDependency). Browser: `PW_CHANNEL=chrome` (CI), else `$CHROMIUM`, else
`/usr/bin/chromium`. Playwright's bundled Chromium cannot decode H.264, so the player journey fails on it. Stable handles:

| handle | what |
| --- | --- |
| `#open-folder`, `#folder-files` | hosted read/write picker and read-only folder import |
| `#examples-shelf`, `[data-open-example]` | lazy attributed examples, opened as IndexedDB copies |
| `[data-action="export-project"]`, `[data-action="save-copy"]` | local project download and example copy to visitor folder |
| `.gate` | sign-in page shown without the token cookie |
| `/open?token=T` | sets the `ffs` cookie, redirects to the library |
| `.card`, `.card .t` | library cards and titles |
| `#preview-video` | project player (proxy video) |
| `[data-slate-tab]`, `.direction-card` | Shot / Narrative / Direction / Takes / Assistant / Source tabs; Story tab below 1024 px |
| `#timeline-splitter` | Pointer/keyboard timeline height separator; `aria-valuenow` persists |
| `.story-panel`, `.inspector-panel`, `[data-action="toggle-story"]`, `[data-action="toggle-inspector"]` | Collapsible, internally scrolling views |
| `.shot-thumbnail`, `.thumb-words`, `canvas[data-video][data-ready="true"]` | Word fallback and decoded clip-midpoint posters |
| `#theme`, `#library-theme` | Studio, Paper and retained workspace themes |
| `[data-action="loop-shot"]`, `[data-action="loop-film"]`, `[data-action="mute"]`, `[data-action="screening"]` | real playback toggles and fullscreen canvas |
| `#audio-wave` | worker-computed peak/RMS display; hidden without audio |
| `#timeline .timeline-clip[data-select]` | timeline shot blocks; click seeks to the shot |
| `input[data-field]`, `textarea[data-field]` | selected clip text; `change` edits, `[data-action="save"]` writes `textOverrides` |
| `[data-agent]`, `#ask`, `#send`, `#chat` | assistant agent pills, prompt, send, transcript |

## Evidence

`verify-out/<timestamp>/report.json` (one entry per journey with measured values, console errors,
failed requests) and numbered screenshots. Open the screenshots and look at them; a passing exit
code with a broken layout is a failure. Side effects are checked on disk (the edit lands in the
library copy; the source video is unchanged).

## Cleanup

Verify kills the bridge it started and deletes the temp `HOME` unless `--keep`. Evidence stays in
`verify-out/` (gitignored). Never kill processes by name.

## Feature map

`features/README.md` lists the journeys. When you change a feature, update its file and the
matching journey in `test/verify.mjs` in the same commit. Never weaken a journey to make it pass.
