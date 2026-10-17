# Performance ethos: fewer jobs, less movement, measured results

Research checked 2026-10-17. This is an engineering policy **proposal**, not a statement that fframestudio already meets these budgets. Read with [DESIGN.md](DESIGN.md) and [FFRAMES-FEATURES.md](FFRAMES-FEATURES.md).

**Make the useful operation fast, without changing its meaning.** The shared lesson of Dmitriy Kovalenko's fframes, fff and odiff is not “rewrite everything in Rust.” It is: choose a narrow workload, understand the data, eliminate repeated preparation and transfers, specialize expensive kernels, and publish enough evidence to challenge the claim. Our implementation should earn respect through reproducible results, not imply endorsement by their maintainers.

## 1. What the upstream projects actually do

### fframes: compile the description; keep drawing and encoding close

Sources below are pinned to `44745c09a6c8c51071609097326a820cf59d087b`:

- Source: [README](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/README.md): a Rust `Video` produces an SVG tree per frame. Skia draws on Metal or Vulkan; the CPU backend uses tiny-skia. FFmpeg's libav libraries are linked instead of spawning a process for each operation. SkSL/GLSL shader layers cover work poorly expressed as SVG.[1]
- Source: [SVG macro](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/svgr-macro/src/nodes_to_svgtree.rs): static attributes contribute to content hashes; static paths become a `StaticPathData` built once per process. Colors and paths can be prepared ahead of rendering. This is more specific than a generic “virtual DOM is fast” claim: unchanged content avoids repeated parsing/conversion.[2]
- Source: [Skia pipeline](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes-skia-renderer/src/skia_pipeline.rs): generation, GPU work and encoding are separate pools connected by **bounded** queues. Software-encoder memory influences generator counts. Parallelism is a resource allocation decision, not simply “one worker per core.”[3]
- Source: [Cache configuration](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes-skia-renderer/src/cache.rs): text and geometry limits are per worker. Geometry has two generations, so retained geometry can reach twice the configured byte budget, before allocator/hash-map overhead. A per-worker limit is not a process-wide limit.[4]
- Source: [Frame export negotiation](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes-skia-renderer/src/frame_export/mod.rs): `Auto` prefers hardware frames, then GPU conversion with plane readback, then RGBA readback and CPU conversion. It explicitly rejects hardware-frame negotiation when that would silently replace requested alpha, 10-bit or 4:4:4 output with 8-bit 4:2:0. **GPU drawing does not prove zero-copy encoding.**[5]
- Source: [Pixel conversion](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes/src/renderer/pix_fmt.rs)[6] and [its benchmark](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes/benches/yuv420_conversion.rs): the NEON path processes full eight-pixel blocks, with scalar tails. There is a non-NEON fallback. Do not describe this particular conversion kernel as universally AVX-accelerated.[7]

Two merged PRs expose the engineering discipline behind the architecture:

