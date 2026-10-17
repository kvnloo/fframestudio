# Browser engine qualification — NO-GO for the proposed shipping stack

**Measured 2026-10-17.** WebAV 1.2.8, Diffusion Studio Core 4.0.3, Mediabunny 1.61.6. This is a standalone spike, not an integration into the editor. The recommendation in `docs/DESIGN.md §5` remains conditional.

## Decision

- **WebAV: NO-GO as the default preview/export engine.** Pixel-verified seeking is two frames early on the fly-through; `AVCanvas` has a hard-coded 30 Hz scheduler; this Chromium build cannot encode AAC; a nominal 20 s / 30 fps silent export contains **601**, not 600, frames. None of the requested high-resolution/high-FPS exports was faster than real time.
- **Diffusion: NO-GO for adoption in this build.** It produces the complete film, including transitions, title, music and the retained watermark. Its offline output has correct frame counts and excellent measured A/V alignment. But preview seek completion does not mean the requested frame has painted; random-seek error reaches **117 frames**, still **82** after a 500 ms settling experiment. The full run collected 1,525 page errors, including null-timestamp decoder errors. Its free watermark/key policy also needs a product decision before adoption.
- **Mediabunny: GO for a bounded media-I/O integration**, not a compositor certification. All **50/50** tested source seeks matched the independent FFmpeg frame index, maximum error **0 frames**. Broader format, VFR, rotation and mobile gates remain open.
- **Final export should be owned by the local bridge**, with replaceable render backends and mandatory output verification. Browser rendering remains useful where it preserves scene parity; native FFmpeg owns codec selection, AAC and final container validation. Do **not** claim native rendering is automatically faster: the tested PNG-capture path and fframes example are also below real time. Do not make fframes the arbitrary-document renderer until an actual adapter and fidelity tests exist.

## Environment and measurement boundaries

- Arch Chromium **153.0.8010.52**, Firefox **157.0.1**, Linux **7.2.9-1-cachyos**, NVIDIA **RTX 3080 Ti**, driver **615.71.9.0**. Node 26.7.0; npm 11.19.0.
- Chromium launched headless through Python Playwright with the requested `--ignore-gpu-blocklist --enable-gpu --use-angle=vulkan --enable-features=Vulkan`, plus autoplay and precise-memory flags. Separate browser processes/profiles; no host desktop interaction.
- CDP reports **ANGLE NVIDIA Vulkan**, accelerated canvas/compositing, but **`video_encode: disabled_software`**, and no hardware codec profiles. GPU rendering is **not** evidence of hardware H.264 encoding. Exact GPU receipt and launch command are in `evidence/webav-results.json`.
- This is a **shared, busy workstation**, not an isolated performance lab. Other jobs were using CPU, memory and GPU. Timings are observed single runs, not intrinsic limits or cross-machine benchmarks. Native x264 comparisons deliberately use two encoder threads; NVENC is also actually exercised. Repeat under controlled resource admission before setting product budgets.
- Three explicitly different workloads: **A**, a 20 s real-media film; **B**, a 2 s moving test pattern plus animated square for resolution/temporal tests; **C**, the existing fframes One Take film's first 2 s. Do not rank engines by comparing A, B and C as if they were the same scene.

## Fixtures and composition

`prepare.py` uses the requested local media, without committing or uploading it:

| Node | Source range | Timeline range |
|---|---|---|
| Hermes One Take proxy | 2–11 s | 0–9 s |
| GEV `moves/01-2.mp4` | 0.5–4.5 s | 8–12 s |
| CCTV TV704 | 1–10 s | 11–20 s |
| IBM Plex Mono title | generated from the repository font | 0–20 s |
| `drive-full.mp3` music | first 20 s, attenuated | 0–20 s |

