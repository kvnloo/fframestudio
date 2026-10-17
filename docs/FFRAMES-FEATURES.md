# fframes workflows → native fframestudio features

Evidence reviewed 2026-10-17. Companion: [ETHOS.md](ETHOS.md). Product constraints: [DESIGN.md](DESIGN.md)—web first, one document/command model, no Tern dependency, explicit capabilities, audited native execution, and optional fframes motion backend.

## Scope and evidence standard

This inventory covers the advanced techniques found in the named render-lab and theme-gallery projects, their recovered Claude Code/Codex history, a relevant Hermes research session, and the local upstream fframes skill. **It is not a claim that every historical conversation in every harness was recovered.** Each inventory row has a source, a native UI surface, an engine responsibility, effort and dependencies. New product implementations are proposals even where the original workflow was demonstrated.

Evidence levels:

- **Artifact:** inspected source/script/document or existing media metadata; not necessarily rerun here.
- **History:** a dated user request or assistant/delegate report; reports are not fresh test results.
- **Rechecked:** a check actually executed during this research.
- **Proposed:** not established as something we used. Section 6 contains exactly ten additional proposals.

Important qualifications:

1. **540 fps at normal playback speed ≠ rendering 540 frames per wall-clock second.** We explicitly noted offline rendering need not finish in real time. Use “540 fps normal-speed source” in UI/docs, not “540 fps realtime renderer.”
2. **Conform and blend are different operations.** Reinterpreting all 540 frames at 60 fps produces 9× slow motion; averaging groups of nine and retaining duration produces 60 fps motion blur. Frame dropping is a third operation.
3. Motion blur was already used: browser subframe accumulation and later linear-light blending. “Add motion blur” alone is not a novel proposal; controlled, cut-aware, per-layer shutter integration is.
4. The recovered fframes FPS port accepts **positive integer multiples of 60**, not arbitrary rational rates. Any-resolution/any-fps is a product goal, subject to backend capabilities, not a proved property of those crates.
5. The inspected gallery FPS-port worker explicitly could not build offline because Skia needed downloads. Later parent reports and surviving output files provide separate evidence; do not upgrade the worker's incomplete report into a successful build.

## 1. Evidence map

Local references here and any private session identifiers are not public product dependencies. Do not publish private recordings or session text as sample content without approval.

### Inspected artifacts

