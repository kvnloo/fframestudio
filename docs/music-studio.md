# Music studio: design

Status: proposal on `feat/music-studio`. Built so far: offline transcription (`tools/sound-atlas-score.py`),
`web/src/music-atlas/score.js` (notes → lanes, ABC, MIDI; 5 unit tests). The abcjs-in-a-box view is a
stopgap and is replaced by the paper skin below.

## The core

**Every song is an open document.** Today a track in the atlas is a sealed file. The studio opens it into
*lanes* (drums, bass, keys, voice, …) and gives each lane three faces that stay in sync:

| face | what it is | made by |
|---|---|---|
| sound | the stem audio | Demucs (exists, HF `sound-atlas-stems`) |
| notes | onset/duration/pitch per lane | MuScriptor (multi-instrument), SheetSage2 (lead sheet + chords) |
| voice | what renders the notes back into sound | a kit (samples), a synth, or a model (Magenta RT2, ACE-Step) |

Any face can be edited and the others follow: mute a stem and its notes dim; rewrite a bar on paper and a
kit or model re-voices that lane; swap a lane's voice for an 808 kit and it plays in the original mix. The
loop **listen → split → read → edit → re-voice → mix** is the product. Search, atlas, stems and remix
already cover the first two steps. This branch adds the rest.

The document is small and plain JSON: `{ track, grid: {bpm, meter, downbeat, key}, lanes: [{k, sound?,
notes?, voice?}] , provenance: [...] }`. Everything else in the studio, the agent included, is a plugin
that reads or writes this document.

## Everything is a plugin

One manifest shape, five kinds. A kit is a plugin with data and no code.

| kind | does | examples |
|---|---|---|
| `source` | brings tracks/sounds in | CC catalogue, ccMixter, Freesound (CC0 filter), your files (BYOM) |
| `analyze` | audio → facts | stems, transcribe, beat/key, **earshot** (describe, match, critique) |
| `voice` | notes → sound | sample kits (SFZ/SF2), smplr instruments, WAM 2.0 synths/FX, Magenta RT2, ACE-Step |
| `skin` | how the document looks | atlas night, **paper**, hardware skins (boombox, keyboard, camera, from the Blender studies) |
| `export` | document → elsewhere | MIDI, ABC/MusicXML, stems zip, **fframes soundtrack** |

Manifest (`plugin.json`): `id`, `kind`, `title`, `license`, `capabilities` (network hosts, gpu, audio-in),
and `actions`: typed entries in the **same shape as fframestudio `web/src/actions.js`** (`id`, `schema`,
`scope`, `destructive`, preview/apply/inverse). Code runs in a worker or sandboxed iframe (DESIGN §6). DSP
plugins use the open **WAM 2.0** ABI (40+ community plugins, works on iOS Safari), so we don't invent an
audio plugin format.

**AI-native** means the agent sees one `actionManifest()` covering every installed plugin and writes
proposals (`fframestudio.proposal/1`) over the document. "Make the bass a Reese and double the drums in
the chorus" becomes `voice.set {lane: bass, kit: reese}` plus `notes.copy {lane: drums, bars: 17-24}`. The
user reviews it as a diff on paper and taps once to apply. Hermes or DeepSeek reach it over ACP, as in
fframestudio today. A new plugin can be written by an agent, since a manifest plus one worker file is the
whole contract.

## Paper skin

Sheet music is not a separate viewer; it is a skin. Flip the theme and the whole app turns to paper:
cream ground, ink lines, engraved type. The Layers lanes become staves in the same lane colours, used as
ink accents. The playhead becomes a pencil line. The piano roll and the staff are two zoom levels of the
same lanes. Tapping a note plays it through that lane's current voice, so paper is an instrument and not
just a picture. Notation is engraved by our own renderer over the lane notes, using abcjs only as a
fallback.

## Phone

One focused surface at a time, summoned by context and dismissed when done (ephemeral):
- playing → transport + lanes; hold a lane → its voice, mute/solo, borrow
- paper skin → staff for the held lane; drag a note = pitch, swipe across a bar = select, two-finger = zoom
- "+" or voice → generate (prompt, or continue from here) with a lane picker
Physical metaphors come from the Blender studies (Sulumatrix grid, controller knobs, camera dials) and
the Taste audio-hardware bookmarks: detented knobs with haptic ticks, toggles that look latched.

## Kits and data (licence-checked)

Shipped as `voice` plugins (`web/src/music-atlas/voices.js`). Each one is a data-only manifest: a smplr
factory and preset, the lanes it fits, and its licence. Licences were checked against each sample set's
own README on 2026-11-14; the smplr library is MIT.