Incoming video opacity ramps over 8–9 s and 11–12 s produce cross-dissolves. Source audio is muted; the separate music track is active. The audio fixture adds explicitly generated calibration chirps at 1, 10 and 19 s; matching visual flashes permit synchronization measurement. These are test signals, not fabricated engine output. A native FFmpeg-generated 1080p60 fixture provides distinct high-rate source frames; a 3840×2160 H.264 fixture tests 4K decode. The ordinary project proxies and GEV files are only 720p30/540p30; they must not be mislabeled native 1080p60 or 4K footage.

Both engines produced the layered film. The WebAV transition and final Diffusion export were visually inspected. Diffusion's text font units scale by three internally; the final mapping uses size 14 for a 42 px title. The final calibration flashes were moved to a black-backed bottom-right patch, away from Diffusion's watermark. Memory/seek receipts precede those title/marker-only corrections; final export receipts explicitly supersede the early oversized-title export. Offline export and preview are not assumed identical.

## Required gates

### 1. Random seeking: independent decoded-pixel oracle

Seed **424242**, 50 unordered times in 0.05–4.9 s. The oracle decodes **all 150** frames of the GEV fly-through with FFmpeg, scales them to 320×180, and selects the frame with lowest full-RGB MSE against each browser PNG. Expected frame is `floor(time × 30)`. Returned engine timestamps alone are not accepted as proof.

| Path | Requests | Maximum absolute frame error | Median / p95 request time | Median PSNR against expected frame |
|---|---:|---:|---:|---:|
| WebAV `MP4Clip.tick` | 50 | **2** | 114.9 / 268.1 ms | 19.39 dB |
| Mediabunny `VideoSampleSink` | 50 | **0** | 158.3 / 327.1 ms | 25.05 dB |
| Diffusion `Composition.seek`, immediate paint read | 50 | **117** | 0.52 / 2.75 ms | 22.95 dB |
| Diffusion + 500 ms settling and explicit update | 50 | **82** | 502.4 / 584.0 ms | 22.80 dB |

WebAV's frame timestamp often names the expected time while the **pixels are two frames earlier**. This is why a timestamp-only test would have falsely passed. PSNR includes browser/FFmpeg scaling and color-conversion differences; 25 dB does not certify color fidelity, but nearest-frame matching identifies the temporal frame. All 50 rows and PNG hashes are retained. No sparse-pixel approximation is used in the final result.

Diffusion receives a rational `floor(time*30)/30` time, avoiding its default rounding-to-nearest timebase. Inspection of its shipped implementation explains the fast-but-stale result: preview `VideoClip.update` starts `seekTo` but awaits it only for `OfflineAudioContext`. A product adapter must not implement a decode-and-paint promise by sleeping an arbitrary duration.

### 2. Real-time playback at 1080p30 and 1080p60

Four-second playback windows of the distinct-frame 1080p60 fixture, rendered at 1920×1080. Instrumentation propagates `VideoFrame.timestamp` through intermediary canvases and counts distinct source frames actually drawn to the output canvas, without pixel readback. Warm-up is excluded. Diffusion's experimental timebase is set to the requested 30/60 rate; WebAV exposes no equivalent.

| Engine / requested rate | Paint calls | Distinct source frames / required budget | Missing unique-frame budget | Distinct FPS |
|---|---:|---:|---:|---:|
| WebAV 30 | 117 | 104 / 120 | **13.33%** | 26.00 |
| WebAV 60 | 116 | 87 / 240 | **63.75%** | 21.75 |
| Diffusion 30 | 40 | 36 / 120 | **70.00%** | 9.00 |
| Diffusion 60 | 86 | 83 / 240 | **65.42%** | 20.75 |

These are output-canvas frame deficits, **not physical-monitor presentation telemetry**. They combine missed updates and stale repeats; the raw trace distinguishes paint calls from distinct frames. The busy host makes the percentages unsuitable as universal engine limits. An earlier WebAV run painted 108 distinct frames in each window, illustrating variance. Independent of load, shipped `AVCanvas` uses `1000/30` both for its ticker and timeline step: **60 fps preview cannot pass without upstream changes or replacing that scheduler**.

### 3. Twenty-second 1080p30 H.264 MP4 export and A/V sync

