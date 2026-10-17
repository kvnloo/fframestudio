# Source-aware procedural fframes imports

This is the read-only ingestion foundation for [ff-tracking](https://github.com/mrsarac/ff-tracking) and [ff-unmute](https://github.com/mrsarac/ff-unmute), two films by Mustafa Saraç using [fframes](https://github.com/dmtrKovalenko/fframes) by Dmitriy Kovalenko.

Add entries to ~/.config/fframestudio/sources.json (adjust paths):

    {
      "library_root": "~/fframestudio/projects",
      "sources": [
        {
          "id": "tracking", "title": "ff-tracking",
          "kind": "procedural-fframes", "path": "~/src/ff-tracking",
          "render": "out/tracking.mp4", "build": "tools/render.sh"
        },
        {
          "id": "unmute", "title": "ff-unmute",
          "kind": "procedural-fframes", "path": "~/src/ff-unmute",
          "render": "out/unmute.mp4", "build": "tools/render.sh"
        }
      ]
    }

Render these sources first, following their READMEs. Then run:

    python3 tools/import_projects.py tracking unmute
    npm run bridge

## What is imported

- **ff-tracking:** scenes are taken from the SCENE_LIST and timing constants in hud/src/lib.rs. In the reference version, this produces 12 source-aligned, half-second shots. Labels carry the real source text and palette, without painting new text over already-baked frames.
- **ff-unmute:** the cinematic take is continuous. hud/src/generated.rs provides editorial SHOT_FRAMES markers and music events (KICKS, CLAPS, TOKENS). Editorial markers are not physical video cuts; kick onsets are not invented full-song beat markers.
- Both: library proxy/thumbnail generation uses the existing importer; the project carries an explicit read-only procedural metadata record with provenance, render dependency stages, and source timings. Migration to project/1 retains these records in metadata.

The importer **never runs the source build scripts or writes into the Rust project**. Missing output is skipped, edited project/1 documents are protected from re-import overwrites, and fps/duration mismatches fail rather than applying incorrect shot timings. The existing browser preview is a baked MP4, **not** a live GPU shader or native fframes export.

## Next slices

Source-aware camera/FX inspector, typed reversible controls, isolated render worker, audio analysis waveform and real export are follow-ups in [#3](https://github.com/kvnloo/fframestudio/issues/3), [#4](https://github.com/kvnloo/fframestudio/issues/4) and [#5](https://github.com/kvnloo/fframestudio/issues/5). Do not treat this import adapter as proof those features work.

Source-only regression tests (no GPU):

    npm run test:procedural