1. [#189](https://github.com/dmtrKovalenko/fframes/pull/189)[8], merged 2026-10-06, moved scene-tree destruction off the GPU worker and avoided unnecessary probing/decoding before copying eligible generated MP4 segments. The report gives medians from three alternating before/after pairs, a pinned baseline, M5 Max hardware and complete export timing. One-context elapsed time went from 6.927 s to 5.300 s; six contexts from 3.819 s to 3.501 s. It discloses longer tree lifetimes, variable RSS and an earlier roughly 0.2 GB increase, and explicitly says Vulkan was **not measured**. These are contributor-reported results, not measurements repeated for this document.
2. [#164](https://github.com/dmtrKovalenko/fframes/pull/164)[9] limits codec threads within parallel segments and supports portable FFmpeg builds. Nested parallelism can inflate memory and oversubscribe CPUs; cached `-march=native` builds can fail on a different CPU. A faster local build is not necessarily a portable release.

The [Remotion comparison](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/render-bench/vs-remotion/README.md)[10] is unusually useful because it describes what it does **not** prove. It tests 99,000 overlapping circles plus 1,000 changing digits, at 4K, 300 frames, without audio. Timings include conversion/encoding/muxing but exclude build, preparation, browser launch and warm-up; copying the browser MP4 from OPFS is excluded. The headline table combines an M4 Max GPU run with M5 Max other runs, while separate same-machine results are linked. Each table entry is one run. Equal bitrate targets do not imply equal quality, and eight browser tabs beat eighteen in a reported check. Cite this as an SVG-overdraw stress test, never a universal “fframes is 30× faster” promise.

### fff: pay preparation once; reduce candidates before expensive work

Sources pinned to `df98973cf0b8e264cb8c4c2bd236d93da94d3a36`:

- Source: [README](https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/README.md): a long-lived file-search SDK, not just a faster invocation of grep. It keeps paths/metadata, a lightweight content index and a bounded content cache; a watcher updates them. It exposes fuzzy path ranking, literal/regex/fuzzy content matching, frecency and git awareness. Literal matching uses SIMD; multi-pattern search uses Aho–Corasick rather than repeated searches. Rust regex is reused rather than reimplemented.[11]
- Memory is a deliberate trade: contiguous string arenas improve locality and reduce per-path allocation; mapped content/cache storage and cached libgit2 metadata avoid repeated reads/process launches. The README explicitly concedes that **one grep from a shell is still a good job for ripgrep**. Its warm repeated-query speedups are not cold-start equivalence.
- Source: [Bigram index](https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/crates/fff-core/src/index/bigram_filter.rs): compact bitset columns filter candidate files before opening and matching them. It has allocation bounds, separate short/long-content paths and fallback when allocation fails. Rejecting impossible work is often more valuable than vectorizing work that should never happen.[12]
- Source: [Parallelism](https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/crates/fff-core/src/parallelism.rs): background scan/warm-up/index work has a separate pool from search; the source explains reserving cores for search/UI. [Sort scratch](https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/crates/fff-core/src/sort_buffer.rs)[14] reuses storage rather than making every request allocate afresh.[13]
- The actual tree uses `crates/fff-core` (package naming/docs retain `fff-search` terminology), with `fff-grep`, query parsing, C FFI and thin language/MCP/Neovim adapters. Follow the pinned code tree, not an outdated layout paragraph.

[PR #887](https://github.com/dmtrKovalenko/fff/pull/887)[15], merged 2026-09-25, is a practical model: rank a compact 16-byte pair, construct the larger score only for the returned page, cache sibling directory penalties, borrow paths, reuse buffers, and **skip Rayon on small inputs**. It adds Criterion synthetic and real-repository benchmarks and reports unchanged grep performance within noise. Review caught assumptions that every repository had a root README and fixed expected match counts. Our fixtures must not silently select only favorable projects either.

The maintainer's [#889 review](https://github.com/dmtrKovalenko/fff/pull/889#discussion_r4112881986)[16] questions unbounded scan growth: “we had bitten by this before.” The [measured reply](https://github.com/dmtrKovalenko/fff/pull/889#discussion_r4113933874)[16] bounds growth at `base_chunk * 8`, preserves the useful win, and reports worst-case warm/cold overscan. That is the ethos: protect tail latency even when an unbounded batch wins one query.

### odiff: specialize the pixel kernel, but count the I/O too

Sources pinned to `6dd1e9629810042c03a81fc787f37b245772970a`:

- Source: [README/API](https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/README.md): originally OCaml, now Zig; a native SIMD-first image comparator with SSE2/AVX2/AVX512/NEON support, YIQ color distance, antialias detection, ignored regions and layout-difference handling. Its focus is significantly similar images. “Fastest” is an upstream claim scoped to one-thread pixel comparison, not our independent finding.[17]
- Source: [Diff kernel](https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/src/diff.zig)[18] chooses vectorized/platform-specific paths; [color delta](https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/src/color_delta.zig)[19] includes shifted-integer SIMD YIQ arithmetic. This does **not** mean every operation in the application avoids floating point.
- Source: [Mapped input](https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/src/io/memory_mapped_file.zig)[20] avoids an unnecessary whole-file input copy on supported systems. Decoding and output remain real costs. `ODiffServer` amortizes subprocess startup across comparisons; it is not evidence of an in-browser WASM API.
- Source: [Benchmark instructions](https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/images/README.md)[21] use hyperfine and disclose an older MacBook Pro/macOS 11 environment. The README's multi-second comparison tables are historical, not current-Zig hardware measurements. [bench.sh](https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/bench.sh)[22] compares commits in a separate worktree and includes warm-up and repeated runs.
- Source: [PR #150](https://github.com/dmtrKovalenko/odiff/pull/150)[23], merged 2025-11-16, fixes PNG-save overhead in the I/O writer and adds a benchmark script. The [maintainer asks whether a change actually improves performance](https://github.com/dmtrKovalenko/odiff/pull/150#discussion_r2525572596)[23]; the reply says the encoding variation made essentially no difference. Optimizing the comparison loop while ignoring output encoding would have missed the regression.

### The author's public rationale—separate from proof

The [Wasm I/O 2024 abstract](https://2024.wasmio.tech/sessions/everything-about-media-files-in-wasm-fonts-images-audios-all-in-rust/)[24] describes static asset inlining, font parsing/shaping in WASM, stream-based FFT and passing generated buffers to Web Audio. It motivates doing preparation outside the hot path; it does not establish current fframestudio startup speed. The [EuroRust 2026 abstract](https://eurorust.eu/talks/how-i-built-a-file-search-that-is-50x-faster-than-ripgrep-and-made-it-into-opencode/)[25] calls fff “up to 50 times faster”; retain “up to” and the repeated-search qualification from the implementation docs.

His [site](https://dmtrkovalenko.dev/)[30] lists the 2022 programmatic-video talk, the 2024 image-comparison talk and the WASM talk. The [sponsor statement](https://github.com/sponsors/dmtrKovalenko)[26] explicitly describes optimizing video end to end, from markup parsing through encoding; its older CPU/beta wording is not the current backend specification. These pages/abstracts were read; talk recordings were not transcribed or watched for this report.

## 2. Rules for fframestudio

These extend, rather than replace, DESIGN.md: **web first**, one document and command system, conditional WebAV/Mediabunny adapters, audited FFmpeg/native bridge, optional fframes motion backend. Tern must never be a prerequisite.

| Rule | Implementation consequence | Required evidence |
|---|---|---|
| Measure the complete user operation | Instrument open/import, seek, edit-to-paint, draft, final encode and file delivery separately. Keep stage timings as well as total time. | Trace plus finished-file metadata, not only kernel fps. |
| Keep the frame loop out of UI reconciliation | UI framework manages controls/document edits; a worker or engine owns playback and sampling. Do not rebuild the whole timeline DOM or serialize the project at video rate. | Main-thread/worker trace during scrub and playback. |
| Compile immutable work once | Prepare fonts, text layout, paths, shaders and media metadata; cache by content/revision, renderer, resolution and color settings. Invalidate only dependent nodes. | Cold/warm tests and mutation tests that detect stale results. |
| Avoid copies before adding cores | Prefer canvas/texture → VideoFrame → encoder when the backend actually supports it. Transfer ownership; close frames promptly; avoid PNG/base64/CDP round trips in a qualified fast path. | Copy/readback counts and memory profile, with the actual negotiated encode path. |
| Zero-copy is a property of a path, not a slogan | Surface hardware frames vs GPU-converted readback vs CPU fallback. Preserve requested pixel format and alpha. | Capability test + decoded output/color/alpha checks. |
| Bound every cache and queue | Budget process-wide decoded media, textures, in-flight frames, temp disk and worker scratch. Divide budgets among workers; apply backpressure and cancellation. | Peak RSS/VRAM/disk plus cancel/error cleanup test. |
| Separate interactive and background work | Prioritize preview/scrub; pause or reduce export, waveform and proxy jobs when contention harms interaction. Use measured crossover points for parallel tasks. | p95/p99 interaction latency with exports running. |
| Reject unnecessary work early | Cull invisible layers; only update affected clips; draw visible timeline items; generate thumbnails at demanded scales. | Same output plus reduced work counters on long timelines. |
| SIMD/WASM must earn their boundary | Try SIMD WASM for measured bulk analysis/conversion kernels; include JS↔WASM transfer and initialization. Keep a scalar reference and portable fallback. Do not rewrite form controls in WASM. | End-to-end A/B, cross-platform correctness, bundle/startup cost. |
| GPU must earn its transfers | Qualify shader-heavy scenes, texture residency and device-loss recovery. Do not route tiny jobs to GPU merely because it exists. | CPU/GPU comparison including upload/readback and fallback behavior. |
| Deterministic time is non-negotiable | Rational document time; explicit source/output/sample clocks; seeded noise; seek-safe media; no wall-clock-dependent export. Freeze assets/fonts. | Random-order seek equals sequential render at sampled instants; segment-boundary and fps-change tests. |
| Fast failure beats silent degradation | Unsupported codec/fps/effect is a visible refusal or an explained fallback. Never silently cap fps or drop alpha/audio. | Deliberate unsupported-capability tests. |
| Optimize an observed bottleneck | Profile first; change one cause; test a small, representative fixture and a real film; keep or revert. | Baseline/candidate SHA, same fixture and quality, repeated paired runs. |

Earlier render-lab benchmarks of fframes films showed the same thing: the fast HTML path avoided image serialization, but WebGL snapshots were stale and WebGPU was unverified. The correct product feature is **a qualified fast path with an honest fallback**, not “all HTML renders fast.” His measured 540 fps output was not 540 frames/s render throughput.

## 3. Proposed budgets and CI contract

Initial **acceptance targets to calibrate on named hardware**, not achieved numbers:

| Surface | Initial target | Measurement contract |
|---|---|---|
| 1080p60 preview | p95 frame work ≤16.67 ms; report missed deadlines | 30 s deterministic fixture after warm-up, with audio and input contention; report p99 too. |
| UI edits | p95 command-to-next-painted-result ≤50 ms | Text edit, trim, move and undo on a named medium/large document. |
| Scrubbing | p95 warm seek-to-correct-frame ≤100 ms | Random seeks, including clip/cut boundaries; cold decoder-start reported separately. |
| Main-thread responsiveness | No attributable task >50 ms during steady interaction | Trace, not average fps alone; worker stalls also count toward user latency. |
| Export correctness | Exact expected frame count, rational timing and audio duration within declared codec padding tolerance | ffprobe plus decode tests; do not demand unique hashes on intentionally static frames. |
| Memory/disk | Hard configured cap, no growth after repeated open/close/export cycles | Include all workers, decoded buffers and scratch; choose numeric caps after the first baseline. |

A 120 Hz preview has an 8.33 ms frame interval; 540 fps has a 1.85 ms interval. **Offline 540 fps export has no 1.85 ms wall-clock requirement.** Render throughput is a separately measured number.

CI should have three layers:

1. **Every PR:** deterministic unit/command tests, a short render/decode fixture, frame-count/audio checks, small visual corpus, bundle-size report and benchmark smoke. No external music downloads or mutable fonts.
2. **Controlled performance runner:** alternating baseline/candidate runs of text-heavy, shader-heavy, recorded-footage, fast-cut, 4K and long-timeline workloads. At least five measured pairs after explicit warm-up; retain every sample. Proposed regression gate: investigate a reproducible >5% median slowdown or >10% p95 slowdown; do not use noisy shared-runner timings as an unconditional merge blocker.
3. **Nightly/release:** browser/OS/CPU/GPU matrix; scalar/SIMD paths; device loss; cancellation; long export; cold-cache startup; low-memory and disk-full failures. CPU-only CI cannot certify a hardware GPU path.

Inspected upstream CI includes platform correctness/build checks ([fframes](https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/.github/workflows/main.yml)[27], [fff](https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/.github/workflows/rust.yml)[28], [odiff](https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/.github/workflows/build.yml)[29]). Do not infer from the existence of benchmark code that all three enforce performance thresholds in CI. The gates above are **our proposed improvement**.

Each published result must retain: source/dependency revisions; asset hashes; compiler/build flags; CPU/GPU/driver/browser/codec versions; resolution, fps and sample count; worker/cache settings; cold/warm state; color/pixel format; quality settings and measured fidelity; included/excluded work; raw timings, failures, skipped cases, RSS/VRAM/temp-disk peak; command and completed artifact metadata. Publish regressions and non-wins. Never compare different quality or hardware without putting that caveat beside the headline.

## 4. Qualify odiff for visual regression

**Candidate, not yet integrated or benchmarked in this product.** Try native `odiff-bin`/`ODiffServer` in the bridge/CI, and `playwright-odiff` for editor chrome. Avoid a new browser WASM port until a browser-only requirement justifies it.

- Keep approved, lossless PNGs at explicit document times. Record project/assets/fonts/renderer/color/viewport/device-scale provenance. Compare within one backend/platform first; cross-backend equivalence is a separate test with explicit tolerances.
- Use strict mode for layout/text/asset changes; add carefully calibrated antialias tolerance only for known rasterization variation. Never mask the whole moving region or accept a large threshold to silence a failure.
- Include missing glyphs, one-pixel text shifts, low-contrast text, thin barcode stripes, alpha edges, color-space mistakes and cut boundaries. Verify that known bad frames **fail** and approved equivalent frames pass.
- Produce base/current/diff triplets and changed bounds. Baseline updates require review, not an automatic “fix snapshots” step.
- Time both the comparison kernel and full decode/compare/diff-write pipeline. Compare cold CLI and persistent server throughput, memory, failure handling and version portability against the current reference comparator.
- odiff is not a temporal-quality judge. Add consecutive strips, frame-order/duplicate checks, audio sync checks and human playback approval. A matching still cannot establish good motion blur, readability at speed or good music.

## 5. Definition of a performance change being done

The feature remains correct and deterministic; a measured bottleneck improves on representative work; the complete operation also improves or the tradeoff is explicit; resource bounds and fallback behavior survive; raw evidence is retained; and a maintainer can reproduce the result without Kevin's private sessions. Until then, say **experiment**, not **optimization shipped**.

## Sources

[1] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/README.md
[2] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/svgr-macro/src/nodes_to_svgtree.rs
[3] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes-skia-renderer/src/skia_pipeline.rs
[4] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes-skia-renderer/src/cache.rs
[5] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes-skia-renderer/src/frame_export/mod.rs
[6] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes/src/renderer/pix_fmt.rs
[7] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/fframes/benches/yuv420_conversion.rs
[8] https://github.com/dmtrKovalenko/fframes/pull/189
[9] https://github.com/dmtrKovalenko/fframes/pull/164
[10] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/render-bench/vs-remotion/README.md
[11] https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/README.md
[12] https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/crates/fff-core/src/index/bigram_filter.rs
[13] https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/crates/fff-core/src/parallelism.rs
[14] https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/crates/fff-core/src/sort_buffer.rs
[15] https://github.com/dmtrKovalenko/fff/pull/887
[16] https://github.com/dmtrKovalenko/fff/pull/889
[17] https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/README.md
[18] https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/src/diff.zig
[19] https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/src/color_delta.zig
[20] https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/src/io/memory_mapped_file.zig
[21] https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/images/README.md
[22] https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/bench.sh
[23] https://github.com/dmtrKovalenko/odiff/pull/150
[24] https://2024.wasmio.tech/sessions/everything-about-media-files-in-wasm-fonts-images-audios-all-in-rust
[25] https://eurorust.eu/talks/how-i-built-a-file-search-that-is-50x-faster-than-ripgrep-and-made-it-into-opencode
[26] https://github.com/sponsors/dmtrKovalenko
[27] https://github.com/dmtrKovalenko/fframes/blob/44745c09a6c8c51071609097326a820cf59d087b/.github/workflows/main.yml
[28] https://github.com/dmtrKovalenko/fff/blob/df98973cf0b8e264cb8c4c2bd236d93da94d3a36/.github/workflows/rust.yml
[29] https://github.com/dmtrKovalenko/odiff/blob/6dd1e9629810042c03a81fc787f37b245772970a/.github/workflows/build.yml
[30] https://dmtrkovalenko.dev