| Path | Wall time | Verified video | Throughput | Audio / sync result |
|---|---:|---|---:|---|
| WebAV, normal audio enabled | fails | no valid completed export | — | `AudioEncoder: Unsupported codec type` for AAC |
| WebAV, audio explicitly disabled | **24.191 s** | 601 frames; 20.033133 s; H.264 | **24.84 frames/s** | silent diagnostic only |
| Above + native AAC encoding/mux | additional **1.551 s** | still 601 frames | — | calibration A/V offset **+1 frame** at all three markers; within the requested boundary, but wrong total frame count remains |
| Diffusion, final film | **27.698 s** | **600 frames; exactly 20 s; H.264** | **21.66 frames/s**, 0.722× real time | **Opus**, not AAC; maximum calibration error **0.000625 frame** |

Diffusion silently selected Opus in MP4 when AAC was requested but unavailable. H.264 MP4 with audio therefore works for this alternative, but it is **not an H.264/AAC delivery file**. Verify actual streams instead of trusting requested config. Its audio stream is 20.020 s, 20 ms longer than video, still within one 30 fps frame. Chirp correlation after decoding detects no material progressive drift. The watermark remains visible.

`verify_av.py` fully decodes output audio, finds each white flash over its black backing, and correlates decoded audio against the known source windows. It reports sample-level offset at three positions, not merely equal container durations. The WebAV/native hybrid is explicitly not counted as successful browser audio export.

### 4. Five-minute random scrubbing

RSS sums the owned browser's CDP-reported processes, including its GPU process; shared mappings may be counted more than once. It is not exact exclusive physical memory. Samples every 10 s, no forced GC.

| Engine | Wall time | Seek calls | RSS start → end; peak | JS heap start → end |
|---|---:|---:|---|---|
| WebAV | 300.208 s | 1,646 | 1,134.0 → 617.3 MiB; **1,293.1 MiB** | 21.07 → 15.57 MiB |
| Diffusion | 300.095 s | 4,974 | 1,324.8 → 484.1 MiB; **1,324.8 MiB** | 12.12 → 9.37 MiB |

No monotonic memory growth was observed in this bounded test. This is not a lifetime-leak or low-memory-phone pass. Diffusion's greater seek-call count is not greater completed-frame throughput: its calls resolve before decode/paint, and the full run recorded **1,525** errors, chiefly null-timestamp reads. WebAV's recorded page error was the failed AAC export.

### 5. 4K input decode

The actual generated input probes as **3840×2160, H.264, 30 fps, 3 s**. WebAV loaded it and decoded the 1.5 s frame in **233.5 ms**; the decoded-frame timestamp was 1.5 s. Diffusion loaded the same source and produced a nonblank canvas after a 1 s settle; total request/settle time **1,039.1 ms**. That is decode feasibility, **not** proof of accurate Diffusion seek completion or sustained 4K real-time playback.

### 6. Firefox and basic WebCodecs matrix

Stock Firefox was tested headlessly via Selenium/WebDriver because the installed binary lacks Playwright's Juggler patch. The primary Chromium qualification uses Playwright as requested.

Firefox 157.0.1 exposes all four codec classes, reports H.264 encode/decode and AAC decode supported, but **AAC encode unsupported**. WebAV composition initialization succeeded; export returned **AbortError**. Do not describe modern Firefox as categorically missing WebCodecs. No Firefox performance/fidelity certification is claimed.

Current MDN compatibility data, fetched into `evidence/research.json`:

| API presence | Chromium / Edge | Firefox desktop | Safari / iOS Safari | Firefox Android |
|---|---|---|---|---|
| VideoEncoder / VideoDecoder | Chromium 94+; Edge mirror | 130+ | 16.4+ | absent in fetched data |
| AudioEncoder / AudioDecoder | Chromium 94+; Edge mirror | 130+ | 26+ | absent in fetched data |

