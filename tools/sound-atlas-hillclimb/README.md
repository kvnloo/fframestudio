# Sound Atlas hill climbs

The app gets better one measured change at a time. A round keeps a change only when the
scorer says the targeted category went up and nothing else went down.

This setup combines three sources:
- **Theo's method:** turn every failure and every "rage moment" into an eval case, then climb.
- **Karpathy's autoresearch ratchet:** a frozen evaluator, one change per round, keep or reset, log
  everything.
- **The Quackles / StreetIQ dream-loop lessons:** separate critic layers, pairwise judging in both
  orders, calibrate before trusting a model, and keep real-device feel as its own gate.

## Who it is for

`rubric.json` names three users:
- **Creator** (the main one): needs a song that fits the video, with its bpm, key, licence and
  credit, fast.
- **First-time listener:** opens a shared link on a phone.
- **Audiophile:** wants the measured truth and the ability to steer by it.

Phone first: 360, 393 and 412 px. Desktop is the side panel.

## What gets scored

Each category is scored on its own. Promotion never uses a blended number.

| Category | Scored by | What it means here |
|---|---|---|
| Gates (blocking) | code | 0 console errors, no overflow, nothing clipped, header and rail inside the screen at all three widths, e2e clean, unit tests pass, licences valid, shared DB left net zero |
| Owner cases | code | Every past correction and every journey failure becomes a pass/fail case. Once a case passes, it may never fail again |
| Journey | phone critic + code | The 17 stages in the journey map. Works = 1, rough = 0.5, broken = 0 |
| Motion | code + Opus panel on filmstrips | Every motion carries a meaning (what changed, where it went, that it registered). No hard cuts, no replayed entrances, transform/opacity only, reduced motion honoured |
| Haptics | code + owner on the phone | One pulse per gesture, at least 8 ms. A bigger commitment gets a stronger pulse. Holds show the ring |
| Meaning | code + Opus panel | Each channel means one thing (`skills/free-music-finder/references/visual-language.md`). Colour has one source. The map and the pane pair for every section |
| Utility | code + creator critic | Cold start to a usable song with bpm, key, licence and credit. Catalogue coverage for features and stems |
| Craft | code + Haiku critics | 44 px targets, WCAG AA contrast, no truncation, plain words |
| Perf | code (median of 3) | Time to ready, long tasks, shipped bytes. Real-phone smoothness is the owner's call |

## Run the scorer

```bash
python3 tools/sound-atlas-hillclimb/score.py http://localhost:8852/ <outdir> --journey <journey.json>
python3 tools/sound-atlas-hillclimb/film.py  http://localhost:8852/ <outdir> 393 852   # filmstrips for the motion panel
```

`score.py` writes `scorecard.json`, with every raw measurement plus a 0–100 score per category, and
lists the failing cases. It exits 1 if a gate fails. It also runs `steer_e2e.py`, `swap_e2e.py` and
`layers_e2e.py`, all locally.

**Never point the scorer at production.** Visits there inflate the live counters.

## A round

1. Read the latest `scorecard.json`. Pick the weakest category, ranked by deficit × how often a
   user meets the problem. Prefer a failing case over a vague score.
2. Make **one** change on a branch and commit it.
3. Run `score.py` on the candidate. If any gate fails, reset and log the round.
4. If the targeted category rose and no other category or passing case fell, keep the change.
   Timing metrics compare medians of 3 runs.
5. If the change adds UI or motion, run the pairwise critic: parent vs candidate side by side, in
   both orders, each with a fresh no-history model. A split is a tie, and a tie is not a win.
6. Log the round, kept or reset, in `ROUNDS.md`.
7. **Every 3 kept rounds:** the Opus motion panel and art-director panel review it, then the owner
   checks it on the phone.
8. If the same failure survives 2 rounds, change the mechanism, not the wording.
9. Equal score with less code is a win.

The evaluator is frozen. A climb never edits this directory. New cases are added in their own
commit, before the climb that targets them.

## Calibrate the critics before trusting them

Use the owner's own verdicts as anchors. The rejected and accepted states are in git:
- "this looks bad" before `7f388f2` vs after it
- "filters hidden offscreen" before `582504d` vs after it
- the slider flash before `fcebfa7` vs after it

Run each pair through each critic in both orders, plus one reversed control. A critic gates its
layer only if it picks the owner's side in both orders and never confidently picks the rejected
one. On StreetIQ, Haiku passed task and text, passed layout 2 of 3 times, and abstained on
brand/scene, so those went to Opus. Expect the same split here, and re-calibrate whenever the
model, the rubric or the evidence size changes.

## Models

| Role | Model |
|---|---|
| Builder (one change per round) | Claude Opus (Kevin's highest-rated). GPT models only through fx or pi with a contract brief, after passing their coding probe |
| Routine critics (journey, creator, craft) | Claude Haiku 5.5, once calibrated |
| Motion and art-director panels | Claude Opus 5.5 |
| Gates and cases | code |
| Feel | the owner, on the phone |

## Planned series

Ordered by measured deficit, then by how often users meet the problem:

1. **Broken journey stage 12:** borrowing a layer zooms the map out.
2. **Teach the map on first open:** journey 1, the `first_open_explains_dots` case.
3. **Plain words on the Track card:** journeys 8/9; the jargon list is in `rubric.json`.
4. **Chip at peek raises the sheet:** journey 5.
5. **Radio "next up" and "steered from … · undo":** journeys 16/13.
6. **Map/pane pairing for every Track section:** the open ask on #81.
7. **Motion with meaning:**
   - Sort lens changes fly dots to their new homes.
   - The playing dot breathes on the beat.
   - Haptic detents while dragging a meter.
8. **Desktop side panel:** journey 17.
