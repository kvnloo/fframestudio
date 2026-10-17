# Editor performance and recovery

The Studio film desk passes the existing performance runner in three final processes. The
thresholds and measurement phase in `test/editor-perf.py` and `test/perf/` are unchanged by this
branch. Previous failed measurements remain below as historical evidence, not the current result.

## Studio look qualification

Measured on the same 48-clip cold-open and 500-clip command/scrub fixtures, with autosave active.
No host processes were stopped and no browser scheduling flags, test thresholds or measurement
start/end points were changed. Fonts remain separate, locally hosted and `font-display: swap`.

| Measure | Final median | Final worst | Result |
| --- | --- | --- | --- |
| Cold navigation → interactive, including recovery lookup | 139.7 ms | 140.7 ms | PASS <300 ms |
| 500-clip command → main-thread DOM/layout ready | 9.0 ms | 9.2 ms | PASS <16 ms |
| Command → next rAF callback | 16.8 ms | 16.9 ms | PASS existing next-frame gate |
| Scrub rate | 60.003 fps | 60.000 fps | PASS |
| Scrub long tasks >50 ms | 0 | 0 | PASS |
| Shipped editor JS, Python gzip excluding ACP | 35,475 bytes | 35,475 bytes | PASS <150 KiB |
| Mounted Story / Timeline nodes for 500 clips | 7 / 28 | 7 / 28 | PASS windowed |
| Canvas and same-selection inspector identity | preserved | preserved | PASS |
| Autosave structured-clone / transaction setup | 4.7 ms | 4.8 ms | PASS <16 ms |

| Run | Cold | Worst ready | Worst next rAF | Scrub fps | Exit |
| --- | --- | --- | --- | --- | --- |
| [1](evidence/studio-look/perf-overlap-1/perf.json) | 140.7 ms | 9.0 ms | 16.8 ms | 60.003 | 0 |
| [2](evidence/studio-look/perf-overlap-2/perf.json) | 136.2 ms | 9.2 ms | 16.9 ms | 60.003 | 0 |
| [3](evidence/studio-look/perf-overlap-3/perf.json) | 139.7 ms | 8.7 ms | 16.8 ms | 60.000 | 0 |

The pre-existing runner gates next-rAF against 1.5× the measured median frame interval, with
main-thread work separately gated at <16 ms. These ~16.8 ms samples are the next callback on a
~16.7 ms clock, **not a claim of <16 ms compositor presentation**. No threshold was changed here.

The initial colourful-lane trial mounted 92 timeline nodes and missed next-rAF at 107 ms.
Long documents now retain the original minimum lane scale/windowing (28 nodes here), while
ordinary projects fit the film so the actual 48-shot project mounts all shots at default zoom.
Further cold trials measured 353.6/309.6/262.9 ms. Their receipts are retained. One had a 100 ms
project request queued alongside agent discovery; others spent most of the remaining time after
worker migration. Recovery opening now starts concurrently with DOM mounting, and direct-project
navigation waits for the project before discovering optional assistant agents. `interactiveAt`
still waits for the full recovery lookup and the root remains inert while loading. This is not a
controlled baseline/candidate speedup claim; it is the actual final qualification on this host.

Earlier candidate runs, including a 57.5 fps scrub sample accepted by the existing runner's
tolerance, remain under `evidence/studio-look/`. Final raw values and suite outputs are in the
three linked directories and [aggregate](evidence/studio-look/overlap-perf-runs.json).

`npm test` passes 43 tests plus ACP/bridge security checks. `npm run verify` passes all 14
journeys (the original 13 plus Studio controls), including recovery/conflict cases. The additional
editor workflow proves repeated native drags, command patch isolation, versions, resize/collapse,
legacy/custom themes and remapped shortcuts. The visual/audio harness proves all 48 real shots,
five type colours, narrow-shot selection, loops, mute, fullscreen, nonzero worker peaks/RMS,
cache reuse and byte-identical original project.json. See the retained [browser report](evidence/studio-look/verify-report.json)
and [visual/audio report](evidence/studio-look/studio-report.json).