API presence is not a codec matrix. Secure context, profile/level, OS codecs, encoder configuration and hardware preference require probing. Tested Chromium and Firefox both fail AAC encoding despite exposing `AudioEncoder`. Safari, mobile and Edge were **not run**. COOP/COEP headers are supplied for Diffusion/SharedArrayBuffer; CORS and origin-clean canvases remain deployment gates.

## Added performance gates

### Arbitrary resolution / FPS

Each output was probed after rendering. WebAV uses workload B (test-pattern video plus animated square, 12 Mbps, no audio), Diffusion uses the first 2 s of workload A (title/video/music, 5 Mbps, watermark). These establish capability and within-path throughput, **not quality-matched engine rankings**. Diffusion resizing tests dimensions, not a fully responsive layout policy.

| Engine | Requested output | Wall time for 2 s | Actual frames | Verified throughput | Faster than real time? |
|---|---|---:|---:|---:|---|
| WebAV | 1920×1080 @30 | 8.246 s | **61** | 7.40 fps | no |
| WebAV | 1080×1920 @60 | 15.262 s | 120 | 7.86 fps | no |
| WebAV | 3840×2160 @30 | 15.887 s | **61** | 3.84 fps | no |
| WebAV | 2560×1440 @120 | 15.139 s | **241** | 15.92 fps | no |
| WebAV | 1920×1080 @240 | 28.231 s | 480 | 17.00 fps | no |
| Diffusion | 1080×1920 @60 | 5.801 s | 120 | 20.69 fps | no |
| Diffusion | 3840×2160 @30 | 5.363 s | 60 | 11.19 fps | no |
| Diffusion | 2560×1440 @120 | 18.184 s | 240 | 13.20 fps | no |

WebAV rounds frame duration to integer microseconds: ffprobe reports `1000000/33333`, `/16667`, `/8333`, `/4167`, not exact rational 30/60/120/240. The extra terminal frame at 30/120 is a correctness issue, not bonus throughput. Exact frame-count and timestamp validation must be adapter requirements. These even dimensions passing does not promise every arbitrary dimension/profile is encodable.

### Temporal accumulation: render internally at 240, deliver 60/30

WebAV has no stock temporal-accumulation option. A bounded `IClip` wrapper in `performance.js` uses existing `OffscreenSprite.offscreenRender` at subframe times, accumulates four/eight samples in Canvas2D, and lets the normal Combinator encode at the delivery rate. It does **not** introduce a decoder or muxer. The animated square changes at every subframe; the 60 fps source video repeats between its source frames rather than inventing optical-flow frames.

| Path for 2 s at 1080p | Wall time | Delivered frames / throughput |
|---|---:|---|
| In-engine adapter accumulation 240→60 | **15.415 s** | 120 / **7.78 fps** |
| In-engine adapter accumulation 240→30 | **11.588 s** | 61 / **5.26 fps**, with WebAV terminal-frame defect |
| Render 240, then FFmpeg `tmix`→60 | 28.231 + 11.400 = **39.630 s** | 120 / **3.03 fps** end to end |
| Render 240, then FFmpeg `tmix`→30 | 28.231 + 14.071 = **42.302 s** | 60 / **1.42 fps** end to end |

The FFmpeg path mixes contiguous groups before selecting every fourth/eighth frame, resets timestamps, and verifies exact 60/30 fps output. Both paths visibly blur the moving square's edges; captured frames were inspected. Adapter accumulation is cheaper here because it avoids encoding, writing and decoding a 240 fps intermediate. This is 8-bit, gamma-space box averaging, not a linear-light/HDR or physically accurate shutter implementation. WebAV's timing defect and differing phase mean the two paths are **not certified pixel-equivalent**. Diffusion's built-in temporal accumulation was not implemented or claimed.

### Native comparison

