# PR #6 procedural qualification receipt

## Implemented scope

Read-only procedural metadata import and source inspector for issues #3/#4. No source editing/rebuild/voice flow is implemented. No new runtime dependency or performance-budget change was made.

- Rebased the original PR onto main `9e3bcda`, preserving hosted tests and procedural tests in the package.json conflict.
- ff-tracking pinned at `55abcd62a04c96eeb3ab51d7d75df64d068bd1e6`: 12 source-defined shots, 15 frames each at 30 fps; all seven source palettes; Cam/hero/size; all 180 exported focus samples with selected start/mid/end values.
- ff-unmute pinned at `3ba661da9b150433c277948f0c24b9033a5bfa96`: one 480-frame / 16-second continuous shot; 2,560 source waveform peaks; eight authored bars, 19 measured kicks, four score claps, 54 score tokens; twelve Catmull–Rom camera keys; source timing, hashes and credits.
- Actual importer executed into a temporary library, then both real-source sidecars exercised in an owned `--no-config` browser journey: no writable source inputs, save/migrate/reopen retains metadata. Original source tracked-file hashes before/after import match, and both original Git checkouts remain clean.
- The source-only canvas explicitly says **No rendered preview**. It does not masquerade as a locally rendered film.

## Actual source pipeline outcome

Both documented `tools/render.sh` scripts were attempted in isolated copies, using a writable Cargo home, clang and the examples' matching x264/FFmpeg environment. Both fail because the upstream non-Windows manifests enable Metal: `E0455: link kind framework is only supported on Apple targets` and `Metal/Metal.h file not found`; Skia's prebuilt also returns 404. Original source/manifests were not patched. Vulkan/GPU rendering was not reached.

Both `cargo test -p hud` suites pass (tracking: 3 tests; unmute: 4 tests). Tracking's tracks/camera helpers and SFX synthesis ran. Unmute's synthesis, measurements and HUD generation ran; regenerated HUD bytes equal the pinned source. ffprobe and decoded PCM confirm real stereo 48-kHz audio of 6 and 16 seconds. The generated event timestamps match their actual measurement/score exports; this is **not** video A/V-sync qualification.

The default films' generated code/media and MIT/OFL grants were audited, including nooga's optional MIT score (not used). No successful video means no honest video frame-count/contact-sheet qualification, proxy/poster, or published Example. The separate artifact manifest fragment is intentionally empty; metadata-only project records are not public examples. The shared examples output directory was not changed.

## Gates (all attempts retained)

| Gate | Result |
|---|---|
| `npm test` at final implementation | **PASS**: 64 Node tests, 9 Python tests, ACP security; 0 skipped Python media tests |
| Python rendered synthetic import | **PASS**: real FFmpeg-generated test clips → importer → playable proxy/poster; ffprobe checks 180/480 frames, 30 fps and audio; original fixture bytes preserved; no GPU |
| `bash scripts/check-no-local-paths.sh` | **PASS** |
| `git diff --check` | **PASS** |
| `npm run verify` | **Not consistently green**: seven full runs, 22 journeys each; run 3 passed all 22. The new procedural journey passed **7/7**. Other runs retain theme/context-menu timing failures; run 4 also timed out waiting for a decoded layout thumbnail. Latest HEAD run failed theme apply (99.2 ms) and menu work (33 ms). |
| `npm run test:perf` | **FAIL**, three attempts retained. Original budgets unchanged. CPU retime/restore-version tails were 799.2 / 20.3 / 107.9 ms in their respective failed runs. Final shipped JS is 60,645 gzip bytes, under the existing 150-KiB limit. |
| Independent browser perf | **FAIL**: cold open 420.1 ms; command-ready worst 115.7 ms; next-frame worst 122 ms; scrub 46.5 fps; splitter 35.2 fps; autosave CPU worst 39.4 ms. DOM stability/virtualization, gzip, scrub-no-longtasks and resize-no-longtasks pass. |
| Real-source local browser journey | **PASS in metadata-only mode**, not verified-render E2E; both sources migrated, saved and reopened |
| Optional real journey without inputs | **Clean SKIP**, no invented fixture result |
| 1896×880 inspector screenshots | **Reviewed visually**: tracking source/shot and unmute source/events/camera. First captures exposed an ambiguous generic canvas; final captures replace it with the explicit no-render notice. Long source data is intentionally internally scrollable. |

The host was shared and showed load averages around 30–37 during qualification. That is context, **not proof** that every timing failure is environmental. No budget was weakened, no unrelated process was stopped, and a single passing run is not presented as consistent performance qualification. This PR is **not fully gate-green**.

## Evidence location (outside Git)

The task's procedural artifact directory contains `out/LICENSES.md`, `out/import-receipts.json`, `out/before-import-hashes.json`, `out/audio-receipts.json`, `out/font-inventory.json`, `out/<id>/project.json`, `out/manifest.fragment.json`, raw build/HUD/audio/test logs and repeatable local scripts. Its sibling `ui-compare/issue-3-4/` contains all seven verify reports, the independent browser perf report and `real-final/` inspector screenshots/receipt. Paths are intentionally not machine-absolute in this committed document.

## Left

A compatible backend/host must render the pinned films, then pass actual video frame/fps/duration/audio and contact-sheet checks before public proxies/posters or manifest entries can be supplied. Performance gates need a repeatable green qualification without hiding these failures. Issue #3/#4's later working-copy source overrides, render jobs, voice controls, original-vs-remix comparison and faithful final A/V export remain out of scope and unimplemented.
