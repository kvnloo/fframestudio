---
name: verify-fframestudio
description: Drive the fframestudio web app (library, project player, shot edits, assistant) in Chromium and capture evidence. Use before claiming any web, bridge or importer change works.
---

# Verify fframestudio

The surface is the web app served by the local bridge. `test/verify.mjs` is the harness: it builds
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

Playwright (`playwright` devDependency). Chromium: `$CHROMIUM`, else `/usr/bin/chromium`, else the
Playwright-managed browser (`npx playwright install chromium`). Stable handles:

| handle | what |
| --- | --- |
| `.gate` | sign-in page shown without the token cookie |
| `/open?token=T` | sets the `ffs` cookie, redirects to the library |
| `.card`, `.card .t` | library cards and titles |
| `#vid` | project player (proxy video) |
| `.tl .s[data-id]` | timeline shot blocks; click seeks to the shot |
| `.fld input[data-shot][data-k]` | editable on-screen text; `change` saves to `project.json` `edits` |
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