| Pipeline | Workload | Wall time | Delivered throughput |
|---|---|---:|---:|
| Chromium deterministic canvas→60 PNGs | B, 1080p30, 2 s | 6.870 s | 8.73 captured fps |
| Above + FFmpeg x264 fast CRF18, 2 threads | B | **13.570 s** total | **4.42 fps** |
| Above + FFmpeg NVENC p4 / 12 Mbps | B | **13.893 s** total | **4.32 fps** |
| Existing fframes Rust/Skia Vulkan One Take→FFV1 | C, 1080p60, 2 s | **13.240 s** process wall | **9.06 fps** |
| Above + normalized FFmpeg x264/AAC | C | **19.266 s** total | **6.23 fps** |
| Above + normalized FFmpeg NVENC/AAC | C | **15.863 s** total | **7.56 fps** |

The fframes executable already existed and was actually run; no source rebuild was needed. Its SHA-256 is in `evidence/native-results.json`. The adjacent upstream checkout is at `30b48f3da60040e0fd7c811fdcd5b159e70a5b02`; **that is not a reproducible-build attestation for the existing binary**. The CLI reported 9.127 s internally, while process wall time including initialization was 13.240 s. Prefer the latter for job UX.

Both provided project build/export scripts were read. One Take and the theme-gallery project deliberately avoid fframes' H.264 feature because of their documented libx264 ABI mismatch and export an FFV1 master first. One Take's export script supplies `-r 60` **before** the master input. The first diagnostic transcode without that normalization produced only 117 frames. Repeating with that documented input-rate normalization produced **120 decoded frames, exactly 2 s**, with AAC; both corrected CPU and NVENC outputs are retained. This is a concrete reason for native frame-count verification, not evidence that native output is automatically safe.

PNG serialization/decoding dominates the tested headless capture path: merely swapping x264 for NVENC did not improve it. A raw-frame pipe or GPU-resident handoff is a next experiment, not a measured result in this spike. fframes workload C is not a port of this film and cannot establish browser/native visual parity. No tested complete path met the faster-than-real-time requirement.

## Maintenance and licences

Live first-party receipts are in `evidence/research.json`; the npm lockfile pins the actual packages used.

- **WebAV MIT**, public default head `42dd6fd65ccbda39c729265c14aab56ac4d28235`, still pushed **2026-01-10**, not archived. Five open issue entries: #482 large-source scaling blur; #480 proposed Mediabunny migration; #438 codec expansion; #377 audio noise; #60 question-writing guidance. These are upstream reports, not all reproduced bugs here.
- **242 fork records scanned; six newer push timestamps.** PiedPiper911 and caohongz are identical to upstream despite later pushes; NorthSage is behind; knoxlab is identical. `tetap` has a build-CI commit but is 259 commits behind. `AssistMelody` is two commits ahead (registry change and playback-speed fix, last pushed March 11). No reviewed, actively maintained drop-in successor was established. A recent push date alone is not maintenance evidence.
- **Mediabunny MPL-2.0**, not MIT. Preserve notices and make distributed modified covered-file source available under MPL; independent application files need not all become MPL. No watermark or company-size threshold was found in its core terms. Native/server extensions and their FFmpeg/NodeAV dependencies were **not adopted or cleared**.
- **Diffusion Core MPL-2.0** source, with a separate explicit README product policy: free use keeps **“Made with Diffusion Studio”** on rendered video; removal requires a purchased signed key. README says one-time/perpetual key, offline signature verification, no sharing with another organization, use across one's own apps/domains. This evaluation uses no key and retains the watermark; it does not bypass enforcement. Whether the additional marketed restriction is enforceable under the source grant is not decided here. Obtain written supported embedding/removal terms before a watermark-free product. Its Core repository's latest inspected commit remains **2025-11-18**; activity in the newer Diffusion editor is not Core maintenance.
- **OpenReel MIT** was checked as the other candidate (default commit October 3), but not built: the watermark-preserving Diffusion evaluation supplied the requested alternative. No OpenReel runtime qualification is implied.
- Preserve WebAV/third-party notices, font OFL notices and media credits. Local source footage/music and generated outputs remain **ignored**, not committed. No new right to redistribute those assets is asserted.
- Native FFmpeg build flags are retained locally in `artifacts/ffmpeg-build.txt`; this is a local execution audit, **not binary redistribution clearance**, nor a complete codec-patent/SBOM review. `npm audit` after updating dev tooling reports zero vulnerabilities; that is not a complete licence/security audit.