Twelve 1600×1000 screenshots plus reference/Studio and reference/Paper comparison sheets live in
`/mnt/zer0models/project-artifacts/fframestudio/ui-compare/studio-look/`; they were visually inspected.
The ACP and browser test launchers now explicitly use `--no-config`; an earlier ACP launcher
omission was discovered during this work. Final tests were checked to leave the existing shared
bridge discovery file byte-identical. Do not restore a live bridge config from a captured test copy.

## Historical editor-core measurements

The sections below retain earlier measurements and their original failures unchanged.

## Reproduce

```sh
npm ci
npm run build:acp
npm test
npm run verify
npm run test:perf
```

`tools/verify-editor.mjs` owns a bridge on port 7879 (`FFS_PORT` overrides) and copies the
library into `$TMPDIR/ffs-editor-*`. It never edits production projects or bridge configuration.
`FFS_LIBRARY` chooses the source library; `FFS_EVIDENCE` chooses the receipt directory.
Chromium is `/usr/bin/chromium`; the perf browser uses Python Playwright through uv.

The synthetic document has 500 real clips with text and attachments, three seconds each.
The cold navigation opens a generated 48-clip fixture (`perf-48`, same clip count as the largest real project when the budget was set; override with `FFS_COLD_PROJECT`), with 48 clips
and 22,958 original JSON bytes. Migration tests copy every actual library project and
verify that the originals remain byte-identical.

## Three final runs

Measured 2026-10-17, Linux 7.2.9-1-cachyos, Node v26.5.0, Chromium 153.0.8010.52,
1440×1000 headless viewport, 60 Hz rAF. The acceptance runs have tracing disabled. No host
workloads were stopped, browser scheduling settings changed, phase delays inserted, timer
starts moved, or budgets relaxed. Autosave is active throughout the command and scrub tests.

| Measure | Required | Median of 3 runs | Worst of 3 runs | Result |
| --- | --- | --- | --- | --- |
| Largest-project cold navigation → interactive | <300 ms | 144.5 ms | 155.4 ms | PASS |
| 500-clip command → main-thread patch + DOM/layout ready, worst | <16 ms | 8.9 ms | 9.0 ms | PASS |
| Command → next animation frame, worst | <16 ms | 16.8 ms | 16.9 ms | **FAIL** |
| CommandStore CPU at 500 clips, worst | <16 ms | 6.476 ms | 6.634 ms | PASS |
| Scrub animation frame rate | 60 fps | 60.003 fps | 60.003 fps, 16.666 ms mean interval | PASS |
| Scrub long tasks >50 ms | 0 | 0 | 0 | PASS |
| Editor JS gzip, excluding ACP | <150 KiB | 26,811 bytes, Python gzip | 26,811 bytes | PASS |
| Mounted Story / Timeline clips for 500 clips | visible window only | 7 / 39 | 7 / 39 | PASS |
| Canvas and same-selection inspector identity during text edits | preserved | preserved | preserved | PASS |
| Autosave transaction setup and structured clone, worst batch | <16 ms | 4.6 ms | 4.6 ms | PASS |
| Autosave transaction completion, worst batch | report async wall time | 5.0 ms | 5.0 ms | recorded |
| Autosave batches per run | report count | 13 | 13 | recorded |

| Run | Cold open | Worst ready | Worst next rAF | Scrub fps | Node CPU worst | Autosave CPU worst | Exit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [1](evidence/next-frame/run-1/perf.json) | 144.5 ms | 8.9 ms | 16.9 ms | 60.003 | 6.634 ms | 4.6 ms | 1 |
| [2](evidence/next-frame/run-2/perf.json) | 155.4 ms | 9.0 ms | 16.8 ms | 60.003 | 6.476 ms | 4.6 ms | 1 |
| [3](evidence/next-frame/run-3/perf.json) | 131.4 ms | 8.2 ms | 16.8 ms | 60.003 | 6.420 ms | 4.6 ms | 1 |

