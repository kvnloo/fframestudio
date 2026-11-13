# Sound Atlas e2e (tester-army)

User-journey suite for Sound Atlas, ported from the trafficiq tester-army harness (`e2e/army` on
`feat/e2e-tester-army`). It has three layers:

| Layer | Command | What it catches |
|---|---|---|
| Journeys (deterministic) | `npm test` | 19 journeys × desktop 1440×900 + phone 390×844: map painted, search, play/pause/next/prev with the audio clock moving, local `/tracks` playback, pretty `/song/…` links, picks surviving reload + Liked filter, chip counts, every sort lens, every sheet view, share QR, radio, `/api/social`, cast menu, BYOM, layout overflow, and every catalogue host serving audio |
| Canary (recall) | `CANARY=1 bash bundle.sh site-canary`, serve it, `SITE_URL=… npm test` | 5 seeded defects (`canary.sh`): blank map, query dropped from URL, chip count +1, a sort throws, cast button dead. The suite must fail each one |
| Army (exploratory) | `bash run.sh` (or `boat/up.sh`) | 20 goals in `goals.tsv`, taken from `journey.json` stages and past bug history. `e2e explore` sessions with a vision model; `findings.py runs` aggregates them |

The repo's own suites still apply: `node --test test/music-atlas/*.test.mjs`, and
`node test/music-atlas/{cast,byom}-e2e.mjs <url>`.

## Setup

```sh
npm install
bash bundle.sh              # builds this checkout into ./site (catalogue from SA_CATALOG, MP3s from SA_TRACKS)
. ./serve.sh                # serves ./site on 18941 with SA_SCHEMA=sa_e2e, so community writes stay out of prod
CHROME_EXE=/usr/bin/google-chrome-stable npm test
```

`army.config.ts` holds both targets. `SITE_URL` points the suite at a preview or at production instead.
`DATABASE_URL` comes from `SA_ENV`, which defaults to the clean profile's `sa-social/.env.neon`. Without
it, `/api/social` is off and the community journey fails.

## Army model gate

`e2e explore` needs a model that takes images, makes tool calls and returns JSON-schema output. Check a
model with the rendered-ui-qualification skill's `scripts/probe-vision-model.py` before trusting a run.
Results from 2026-11-12, NVIDIA NIM free tier:

| Model | Result |
|---|---|
| `google/gemma-4-31b-it` | slow: 80–120 s per call; every explore act hit the 240 s limit |
| `nemotron-3.5-super-vl` | G0 fail: empty JSON output |
| `nemotron-3-nano-omni` | G0 fail: empty JSON output |
| `kimi-k2.6` | 404 on this account |
| `llama-4-maverick` | end of life |

Until a model passes G0, the stronger orchestrating model reviews the journey screenshots by hand.
`E2E_BASE_URL`, `E2E_MODEL` and `E2E_KEY_ENV` switch the provider (see `agent.ts`).