Sources: [WebAV](https://github.com/WebAV-Tech/WebAV), [open issues](https://github.com/WebAV-Tech/WebAV/issues), [Mediabunny](https://github.com/Vanilagy/mediabunny), [Diffusion README / pricing policy](https://github.com/diffusionstudio/core#pricing), [Diffusion LICENSE](https://github.com/diffusionstudio/core/blob/main/LICENSE), [OpenReel](https://github.com/Augani/openreel-video), [fframes](https://github.com/dmtrKovalenko/fframes), [MDN compatibility data](https://github.com/mdn/browser-compat-data).

## Recommended adapter boundary

`adapter.ts` is a **proposed, type-checked interface**, not a finished implementation.

1. **Canonical document stays engine-neutral.** Stable IDs, rational source in/out and timeline positions, attached text/audio references, transforms and versioned `cross-dissolve/v1` transitions. Never persist sprites, engine instances, blob URLs or decoder state. Attached layers resolve against parent clip edits in the document layer, not by hidden engine mutation.
2. **Compile an immutable render snapshot.** Include revision/hash, asset/font hashes, resolved attachment positions, explicit output dimensions/rational FPS/color policy and licence approval. Validate overlaps/ranges and report unsupported effects; never silently discard them.
3. **Separate `MediaIO` from `RenderEngine`.** Mediabunny probes/thumbnails/proxies in bounded jobs. One engine owns active preview decode; do not decode the active clip once in WebAV and again in Mediabunny. AssetResolver hands out revocable local leases; releases are explicit.
4. **`seek(frameIndex)` resolves only after decode and paint.** Return revision, actual source timestamps and painted-frame index. Abort stale generations, close every unused VideoFrame and enforce bounded caches/queues. WebAV microsecond conversion and Diffusion seconds/percent/font-unit conversions are adapter-local, never schema rules.
5. **Probe exact codec configurations.** Encoder/decoder and audio/video independently; requested dimensions, FPS, H.264 profile/level and audio sample rate are part of the probe. Report native-export-required versus review-only tiers. Never let Diffusion's AAC→Opus fallback silently satisfy an AAC request.
6. **Export is a job, not the preview clock.** The bridge owns the queue, cancellation, resource admission, safe local outputs, progress, capability routing and final ffprobe/full-decode/A/V checks. The renderer may be browser-based, fframes for qualified templates, or another adapter. The job receipt includes source snapshot hash, renderer version, frame/sample counts, output hash, wall time and diagnostics.
7. **Temporal sampling belongs to rendering policy.** Specify internal rational FPS, shutter fraction and accumulation method. Average before delivery encoding when supported. FFmpeg `tmix` is a fallback with explicit phase/color semantics, not something added to every export by default.

## What remains unqualified

The broader research §10 gates are not all covered by this desktop spike: VFR/rotation/long-GOP matrices, mixed audio sample rates, missing/corrupt sources, empty timelines, fractional-rate endurance, cancellation/GPU-loss recovery, low-memory phones, Safari/Edge/mobile, native template parity, shell packaging, collaboration and release-level licence inventory. Do not ship on the strength of the passing subset. The next engine experiment should fix/prove decode-and-paint completion and exact rational frame scheduling before adding more effects.

## Reproduction and receipts

See `README.md`. `evidence/summary.json` is computed from actual receipts; raw seek rows, playback traces, memory samples, codec probes, ffprobe output, source hashes and first-party research accompany it. `evidence/local-artifact-manifest.json` hashes local outputs/frames without publishing their pixels. Generated media lives in ignored `artifacts/`; dependencies and fixture links are also ignored. Build, adapter type-check, Python compilation and dependency audit were executed; no production app files were changed.
