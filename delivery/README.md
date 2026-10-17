# Platform-aware delivery lab

**Start with [REPORT.md](REPORT.md) for measured results and [RESEARCH.md](RESEARCH.md) for citations and uncertainties.** This is a local SDR export/qualification pipeline, not a platform uploader. It does not guarantee a service's codec allocation or delivered quality.

Requirements: Python 3.11+, FFmpeg with `libx264`, `libx265`, `libvpx-vp9`, `libsvtav1` (optional alternative simulator), `libvmaf` with built-in VMAF / VMAF NEG / CAMBI, `zscale`, `cas`, `hqdn3d`, `tmix`, `minterpolate`. NVIDIA export additionally requires a working NVENC device; listing the encoder is not sufficient. No Python third-party dependencies for encoding/metrics. Crop-sheet generation uses Pillow.

## Export

```sh
python delivery/deliver.py export master.mkv delivery/out/youtube.mp4 --platform youtube
python delivery/deliver.py export master.mkv delivery/out/reels.mp4 --platform reels

# CPU alternative, arbitrary even geometry and rational CFR:
python delivery/deliver.py export master.mkv delivery/out/custom.mp4 \
  --platform youtube --encoder libx264 --width 1280 --height 720 --fps 30000/1001

# Preserve aspect ratio by padding (default); cropping must be intentional:
python delivery/deliver.py export master.mkv delivery/out/vertical.mp4 \
  --platform tiktok --fit crop --width 1080 --height 1920

# Measured low-resolution recipe:
python delivery/deliver.py export master.mkv delivery/out/480.mp4 \
  --platform x --profile delivery/profiles/lowres-480.json

# Optional experimental modes; NOT automatic quality improvements:
python delivery/deliver.py export high540fps.mp4 delivery/out/blur60.mp4 \
  --platform youtube --fps 60 --conform blend
python delivery/deliver.py export master.mkv delivery/out/linear480.mp4 \
  --platform x --width 854 --height 480 --scale linear --prefilter cas
python delivery/deliver.py export master.mkv delivery/out/main10.mp4 \
  --platform youtube --encoder hevc_nvenc
```

Profiles live in `profiles/*.json`; `--profile custom.json` loads an explicit full profile. CLI overrides: width, height, fps, encoder, quality, conform, scale, prefilter, fit, maxrate-kbps, start, duration. Rational FPS works for exports; simulator configurations use numeric FPS. Custom geometry/FPS does **not** guarantee platform acceptance; consult the exact ingest surface. `--duration` truncates output; it cannot invent source frames except the bounded interpolation tail.

Defaults: 8-bit H.264 upload, progressive, limited BT.709 tags **and matrix conversion**, closed fixed GOP, CFR, AAC stereo 48 kHz, two-pass loudness targeting −14 LUFS / −1.5 dBTP. Silence remains silent. The target is a house policy, not a verified requirement of all services. PQ/HLG input is rejected; upstream tone-map deliberately before invoking this SDR pipeline. Unspecified matrix/primaries/transfer is treated as SDR BT.709; source color metadata must be correct. Non-square-pixel and wide-gamut SDR inputs are outside the qualified corpus.

Conform modes:
- `decimate`: FFmpeg FPS sampling; no invented motion blur.
- `blend`: non-overlapping equal-weight box accumulation, only for an **integral** source/target FPS ratio (1–128). This is a full-frame-period, signal-domain box shutter, not linear-light physically accurate camera exposure. Initial partial windows are discarded; timestamps are rebuilt. Non-integral ratios fail, not silently round.
- `interpolate`: motion-compensated interpolation with a bounded clone tail, then truncate to requested/source duration. Synthetic motion can deform text. Not a substitute for high-rate rendering.

Filters: `none`, `cas` (contrast-adaptive 0.15 after scaling; not semantic text segmentation), `denoise` (mild spatial/temporal hqdn3d), `chroma` (4:4:4 intermediate, slight chroma-only Gaussian blur before 4:2:0). Scaling: `bicubic`, `bilinear`, `lanczos`, `linear` (float linear-light zscale/Lanczos). Chroma upsampling cannot restore color detail already missing in a 4:2:0 master.

H.264 NVENC uses p6 / HQ / VBR CQ14 / spatial+temporal AQ / 20-frame lookahead. Software H.264 uses medium / CRF14. CQ and CRF numbers are **not comparable quality scales**. Main10 paths: HEVC NVENC or libx265. AV1 NVENC is deliberately not offered: initialization failed on the tested RTX 3080 Ti. There is no silent software fallback; select `--encoder libx264` explicitly.

