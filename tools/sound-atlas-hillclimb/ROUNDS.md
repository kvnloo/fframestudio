# Rounds

| # | Commit under test | Change | Gates | Cases | Journey | Motion | Haptics | Craft | Perf | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1762084 | baseline (rubric sound-atlas-v1) | pass | 64 | 65 | 100 | 100 | 33 | 100 | baseline |
| 0b | 06cb6c9 | parent re-scored after the scorer fixes (3-run majority, frame-synced scrub probe) | pass | 80 | 65 | 100 | 100 | 33 | 100 | new baseline |
| 1 | (this commit) | idle player line: "Tap a dot to hear it · 1,815 free songs" (was "1,815 free CC tracks") | pass | 87 | 65 | 100 | 100 | 33 | 100 | **kept**: first_open_explains_dots now passes; Opus text layer picks the candidate in both orders at 360 and 393; no layer picks the parent in both orders |
| 2 | d00b25f + diff | chip tap at peek raises the sheet to half | pass | 93 | 65 | 100 | 100 | 33 | 100 | **reset**: case passed, but Opus layout picked the parent in both orders at 360 and 393 ("the map stops being the hero"); art split/parent. Next try: sheet stays down, the player line names the result |

Baseline notes:
- **Failing cases:**
  - `first_open_explains_dots`
  - `track_card_plain_words` ("pct" shown while tuning, "Camelot" in the By-ear header)
  - `chip_at_peek_shows_list`
  - `radio_shows_next_up`
- **Craft:**
  - 44 controls under 44 px: rail chips and pins are 32 px tall, the brand link is 32 px.
  - The "32 Hz – 16k" range label is truncated.
- **Motion and haptics:** these score 100 on the code checks only. The meaning layer (the Opus panel on
  `film.py` filmstrips) and on-phone feel are not in these numbers yet.
- **Scorer fixes made before freezing:**
  - The title-glide sampler read a child element instead of `#pt`.
  - Meaningful per-change animations (`view-l`/`view-r`, `pt-in`) were counted as replays. They are
    now listed in `rubric.json` `meaningful_anims`.