Median means the median of each run's worst sample. Worst fps is the lowest rate. Each run
retains its complete `suite.txt`, raw `perf.json`, Node command timings and exit code.
[runs.json](evidence/next-frame/runs.json) retains the aggregate without rounding. The added
autosave CPU check does not replace or weaken any previous gate.

### Every command

Each cell is **median / worst milliseconds across the three runs**. For text edits, take the
worst of the 20 samples within each run before aggregating. Other commands have one browser
sample per run. The Node gate exercises the same named command set, plus undo and redo,
without DOM, storage or worker scheduling.

| Command | Node CPU median / worst | DOM/layout ready median / worst | Next rAF median / worst |
| --- | --- | --- | --- |
| add | 3.241 / 3.312 | 1.600 / 4.100 | 16.800 / 16.900 |
| select | 0.047 / 0.057 | 2.100 / 2.100 | 16.700 / 16.700 |
| move | 0.545 / 0.552 | 2.600 / 2.800 | 15.800 / 16.000 |
| trim | 3.550 / 3.665 | 5.700 / 5.900 | 15.700 / 15.700 |
| split | 0.647 / 0.648 | 2.400 / 2.600 | 13.500 / 13.600 |
| replace | 0.632 / 0.993 | 1.700 / 1.800 | 16.000 / 16.100 |
| edit-text | 0.531 / 0.754 | 2.800 / 2.900 | 16.800 / 16.900 |
| duplicate | 0.473 / 0.708 | 2.000 / 2.000 | 16.300 / 16.300 |
| group | 0.616 / 0.840 | 1.800 / 1.900 | 15.900 / 16.100 |
| set-beat-lock | 0.406 / 0.601 | 2.500 / 2.600 | 16.100 / 16.300 |
| retime | 4.338 / 4.463 | 4.200 / 4.200 | 16.200 / 16.300 |
| delete | 0.509 / 0.683 | 2.600 / 2.800 | 13.300 / 13.500 |
| edit-style | 0.577 / 0.619 | 2.500 / 2.700 | 15.500 / 15.500 |
| save-version | 2.764 / 2.820 | 3.600 / 3.700 | 16.300 / 16.300 |
| restore-version | 6.476 / 6.634 | 8.900 / 9.000 | 11.100 / 11.300 |
| undo | 0.052 / 0.068 | 5.500 / 5.600 | 15.700 / 15.900 |
| redo | 0.019 / 0.021 | 5.200 / 5.300 | 16.700 / 16.700 |

## Root cause and remaining failure

The earlier [after trace](evidence/editor-core/profile-after/perf.json) captured 79.677 ms
between SchedulePostMessage and HandlePostMessage for a document edit. The handler used
0.558 ms CPU and 0.560 ms wall time; another dispatch waited 83.856 ms. Those delays were
on the critical path because the editor waited for worker patches before updating views.

`Editor.run`, undo, redo and proposal application now commit synchronously to the main-thread
CommandStore and reconcile its patches immediately. A getter exposes that store's document;
there is no separately mutable view document or live worker copy. The stateless worker takes
explicit snapshots for migration, proposal preview, version comparisons, recovery validation
and persistence serialization. Worker replies cannot replace a command's painted document.

A regression test blocks worker replies and asserts the store and view are updated before
`run` returns. A real module-worker test compares exact documents after the same seeded 200
commands, including undo and redo, and checks history counts. Additional regressions preserve
edits during external migration and gate actions until the initial recovery lookup completes.

The [instrumented diagnostic](evidence/next-frame/diagnostic/perf.json), taken before journal
batching and the final recovery race fixes, measured 9.9 ms worst ready, 17.0 ms worst next rAF,
and 60.000 fps. Its [trace summary](evidence/next-frame/diagnostic/trace-summary.json) contains
**zero document RPC calls during the measured command loop**, zero document-worker dispatches
after that loop starts, and zero Layout events inside refresh, Story or Timeline rendering.
Refresh took 19.6 ms total across 27 calls, maximum 1.5 ms. The original
[compressed trace](evidence/next-frame/diagnostic/trace.json.gz) and failed suite log are retained.
This diagnostic is supplementary evidence, not one of the three acceptance runs above.

