# Rounds

| # | Commit under test | Change | Gates | Cases | Journey | Motion | Haptics | Craft | Perf | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1762084 | baseline (rubric sound-atlas-v1) | pass | 64 | 65 | 100 | 100 | 33 | 100 | baseline |

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
