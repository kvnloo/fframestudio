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
all source projects and verifies the originals are byte-identical afterward.

## Recorded result and qualification boundary

Three consecutive uninstrumented `npm run test:perf` runs on 2026-10-17, Linux
7.2.9-1-cachyos, Node v26.5.0, Chromium 153.0.8010.52, 1440×1000 headless viewport.
Each run executes both the Node gate and `test/editor-perf.py` against a disposable library.
No workloads were stopped or host/browser scheduling settings changed. All three processes
exit **1**, because the unchanged command-to-next-rAF budget still fails.

| Measure | Required | Median of 3 runs | Worst of 3 runs | Result |
| --- | --- | --- | --- | --- |
| Largest-project cold navigation → interactive | <300 ms | 98.2 ms | 107.9 ms | PASS |
| 500-clip command → worker patch + DOM/layout ready, worst | <16 ms | 11.6 ms | 12.2 ms | PASS |
| Command → next animation frame, worst | <16 ms | 19.1 ms | 19.6 ms | FAIL |
| Scrub animation frame rate | 60 fps | 60.00 fps | 60.00 fps (16.667 ms mean interval) | PASS |
| Scrub long tasks >50 ms | 0 | 0 | 0 | PASS |
| Editor JS gzip, excluding ACP | <150 KiB | 21,791 bytes (Python gzip) | 21,791 bytes | PASS |
| Mounted Story / Timeline clips for 500 clips | visible window only | 7 / 39 | 7 / 39 | PASS |
| Canvas and same-selection inspector identity during text edits | preserved | preserved | preserved | PASS |

| Run | Cold open | Worst patch/layout | Worst next rAF | Scrub fps | Node CPU worst | Exit |
| --- | --- | --- | --- | --- | --- | --- |
| [1](evidence/editor-core/perf/run-1/perf.json) | 91.8 ms | 12.2 ms | 18.2 ms | 60.00 | 7.11 ms | 1 |
| [2](evidence/editor-core/perf/run-2/perf.json) | 107.9 ms | 11.0 ms | 19.1 ms | 60.00 | 6.41 ms | 1 |
| [3](evidence/editor-core/perf/run-3/perf.json) | 98.2 ms | 11.6 ms | 19.6 ms | 60.00 | 6.88 ms | 1 |

Median means the median of each run's worst command latency, not a percentile pooled across
commands. Worst fps means the lowest run rate. Each directory retains `suite.txt`, including
its assertion failure. [`runs.json`](evidence/editor-core/perf/runs.json) records every exit
code. [`perf.json`](evidence/editor-core/perf/perf.json) is the third receipt, not the best run.
These observations do not qualify the editor under arbitrary host contention.

### Trace findings and changes

Before changing performance code, Chrome tracing and User Timing wrappers captured
[`profile-before`](evidence/editor-core/profile-before/perf.json): 176.5 ms cold open,
12.1 ms worst ready, 16.8 ms worst next rAF and 60.003 fps. This did not reproduce the old
167 ms stall. The trace did expose synchronous layout during refresh: 72 Layout events
inside 28 refresh calls, including reads of `clientWidth`, `scrollTop` and `scrollLeft`
after DOM writes. Story text changes also rebuilt that card's thumbnail canvas.

Geometry now comes from ResizeObserver entries after one initial measurement. Scroll
positions are cached in scroll handlers; refresh and render paths do no geometry reads.
Unchanged labels are not rewritten. Story text changes update existing text nodes and
retain the thumbnail canvas. Grouping and version commands share unchanged clips instead
of cloning 500 clip trees. A regression test checks sharing and snapshot isolation.

The final [`profile-after`](evidence/editor-core/profile-after/perf.json) trace contains
zero Layout events inside refresh, Story or Timeline rendering. Total refresh time across
28 calls was 40.1 ms versus 57.2 ms before; Story rendering was 9.4 ms versus 22.6 ms across
50 calls. These are instrumented runs under different host load, not controlled speedup
claims or replacements for the three acceptance runs.

That after trace also captured a real scheduling stall: one edit took 81.4 ms ready,
including **79.677 ms between SchedulePostMessage and the document worker's HandlePostMessage**.
The handler used 0.558 ms CPU and 0.560 ms wall time. Another worker dispatch waited
83.856 ms. No card rebuild or synchronous layout accounts for that queue delay. Its cause
beyond Chrome's task dispatch is unresolved. The same instrumented run scrubbed at 55.00 fps,
with 100 ms and 66.6 ms frame gaps and no >50 ms JavaScript long tasks. Keep this failure
alongside the faster runs; host scheduling is not an exemption from the budgets.

The repeated text-edit loop resumes immediately inside the preceding rAF callback. On the
measured 60 Hz clock, even a 2–4 ms edit then waits approximately 16.667 ms from its start
until the next callback. This explains the persistent 16.6–16.8 ms samples even before a
frame is missed; the unchanged <16 ms next-frame gate fails in every acceptance run. We
have not changed the frame clock, shifted the timer start, inserted phase delays, or changed
any threshold to turn that failure green.

Reproduce the trace and its summary:

```sh
FFS_PERF_TRACE=1 FFS_EVIDENCE=docs/evidence/editor-core/profile-local npm run test:perf
python3 tools/summarize-editor-trace.py docs/evidence/editor-core/profile-before \
  docs/evidence/editor-core/profile-after
# Decompress trace.json.gz to load it in Chrome DevTools Performance or Perfetto.
```

The optional wrappers run only with `FFS_PERF_TRACE`; acceptance runs have them disabled.
The [computed trace summary](evidence/editor-core/profile-summary.json) joins message trace
IDs and counts Layout events contained in method timing spans. Nested method counts overlap.

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

1. Resolve document-worker dispatch stalls under host load and the persistent next-rAF
   acceptance failure. Cold open and patch/layout passed three runs; the full gate did not.
2. Replace whole-clip-array patches for structural edits with bounded splice patches where
   they are proven correct. Current diff paths are safe but not maximally efficient.
3. Qualify command-to-presented-frame latency from compositor tracing. The captured Chrome
   traces include layout and paint work; CPU and rAF metrics still do not certify displayed pixels.
4. Qualify real proxy decode/audio/compositing separately. The synthetic test intentionally
   has no source video decode cost; its result cannot stand in for a media-engine benchmark.

Receipts: [three performance runs](evidence/editor-core/perf/runs.json),
[trace summary](evidence/editor-core/profile-summary.json), and
[editor workflow](evidence/editor-core/browser-after/browser.json). The original
[`node-perf.txt`](evidence/editor-core/node-perf.txt) and
[`node-tests.txt`](evidence/editor-core/node-tests.txt) predate these changes. Browser and real ACP screenshots and
JSON receipts live alongside them. The separate no-mistakes orchestrator was not run: this
repository is not initialized for it. These direct tests are not a claim of full pipeline CI.