The final uninstrumented runs still fail at 16.8–16.9 ms. Their repeated edit loop resumes
inside the preceding rAF callback. On the measured 60 Hz clock the next callback is roughly
16.667 ms later, even when synchronous editing finishes well before it. Removing the worker
round trip removes that queue from painting but does not make this unchanged test satisfy
<16 ms. Work stopped after the three failures; the threshold and sample phase remain intact.
The previous acceptance runs had 19.1 ms median and 19.6 ms worst next-rAF latency and also
failed. See their [original receipts](evidence/editor-core/perf/runs.json). These observations
under different host load are not a controlled speedup claim.

## Autosave and recovery

Each committed content command enqueues its command and resulting document revision for
IndexedDB. Selection and empty undo/redo do not dirty or journal the document. A 250 ms debounce
has a one-second maximum wait during continuous editing; durable writes use idle callbacks
with a one-second timeout and batches of at most four commands. A partial durable prefix can
be replayed after a crash. Command painting never waits for storage. The diagnostic's single
12.5 ms journal burst motivated batching; the final batches used at most 4.6 ms of synchronous
transaction setup and structured-clone work on this fixture, with 5.0 ms async completion.
This is measured evidence, not a guarantee under arbitrary contention or command size.

The journal is keyed by the absolute project path and tied to the exact saved bytes' SHA-256
and document revision. Reopening offers **Recover unsaved changes** or **Discard**. Recovery
validates revisions in the worker, then replays commands through `Editor.run` and normal
CommandStore history. Persisted undo/redo actions also record their resulting patches so they
can replay when the original in-memory history predates the saved file. Replayed actions
are undoable. Recovering and discarding leave project.json unchanged.

Save serializes a captured document in the worker, durably records its candidate hash/revision,
and still PUTs through the bridge with `x-ffs-expected`. A successful save checkpoints only
commands through the captured revision. Later edits survive. If the page dies after PUT reaches
disk but before acknowledgement, the prepared hash recognizes that file and preserves later
journal entries. Unrelated external hashes are not silently replayed or overwritten. External
changes while recovery is pending preserve the offer and require conflict resolution before Save.

The debounce and unfinished batches leave a crash window for entries that have not committed.
Recovery is local to the same browser profile and origin. Storage/quota failures are reported;
explicit Save remains available. An unrelated disk version retains the old journal and reports
recovery as unavailable. No automatic background write changes project.json.

## Verification and measurement boundaries

`npm test` exits 0 with 38 document tests plus the bridge/ACP security checks.
`npm run verify` exits 0 with all 13 journeys, including six recovery journeys. The
[verification report](evidence/next-frame/verify/report.json) and
[test log](evidence/next-frame/tests.txt) are retained. The recovery journeys prove title
restoration after closing a page, unchanged disk bytes until explicit Save, expected-hash PUT,
undo/redo, discard, edits during Save, undo across Save, crash after PUT before acknowledgement,
and an external change while recovery is pending. The
[recovery offer](evidence/next-frame/verify/06-recovery-offer.png),
[restored title](evidence/next-frame/verify/06-recovery-restored.png) and
[mobile screenshot](evidence/next-frame/verify/05-mobile.png) were visually inspected.

* Cold open uses a fresh page with CDP cache disabled. `interactiveAt` follows migration,
  view mount, event binding and recovery lookup. Lazy thumbnails and decoded media are excluded.
* `ready` includes synchronous command application, validation, diffing, DOM updates, journal
  enqueueing and a forced layout flush. It measures readiness, not GPU presentation.
* `present` ends at the next rAF callback. It is a scheduling diagnostic, not proof of physical
  screen presentation. True compositor presentation remains unqualified.
* Scrub measures rAF intervals for two seconds and observes >50 ms main-thread long tasks.
  The existing frame-rate gate permits a 17.5 ms mean interval for clock jitter.
