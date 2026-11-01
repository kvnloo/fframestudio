# Source-aware procedural fframes imports

Read-only ingestion and inspection of [ff-tracking](https://github.com/mrsarac/ff-tracking) and [ff-unmute](https://github.com/mrsarac/ff-unmute), films by **Mustafa Saraç**, using fframes by Dmitriy Kovalenko. This is not a source editor, GPU preview or final compositor. Python 3.11+ stdlib, FFmpeg and ffprobe are required; no runtime package was added.

## Import

Point `FFS_SOURCES` at a registry JSON. Use a temporary library for qualification; the importer never builds or modifies a source checkout.

```json
{
  "library_root": "<temporary-library>/projects",
  "sources": [
    {"id":"ff-tracking", "title":"ff-tracking", "kind":"procedural-fframes", "path":"<source>/ff-tracking", "render":"out/tracking.mp4"},
    {"id":"ff-unmute", "title":"ff-unmute", "kind":"procedural-fframes", "path":"<source>/ff-unmute", "render":"out/unmute.mp4"}
  ]
}
```

```sh
FFS_SOURCES="$TMPDIR/procedural-sources.json" python3 tools/import_projects.py
```

Run upstream `tools/render.sh` separately **in an isolated copy**, after reviewing dependencies. Missing renders are skipped by default. Only explicit `"source_only": true` imports without footage: no proxy/poster is generated, and the inspector says **Metadata only — no verified render or playable proxy**. Optional `artifacts` points to a build copy's exported tracks/measurements; its HUD bytes must match the source before that data is trusted. Re-import refuses to overwrite saved project/1 edits.

## Read-only inspector

Open **Source** in the film slate; the **Shot** tab also shows selected source fields above the ordinary editorial controls.

- **Tracking:** the reference `SCENE_LIST` provides **12 × 15-frame shots at 30 fps**, never scene detection. Its scene grid contains source text, kind, palette, hero baseline, size and Cam tilt/roll/zoom/pan/blur/shake. Paper, Thermal, Mono, Phosphor, Amber, Navy and Neon swatches use the actual five source colour stops. If `out/tracks.json` exists, the sidecar retains every frame's focus and shows each shot's start/mid/end focus. A hero baseline is not mislabeled as focal plane.
- **Unmute:** **one continuous 16-second / 480-frame take**, not 22 or 12 invented cuts. SHOT_FRAMES are editorial annotations. Show source-measured music.wav peaks, event tracks and exact sub-frame seconds, and the Catmull–Rom camera keyframe track/values. Frame conversion uses positive half-up rounding, matching Rust rather than Python banker's rounding.
- **Causality:** KICKS are measured kick-stem onsets. CLAPS/TOKENS are exported synthesized score event timestamps (token count is measured separately). The bar grid is authored 4/4 at generated score BPM, not detected full-song beats. Preserve this distinction.
- **Provenance:** source revision, source/measurement SHA-256, render dependency stages, author, engine and font credits survive migration and save/reopen. Tracking also credits **nooga** for its optional Slab score, explicitly marked not used by tools/render.sh.

Everything under **Source — read-only** is informational. Timeline/Words edit the editorial document/proxy, not baked glyphs, sound or shaders. The only writable source surface is the ff-unmute camera working copy below; tracking text/palette/camera, score, palettes and shader controls have no setter yet.

The adapter recognizes a bounded subset of Rust literal declarations; it never evaluates Rust or rewrites source. Workspace members, package/bin names, camera literals, arrays and rendered FPS/duration are validated. Unsupported forms fail closed. This shared sidecar is not a general Rust parser.

## ff-unmute camera working copy (#4)

Below the read-only source, **Studio working copy · overrides** edits `hud::camera`'s twelve Catmull–Rom `KEYS` as `metadata.proceduralOverrides` (`fframestudio.procedural-overrides/0`). `metadata.procedural` is never changed; the override records the imported `hud/src/lib.rs` SHA-256 and is refused if it disagrees.

- **Edit**: per-key `time_s`, `look_y`, `zoom`, `tilt_x`, `tilt_y`, `roll`, `dx`, `blur`. Key 1 stays at 0 s, keys stay ordered (≥ 1 ms apart), the last key ends by the film length, zoom is 1–20 (hud clamps < 1) and blur 0–20. Invalid values show an inline error and leave the document unchanged.
- **Beat-aware snap**: each key offers the nearest bar, kick, clap and token. Snapping uses the exact source seconds (sub-frame preserved; frames shown with Rust half-up rounding). Bars are the authored 4/4 grid, kicks measured onsets, claps/tokens score timestamps, as in the inspector.
- **Curve**: any camera field sampled with an f64 mirror of `hud::camera` (source dashed, working copy solid) over bar/kick/clap/token ticks. This explains the keys; it is **not a render**.
- **Dependency**: camera keys feed `hud::track` (flat's tracker boxes) and `hud::shot` (lens). The panel states that a change needs a Rust rebuild → flat pass → lens pass, and that `music/synth.py`, `music/analyze.py` and `music/gen_hud.py` stay valid. Nothing is rebuilt or rendered from the browser.
- **Same command everywhere**: `edit-procedural-camera` is in the shared action registry, so it is undoable, journaled, reviewable in assistant proposals and available from the palette (opens the Source table). Typed/voice grammar: “snap camera key 3 to kick 7”, “move camera key 4 to bar 3”, “set camera key 3 zoom to 2.75”, “reset camera key 3”. Open-ended requests (“make the camera dive into the bass”) ask for a precise action.

Write a saved project's overrides into an isolated copy:

```sh
python3 tools/procedural_overrides.py diff   --source <ff-unmute checkout> --project <project.json>
python3 tools/procedural_overrides.py export --source <ff-unmute checkout> --project <project.json> --out <new empty dir> --cargo-test
```

`export` refuses source drift (any recorded source hash), output inside/around the source and non-empty output. It copies the source's tracked files (no `.git`, `target` or `out`), rewrites only the `KEYS` literal, re-imports the copy to prove the camera keys round-trip and that score, events, waveform and timing are unchanged, optionally runs `cargo test -p hud` there, re-hashes the source, and writes `fframestudio-remix.json` (changed cells, hashes, hud test summary, required/skipped stages, `rendered: false`). Exit 3 means the round trip passed but hud tests failed; e.g. a camera that loses the tracked focus fails upstream's `the_camera_keeps_the_focus_in_frame`.

## Empirical Linux result

Pinned sources: tracking `55abcd62a04c96eeb3ab51d7d75df64d068bd1e6`; unmute `3ba661da9b150433c277948f0c24b9033a5bfa96`. Both non-Windows Cargo sections enable **Metal**, not Vulkan. After environment fixes (writable Cargo cache, matching x264/FFmpeg), both documented scripts failed on Linux:

```text
error[E0455]: link kind `framework` is only supported on Apple targets
error: could not compile `core-graphics-types` (lib)
fatal error: 'Metal/Metal.h' file not found
```

Skia's prebuilt also returned 404 before the Metal source-build failure. No backend/source patch was made under the environment-only rule. Vulkan/GPU rendering was not reached.

Both HUD test suites passed. Tracking's real tracks/camera/SFX helpers ran. Unmute synthesized/analyzed its actual audio and regenerated generated.rs byte-for-byte. Both pinned sources imported and opened in **metadata-only** mode without changing original tracked bytes. No video frame count, A/V sync, rendered contact sheet or playable public Example is claimed from these failed video builds.

Both films' default media are generated by code under MIT, © 2026 Mustafa Saraç; JetBrains Mono is SIL OFL 1.1. Tracking's optional score is by nooga, explicitly offered under upstream MIT, but not used by the default render. A public example still needs a successful render, full frame/fps/audio checks, retained notices and visual review; failed builds yield no manifest entries.

## Qualification

See [the measured qualification receipt](procedural-qualification.md) for actual source/build outcomes, repeated gate failures and the distinction between metadata-only inspection and render E2E.

```sh
npm run test:procedural
npm run verify
node test/verify-procedural-real.mjs
FFS_PROCEDURAL_LIBRARY="<temporary-library>/projects" node test/verify-procedural-real.mjs --out verify-out/procedural-real
```

Nine GPU-free Python tests cover literal parsing, stale renders, exact frame conversion, detector identity, importer execution, saved-project protection, and real FFmpeg-generated synthetic proxies with frame/fps/audio/poster checks. The committed synthetic generator feeds the real importer; the browser journey **procedural: ff-tracking 12 shots, ff-unmute one take + markers** checks shot/frame counts, palette names, waveform/events/keyframes, no source inputs, credits and save/reopen; for ff-unmute it also snaps a camera key to an event, rejects an invalid zoom inline, edits zoom (one undo step), checks the read-only panel is byte-identical, undoes/redoes, saves/reopens and exports the saved overrides to a working copy (with `cargo test -p hud` in the real journey). `test/test_procedural_overrides.py` (five tests) and `test/doc/procedural-camera.test.mjs` (seven) cover the export round trip/fail-closed rules and the command, snap, voice, proposal and rendering contracts. Synthetic fixture data is explicitly labelled; it is not a real render. The optional local journey skips cleanly without a supplied library, copies that library and starts only its own `--no-config` bridge. Its report distinguishes metadata-only inspection from verified-render E2E.

Remaining #3/#4 work: score/palette/audio-response overrides, ff-tracking overrides, the dependent render queue/cancel/cache, GPU previews, reconstructed A/V export and original-vs-remix synchronization. These are deliberately not shown as working controls. Camera-key overrides and their working-copy export are implemented as above; rendering a remix is still blocked on Linux (Metal manifest).