Each successful export writes `OUTPUT.receipt.json` with the exact command, resolved profile, input/output ffprobe metadata, decoded frame count, audio analysis and wall time. Large outputs belong outside Git or under ignored `delivery/out/`.

## Simulate and measure

```sh
python delivery/deliver.py simulate delivery/out/youtube.mp4 delivery/out/playback.mp4 \
  --platform youtube --multiplier 1.0
python delivery/deliver.py measure delivery/out/playback.mp4 reference.mkv \
  --log delivery/out/quality.json
```

`platforms.json` configures playback geometry, FPS, codec, nominal bitrate, CRF and GOP. `--config` selects another simulator file. `--multiplier` scales the nominal bitrate/rate-control bounds; it does not select a real platform ABR lane. These short constrained-quality encodes can overshoot the nominal average, especially VP9. Read measured file/stream rates, not just encoder arguments. Both arms always receive the same transcode; we never assume a preferential codec for the “ours” arm.

The metric command requires matching geometry, rational frame-rate text and decoded frame counts, rebuilds timestamps from frame index, disables last-frame padding, and scores **every** frame. It cannot discover semantic misalignment in unrelated clips; callers must select the identical source interval. It writes per-frame VMAF v0.6.1, VMAF NEG v0.6.1neg, luma/chroma PSNR, float SSIM, CAMBI, and summary means/linearly interpolated 5th percentiles. Higher is better except CAMBI (lower is better). CAMBI measures banding in the distorted image, not full-reference banding loss; interpret it with the reference and crops. VMAF can saturate on high-motion footage and was not trained specifically for small UI text or portrait phone viewing.

## Reproduce qualification

Run on an otherwise idle machine for comparative performance numbers. The recorded run used a shared workstation. Main-cohort timings are short-clip diagnostics. `performance.py` separately measures three actual 60-second trials per profile and encoder, including export probes but excluding input preparation, simulation, metrics, and audio. See the report for variability and the X quality-versus-speed tradeoff.

```sh
python -m unittest discover -s delivery -v

ART=${ART:-$PWD/delivery-artifacts}
python delivery/benchmark.py --out "$ART/main" --variants naive,fast
python delivery/benchmark.py --out "$ART/main" --variants software --contents ui
python delivery/benchmark.py --out "$ART/main" --platforms youtube --contents gradient --variants software
python delivery/benchmark.py --out "$ART/main" --platforms x --contents ui --variants software_unfiltered
python delivery/benchmark.py --out "$ART/main" --platforms x \
  --contents gradient,satellite,motion --variants software
python delivery/benchmark.py --out "$ART/main" --platforms youtube \
  --contents ui,gradient --variants hevc10
python delivery/benchmark.py --out "$ART/main" --platforms x --variants fast_unfiltered
python delivery/benchmark.py --out "$ART/main" --platforms x \
  --contents ui,satellite --variants chroma,denoise
python delivery/benchmark.py --out "$ART/main" --platforms youtube \
  --contents ui --variants up1440,up2160
python delivery/experiments.py temporal --out "$ART/temporal"
python delivery/experiments.py temporal --pan-stress --out "$ART/temporal-pan"
python delivery/experiments.py lowres --out "$ART/lowres" --main-dir "$ART/main"
python delivery/performance.py --main "$ART/main" --out "$ART/performance" --duration 60 --repeats 3
python delivery/summarize.py --main "$ART/main" --evidence "$ART/evidence" --sheets "$ART/sheets"
python delivery/visualize.py --root "$ART"
```

`benchmark.py` contains the explicit local corpus paths/intervals. Modify them for your own corpus. It uses 3 seconds / 90 frames at 30 FPS, center-crops vertical references to avoid rewarding black padding, saves FFV1 references, and appends verified rows after each completed comparison. The profile shipped to users still pads by default; production vertical composition should normally be authored vertically, not center-cropped from a landscape master. Use a **fresh output directory** when changing sources, duration, preparation, or the qualification cohort. Cached references are versioned and hash-checked, but are not a general render-cache service. Recipe hashes in output filenames prevent later variants from overwriting earlier evidence.

`--smoke` runs a small generated test fixture only. Smoke fixture results are never included in the real-source report. Full raw artifacts remain in the artifact directory, with compact result JSON, hashes, and command receipts in `evidence/`. The additional bitrate, AV1, and native-10-bit stress runs retain their exact source-generation and re-encoding arguments in `evidence/commands.json`. No media uploads, account actions or posting occur.
