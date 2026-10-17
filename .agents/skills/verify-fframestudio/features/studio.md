# Studio film desk

The default Studio theme presents the same editable document as a colourful film-production desk. Paper is its light counterpart. Shot timing, text, shared styles and all original commands remain ordinary undoable editor operations.

## Sub-features

- `studio-themes` adds Studio and Paper without removing Dark, Light, High contrast or Custom; Workspace persists the choice and the library shares it.
- `studio-poster` shows large display words, corner brackets, project name, preview status, frame timecode and available BPM/bar metadata. Generated shots use paper; source shots keep their actual media.
- `studio-slate` provides Shot / Narrative / Direction tabs. Shot retains timing, beat lock, editable words, replacement and shared-style controls. Narrative reads the selected shot. Direction shows real project values, styles, format and poster-sampled swatches; a shared-style card opens the corresponding existing style editor.
- `studio-timeline` uses stable type colours, a ruler, chapter labels, beat/shot markers and film/music credits. All 48 real-project shots fit at default zoom; long documents remain windowed. Attachments and trim handles remain available.
- `studio-waveform` reduces attached-track or embedded source-proxy PCM into 1,400 peak/RMS bins in a module worker, caches compact results by source SHA-256 (bounded to 32 sources), and displays no invented waveform when audio is absent.
- `studio-loop` loops the selected shot or the whole film, including fractional-frame and reverse boundaries.
- `studio-audio` mutes/unmutes actual source or attached soundtrack playback; audio analysis is deferred beyond cold open.
- `studio-screening` opens the canvas in browser fullscreen; Escape exits.

## How to get to it (user POV)

- Open any library poster. Projects with direction metadata initially show Direction; others start with Shot.
- Choose Shot, Narrative or Direction on the right. Arrow keys/Home/End navigate the tabs.
- Use Loop shot, Loop film, Mute and Screening room under the hero frame.
- Open Workspace to select any theme; the library also has a theme selector.
- Story, Takes (film versions), proposals, provenance and the assistant remain below the film desk. Story retains reorder, resize and collapse.

## Driving it with Playwright

Preconditions:

- `npm run verify` creates its own demo library and bridge. The original thirteen journeys remain intact.
- `node tools/verify-studio.mjs` additionally copies `~/fframestudio/projects/expresslane-i880` into a temporary library, creates a separately labelled audio fixture, and starts an owned bridge with `--no-config`.

- **Themes and tabs.** The `studio: themes, slate tabs, loops and screening room` journey selects Paper then Studio through `#theme`, verifies legacy options remain, opens each `[data-slate-tab]` and asserts `.direction-card`, `#narrative-pane blockquote` and `#duration` are visible in their respective tabs.
- **Loop boundaries.** Seek to the last frame, choose `[data-action="loop-shot"]` or `[data-action="loop-film"]`, Play, then wait for `window.ffs.frame` to wrap into the first half of the selected shot. Pause and turn looping off.
- **Mute.** Choose `[data-action="mute"]` and read `#preview-video.muted`, then restore mute.
- **Screening room.** Choose `[data-action="screening"]`, wait for `document.fullscreenElement.id === 'canvas'`, then exit fullscreen.
- **Real-library and visual proof.** Run `FFS_EVIDENCE=<evidence directory> node tools/verify-studio.mjs`. Inspect the six 1600×1000 library/demo/real-project screenshots in Studio and Paper plus the separate slate screenshots. Assert all 48 shots mount and all five colour slots occur.
- **Real waveform and cache.** The additional harness opens the labelled audio fixture, checks nonzero peaks/RMS and a visible `#audio-wave`, reloads, then asserts `window.ffs.studio.waveCached === true`. The source real project is checked byte-identical after the run.

## Gotchas

- A soundtrack title/BPM is metadata, not evidence that an audio file exists. Embedded audio is analysed from an available source proxy; attached-track playback and existing mapped video playback remain separate. Source-proxy peaks describe the source, not a newly composited/retimed final mix. The copied expresslane project supplies metadata but no soundtrack file/beat grid; its screenshot correctly shows shot markers, not a fake waveform.
- Direction metadata cards are informational, not a new preset engine. Shared-style cards lead to the existing undoable style-colour control.
- The demo's test-pattern video contains burned-in labels. The new title overlay does not erase or claim to recompose source pixels. Final video compositing/export remains explicitly unavailable.
- Wait for `window.ffs.doc.id` to match the requested project before driving a route change. A previous editor can remain in `window.ffs` while its successor opens.
- Story is below the hero now; scroll the panel into view before testing its native CSS resize handle. Persist its measured border-box width, not a fixed padding allowance.
- `npm run test:perf` measures main-thread paint readiness and next-rAF scheduling, not proof of compositor presentation.