* Story and Timeline remain windowed. Text edits retain Canvas and Inspector identity.
  Thumbnail fetch/decode runs in a separate worker and playback updates the playhead without
  layout reads or DOM reconciliation.
* This synthetic workload excludes source-video decode, final compositing, audio mixing,
  waveform generation and SIMD workloads. It cannot qualify those unimplemented paths.

Remaining performance work is the strict next-frame failure and compositor presentation
qualification. Structural edits still use whole-array patches where necessary; bounded splice
patches would need separate correctness and end-to-end measurements.

## Correction: what "command → next frame" measures (2026-10-17)

The suite issues each command immediately after a `requestAnimationFrame` callback, then awaits the
next one. Command → next rAF is therefore about one vsync interval (16.67 ms at 60 Hz) **by
construction**, whatever the command costs: three runs gave 16.8 / 16.8 / 16.9 ms with zero command
RPCs and a 9.0 ms worst main-thread cost. A `< 16 ms` threshold on that number could never pass.

The gate now states what the user cares about: **the edit is presented in the very next frame**
(command → next rAF below 1.5 × the measured median frame interval, i.e. no dropped frame), and the
main-thread work is still held to `< 16 ms` by the paint-ready gate. No other budget changed.

## Context menus: measured open latency

Measured 2026-10-17 on Node v26.7.0 / Chromium 153.0.8010.52, Linux, 1440×900
headless viewport. The latest `npm test`, `npm run verify` and `npm run test:perf` all
exit 0. **The strict <16 ms menu rendering-opportunity budget is not consistently
qualified across repeated runs:** one of five final verification processes fails on a
17.6 ms tail. The gate remains strict; no frame-rate settings, budgets or sample phase
were changed to make it pass.

The reusable menu uses `performance.mark('context-menu:open')` before resolving actions
and building rows. `context-menu:ready` follows sizing, viewport clamping and focus.
`context-menu:first-paint` is marked in a zero-delay task posted by the next rAF;
`context-menu:open-paint` measures that first rendering opportunity, **not physical
compositor presentation**. It includes vsync wait and task scheduling as well as work.
The menu is paint/layout-contained and positioned with a transform on its own layer,
so clamping does not require a second position layout.

The new verify journey performs ten actual pointer right-clicks (first open plus nine
reopens), checks the menu is visible and the editor state is unchanged, and retains
both timings. It asserts both open-ready work and open-to-rendering-opportunity are
strictly below 16 ms. No warmup samples are discarded. The five runs below are sequential,
not an interleaved A/B: they do not establish an optimization speedup.

| Run | Open → rendering opportunity, median / worst | Open-ready worst | Verify |
| --- | --- | --- | --- |
| [1](evidence/context-menu/run-1/report.json) | 15.40 / 15.70 ms | 2.0 ms | 14/14 pass |
| [2](evidence/context-menu/run-2/report.json) | 15.45 / 15.60 ms | 2.2 ms | 14/14 pass |
| [3](evidence/context-menu/run-3/report.json) | 15.40 / 15.60 ms | 2.0 ms | 14/14 pass |
| [4](evidence/context-menu/run-4/report.json) | 15.60 / 17.60 ms | 2.1 ms | 13/14; strict menu deadline failed |
| [5, latest](evidence/context-menu/run-5/report.json) | 15.35 / 15.80 ms | 3.2 ms | 14/14 pass |

The [aggregate](evidence/context-menu/runs.json) is **15.40 ms median of run medians /
17.60 ms worst**, not a claim that all opens meet 16 ms. Latest open-ready work is
1.30 ms median / 3.20 ms worst. Shared-host load was 7.68 / 7.42 / 6.55 on 10 logical
cores before repeated measurement; other workloads and the user's bridges were left alone.
An [earlier failed run](evidence/context-menu/initial-failed/report.json) reached exactly
16.0 ms and is retained too. Failed reports predating the dedicated `context_menu` report
field contain the timing summary in their truncated error; future failures retain all samples.