| kit (id) | samples | licence | lanes |
|---|---|---|---|
| Grand piano (`kit.splendid-grand`) | Splendid Grand Piano (sfzinstruments) | public domain | piano, other, guitar, vocals |
| TR-808 (`kit.tr808`) | Michael Fischer / Technopolis 808 set, 1994 | "absolutely free" (no formal licence) | drums (GM → 808 map) |
| Upright bass (`kit.upright-bass`) | D. Smolken double bass, pizzicato | CC0 | bass |
| Marimba (`kit.marimba`) | FluidR3 GM via midi-js-soundfonts | CC BY 3.0 | any pitched lane |

Next candidates, with the same check before adding:

| kit | format | licence | use |
|---|---|---|---|
| VCSL (Versilian) | sfz | CC0 (verified) | orchestral and world instruments; smplr `Versilian` |
| J. Learman Rhodes, Old Piano (FreePats) | ogg | CC0 (verified) | electric piano, honky-tonk piano |
| Big Rusty Drums, Virtuosity Drums (Karoryfer) | sfz/flac | CC0 | acoustic and jazz kits |
| Naked Drums (Wilkinson Audio) | sfz/flac | CC BY 4.0 | multi-mic kit |
| Freesound API | per sound | filter CC0 / CC BY | one-shots on demand |
| earshot forge | code-synthesised | MIT | procedural SFX kit, nothing to license |

Avoid ShareAlike banks (AVL/Sonor, the FluidR3 SA variants): ShareAlike binds derivatives.

## Models

| job | model | licence | notes |
|---|---|---|---|
| split | htdemucs_6s (running); BS-RoFormer in audio.cpp | MIT / Apache | |
| notes | MuScriptor small | **CC BY-NC 4.0** | ~1.5× real time on CPU (40 s in 61 s, 3 threads) |
| lead sheet | SheetSage2 | **CC BY-NC 4.0** | waltz test: Dm, 3/4, 121 bpm, chords plus melody |
| notes → sound | **Magenta RT2** | CC BY 4.0 | `pianoroll_file` conditioning, ~0.2 s control latency, streaming: the paper-to-sound bridge |
| songs, edits | **ACE-Step 1.5** | MIT | text2music, complete, repaint; the DESIGN §6 generation pilot |
| lyrics → song | YuE2 | CC BY-NC 4.0 | takes ABC (`cot=melody`), so it can sing a lead sheet |

All of these are wired in audio.cpp already. NC-weight output goes through the existing fail-closed export
gate (DESIGN §6): personal use is fine, and a commercial export is blocked until there's a commercial
transcriber.

## Back into fframestudio, fframes, earshot

- **fframestudio:** the studio is the `audio.catalogue`, `audio.generate` and `audio.analyze` families DESIGN §6
  already plans, and it adds `voice`, `skin` and `export`. It uses one actions registry and one proposal
  schema, so an agent edits a film and its score in the same proposal.
- **fframes:** the document's grid converts bars and beats to integer project frames. A fframes project gets a
  soundtrack lane, cut-on-downbeat snapping, and per-lane stems for ducking under voiceover.
- **earshot:** the studio's ears. An agent generates, then runs `earshot match`/`critique`, then refines. That closes the
  "AI can't hear what it made" loop for music. `forge` is a free kit source.

## Status

Done and covered by `npm run test:music-studio` (a headless phone browser against a bundle):
- `studio.js`: the lane document and the plugin registry. There are five kinds, and the action manifest is data only. `run` validates parameters before `apply`, and a proposal stops at the first failing command.
- Voices: tap ♪ on a lane, or have an agent run `kit.<id>/voice {lane}`. The lane's stem goes quiet, and the kit plays its notes against the `<audio>` clock, using a 200 ms lookahead and re-syncing on seek and pause. `voice.original/voice` gives the recording back.
- The paper skin (`skin.paper/apply`, or Paper in the top bar) applies to the whole app. The map uses its day palette, chips and the sheet use cream and ink, and the roll draws as a grand staff with G/F clefs, a drum line, a pencil playhead and ledger lines. Tapping a note plays it through that lane's voice.
- The agent entry is `window.__sa.studio` (`actionManifest`, `run`, `apply`).

## Next steps

1. Magenta RT2 `voice` behind a local bridge (audio.cpp), then ACE-Step `generate`.
2. earshot `analyze` plugin; fframes soundtrack export.
3. Expose the studio manifest over ACP, the same way fframestudio's actions are exposed, so that Hermes or DeepSeek proposals show up as a reviewable diff on paper.
4. Note editing on paper (drag = pitch), and loading third-party plugins from a `plugin.json` URL in a sandboxed worker.
5. Publish `scores.json` for more tracks (`tools/sound-atlas-score.py --push`).
