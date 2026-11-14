# Sound Atlas perf climb (rubric perf-climb-v2)

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
- `still`: the paused, whole-map frame differs from the incumbent's by no more than max(0.6/255, 1.5 x A/A).

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
| 1 (v1 run, v2 score) | c0937df | 5bb097d `?c=cssbg` | 0.703 [0.48, 0.848] | pass | **KEEP (pending zoomed-view gate)** | boat-perf/20261114-123924 |
| 1 | c0937df | 5bb097d lean writes (no flag) | 1.03 [0.909, 1.184] | pass | DROP: no sure gain | same |
| 1 | c0937df | 5bb097d `?c=defer` | 1.192 [0.901, 1.462] | pass | DROP: no sure gain | same |
| 1 | c0937df | 5bb097d `?c=cpu` | 1.152 [0.908, 1.433] | pass | DROP: no sure gain | same |

Round 1 notes. An identical A/A arm scored 1.14 [0.87, 1.49]. Frame times on the UHD 620 quantise to 16.7 ms steps, so 5
reps resolve only about 30% changes. `cssbg` raised dance fps on every rep (37-56 against 19-38 for everything else).
The `defer` "regresses drag.lat.p95" verdict is noise, because defer does not touch drag. The v1 motion gate failed
`cssbg` at 74% only because one loud base rep (0.78 against 0.21-0.37) inflated the pooled median. v2 fixes that.
The gate was changed after seeing this data, so `cssbg` must re-pass a fresh v2 run before it becomes the default.