An optional diagnostic (`FFS_MENU_TRACE=1 npm run verify`) captures CDP timeline events
around only those ten opens. Its [trace](evidence/context-menu/diagnostic/trace.json.gz) and
[summary](evidence/context-menu/diagnostic/trace-summary.json) precede layer isolation and are
not acceptance samples. They show 0.516–0.833 ms Layout, 0.569–0.922 ms Paint per open,
with the last Paint ending at 13.743–15.090 ms after open and the following task at
14.311–15.683 ms. Stage durations may overlap; do not sum them as CPU time. The dominant
wall-time component is waiting for rendering/task scheduling, not row construction. This
diagnostic cannot prove the later 17.6 ms outlier's compositor timing; reliable strict-tail
qualification remains open.

The latest [500-clip perf receipt](evidence/context-menu/perf.json) passes all existing
budgets: 160.2 ms cold open, 9.4 ms worst command-to-layout-ready, 17.7 ms worst next-rAF
against the unchanged next-frame gate, 60.003 fps scrub, zero scrub long tasks, and
30,289 shipped JS gzip bytes by Python gzip. `npm test` passes 38 document tests plus ACP
security, including assertions that discovery config bytes and mtime are unchanged.

The new 14th journey also checks keyboard seek against actual video time, Escape focus
return, native input/textarea/contenteditable menus, duplicate/undo/redo, beat-lock disabled
states, custom shortcuts, Canvas transport/clipboard and library source-path copy.
The final open-menu screenshots were visually inspected in
[dark](evidence/context-menu/menu-dark.png), [light](evidence/context-menu/menu-light.png)
and [high contrast](evidence/context-menu/menu-contrast.png); labels, shortcuts, focus and
separators are readable, and the bottom-right-clamped menu fits the viewport.

## System-theme qualification

Measured on the same Linux/Chromium host and 1440×1000 fixture above, with no changes to any existing
performance gate. Baseline was `8701715`; candidate is `feat/system-theme` (adapters, live SSE,
contrast normalization and isolated token mapping). This is a single before/after acceptance sample,
not a speedup claim or a controlled multi-pair benchmark. An exact-code replay is also retained below.

| Measure | Before | After | Budget |
| --- | --- | --- | --- |
| 48-clip cache-disabled navigation → interactive | 130.8 ms | 129.4 ms | <300 ms |
| Command → DOM/layout ready, worst | 9.9 ms | 8.9 ms | <16 ms |
| Command → next rAF, worst | 16.8 ms | 16.8 ms | existing next-frame gate |
| Shipped editor gzip, excluding ACP | 26,811 B | 30,068 B | <150 KiB |
| Theme GET during cold open | absent | 1.8 ms | parallel, never awaited by editor |
| Theme application, 30 fixture samples | absent | 0.6 ms worst | <16 ms |
| wal file rewrite → computed background, no reload | absent | 116 ms | <2 s |

The cold trace shows `/theme` starting at 38.0 ms, `/agents` at 38.2 ms and the project read at
38.9 ms. The verify run saw exactly one initial theme GET (775 transferred bytes), 1.7 ms duration.
The module is preloaded beside the existing editor modules; no new runtime dependency was added.
The 3,257 B gzip increase includes all shipped theme logic and settings/shot-type wiring.

Application timing uses `system-theme-start` → `system-theme-apply` performance marks, including
contrast preparation, all token writes and Workspace metadata updates. It performs no layout reads
or forced style flush. This is synchronous application work, **not compositor presentation**.
Real read-only palettes, 30 applications each:

| Desktop palette | Median apply | Worst apply | Text / panel contrast | Accent / panel contrast |
| --- | --- | --- | --- | --- |
| Noctalia | 0.2 ms | 1.9 ms | 10.12:1 | 7.38:1 |
| pywal / wallust | 0.5 ms | 1.1 ms | 9.51:1 | 4.95:1 |

