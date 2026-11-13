# Rounds

| # | Commit under test | Change | Gates | Cases | Journey | Motion | Haptics | Craft | Perf | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1762084 | baseline (rubric sound-atlas-v1) | pass | 64 | 65 | 100 | 100 | 33 | 100 | baseline |
| 0b | 06cb6c9 | parent re-scored after the scorer fixes (3-run majority, frame-synced scrub probe) | pass | 80 | 65 | 100 | 100 | 33 | 100 | new baseline |
| 1 | (this commit) | idle player line: "Tap a dot to hear it · 1,815 free songs" (was "1,815 free CC tracks") | pass | 87 | 65 | 100 | 100 | 33 | 100 | **kept**: first_open_explains_dots now passes; Opus text layer picks the candidate in both orders at 360 and 393; no layer picks the parent in both orders |
| 2 | d00b25f + diff | chip tap at peek raises the sheet to half | pass | 93 | 65 | 100 | 100 | 33 | 100 | **reset**: case passed, but Opus layout picked the parent in both orders at 360 and 393 ("the map stops being the hero"); art split/parent. Next try: sheet stays down, the player line names the result |
| 3 | e0217e6 + diff | idle player: **Tap a dot** / *to hear it* (round 1's line ellipsized to "Tap a dot to h…" in a 78–130 px slot) | pass | 88 | 65 | 100 | 100 | 33 | 100 | **kept**: idle_hint_fits passes at 360/393/412; Opus picks the candidate in both orders on 7 of 8 layer×width verdicts (360 layout split) |
| 4 | 8884440 + diff | radio picks its next song ahead; the radio button says `next: "<title>"` and skip plays exactly that (6/6 verified) | pass | 88 | 65 | 100 | 100 | 33 | 100 | **reset**: radio_shows_next_up still fails, because the line lives only on the Community tab and the radio is usually started from the player. Next try needs the owner: show next-up in the player, which displaces bpm · key · artist while the radio plays |
| 5 | 4ba8084 + diff | Fable 5.2 M7 + M5 + haptic grammar: a tap selects in place (the map no longer re-aims); the pulse and a 'land' haptic arrive with `playing`, a ring draws in while the stream loads; a stream error keeps its toast and has its own pattern; haptic scale touch 12 / land 22 / press 35 | pass | 88 | 65 | 100 | 100 | 33 | 100 | **kept** under rubric v2 (Fable's haptic grammar: a commit is one pulse + one `land` at `playing`; `ppwait` is meaningful). v1 read the land pulse as a double tap (haptics 60, cases 81); both cards re-scored with `score.py --rescore`: candidate = parent on every category. Target (m75_probe, 360/393/412): camera move 0.0 px over 5 taps, 5/5 select and play, land haptic within 0-1 ms of `playing`, 403 toast still up 500 ms later. Opus: 8/8 layer verdicts split/tie (the stills differ only in visitor counters)
| 6 | 85bcabc + diff | Fable 5.2 M1 M2 M3 M4 M6 M8: sound starts on contact (warm on pointerdown); a loupe under a held slide; a feel's name lights it in place, names hold through the dance and point the way from the edge when zoomed in; a tick per feel border and per song a meter steer passes; the map scales with the sheet frame by frame; a video plays under the veiled map, synced to `playing`. Also: the header live pill drops its visits count when the row can't hold it (Motion was pushed off-screen at <=393 px) | pass | 88 | 65 | 100 | 100 | 33 | 100 | **kept, Opus pending**: candidate = parent on every category (scorer fix: a land pulse arriving before a commit's own pulse belongs to the previous tap; the parent read haptics 60 without it). Gates: parent failed edge_crossers (Motion), candidate passes. Target (`fable_probes.py`, 360/393/412): M1 down->playing median 352/318/334 ms vs parent 668/546/552 (back to back); M2 lens 63-100 px above the finger, audition = nearest 9/9; M3 lit in 21-67 ms, sheet 0 px, ink 0.89, 8 names every dancing frame; M4 1 tick per border, steer input 0.2 ms; M6 scale follows 23/23, 30/30, 36/36 frames, dot never leaves the free region; M8 video restarts 42-82 ms after `playing`, 62-68% of the height at peek. Opus pairwise could not run: the local Hermes install was mid-update (`Gateway draining: update_paused`) |

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
