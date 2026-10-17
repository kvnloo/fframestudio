# Performance is a feature — editor core

fframestudio follows the fframes/fff ethos: actually fast, measured, no bloat. This branch
uses plain browser ES modules, not a UI framework. **The full performance acceptance gate
is not green.** Do not promote this as a qualified <16 ms editor based on the smaller CPU
number, a single faster run, or the shipped-size result.

## Reproduce

```sh
npm ci
npm run build:acp
npm run test:doc
npm run test:editor
npm run test:perf
# Actual agent, not a mocked response; requires a logged-in hermes acp:
npm run test:editor-acp
```

`tools/verify-editor.mjs` owns a bridge on port 7879 (`FFS_PORT` overrides), copies the library
to `$TMPDIR/ffs-editor-*`, never changes the real projects or bridge configuration, and prints
evidence paths. `FFS_LIBRARY` selects an alternate source library. `FFS_EVIDENCE` selects the
output directory. Chromium is `/usr/bin/chromium`; Python Playwright is run through uv.
To collect both perf suites even when one fails, run them separately:

```sh
node --test test/perf/*.test.mjs
FFS_PORT=7881 FFS_EVIDENCE=docs/evidence/editor-core/perf \
  node tools/verify-editor.mjs --synthetic --perf
```

The benchmark generates 500 real document clips (three seconds each, text and attachments),
not fabricated measurements. Cold navigation opens `expresslane-i880`, the largest current
library project: 48 clips, 22,958 original JSON bytes. The actual-library migration test covers
all six source projects and verifies the originals are byte-identical afterward.

## Recorded result and qualification boundary

Latest recorded browser run: 2026-10-17, Linux 7.2.9-1-cachyos, Node v26.7.0,
Chromium 153.0.8010.52, 1440×1000 headless viewport. The shared host was not idle; a nearby
read observed load averages 13.10 / 19.58 / 18.93. No other workloads were killed, paused or
reconfigured. Host contention is not an exemption from the stated budgets.

| Measure | Required | Recorded | Result |
| --- | --- | --- | --- |
| Largest-project cold navigation → interactive | <300 ms | 325.4 ms | FAIL |
| 500-clip command → worker patch + DOM/layout ready, worst | <16 ms | 167.2 ms | FAIL |
| Command → next animation frame, worst | <16 ms | 167.9 ms | FAIL |
| Scrub animation frame rate | 60 fps | 37.05 fps (26.99 ms mean interval) | FAIL |
| Scrub long tasks >50 ms | 0 | 0 | PASS |
| Editor JS gzip, excluding ACP | <150 KiB | 21,600 bytes (Python gzip) | PASS |
| Mounted Story / Timeline clips for 500 clips | visible window only | 7 / 39 | PASS |
| Canvas and same-selection inspector identity during text edits | preserved | preserved | PASS |

The Node CPU gate passed: all named commands plus undo/redo were below 16 ms; maximum
8.20 ms in that run. This does **not** prove browser apply+paint latency. Node zlib measured
21,731 gzip bytes; compressors differ slightly. Both size scripts sum each shipped editor
`.js` module separately, including `web/app.js` and both workers, excluding the ACP source
and bundled SDK. CSS, fonts, source media and ACP are not hidden in that JS budget.

During development a browser run measured 201.1 ms cold open, 14.1 ms worst paint-ready,
60.003 fps and zero scrub long tasks, but next-frame latency was still 20.2 ms. Later runs
regressed under the actual host workload. These are observations, **not** qualification or
permission to loosen the threshold. The committed receipt is the latest run, not the best.

### Measurement semantics

* Cold open uses a fresh page with CDP cache disabled; `interactiveAt` is recorded after the
  worker migration, view mount and event binding, relative to navigation time origin. This
  does not wait for every lazy thumbnail or the first decoded video frame.
* `ready` includes worker scheduling, command application/diff, patch transfer, DOM updates
  and a forced layout flush. It is paint-ready work, **not** GPU presentation.
* `present` ends at the next rAF callback, a conservative scheduling diagnostic, **not proof
  of physical screen presentation**. The strict gate checks this separately rather than
  incorrectly calling a layout flush “paint”. True compositor tracing remains unqualified.
* A PerformanceObserver records long tasks during two seconds of transport/scrubbing.
  Frame intervals come from rAF; the 60-fps check allows a 17.5-ms mean interval for clock
  jitter. Missing the budget still fails the process; it is not a warning-only report.
* The browser exercises every named command, undo/redo and restore, with 20 text edits.
  `npm run test:perf` is strict and currently exits nonzero. No optional success flag or
  automatic threshold update conceals this failure.

## Implemented architecture

* One authoritative command document in a module Worker. Migration, validation, proposal
  preview and version diffing run there. Commands return JSON-pointer patches, not the full
  project. Structural sharing keeps source media/provenance/version snapshots out of ordinary
  copy work; multi-video proposals retain transactional isolation.
* Stable clip-keyed DOM reconciliation. Story cards are windowed vertically; Timeline clips
  and beat marks are windowed horizontally. Text edits do not rebuild the editor. The browser
  suite uses a MutationObserver to prove unrelated cards receive zero mutations, and retains
  the same Canvas and Inspector controls during local text updates.
* IntersectionObserver requests thumbnails on demand. A separate Worker fetches and decodes
  with createImageBitmap and transfers ImageBitmap handles to canvas bitmaprenderer contexts.
* One playback rAF writes only the playhead transform, using cached geometry. No layout reads,
  DOM reconciliation or image decoding happen in that loop. Proxy/still/text synchronization
  is throttled separately to 10 Hz; final compositing and audio mixing are not implemented.
* Themes use CSS variables (dark/light/high-contrast/custom). Keybindings, side-panel resize
  widths and collapsed state persist locally. Browser tests exercise actual resize handles,
  collapse/restore, custom colors, light/high-contrast themes and a remapped frame key.

There is no waveform producer yet, so no fake peaks or main-thread waveform implementation.
There is also no demonstrated SIMD workload or SIMD speedup in this core. Add a measured
worker/Wasm SIMD lane when waveform/compositing work exists, not a dependency for branding.

## Remaining work before performance promotion

1. Profile repeated cold starts and command scheduling under controlled and realistic load;
   shorten worker/startup latency and the DOM/layout path without weakening evidence.
2. Replace whole-clip-array patches for structural edits with bounded splice patches where
   they are proven correct. Current diff paths are safe but not maximally efficient.
3. Add compositor trace evidence for command-to-painted-frame latency. A passing CPU or rAF
   metric alone cannot certify actual displayed pixels.
4. Qualify real proxy decode/audio/compositing separately. The synthetic test intentionally
   has no source video decode cost; its result cannot stand in for a media-engine benchmark.

Receipts: [`evidence/editor-core/perf/perf.json`](evidence/editor-core/perf/perf.json),
[`node-perf.txt`](evidence/editor-core/node-perf.txt),
[`node-tests.txt`](evidence/editor-core/node-tests.txt). Browser and real ACP screenshots and
JSON receipts live alongside them. The separate no-mistakes orchestrator was not run: this
repository is not initialized for it. These direct tests are not a claim of full pipeline CI.