The actual wal palette's small accent labels were too dim at the UI-only 3:1 threshold on visual
review. Because current `acc/warn/bad` tokens also render text, they now require 4.5:1; ANSI-only
shot borders remain 3:1. Workspace discloses the exact color adjustments. Both real editor
screenshots and the fixture before/live/fixed states were visually inspected: layout is unchanged,
Noctalia retains olive/gold surfaces, and wal retains its low-saturation slate/green identity.
No real desktop file was changed. Screenshots live in
`<local>/system-theme/`.

### Retained failures and receipts

One initial candidate run failed before measurement when the default-port bridge exited. The
harness did not retain stderr, so the cause is unproven; a private port (`FFS_PORT=18793`) was used
for subsequent runs without touching another process. A run made concurrently with a second
Chromium visual-capture job failed cold-open at **422.2 ms**; all its other gates passed. Its CSS and
module requests alone took about 108 ms. This failure is retained, not discarded or described as
passing. The first serial acceptance run exited 0 with 129.4 ms cold open and every existing gate
true. After adding direct dependency-injected GNOME malformed/missing-command tests, an exact-code
replay of verify + performance also exited 0: **122.6 ms cold open**, 9.4 ms worst DOM/layout-ready,
16.8 ms worst next-rAF, 60.003 fps scrub, all 14 journeys passing. The replay's theme application was
2.6 ms worst across 30 samples, and its live update took 108 ms without reload. Node tests were rerun
independently and all 53 passed. No budget, sampling phase, host process or browser scheduling setting changed.

- [Final exact-code replay perf](evidence/system-theme/final-perf.json) and [verify](evidence/system-theme/final-verify.json)
- [Baseline raw perf](evidence/system-theme/baseline-perf.json)
- [Passing candidate raw perf](evidence/system-theme/after-perf.json)
- [Concurrent-browser failed perf](evidence/system-theme/concurrent-browser-failed-perf.json)
- [All 14 verification journeys](evidence/system-theme/verify.json): exit 0, no console errors or failed requests
- [Node + ACP security test log](evidence/system-theme/tests.txt): exit 0, 53 Node tests
- [Real-palette contrast and application samples](evidence/system-theme/real-palettes.json)

Reproduce with `npm test`, `npm run verify`, and `FFS_PORT=<free-private-port> npm run test:perf`.
See [system-theme.md](system-theme.md) for provider paths and the read-only screenshot command.

### Rebase onto context-menu main

Rebased onto `55053d0` without removing either feature. The final sequence passes build (no
`web/dist` diff), 53 Node tests plus ACP security, the local-path check, three consecutive
**15/15-journey** browser runs, and the existing performance suite. Both original journey sets
are checked against the combined reports. The final perf sample records 127.3 ms cold open,
10.1 ms worst command-to-layout-ready and 16.8 ms next-rAF; every existing budget passes.

The combined journey keeps a context menu open during a wal fixture change and checks its
computed background changes without dismissal. It checks enabled labels and shortcuts at
4.5:1, including the focused row. An initial failure exposed an accent-mixed focus surface
outside the palette's contrast correction; system menus now use the corrected `bg3` surface.
Final minimum text contrast is 5.36:1 before and 4.56:1 after the update. The
[open-menu screenshot](evidence/system-theme/rebase/system-palette-menu.png) was visually
inspected: labels, shortcuts, focus, disabled entries and separators are readable and fit.

A further repeated run exposed a recovery-test ordering race: an external-change GET could
be intercepted before the released PUT reached disk. The test now awaits the actual successful
PUT response while retaining the blocked verification GET and all disk/recovery assertions.
[All attempt reports](evidence/system-theme/rebase/summary.json), including both failures,
and the final [perf receipt](evidence/system-theme/rebase/rebase-qualified-perf/perf.json) are retained.
No latency threshold or sample was relaxed.

Shared discovery configuration bytes and mtime remained unchanged across the complete final
build/test/three-verify/perf sequence. They do **not** match the initial pre-rebase snapshot:
the shared file was replaced at 13:36:06 CDT while rebase was paused, before rebase completed
at 13:36:57 and before this lane launched tests. It pointed to an exited ACP fixture bridge on port 7989. This lane did
not restore or write the shared file; the responsible process is not established.
