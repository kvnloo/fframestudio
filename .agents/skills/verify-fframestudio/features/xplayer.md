# X Player Card launch film

Share `/launch` to offer a minimal embedded film on compatible X clients, or watch/download directly with no account. The current media is a clearly labelled synthetic placeholder, not the launch film.

## Sub-features

- `share`: absolute player/OG metadata, 16:9 poster, responsive film and studio/source links.
- `embed`: tap-to-play, muted/playsinline native controls, explicit unmute, no site chrome.
- `policy`: only the embed permits X/Twitter HTTPS framing; all other routes retain DENY.
- `variants`: manifest fps/codec/url/bytes and default HEVC120/H.264120/H.26460 order.
- `debug`: optional observed callback-rate readout, never a nominal-fps claim.

## How to get to it (user POV)

Open `/launch`; tap native Play or Unmute. X's player target is `/launch/embed`. Use `/launch/embed?debug=1` only when measuring playback. Owner swap/deployment steps are in `docs/X-PLAYER-CARD.md`.

## Driving it with Playwright

Preconditions: Node, Python, ffmpeg/ffprobe, system Chromium with H.264 support. Run `npm run verify:xplayer`, also included in `test/verify.mjs` as `hosted: X player card and isolated embed`. The runner builds and owns its free-port static server, with generated route-specific CSP.

- **Metadata:** `page.goto(base+'/launch')`; parse all `meta[name^="twitter:"],meta[property^="og:"]`; assert player URL, poster, title, description and 640×360.
- **Paused:** `page.locator('#film').evaluate(v=>v.paused&&!v.autoplay&&v.muted&&v.playsInline)`; default `#fps` hidden.
- **Framing:** fake HTTPS X/Twitter parents embed an HTTPS transport mirror of the real static response; assert `#film` exists for allowed parents and not for evil.test. Preserve CSP unchanged. This is not an X client.
- **Playback:** `page.goto(base+'/launch/embed?debug=1')`; `page.locator('#film').evaluate(v=>v.play())`; wait for `#fps[data-fps]`, record callbacks/s, selected source and decoded dimensions; click `#sound` and assert unmuted.
- **Visual:** capture `/launch` at 412×915 and 1440×900, and embed debug; open all screenshots. Placeholder labels must remain visible until the explicit real-media swap.

## Gotchas

- Preview SSO blocks ordinary Twitterbot; authenticated CLI bypass proves route headers only, not a card render.
- A 120 fps source may display fewer frames. Headless/60 Hz cannot certify a physical 120 Hz panel.
- `preload=none` is advisory; Chromium may still fetch metadata. No autoplay is the contract.
- X caches cards and inline behavior varies by client; validate in an X draft before posting.
- Keep raw masters and media without verified publication rights out of Git and site.
