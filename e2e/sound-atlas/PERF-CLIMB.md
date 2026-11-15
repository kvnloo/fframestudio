# Sound Atlas perf climb (rubric perf-climb-v5)

Goal: lower input latency and the frame-time tail (1% and 0.1% lows) without losing any animation quality or UX.
Every round changes one thing and either keeps it or resets it. The referee is frozen; changing it starts a new epoch
and a fresh baseline.

## Workload (perf-climb.mjs)

The phone profile is 390x844 @3x with touch and 4x CPU throttle. It runs untraced, because tracing skews pacing.

| Window | What it does | Metrics |
|---|---|---|
| dance | A bundled track plays with the whole map framed, 12 s | frame times: mean, p99 (1% low), p99.9 (0.1% low) |
| drag | 4 touch drags of 24 moves while playing | frame p99, move-to-committed-frame latency p50 and p95 |
| taps | 6 taps on the map while playing | Event Timing duration to next paint, per interaction: p75 and max |

Frames are pooled across reps, since 0.1% of one 12 s dance is under one frame.

## Quality gates (score-climb.mjs; a failure is DROP regardless of speed)

- No page errors.
- `density`: every canvas backing store has the same px/CSS ratio as the incumbent (catches a DPR cap).
- `motion`: the median of per-rep median dance motion is at least 75% of the incumbent's (v2; v1 pooled frames, and one loud rep moved the bar).
- `where`: the dance moves in the same places. The candidate must cover the incumbent's moving 4 px cells within
  5 points of the incumbent's own A/A share. This catches a frozen part, such as `?gpu=1` stilling the arms.
- `zoomWhere` and `zoomMotion` (v3): the same two checks, taken zoomed onto the playing track.
- `still`: the paused, whole-map frame differs from the incumbent's by no more than max(0.6/255, 1.5 x A/A).

## Noise guard (v4)

Every run carries an A/A arm named `aa` (the incumbent again). If the A/A objective CI is wider than 0.45, the run is
VOID and no verdict counts. Shared-iGPU Boat boxes are sometimes contended: round 3's first box ran one build at 7-60 fps.

## Paired reps (v5)

perf.sh interleaves arms inside each rep, so rep i of every arm ran in the same minute of the box. The bootstrap resamples
the same rep indices for candidate and incumbent, which cancels the box's drift. Round 3b's A/A CI went from [0.39, 2.42]
(unpaired) to [0.87, 1.23].

## Arm order (v6)

perf.sh rotates the arm order every rep (rep r starts at arm r mod N), so use a multiple of N reps. A run whose A/A
objective CI excludes 1 in either direction is VOID: identical code showing a sure difference means order or box bias.

## Keep rule

All gates pass. The objective must have a 90% bootstrap CI high below 1. The objective is the geometric mean of the
candidate/incumbent ratios of dance p99, dance p99.9, drag frame p99, drag latency p95 and tap p75. In addition, no
metric may have a CI low above 1.03, which would mean a sure regression.

## A round

```bash
bash boat/climb-bundles.sh <fframestudio repo> <incumbent-sha> <candidate-ref> $TMPDIR/climb-rN
HARNESS=perf-climb REPS=5 bash boat/perf.sh "inc=$TMPDIR/climb-rN/inc,cand=$TMPDIR/climb-rN/cand" \
  'base=inc aa=inc cand=cand?c=<flags>'
node score-climb.mjs runs/boat-perf/<stamp> base
```

Runs happen on Boat. A `large` box has an Intel UHD 620, which stands in for a weak phone GPU. Never compare its
numbers with groot's. Candidates ship behind `?c=` flags on the `perf/climb` branch of fframestudio. A KEEP becomes
the default in a follow-up commit, and that commit is the next round's incumbent. The phone feel check stays with the
owner.

## Ledger (append only)

| Round | Incumbent | Candidate | Objective [90% CI] | Gates | Verdict | Run |
|---|---|---|---|---|---|---|
| 1 (v1 run, v2 score) | c0937df | 5bb097d `?c=cssbg` | 0.703 [0.48, 0.848] | pass | KEEP pending a fresh v3 run | boat-perf/20261114-123924 |
| 1 | c0937df | 5bb097d lean writes (no flag) | 1.03 [0.909, 1.184] | pass | DROP: no sure gain | same |
| 1 | c0937df | 5bb097d `?c=defer` | 1.192 [0.901, 1.462] | pass | DROP: no sure gain | same |
| 1 | c0937df | 5bb097d `?c=cpu` | 1.152 [0.908, 1.433] | pass | DROP: no sure gain | same |

Round 1 notes. An identical A/A arm scored 1.14 [0.87, 1.49]. Frame times on the UHD 620 quantise to 16.7 ms steps, so 5
reps resolve only about 30% changes. `cssbg` raised dance fps on every rep (37-56 against 19-38 for everything else).
The `defer` "regresses drag.lat.p95" verdict is noise, because defer does not touch drag. The v1 motion gate failed
`cssbg` at 74% only because one loud base rep (0.78 against 0.21-0.37) inflated the pooled median. v2 fixes that.
The gate was changed after seeing this data, so `cssbg` must re-pass a fresh v2 run before it becomes the default.

