# X player qualification

Preview: https://fframestudio-3s4mx1g09-kvnloos-projects.vercel.app/launch

Build ID: `4a76712ac1da92cc` (source-content hash). `live-preview.json` records fresh actual Vercel responses, fetched with Twitterbot UA and an authenticated CLI bypass after linking the intended project. The clean-URL `.html` alias redirects with 308, then serves the correct embed policy. Unauthenticated Twitterbot receives a 302 SSO redirect; **this preview cannot become an X card**. No production deployment or X posting occurred.

## Results

- `npm test`: exit 0; 251 Node tests, 9 procedural tests, ACP/security checks pass; real discovery config bytes/mtime unchanged. The two previously reported system-theme watcher failures did not reproduce in these runs.
- `npm run verify:hosted`: exit 0, 8 journeys.
- `npm run verify:xplayer`: exit 0; metadata parsed, three embed aliases permitted, all 89 emitted non-embed files and near-miss paths retain DENY, byte-range decoding checks, no-autoplay/unmute, allowed and blocked ancestor tests pass. Unexpected console/page errors: zero. The expected blocked-frame violation is retained.
- `npm run verify`: first 33/33; latest 32/33, exit 1 at the existing style-lab 60 Hz scheduling tolerance. An `origin/main` archive control also fails that scheduling gate (31/32, at a different component). Both raw timing arrays and the earlier passing sample are retained. This does not establish the cause or excuse the failed gate; no threshold was weakened and no style runtime was changed.
- The local 120 fps H.264 file decodes at 1920×1080, but standalone rVFC observations were 36.4/36.4/52 callbacks per second; **>100 callbacks/s was not reached**. Additional runs remain in their receipts. File metadata is not display-rate proof.
- ffprobe counts: HEVC120 480 frames / 1,294,362 bytes; H.264120 480 frames / 2,279,392 bytes; H.26460 240 frames / 1,547,509 bytes. All are four-second labelled synthetic fixtures.
- Inspected final 412×915 and 1440×900 viewport/full-page renders and the debug embed: no horizontal overflow or overlapping labels; native controls and explicit placeholder labels visible. Fixed a stale fallback-loading message found in the first screenshots.

## Preserved early findings

`prior-xplayer-runs.json` retains the initial over-strict zero-media-request test failure (`preload=none` is advisory), the fake HTTPS-parent to loopback framing failure (transport was replaced by an unchanged-header HTTPS mirror), and intermediate playback observations. The initial `npm test` run failed one existing header-array-position expectation after adding the embed rule (250/251); the test now semantically validates the embed policy before checking the two unchanged immutable rules. Final `npm test` passed twice. A live alias probe initially expected headers on the 308 redirect itself; final live evidence follows the redirect and asserts the document's real headers.

Node/Chromium/ffmpeg ran locally. The factory substrate only supports Python stdlib jobs and cannot execute these suites. Version details are in `qualification.json`.

## NOT VERIFIED

Real launch-film substitution (delivery MP4s were not yet present), real X card render/client approval, physical 120 Hz phone playback, 120+ displayed fps, production deployment, or X posting. See `../../X-PLAYER-CARD.md` for exact owner swap/release steps and the future refresh-adaptive manifest seam.