| ID | Exact source | What it establishes |
|---|---|---|
| R1 | `R/README.md`, `R/benchmark.md`, `R/research.md`, `R/compatibility.md` | Deterministic offline HTML rendering, measured fast/fallback paths, capability limits, timestamps, metrics and blur. |
| R2 | `R/demo/build.sh`, `R/demo/render-540.sh`, `R/demo/conform-60.sh` | High-fps source and 9× slow-motion delivery. These scripts are under **demo/**, not the project root. |
| R3 | `R/demo/hermes-x-tern/README.md`, `R/demo/hermes-x-tern/engine.js` | `window.__hf` seek/duration protocol, layered WebGL compositor, deterministic page animation and the early themed demos. |
| R4 | `R/demo/fframes-film/README.md` | Native 26-second fframes film: structured splash glyph/cell export, recorded time-lapsed sessions, theme colors, FFV1 master, font-glyph coverage and x264 ABI workaround. |
| R5 | `R/demo/one-take/README.md`, `R/demo/one-take/src/lib.rs`, `R/demo/one-take/src/main.rs` | Recorded session under a camera, musical timing, real event sequence, runtime-loaded footage/audio. |
| R6 | `R/demo/fframes-clips/README.md`, `R/demo/fframes-clips/src/lib.rs`, `R/demo/fframes-clips/src/{count,messenger,powers,take,again,green}.rs` | A family of shorts, shared camera helpers, real recorded UI, close-up stills and reuse of one recording. |
| G1 | `G/v2/BRIEF.md` | Music-first 13-shot design; readable holds, real gallery data, themes on accented beats, typographic system and final CTA. |
| G2 | `G/v2/music/build_track.py`, `G/v2/music/LICENCE.md` | Stereo soundtrack edit/resampling to 48 kHz, bar-aligned cuts/crossfades, low/high-band accent and spectral-flux analysis, WAV/beat-grid output and source attribution/license. |
| G3 | `G/v3/NUMBERS.md` | Frozen data counts, old→new mappings, slug-based skin schedule, deterministic hash-based frame-noise discussion, measured layout risks and explicit audit caveats. |
| G4 | `G/v3/review-1.md` | Frame-specific critiques; number overflow, tiny labels, wallpaper visibility, blur/blackout intent, audio peak/true-peak observations and follow-up fixes. |
| G5 | `G/v3/video/build.sh`, `G/v3/video/export.sh` | Skia Vulkan build environment, Cargo target cache, lossless FFV1 master, compressed delivery, optional audio remux and metadata probe. |
| G6 | `G/v3/video/review.sh`, `G/v3/video/extra-checks.sh` | Timeline and diagnostic reports; every-scene stills, consecutive strips, onion skins, cut/sync checks, waveform and finer layout inspection. |
| G7 | `G/v3/video/src/beat.rs`, `G/v3/video/src/lib.rs`, `G/v3/video/tools/generate-clock.py` | `at(bar, beat)`, authored-frame scaling, generated cue hashes, scene dispatch, deterministic grain time, ending fades and URL overlay. |
| G8 | `G/v2-hfr/enc540.sh`, `G/v2-hfr/encblend.sh`, `G/v2-hfr/encslow.sh`, `G/v2-hfr/cutchk.sh`, `G/v2-hfr/video/check.sh` | Explicit 540/180/60 workflows, linear-light multi-frame blend, silent slow motion, output metadata and sampled unique-frame/cut checks. |
| G10 | `G/v2/study/x/x-lane-report.md` | Reference-film research report with source URLs, dates, tool attribution, measured durations and explicit sampled-frame/audio limitations. |
| G9 | `G/v2-hfr/logs/codex-final.txt`; `G/v3/fps-port-backup/film-fps.diff`, `G/v3/fps-port-backup/src-before/` | First port's disclosed build blocker and surviving v3 patch/baseline source directory. Later numerical comparison claims below are attributed to the recovered session report, not an independently repeated test or a recovered standalone report. |
| U1 | `R/upstream/fframes/skills/fframes-video/SKILL.md` | fframes CLI recipe: native render/preview/inspect, diagnostic exit semantics, strips/onions, audio reports, GPU builds and frame-range review. Local clean-profile skill search found no fframes-specific skill. |

### Recovered history

Derived from the maintainer's own fframes production sessions (private notes).

The recovered Claude sessions include subordinate Codex reports and fframes skill text. They also include injected task-notification wrappers, which are treated as report content, not direct user approval. No distinct Grok film-making session was recovered in this pass. Current-task Hermes sessions were excluded as circular evidence. The inventory does not assert that unsearched/unavailable history contains no other techniques.

### Fresh media metadata check

`ffprobe` was executed against the four surviving files in `G/v2-hfr/` on 2026-10-17. It confirms these **stream metadata values**, not full-frame visual identity, audio listening quality or rendering throughput:

| Exact filename | Video | Frames | Duration | Audio |
|---|---|---:|---:|---|
| `awesome-omarchy-themes-demo-540fps.mp4` | H.264, 1920×1080, 540/1 fps | 25,110 | 46.5 s | AAC, 46.5 s |
| `awesome-omarchy-themes-demo-180fps-blend.mp4` | H.264, 1920×1080, 180/1 fps | 8,370 | 46.5 s | AAC, 46.5 s |
| `awesome-omarchy-themes-demo-60fps-blend.mp4` | H.264, 1920×1080, 60/1 fps | 2,790 | 46.5 s | AAC, 46.5 s |
| `awesome-omarchy-themes-demo-slowmo-9x-60fps.mp4` | H.264, 1920×1080, 60/1 fps | 25,110 | 418.5 s | None |

The HFR render/encode scripts exist; a renderer was not rerun for this document. A recovered delivery message reports 14 unchanged 60 fps test frames and matching ninth-frame HFR samples; its wording does not establish the complete comparison coverage. These remain **historical report claims**, not new checks. Static scenes can legitimately repeat frames, so uniqueness must be checked against an expected-motion fixture, not imposed globally.

## 2. Shared native foundations

Effort **S** = narrow extension on an existing foundation; **M** = new bounded subsystem with integration tests; **L** = cross-backend architecture/qualification. These are relative scope estimates, not promised delivery dates. Dependencies are explicit so forty UI buttons do not become forty separate engines.

| Dependency | Shared engine boundary |
|---|---|
| D1 Clock/document | Rational time; stable object IDs; source, authored, sampling and delivery clocks; reversible commands. |
| D2 Render adapter | Deterministic `renderAt(time, spec)`; capabilities; media readiness; canvas/native/fframes bridges; cancellation. |
| D3 Export jobs | Typed encode/mux graph, range jobs, progress, bounded resources, codec negotiation and artifact manifest. |
| D4 Assets/provenance | Content hashes, font/media readiness, dataset revisions, recording/source identity, licenses. |
| D5 Audio/music | Sample-accurate audio timeline, analysis cache, beat grid, cues, mixing and loudness. |
| D6 Motion/materials | Seekable curves/springs, camera, compositing, shaders, palette tokens and reusable scene modules. |
| D7 Review/evidence | Frame extraction, strips/onions, difference tests, inspection findings and approvals tied to revisions. |

Implement through DESIGN.md's one command/schema path. A drag, a settings form and an agent command must make the same validated document mutation; unsupported backend operations must remain visible. Native execution and arbitrary imported HTML need separate trust boundaries.

## 3. Inventory: rendering, rates, delivery and reusable footage

Every item below is evidenced as an artifact or historical discussion. The native implementation column is proposed product work, not an assertion of current fframestudio support.

| ID / technique | What we did, why it mattered, evidence | Native UI → engine piece | Effort / dependency |
|---|---|---|---|
| F01 Resolution/fps-parametric export | R1/R2 and the recovered session request 60/120/240/360/540 sampling and configurable dimensions; native films used 1080p and scene-aware fframes sizes. Avoided capturing in real time. Existing ports do not prove all resolutions/rational fps. | Export: independent width/height, aspect and rational fps fields, presets and support warnings → output spec and capability validation; sample by exact time. | **L**, D1–D3 |
| F02 Deterministic page composition | R3 exports `window.__hf = {duration, seek}`; the recovered session required `seek(i/fps)`. All elements can be placed at an arbitrary instant without playing intervening seconds. | “Import motion page,” time scrub and readiness diagnostics → isolated page adapter, explicit seek completion and frozen assets/fonts; no wall-clock animation dependency. | **L**, D1/D2/D4 |
| F03 Qualified fast capture with fallback | R1 compares HTML-in-canvas/WebCodecs against screenshot transport; reports much lower per-frame cost on the tested fixture. Canvas2D worked, WebGL was stale, WebGPU unverified; errors must not silently blank output. | Render path indicator, qualification report and explicit fallback selection → capability probes; direct canvas/VideoFrame fast path; retained screenshot fallback. | **L**, D2/D3/D7 |
| F04 Backpressure, timestamping and chunked jobs | R1 describes bounded encoder pressure, absolute frame-index timestamps, partial-range rendering and metrics. Avoids queue/RAM growth and drift. | Job panel with completed frames, queue/memory state, cancellation and scene-range export → bounded producer/encoder/mux pipeline. Resume from validated chunks is a further implementation step, not proved by partial ranges alone. | **L**, D1–D3 |
| F05 Direct 540 fps normal-speed source | G8 plus fresh media check proves 25,110 frames over 46.5 s. Provides distinct high-temporal-resolution samples for later treatment. | “High-fps source” preset with expected frames/duration and storage estimate → D2 sampling plus codec/container qualification; no claim of wall-clock realtime. | **M**, F01/D3 |
| F06 Authored-clock-preserving FPS migration | G7/G9 retain a 60 fps authored grid: `f60`, `frame60`, `frame60f`, scaled cues, HUD, type timing, cut offsets and shader time. Merely changing `Video::FPS` would alter the film. | Project timing panel: authored clock vs output clock, “preserve motion” migration → rational time representation and same-instant comparison tests. Existing 60-multiple implementation is the migration reference, not the final general API. | **L**, D1/D6/D7 |
| F07 True slow-motion conform | G8 reinterprets every source frame: 540→60 becomes 9× duration, not frame dropping; its result intentionally has no audio. R2 also conforms, but one of its masters was deliberately sampled at 9× speed, so that conform restores the 26-second normal-speed film. Source time mapping must be shown, not inferred from a filename. | Retiming menu: “Conform every frame,” ratio/duration preview, explicit audio discard/stretch choice → timestamp remap and encoder/mux policy. Audio stretching is new work, not evidence from the silent file. | **M**, D1/D3/D5 |
| F08 Same-duration linear-light temporal blend | G8 `encblend.sh` converts to float linear RGB, averages nine samples for 60 fps or three for 180 fps, decimates and converts back to BT.709. Film retains 46.5 s and its score. | Export “temporal blend,” compare source/60/180; explain exposure window → color-managed accumulation, output cadence and A/V mux. Preserve the script's measured alignment as a baseline, but test cut boundaries explicitly. | **L**, D1/D3/D6 |
| F09 Direct subframe motion-blur accumulation | R3 uses six WebGL samples by default, a configurable shutter (default 0.5), float targets and gamma-2.2 accumulation/resolve, distinct from G8's intermediate-file blend. This is a power-gamma approximation, not proof of full color-managed transfer-function accuracy. Faster motion becomes readable without manually keyframing blur. | Motion blur controls and still/strip preview → evaluate D2 at subframe times, accumulate, normalize and handle endpoints. Baseline behavior must be measured per adapter. | **L**, D1/D2/D6 |
| F10 Lossless master + derived delivery | G5 renders FFV1 MKV before x264 delivery; G8 reuses a 540 fps master. Enables multiple exports without rerendering motion or compounding source loss. | Export profiles “master,” “review,” “delivery”; derivatives grouped under one render → cached immutable master, encode graph, disk cap and purge control. | **M**, D3/D4 |
| F11 Codec, pixel-format and audio policies | G5/G8 set x264 preset/CRF or bitrate, yuv420p, faststart, AAC bitrate, stream map and threads; master may need separate WAV. Platform compatibility and audio inclusion are explicit. | Advanced delivery panel with audio presence, color/pixel format and decoder support → typed validated settings; ffprobe/decoded-output checks. Avoid making a raw shell command the primary UI. | **M**, D3/D5 |
| F12 Skia Vulkan native path | G5 uses `clang`, cached Cargo target and a selected Vulkan ICD; R4/R5 and the recovered session report Rust/Skia rendering rather than Chromium screenshots. A setup recipe is not universal GPU support. | Optional native renderer selector plus diagnostics → capability-gated fframes adapter, controlled environment, pinned dependency/toolchain, CPU fallback disclosure. Web editing remains fully usable. | **L**, D2/D3 |
| F13 Shader-backed atmosphere | R3/G1/G7 use procedural halftone/contour/grain/background shader effects rather than baked animation everywhere. Grain uses a deliberately quantized authored clock. | Materials inspector with deterministic seed/time policy → shader uniform schema and supported CPU/GPU approximations; preserve semantic time across fps changes. | **M**, D1/D6 |
| F14 Real recorded sessions as footage | R5/R6 reference actual session clips, events and real rendered UI; text was not reconstructed as fake video. Builds can read large recordings and stereo scores at runtime rather than compiling them in. | Recording bin with source/time range and provenance badge → media decode plus event/session metadata, source hashes and path-independent relinking. | **L**, D2/D4 |
| F15 Camera over recorded UI | R5/R6 define camera marks in seconds, center coordinates and source-window width; `get_synced_video_frame` supplies the image. Converts a dense recording into a readable guided shot. | Pan/zoom camera overlay, focus rectangles and keyframes → seekable camera curves, source clipping and decode sync. | **M**, D1/D2/D6 |
| F16 Reuse one recording across treatments | R6's `again.rs` is explicitly one recording reused; other shorts share cameras/assets and real UI. Saves capture work and keeps demonstrations authentic. | Linked footage instances, treatments and sequences → source instance references with independent camera/retime parameters. | **M**, D1/D4/D6 |
| F17 High-resolution UI inserts | R6 `powers.rs` documents a real rendered moment at sixteen-times scale for close inspection; recorded clips and stills serve different purposes. Keeps text sharp during extreme zoom. | “Replace with source-quality still at marker,” source-scale warning → alternate representation linked to the same event/time, with bounded image memory. No promise of unlimited video zoom. | **M**, D2/D4/D6 |
| F18 Short-film family and reuse | R6 supplies differently paced shorts from shared footage/helpers; R4 is a longer native film. Reuse need not mean identical edits. | Sequence library, duplicate-as-variant, reusable shot templates → versioned scene instances and dependency-aware asset reuse. | **M**, D1/D4/D6 |

## 4. Inventory: music, motion, facts and visual design

| ID / technique | What we did, why it mattered, evidence | Native UI → engine piece | Effort / dependency |
|---|---|---|---|
| F19 Beat/bar clock with downbeat offset | G1/G7 use `at(bar, beat)`, BPM, beat seconds and first-downbeat offset; cues round on the authored grid before scaling. R3 additionally uses `at(bar, tick)` for a swung 120 BPM score with frame-aligned triplets. Prevents hand-entered seconds drifting from the score. | Musical ruler with bar/beat snapping, fractional beats and editable offset → rational beat map/cue objects, stable rounding. | **M**, D1/D5 |
| F20 Audio analysis and explicit accent cues | G2/G7 contain kick/snare lists, score-derived cues, waveforms and measured onset information. Analysis makes timing repeatable, but the generated clock should not silently change with a rerun. | Waveform + detected onsets, accept/edit cue lane and analysis version → cached sample-domain analysis plus user-owned cues. | **M**, D4/D5 |
| F21 Bar-aligned soundtrack editing | G2 cuts TeknoAXE’s stereo track into 31 bars at 160 BPM, resamples to 48 kHz, places crossfades before bar lines to preserve downbeat attacks, applies a final fade and writes WAV plus beat/section/onset JSON. | Audio arrangement lane with source-bar ranges, crossfade audition and protected attacks → sample-accurate edit map, analysis and gain processing. | **L**, D1/D4/D5 |
| F22 Audio licensing/provenance | G2 records source page, author, CC BY 4.0 and modifications for TeknoAXE’s “Racket and Bang.” Delivering a film is not enough if attribution is lost. | Asset license fields, attribution preview and export credits checklist → source/license/derivative records tied to media hashes. | **S**, D4/D3 |
| F23 Procedural scores and visual/music co-composition | R3 synthesizes vibraphone, plucked bass and cymbals in NumPy; R5/R6 synthesize scores too. Notes, typing and scene beats share a clock. The READMEs explicitly say these scores were not listened to. | Audio lanes, instrument presets, note/cue audition and listening approval → deterministic synthesis/mix with sample placement, gain and A/V sync. Narration and automatic ducking are not established by these sources. | **L**, D1/D5 |
| F24 Loudness/true-peak review | G4/G6/U1 inspect volume, loudness, waveform and true peak; review flags a peak above the intended ceiling. Static frame review misses audio defects. | Audio report beside export, target profile and clip indicators → loudness/true-peak analysis and explicit gain/limiter processing. Limiter implementation is product work, not established by the report alone. | **M**, D5/D7 |
| F25 Music-first shot planning | G1's 13-shot plan assigns bars, premise, hold/release and transitions before final rendering. R5 favors one musical thought and story pacing over arbitrary metric cards. | Shot list with beat ranges, intent and approval notes → storyboard objects linked to timeline ranges. | **M**, D1/D5/D7 |
| F26 Seekable springs, easing and stagger | R4/R5/G1/G7 use springs, staged arrivals, wipes, type reveals and controlled settling. Time functions can be evaluated at any frame, unlike stateful incremental animation. | Curve/spring presets with settle preview, stagger and duration → deterministic analytic/sampled curves, no state carried from previous playback. | **M**, D1/D6 |
| F27 Deliberate hard cuts and black frames | G1/G4/G7 include fast cuts, a short planned blackout, an intentional gap, ending picture fade and URL fade. Warnings must not erase artistic intent. | Cut markers, blackout clip and “intentional” annotation → explicit cut topology and review waivers scoped to a revision. | **S**, D1/D6/D7 |
| F28 Readability through landing holds | G1/G4 demand a typographic hierarchy, clean type and enough time for dense screens. Fast motions lead to stable landing frames rather than constant movement. | Shot inspector with motion/hold phases and text-density warning → duration-aware annotations, hold/settle constraints and phone-scale review. Automatic legibility scoring is not yet evidenced. | **M**, D1/D6/D7 |
| F29 Palette-driven skins | R3/R4 preserve the product’s actual colors and recorded theme variants; G1/G3 drive the film’s ground, ink, accent and HUD from theme data and preserve a 78-skin schedule by slug and beat despite catalogue growth. Theme choice is data, not hardcoded paint sprinkled through scenes. | Theme track and token editor, palette swatches and timed changes → semantic color tokens, palette assets and theme events. | **M**, D4/D5/D6 |
| F30 Real theme cards and wallpaper selection | G1/G3/G4 use real palette data/wallpapers, keep slugs stable and flag decode/duplicate/image issues. Wallpaper placement can fail even if a file loads. | Theme asset browser with palette/preview/alternate wallpaper and provenance → validated catalogue import, image fallback and content-safe crop. | **M**, D4/D6/D7 |
| F31 Data-bound motion graphics | G3 audits 166→640 themes, 4,814→18,560 colors, 32→138 blue themes and narrower barcode stripes. Derived labels and layouts must change together. | Dataset snapshot plus bound text/counts/filter values and data-diff preview → typed derived expressions and responsive layouts, not string replacement. | **L**, D1/D4/D6 |
| F32 Fact-check ledger | G3 `NUMBERS.md` records source revision, build/count caveats, mappings and unchanged skin identities; G4 catches a now-overflowing headline. Prevents attractive but false claims. | Claims panel: displayed value, source pointer, transform, freshness and approval → versioned claim bindings with invalidation when data changes. | **M**, D4/D7 |
| F33 Data-preserving visual revision | G3/G4 distinguish a data update from an unauthorized redesign; parent review restores v2 fly-through geometry for a sampled larger dataset. Fixing counts should not silently alter the approved film's motion. | “Update data only” mode, locked approved layout and impact report → stable object identities, semantic diff and region/time-scoped regressions. | **L**, D1/D4/D6/D7 |
| F34 Authored HUD/timecode distinct from output frames | G7/G9 keep the visible HUD on the authored 60 fps clock even when output is 180/540 fps; otherwise counters race and grain changes. | Counter inspector selects authored/source/output time → explicit clock binding for text and procedural noise. | **S**, D1/D6 |

## 5. Inventory: review, verification and repeatable production

| ID / technique | What we did, why it mattered, evidence | Native UI → engine piece | Effort / dependency |
|---|---|---|---|
| F35 Single-frame and scene contact-sheet review | G6 renders multiple fractions of each scene with time labels; U1 provides frame inspection without exporting the entire video. Reveals hierarchy, clipping and wrong states cheaply. | Review workspace: scene grid, scrub-to-tile and full-size still → deterministic D2 frame jobs and lossless cached thumbnails. | **M**, D2/D7 |
| F36 Consecutive strips | G6/U1 use `strip START END --step ...`, including tight fast-cut ranges. Sparse contact sheets cannot prove motion/readability. | In/out strip tool with frame-step, chronological labels and export → ordered neighboring samples, not evenly spaced scene thumbnails. | **S**, F35/D7 |
| F37 Onion skins | G6/U1 overlay a short frame range to expose trajectory, overshoot, spacing and timing. Static landing frames alone hide these. | Onion-skin toggle with range/opacity/colors → deterministic frame composite with time legend. | **S**, F35/D6/D7 |
| F38 Timeline metadata and per-scene diagnostics | G6 captures `timeline`, `inspect`, layout and report outputs. Reports locate scene boundaries, warnings and important frames. | Searchable validation panel linked to scene/time → structured findings with severity, evidence and revision, not scraped terminal prose. | **M**, D1/D2/D7 |
| F39 Cut-on-beat and semantic diagnostics | G6 runs `check --detect beat-sync,blurry,blackout,cut-on-beat --tolerance 1.25`; G4 discusses intended flashes/blackouts. The current script does not establish a universal meaning/unit for that tolerance. | Sync review overlay: nearest cue, delta in frames/ms, tolerance and intentional exceptions → audio cues + cut topology + explicit diagnostic units. | **M**, D1/D5/D7 |
| F40 Output frame-count/rate/duration audit | G5/G8 run ffprobe; fresh check confirms existing output counts. Sampled frame hashes/cut checks look for held or incorrect frames, without claiming full-frame validation here. | Export result receipt: expected/actual frames, fps, duration, audio and decoder checks → backend-independent artifact audit. | **M**, D1/D3/D7 |
| F41 Same-instant FPS regression | A recovered session requested 60-frame `n` equal 540-frame `9n`; a later report notes seven unchanged default frames and two 180-vs-60 matches, not every frame. Keeps animation semantics stable when sampling changes. | Compare two render specs at identical times → lossless frame pairs, strict/pixel-tolerant diff with declared backend and coverage. | **M**, D1/D2/D7 |
| F42 Revisioned critique and selective fixes | G4 records exact frames, weaknesses, changes and follow-up review; G6 extra checks target specific high-risk layouts. Treating a successful render as approval would miss these defects. | Time/region comments, before/after and resolved-but-not-approved state → revision-scoped findings and scoped rerenders. | **M**, D4/D7 |
| F43 Reusable one-command production scripts | G5/G6/G8 separate build, review, master, encode, slow motion and checks. R2 does the same for the browser demo. Reproducibility lives in parameters and dependencies, not shell-history memory. | Saved job recipes with dry-run/cost estimate and checked artifacts → declarative DAG, typed parameters, audit log and safe native executor. | **L**, D3/D4/D7 |
| F44 Pinning build environments and caches | G5 pins target/cache/ICD environment; a recovered session records fframes API/font/shader integration fixes and upstream experiments. Working code against one revision does not imply latest-main compatibility. | Renderer version/health panel and portable project manifest → adapter version contract, toolchain cache key and explicit rebuild. Do not silently edit upstream libraries during user exports. | **M**, D2/D3/D4 |
| F45 Generated cue provenance | G7 embeds the cue-file SHA in generated Rust; a recovered report says the v3 beat JSON was absent, so the updated generator was **not run**. Missing generators/input data are a reproducibility defect even if a compiled film works. | “Source of generated data” inspector, missing-input warnings and reproducible regenerate → input hashes, generator revision and generated-file verification. | **M**, D4/D5/D7 |
| F46 Native preview alongside offline render | U1 distinguishes interactive preview from CLI render/inspect; fast draft selection is useful without relaxing final export determinism. The exact preview renderer must be reported. | Draft-quality viewport plus full-resolution inspect → adapter-specific preview and final paths with same document semantics and visible capability differences. | **L**, D1/D2/D7 |
| F47 Reference-film study before design | G10 compares real public examples using source attribution, downloaded durations and sampled frames, while disclosing that motion/audio were not fully evaluated. Prevents generic style copying and invented aesthetic observations. | Reference board with time-stamped stills, provenance and observed/inferred labels → rights-aware media import, sampled-frame extraction and annotations; no automatic copying of private or copyrighted source assets into deliverables. | **M**, D4/D7 |

| F48 Structured UI export and glyph-safe fonts | R4 exports actual splash glyph runs and filled cells to SVG on a 174×45 grid, instead of inventing a lookalike; its Nerd Font contains required braille and box-drawing glyphs. | Structured-source import, glyph coverage and missing-font report → renderer export adapter, precise font asset binding and fallback refusal. | **L**, D2/D4/D6 |
| F49 True-resolution rendering and codec fallback | R1/R2 use device scale 2 for true 4K text, VP9 quantizer 16 when Chrome H.264 cannot start 4K540, then H.264/AV1 derivatives. R4 avoids an x264 ABI mismatch through FFV1 plus system FFmpeg. | Logical canvas vs render scale and codec diagnostics → resolution-aware assets, capability negotiation and audited encoder handoff. | **M**, D2/D3/D4 |
| F50 Loop-conscious opening and ending | R3 starts each short on its last card for half a second and resolves the score into the loop. Gives an attractive first frame and intentional replay rather than an accidental jump. | Loop preview, cover-frame selection and end→start strip → cyclic boundary sampling and audio-tail review. | **M**, D1/D5/D7 |
| F51 Scene-relative queries and machine-readable review | R5 accepts frames, seconds, m:ss, percentages, named scenes and scene offsets, with `--json`; drafts can render just one scene. Makes CLI/agent review precise without parsing prose. | Command palette and range picker supporting scene/time expressions → one typed time resolver and structured diagnostic API. | **M**, D1/D2/D7 |
| F52 Source/privacy and picture-license gates | G1 requires sanitized captures, forbids private gallery capture and permits pictured assets only when `picture_ok` is true; G2 rejects non-commercial music candidates. | Import provenance/license gate and export preflight → explicit approved-source/picture permissions, no ambient desktop capture. | **M**, D4/D3/D7 |

### Known limitations that must survive the migration

- R1's HTML-in-canvas measurements are fixture/backend-specific; WebGL stale capture is a failure, WebGPU is unverified, and DOM video requires readiness/seek discipline.
- G8 `cutchk.sh` and `check.sh` write some diagnostic failures using `|| true`; G6 writes all report output even when fframes returns diagnostic status 10. Native review must distinguish **completed with findings**, **failed to run** and **passed**. A produced report is not a passed gate.
- The first port did not compile successfully; the later v3 port had narrow sampled image comparisons and no full >180 fps render/audio-sync proof. Keep these qualifiers attached to the claim.
- G8's temporal filter is a concrete baseline, not a proven cut-aware shutter model. Window alignment, endpoint padding, color metadata and across-cut blends need separate tests.
- G3's gallery dataset build disclosed a failed discovery batch and used a seeded cache; “same counts twice” did not mean the entire upstream discovery process repeated successfully.
- G2’s license note names source bars 145–147 for its ending, while the inspected build script uses 65–67. Do not treat that stale edit-description detail as current truth; generate derivative credits/edit provenance from the current manifest. Both sources explicitly require listening before publication.
- G4's style judgments are human/model critique, not pixel tests. Not every observed flaw was proven corrected by this research.

## 6. Ten further techniques—explicit proposals, not recovered usage

These extend the evidenced techniques rather than relabeling them. UI and engine estimates share the foundations above.

| Proposal | Why it could improve the videos | UI → engine; effort / dependency | Acceptance experiment |
|---|---|---|---|
| P01 Cut-aware, per-layer shutter accumulation | Current blend windows can mix two unrelated shots or smear text. Keep moving backgrounds fluid while type remains sharp. | Shutter angle/phase, box/triangle weights, per-layer enable and “reset at cut” → subframe integration split by cut/layer; **L**, F08/F09/D6. | Fast pan, static text and hard cut fixture; no sample crosses the cut unless explicitly allowed; energy and timing checked in linear light. |
| P02 Perceptual small-text qualification | Data-heavy HUDs can be technically sharp but unreadable on a phone or after chroma subsampling. | Phone-size preview, minimum type/contrast warnings and rendered text heatmap → shaped-text bounds plus platform-scale/codec simulation; **M**, D4/D6/D7. | Known clipped/tiny/low-contrast strings fail; intentional decorative type can be annotated. Human reading test remains the arbiter. |
| P03 Per-platform delivery matrix | One successful 1080p file does not establish vertical/mobile/social playback behavior. | Multi-target export queue (landscape/portrait/square, codec/fps/audio limits) → versioned profiles, capability checks and final decoder audit; **L**, D3/D6. | A single document yields correct dimensions, frame count, audio and CTA visibility per target; unsupported HFR is visibly rejected or explicitly transformed. |
| P04 Automatic safe areas and semantic reframing | Automated crops can cut off faces, key UI or URLs. | Target guides, protected regions and suggested camera reframe → semantic anchors/constraints with manual override; **L**, D1/D6. | Landscape→portrait retains annotated critical regions; impossible fits report a conflict rather than silently cropping. |
| P05 Frequency-band audio-reactive motion | Beat cues give structure; envelope-followed accents can add detail without arbitrary pulsation. | Bass/mid/high bands, attack/release, gain and clamp mappings → cached FFT/envelope data sampled deterministically; **M**, D5/D6. | Seek order and output fps do not change the same-time result; no clipping/flashing beyond configured bounds. |
| P06 Variable-tempo, frame-accurate beat edit assistant | A single BPM grid is insufficient for live/drifting music. | Tempo-map lane, confidence markers and “snap selected cuts” preview → piecewise tempo map, sample-time cues and reversible edit proposals; **L**, D1/D5. | Manual downbeat anchors stay exact; snap never changes approved duration silently; show error in samples, ms and delivery frames. |
| P07 Automated review gates with odiff | Existing scripts generate evidence but do not provide a unified trusted accept/reject workflow. | Review dashboard and base/current/diff triplets → native odiff qualification, negative controls, temporal/audio gates and human baseline approval; **M**, D7/ETHOS.md. | Inject missing glyph, color change, one-frame cut shift and audio offset; each must fail the intended gate. |
| P08 Provenance-bound resumable rendering | Long HFR jobs waste work after interruption; reusing stale frames is worse. | Resume/retry failed ranges, cache provenance view → immutable chunk manifests keyed by document/assets/renderer/spec, atomic completion and seam checks; **L**, D1–D4. | Interrupt mid-export; resumed and clean decoded outputs agree under a declared determinism policy, including audio seams. |
| P09 Measured quality/size search | Fixed CRF/preset choices can be unnecessarily large or erase thin text. | Target file size/quality slider with sampled comparisons → bounded encoder search using perceptual metrics **and** text/edge/cut fixtures; **L**, D3/D7. | Meet budget without hiding degradation on barcode/text regions; report when no candidate satisfies both constraints. |
| P10 Motion continuity and comfort lint | Fast montages can contain accidental velocity jumps, flashes or unreadable density even when every still is attractive. | Motion-speed/flash-density overlay with intentional overrides → curve derivative checks plus rendered luminance-change windows; **M**, D1/D6/D7. | Designed discontinuity and flashing negative controls trigger; do not label this medical certification or remove intentional cuts automatically. |

## 7. Native build order: fifteen product slices

This order buys common foundations first; it is not fifty-two independent feature projects. Each slice must finish with a real output and the evidence described in ETHOS.md.

1. **One rational clock and export spec**—F01/F06/F34: preserve film timing while changing size or fps; qualify same-time frames.
2. **Deterministic render adapters**—F02/F03/F46: `renderAt`, readiness, capability failures and a web-first preview/export contract.
3. **Verifiable, bounded export jobs**—F04/F11/F40/F43: exact frames, audio, cancellation, resource limits and artifact receipts.
4. **Lossless masters and 540 fps sources**—F05/F10: one immutable source for reliable derivatives; distinguish throughput from playback rate.
5. **Retiming modes that cannot be confused**—F07/F08/F09: slow conform vs same-duration temporal blend vs direct accumulation.
6. **Beat/bar timeline and cue snapping**—F19/F20: offset, accents, source hashes and authored-grid semantics.
7. **Review workspace**—F35–F39/F42: stills, strips, onions, findings and explicit artistic exceptions.
8. **Real recording + camera workflow**—F14–F17: authentic footage, smooth focus moves and source-quality inserts.
9. **Seekable motion and shader primitives**—F13/F26/F27: springs, staggers, cuts, grain clocks and controlled atmosphere.
10. **Theme tracks and real asset palettes**—F29/F30: stable slugs, beat-timed skins and verified wallpaper choices.
11. **Data-bound facts and approved-layout locks**—F31–F33/F45: update the catalogue without inventing numbers or redesigning the film.
12. **Audio mix, licensing and loudness review**—F21–F24: sample-accurate placement, provenance and final listening/peak checks.
13. **Regression and performance gates**—F41/P07: same-time comparisons, odiff candidate qualification and honest benchmark receipts.
14. **Platform delivery and readability**—F28/P02–P04: small-text checks, safe areas, reframing and validated format profiles.
15. **Reusable sequences and qualified advanced paths**—F18/F44/F12/P01/P08: shot families, optional Skia Vulkan, cut-aware blur and provenance-bound resume.

## 8. Retrieval and remaining verification

Research used provider-filtered `fframes`/`540`/`conform` searches, the recovered session exports, local source/script reads, upstream README/code/PR review and ffprobe of the four HFR deliveries. Session exports remained in local scratch; raw private transcripts were not added to this repo. Public technical citations and exact upstream revisions are in ETHOS.md.

The separate fframes `--check`, `strip`, `onion-skin`, diagnostics and output flags should be validated against the adapter's pinned CLI version before automation: local projects use revision-specific conventions. Do not copy a historical command blindly into a production executor.

Not done here: full video rerender; playback/listening review; complete-frame equality across rates; reproduction of upstream speed numbers; implementation of native features; Grok-specific history recovery; proof of all possible resolution/fps/codec combinations. The existing media metadata was verified; all broader historical claims retain their source and scope.