Referee checks, run locally with 3 reps each (they confirm the gates fire; local speed numbers are not used):

| Arm | v3 verdict | Gate result |
|---|---|---|
| current build vs itself (A/A) | all gates pass | none failed |
| `?dpr=2` (v2) | DROP | `density`, `where` and `still` failed |
| `?gpu=1` (v3) | DROP | `motion` failed at 67% of the current build |

The zoomed `?gpu=1` frames looked like the current build's to a reviewer, and the zoomed gates passed. The rejection rests on
whole-map motion energy alone.

| Round | Incumbent | Candidate | Objective [90% CI] | Gates | Verdict | Run |
|---|---|---|---|---|---|---|
| 2 (v3, 8 reps) | c0937df | c683153 `?c=cssbg` | **0.719 [0.64, 0.816]** | all 7 pass | **KEEP**, now the default in 207c19e | boat-perf/20261114-134438 |
| 2 | c0937df | c0937df (A/A) | 0.982 [0.854, 1.137] | all pass | (noise floor) | same |

Round 2: dance fps 35 -> 56 (per rep: 38 34 38 38 35 35 41 30 -> 60 48 58 56 54 60 59 50). Dance 1% low 66.7 -> 33.4 ms,
0.1% low 83.3 -> 50 ms, mean 27.7 -> 18 ms, drag latency p95 165 -> 126 ms, tap p75 248 -> 208 ms.
The `?ab=` ablation run (boat-perf/20261114-133258) ran on a box that held about 60 fps, so every arm hit vsync and it
showed nothing. Boxes vary (37-56 vs 57-60 fps on the same UHD 620), so compare only within one run.
Round 3 incumbent: 207c19e (`perf/climb`).
| 3a (v4) | 207c19e | `?c=cpu`, `?c=defer`, both | - | - | **VOID**: noisy box, A/A objective 1.48 [0.73, 2.79] | boat-perf/20261114-142733 |

Shipped: the cssbg-only change on the product branch is `f30562b` on `feat/music-finder` (browse-e2e passes on it and on
c0937df; screenshot diffs sit only on labels and chips caught mid-animation). The production deploy waits for the owner's OK.
| 3b (v5, post hoc) | 207c19e | `?c=cpu` / `?c=defer` | cpu 0.407 [0.284, 0.957] KEEP; defer 0.553 [0.449, 1.017] | A/A 0.939 [0.87, 1.232] | v5 was written after this data: confirm on a fresh box | boat-perf/20261114-154701 |
| 3c (v5, fresh box) | 207c19e | `?c=cpu` / `?c=defer` | cpu 1.293 [1.14, 1.67] DROP, fails where and zoomMotion (74%); defer 1.96 [1.44, 2.61] DROP | A/A 1.34 [0.945, 1.52], VOID by width | cpu's 3b KEEP did not confirm: **cpu and defer retired** | boat-perf/20261114-164424 |
| 4 | 207c19e | `?c=fit` (fitSubs: one measure pass, same swatches hidden; local 15.2 -> 4.8 ms per list render at 4x) | fit 1.358 [0.944, 1.607] DROP (no sure gain); tap p75 200 vs 208 ms [0.857, 1.0] | A/A 1.113 [0.881, 1.148] valid | **Referee saturated**: every arm 54-60 fps, the lows quantize to vsync (A/A 1% low x1.98). More resolution needs a harder workload or the real device | boat-perf/20261114-174428 |

Boat tap profile on the incumbent (boat-perf/20261114-183523, 2 reps): map frames dominate (frame 1411 inclusive: drawStatic
750, setFont 136 self) and the tap's list render is small (renderBody 154). The next candidates are in the map's draw pass.

## Workload epoch: THROTTLE=6 (from round 5)

At 4x every arm sits at vsync after cssbg, so the lows quantize (round 4). From round 5 on, timing runs at 6x CPU slowdown
(`THROTTLE=6`, set before seeing any round-5 data). Screenshots stay unthrottled. Ratios from different throttles never mix.

| 5a (v6, 6x) | 207c19e | `?c=font` (ctx.font set only on change, cached upper-case feel names: the pixel-neutral half of c=cpu) | font 1.177 [1.006, 1.355], confounded: it always ran last | A/A 1.268 [1.073, 1.52] excludes 1 | **VOID (order bias)**: a fixed arm order handed later arms a slower box. perf.sh now rotates the order per rep; v6 voids any run whose A/A CI excludes 1 | boat-perf/20261114-184006 |
| 5b (v6, 6x) | 207c19e | `?c=font`, rotated order, 9 reps | running | | | |
