# Platform-aware delivery qualification

Date: 2026-10-17. Hardware: RTX 3080 Ti 12 GB and Intel Core i9-10900KF. Exact FFmpeg build, CPU details, and real encoder initialization results are in [environment.json](evidence/environment.json).

## Outcome and scope

The selected recipes beat the CRF23 baseline on pooled mean and fifth-percentile VMAF for all five simulators. These are **simulator results, not measured gains on YouTube, Shorts, TikTok, Reels, or X**. No account uploads occurred. The study does not establish the proposed “S+ tier on every platform” marketing claim.

Most of the gain comes from reducing first-generation encoding loss. X also benefits from mild contrast-adaptive sharpening at 720p. The four real clips are only three seconds each. Recipe selection and evaluation used the same clips, not a held-out corpus. The synthetic blue-gradient stress test is a counterexample: the selected H.264 recipes lose VMAF against naive despite winning the real-clip aggregate.

### Selected recipes

All profiles use 30 FPS CFR, ordinary FPS sampling, Lanczos scaling, limited-range BT.709 conversion and tags, H.264 NVENC p6/HQ, VBR CQ14, spatial and temporal AQ, 20-frame lookahead, and two B frames. Scene-cut insertion is disabled. The production fit policy is padding, not destructive cropping. The test corpus uses a common center-cropped reference for each aspect ratio.

| Profile | Upload dimensions | Post-scale filter | GOP seconds | Nominal maxrate / buffer, Mbps / Mbits | AAC kbps |
|---|---:|---|---:|---:|---:|
| YouTube | 1920×1080 | none | 0.5 | 25 / 50 | 192 |
| Shorts | 1080×1920 | none | 0.5 | 25 / 50 | 192 |
| TikTok | 1080×1920 | none | 2 | 25 / 50 | 192 |
| Reels | 1080×1920 | none | 2 | 20 / 10 | 128 |
| X | 1280×720 | CAS 0.15 | 2 | 8 / 16 | 192 |

Reels additionally rejects an output whose measured average video bitrate exceeds 25 Mbps or is unavailable. Its measured uploads range from 4.956 to 23.491 Mbps. This is an average-stream check, not a proof of every instantaneous bitrate or of service acceptance. Other rates above are engineering choices, not invented platform upload maxima.

The software alternative is x264 medium CRF14. CQ14 and CRF14 are different scales; quality equivalence is evaluated after the same simulator, not inferred from the number 14. Native HEVC Main10 export is available but not selected. `av1_nvenc` is listed by FFmpeg but fails device initialization on this GPU. Software SVT-AV1 simulation succeeds.

All audio profiles use two-pass loudness normalization to a house target of -14 LUFS and -1.5 dBTP, with stereo AAC at 48 kHz. Only historical third-party YouTube measurements support the approximate loudness target; the other services' exact normalization is UNVERIFIED. A real audio export measured -13.99 LUFS and -2.63 dBTP after encoding. Multi-track tests ensure the first pass measures the same first audio track that export maps.

Optional `lowres-720.json` and `lowres-480.json` select Lanczos plus CAS 0.15. They are qualified only on the two-source, X-like low-resolution experiment below. Arbitrary positive even dimensions and rational frame rates are supported. The five-platform comparison does not qualify every custom resolution or 60 FPS export.

## Ingest facts and playback assumptions

The full source inventory and uncertainty notes are in [RESEARCH.md](RESEARCH.md), researched on 2026-10-17.

| Platform | Upload evidence | Simulator at 30 FPS | Confidence boundary |
|---|---|---|---|
| YouTube | [Official encoding guidance](https://support.google.com/youtube/answer/1722171?hl=en): H.264, 4:2:0, BT.709, recommended 8 Mbps at 1080p30; no required bitrate maximum | 1080p VP9, CRF31, nominal 3 Mbps | Google's [VP9 web settings](https://developers.google.com/media/vp9/settings) inform the model, not a private YouTube ladder |
| Shorts | [Official help](https://support.google.com/youtube/answer/10059070?hl=en) says uploads have maximum resolution 1080p | 1080×1920 VP9, CRF32, nominal 2.5 Mbps | Upload wording does not prove a universal playback cap; codec and rate UNVERIFIED |
| TikTok | [Content Posting API](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide): 23–60 FPS, dimensions 360–4096, H.264 recommended, HEVC accepted | 1080×1920 H.264, CRF26, nominal 2.5 Mbps | Universal 1080p playback cap, bitrate ladder, and HDR behavior UNVERIFIED |
| Reels | [Instagram publishing reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/): H.264/HEVC, 23–60 FPS, 25 Mbps maximum, AAC128 | 1080×1920 H.264, CRF25, nominal 3 Mbps | [Meta engineering](https://engineering.fb.com/2023/02/21/video-engineering/av1-codec-facebook-instagram-reels/) documents AVC/VP9/AV1 and adaptive per-video decisions; this is only a basic AVC approximation |
| X | [Media Studio](https://help.x.com/en/using-x/media-studio-faqs): H.264, recommended 5–8 Mbps, maximum 60 FPS | 1280×720 H.264, CRF25, nominal 2 Mbps | Media Studio guidance does not cover every X upload interface; playback ladder UNVERIFIED |

Each simulator uses the same codec, quality setting, rate request, two-second GOP, and bicubic playback scaler for both arms. `platforms.json` keeps the assumptions configurable. The nominal rate is not a guaranteed average or hard bound on a short file. For example, the YouTube satellite outputs measure about 5.5 Mbps despite a 3 Mbps request. The tables report actual container rates.

A [creator's single-video analysis](https://note.com/depachika/n/n4e3e8422c358) suggests higher bitrate allocations at higher YouTube resolutions, but does not prove preferential 1080p delivery from an upscale. Guaranteed 1440p-to-VP9 or AV1 promotion remains UNVERIFIED. This study does not award an artificial codec bonus to our upload.

## Method and source integrity

- UI: `one-take-master.mkv`, seconds 8–11, 1920×1080 FFV1 at 60 FPS.
- Gradient and fine texture: Omarchy `v3/video/out/master.mkv`, seconds 14–17, 1920×1080 FFV1 at 60 FPS.
- Satellite: GEV `raw-moves/01-2/0000.jpg` through `0089.jpg`, 1600×900, interpreted at the supplied 30 FPS.
- Motion: `realtime-540fps-4k.mp4`, seconds 8–11, 3840×2160 VP9 at 540 FPS. High frame rate is not proof of high motion; the selected interval has modest motion. A separate, explicitly synthetic pan provides a stronger temporal stress.

[Source hashes](evidence/sources.json) bind the original inputs. Every arm starts from the same lossless FFV1 canonical reference with identical framing, color conversion, and time sampling. The JPEG and VP9 originals already contain compression. “Lossless reference” does not mean those original files were uncompressed. The real corpus is 8-bit. Native 10-bit precision is tested separately with a procedural blue ramp.

The JPEG decoder reports full-range BT.601-family `bt470bg`, not BT.709. Reference preparation converts that matrix and range rather than relabeling the pixels. A red JPEG regression test caught a green value of 23 with the wrong assumption. All satellite comparisons were regenerated after the fix. The FFV1 masters report `smpte170m` matrix and also receive explicit conversion.

Naive means x264 medium CRF23, bicubic scaling, and no preprocessing. Its bitrate bounds are frozen independently of selected-profile edits. Ours uses the selected profile. Upload sizes increase by 3.42×, 3.43×, 3.92×, 3.23×, and 3.70× for YouTube, Shorts, TikTok, Reels, and X respectively. These are not equal-upload-bitrate experiments and do not isolate sharpening from encoder quality except where a matched-quality control is supplied.

Each main comparison scores all 90 aligned frames. The metric command rejects unequal dimensions, frame rates, or decoded frame counts, resets timestamps to frame index, and disables last-frame padding. VMAF v0.6.1, VMAF NEG v0.6.1neg, PSNR, float SSIM, and CAMBI come from FFmpeg/libvmaf. The main aggregate has 360 frames per platform and arm. Pooled p5 is computed from those frames, not by averaging clip percentiles. [frames.csv](evidence/frames.csv) contains the 3,600 main frame scores.

Frames are correlated, and there are only four source clips. No statistical significance, phone-viewing validation, or generalization claim follows from those 3,600 rows. VMAF is not calibrated specifically for small UI text or portrait viewing. CAMBI is a no-reference banding indicator; lower is better, but removing intended texture can also change it.

### Measured scores

Pooled p5 is the 5th percentile of all 360 frames per arm, not the mean of clip p5 values.

| Platform | Naive mean / p5 | Ours mean / p5 | Gain mean / p5 | NEG gain mean / p5 |
|---|---:|---:|---:|---:|
| youtube | 94.666 / 81.943 | 95.448 / 83.707 | 0.782 / 1.764 | 1.172 / 0.445 |
| shorts | 94.379 / 83.871 | 95.216 / 85.280 | 0.837 / 1.409 | 1.227 / 1.409 |
| tiktok | 94.498 / 86.118 | 94.991 / 86.659 | 0.493 / 0.541 | 0.528 / 0.660 |
| reels | 95.010 / 87.050 | 95.466 / 87.646 | 0.457 / 0.596 | 0.612 / 0.739 |
| x | 94.631 / 88.515 | 97.380 / 92.480 | 2.749 / 3.965 | 1.316 / 2.659 |

| Platform | Content | Arm | VMAF mean / p5 | NEG mean / p5 | PSNR-Y dB | SSIM | CAMBI | Actual playback Mbps (container) |
|---|---|---|---:|---:|---:|---:|---:|---:|
| youtube | ui | naive | 96.455 / 94.897 | 95.024 / 93.612 | 47.521 | 0.999697 | 0.3213 | 1.077 |
| youtube | ui | fast | 97.066 / 96.197 | 96.178 / 95.159 | 50.684 | 0.999820 | 0.1645 | 0.920 |
| youtube | gradient | naive | 88.288 / 75.386 | 85.896 / 72.516 | 36.907 | 0.985398 | 9.7541 | 2.569 |
| youtube | gradient | fast | 89.479 / 76.942 | 87.376 / 74.244 | 37.288 | 0.986179 | 9.9448 | 2.849 |
| youtube | satellite | naive | 99.428 / 96.448 | 98.889 / 94.464 | 34.006 | 0.995680 | 0.0168 | 5.455 |
| youtube | satellite | fast | 99.782 / 98.519 | 99.493 / 96.788 | 34.760 | 0.996686 | 0.0159 | 5.578 |
| youtube | motion | naive | 94.491 / 92.862 | 92.639 / 90.361 | 47.440 | 0.999335 | 3.2356 | 0.839 |
| youtube | motion | fast | 95.464 / 94.202 | 94.088 / 92.683 | 49.996 | 0.999621 | 3.2317 | 0.703 |
| shorts | ui | naive | 96.552 / 95.582 | 94.194 / 92.823 | 49.107 | 0.999443 | 1.1772 | 0.566 |
| shorts | ui | fast | 96.946 / 95.344 | 95.656 / 93.945 | 51.871 | 0.999594 | 0.7130 | 0.516 |
| shorts | gradient | naive | 88.403 / 77.472 | 86.148 / 74.968 | 38.505 | 0.972737 | 7.4116 | 1.966 |
| shorts | gradient | fast | 89.471 / 77.517 | 87.431 / 75.094 | 38.863 | 0.973268 | 7.3636 | 2.139 |
| shorts | satellite | naive | 99.197 / 95.693 | 98.723 / 94.162 | 35.458 | 0.993784 | 0.0001 | 3.367 |
| shorts | satellite | fast | 99.642 / 97.626 | 99.281 / 96.093 | 35.967 | 0.994555 | 0.0001 | 3.388 |
| shorts | motion | naive | 93.363 / 91.279 | 91.277 / 88.784 | 46.490 | 0.999223 | 2.9110 | 0.847 |
| shorts | motion | fast | 94.806 / 92.835 | 92.884 / 90.759 | 48.853 | 0.999487 | 2.7961 | 0.726 |
| tiktok | ui | naive | 96.255 / 95.601 | 93.452 / 92.450 | 47.852 | 0.999359 | 1.7839 | 0.383 |
| tiktok | ui | fast | 97.100 / 96.282 | 94.145 / 93.474 | 48.697 | 0.999442 | 2.0480 | 0.386 |
| tiktok | gradient | naive | 90.080 / 84.745 | 87.765 / 82.104 | 38.713 | 0.974523 | 3.4718 | 2.754 |
| tiktok | gradient | fast | 90.137 / 85.510 | 87.921 / 82.951 | 38.852 | 0.974913 | 3.8003 | 2.550 |
| tiktok | satellite | naive | 98.604 / 93.814 | 97.791 / 92.266 | 34.515 | 0.992988 | 0.0001 | 2.876 |
| tiktok | satellite | fast | 98.842 / 94.905 | 98.092 / 93.311 | 34.638 | 0.993071 | 0.0002 | 2.766 |
| tiktok | motion | naive | 93.054 / 90.576 | 90.695 / 87.509 | 45.788 | 0.999171 | 2.8370 | 0.633 |
| tiktok | motion | fast | 93.886 / 91.325 | 91.657 / 88.660 | 46.720 | 0.999275 | 2.9691 | 0.611 |
| reels | ui | naive | 96.599 / 95.868 | 93.850 / 93.157 | 48.435 | 0.999467 | 1.9223 | 0.418 |
| reels | ui | fast | 97.063 / 96.436 | 94.517 / 94.003 | 49.277 | 0.999504 | 1.8759 | 0.423 |
| reels | gradient | naive | 90.716 / 85.485 | 88.433 / 82.768 | 38.941 | 0.975890 | 1.6029 | 3.550 |
| reels | gradient | fast | 91.172 / 86.224 | 89.041 / 83.599 | 39.127 | 0.976266 | 2.6304 | 3.336 |
| reels | satellite | naive | 99.118 / 94.690 | 98.613 / 93.177 | 34.971 | 0.994104 | 0.0001 | 3.482 |
| reels | satellite | fast | 99.393 / 96.154 | 98.959 / 94.635 | 35.218 | 0.994458 | 0.0000 | 3.384 |
| reels | motion | naive | 93.605 / 91.267 | 91.295 / 88.225 | 46.365 | 0.999228 | 2.8890 | 0.698 |
| reels | motion | fast | 94.237 / 92.033 | 92.122 / 89.213 | 47.405 | 0.999359 | 2.9337 | 0.688 |
| x | ui | naive | 95.915 / 94.942 | 93.864 / 92.764 | 45.188 | 0.999395 | 0.8736 | 0.377 |
| x | gradient | naive | 91.547 / 87.255 | 89.204 / 84.926 | 38.562 | 0.988130 | 9.2626 | 1.437 |
| x | satellite | naive | 97.457 / 91.258 | 96.049 / 89.339 | 31.992 | 0.991220 | 0.0019 | 2.305 |
| x | motion | naive | 93.605 / 91.891 | 91.639 / 87.735 | 45.856 | 0.998237 | 2.6657 | 0.439 |
| x | ui | fast | 98.795 / 97.634 | 94.899 / 93.750 | 45.083 | 0.999445 | 0.6978 | 0.389 |
| x | gradient | fast | 95.338 / 91.752 | 91.409 / 88.056 | 38.697 | 0.988447 | 8.8789 | 1.496 |
| x | satellite | fast | 98.586 / 94.023 | 96.926 / 91.381 | 32.123 | 0.990996 | 0.0029 | 2.322 |
| x | motion | fast | 96.799 / 93.893 | 92.786 / 89.672 | 46.210 | 0.998661 | 2.5175 | 0.463 |


### Regressions inside the positive aggregate

The result is not an all-metrics win. Shorts UI p5 falls from 95.582 to 95.344 despite a higher mean. Reels' gradient CAMBI worsens from 1.603 to 2.630. TikTok also has CAMBI regressions. X's sharpened UI loses a little PSNR, and its satellite SSIM falls slightly. VMAF NEG gains are smaller than ordinary VMAF gains, especially for sharpening. The full table retains those outcomes.

## Low-resolution experiment

The 1080p source is exported at 1280×720 or 854×480, passed through an H.264 model at nominal 2 or 1 Mbps, then restored with the same bicubic scaler to the original 1920×1080 viewing resolution. All comparisons use that original-resolution reference. Scores at different resolutions are not mixed.

The matched-bicubic control uses the same encoder and quality as the selected treatment, which separates some scaling benefit from first-generation encoding benefit.

| Content | Target | Naive VMAF | Matched-quality bicubic VMAF | Lanczos + CAS VMAF mean / p5 | Gain mean / p5 | NEG mean gain |
|---|---:|---:|---:|---:|---:|---:|
| ui | 720p | 88.581 | 88.963 | 93.031 / 92.252 | 4.450 / 6.177 | 3.390 |
| ui | 480p | 77.917 | 78.718 | 84.147 / 82.822 | 6.229 / 5.932 | 4.344 |
| satellite | 720p | 90.419 | 91.887 | 93.859 / 87.800 | 3.440 / 4.770 | 2.367 |
| satellite | 480p | 71.466 | 73.591 | 76.183 / 70.334 | 4.717 / 4.874 | 3.252 |

Linear-light Lanczos plus CAS is not selected. Its UI VMAF is 81.457 at 720p and 72.614 at 480p, versus 93.031 and 84.147 for ordinary Lanczos plus CAS. Satellite results are nearly tied, with no consistent NEG advantage. The full sixteen-row experiment is in [lowres.json](evidence/lowres.json).

## Temporal experiment

The real 540 FPS source is reduced to a 960×540 high-rate intermediate. One-second trials compare 30 and 60 FPS. The synthetic-pan version applies a sinusoidal camera crop to the same real content and is labeled separately. It is not captured fast-motion footage.

The instant target uses ordinary FPS sampling. The box target uses non-overlapping averages of 18 or 9 source frames. This is a full-frame-period, signal-domain exposure, not a physically accurate 180-degree shutter. The box reference uses the same accumulation implementation. Its score measures fidelity to a prescribed blur intent, not proof that blur is preferable. Both instant and box scores are reported to expose that dependence.

Interpolation receives half-rate samples selected from the instant reference. The first sparse frame is byte-identical to the first target frame, avoiding the half-frame phase difference caused by independently sampling 15 and 30 FPS. Interpolation's clone tail is bounded. It still has less temporal information than the high-rate render.

Temporal derivative error compares successive 160×90 luma differences against the box target, in 8-bit code values. It is an error proxy, not a validated flicker score or a real-time human viewing test.

| Content | FPS | Method | VMAF against box mean / p5 | VMAF against instant mean / p5 | Temporal derivative error, mean / max |
|---|---:|---|---:|---:|---:|
| temporal | 30 | decimate | 94.812 / 93.747 | 94.815 / 93.824 | 0.0493 / 0.1597 |
| temporal | 30 | blend | 94.729 / 93.660 | 94.599 / 93.388 | 0.0372 / 0.0534 |
| temporal | 30 | interpolate | 94.823 / 93.831 | 94.722 / 93.817 | 0.0444 / 0.1301 |
| temporal | 60 | decimate | 94.502 / 93.228 | 94.531 / 93.252 | 0.0269 / 0.0527 |
| temporal | 60 | blend | 94.726 / 94.102 | 94.715 / 94.066 | 0.0264 / 0.0483 |
| temporal | 60 | interpolate | 94.581 / 93.456 | 94.596 / 93.471 | 0.0336 / 0.1483 |
| temporal-pan | 30 | decimate | 76.879 / 62.244 | 94.802 / 93.621 | 0.4103 / 0.8498 |
| temporal-pan | 30 | blend | 90.167 / 86.701 | 35.454 / 14.765 | 0.1399 / 0.2263 |
| temporal-pan | 30 | interpolate | 66.711 / 36.110 | 70.504 / 26.360 | 0.5079 / 1.1756 |
| temporal-pan | 60 | decimate | 87.854 / 79.315 | 94.241 / 92.308 | 0.1891 / 0.3565 |
| temporal-pan | 60 | blend | 91.238 / 87.280 | 60.610 / 44.524 | 0.1062 / 0.1806 |
| temporal-pan | 60 | interpolate | 84.784 / 77.465 | 84.468 / 65.040 | 0.2364 / 1.0824 |

Full-period blending follows the prescribed box target better during the synthetic pan and reduces derivative error, but smears text and scores poorly against the instant target. The unmodified interval gives no convincing visible reason to replace normal sampling. Interpolation is slower and has larger stress errors. Neither is enabled by default. [Temporal records](evidence/temporal.json) and [synthetic-pan records](evidence/temporal-pan.json) preserve both targets and exact artifacts.

## Native 10-bit gradient stress

The blue ramp is a procedural, 10-bit 4:4:4 SDR signal, not real sky footage. Both delivery models still produce 8-bit 4:2:0. The uploaded HEVC Main10 arm changes codec and precision together, so it is not a bit-depth-only ablation.

| Simulator | Upload | VMAF mean / p5 | CAMBI mean, lower is better |
|---|---|---:|---:|
| youtube | naive | 99.354 / 99.028 | 17.265 |
| youtube | fast | 98.773 / 97.321 | 12.446 |
| youtube | hevc10 | 99.097 / 98.137 | 15.706 |
| reels | naive | 99.402 / 99.028 | 20.852 |
| reels | fast | 98.945 / 98.682 | 21.030 |
| reels | hevc10 | 98.991 / 98.753 | 21.195 |

The naive arm wins VMAF on this stress. YouTube-like CAMBI improves most with our H.264 arm, while the Reels-like arms remain strongly banded by CAMBI. Main10 upload does not guarantee smoother 8-bit playback and is not promoted. No natural-sky corpus was available in the supplied sources. [Gradient records](evidence/gradient10.json) retain this counterexample rather than excluding it from the report.

## Other techniques and simulator sensitivity

- Higher-resolution YouTube upload alone loses here. UI VMAF is 97.066 for native 1080p, 95.656 for 1440p, and 95.695 for 2160p under the same 1080p simulator. This does not test real codec-allocation policy.
- On real 8-bit UI, HEVC Main10 gives 97.128 versus 97.066 for H.264. On the gradient clip, it gives 89.419 versus 89.479 and worsens CAMBI. The tiny, inconsistent benefit does not justify changing the interoperable default.
- Mild `hqdn3d` and a 4:4:4 intermediate with chroma-only Gaussian blur give small, inconsistent changes on X UI and satellite clips. Neither beats the selected CAS recipe consistently. Upsampling cannot restore chroma already missing from the 4:2:0 masters.
- CAS is contrast-adaptive edge sharpening, not semantic text segmentation. No libplacebo/Vulkan or custom text-mask superiority is claimed. The tested software filters are retained only where the measurements support them.

The following checks use the gradient clip only. They do not replace the complete base cohort or calibrate real ABR behavior. The AV1 alternative uses SVT preset 8, capped CRF30, and a nominal 2 Mbps ceiling request. Its rate-control syntax differs from VP9; SVT requires zero target bitrate in CRF mode.

| Stress assumption, gradient clip only | Naive VMAF mean / p5 | Ours VMAF mean / p5 | Gain mean / p5 |
|---|---:|---:|---:|
| youtube, libvpx-vp9, rate multiplier 0.6 | 85.493 / 66.853 | 86.488 / 68.924 | 0.995 / 2.071 |
| youtube, libvpx-vp9, rate multiplier 1.5 | 90.184 / 81.488 | 91.278 / 81.940 | 1.093 / 0.453 |
| reels, libsvtav1, rate multiplier 1.0 | 89.215 / 78.306 | 90.594 / 79.812 | 1.379 / 1.506 |

## Performance

Three warm-cache trials per encoder and profile each process an actual 60-second loop of the real UI reference, following a warm-up. The times include the export call and its probes, but exclude input-loop preparation, simulation, scoring, and final frame-count audit. There is no audio in this timing input. Both paths use four FFmpeg codec threads and two filter threads. This is a shared workstation, including other processing during portions of the run. Trials are not randomized and have substantial variability; these are observed timings, not isolated throughput or causal speedup claims.

| Profile | NVENC seconds per minute, median [min, max] | x264 seconds per minute, median [min, max] | NVENC minus x264 UI VMAF mean / p5 |
|---|---:|---:|---:|
| youtube | 13.64 [13.13, 14.01] | 19.08 [17.76, 35.26] | 0.039 / 0.035 |
| shorts | 17.44 [14.18, 27.59] | 44.60 [43.18, 50.23] | 0.030 / -0.112 |
| tiktok | 30.50 [17.30, 32.86] | 43.21 [27.87, 57.61] | 0.329 / 0.387 |
| reels | 22.55 [15.84, 23.24] | 37.30 [31.50, 42.51] | 0.115 / 0.022 |
| x | 45.35 [42.35, 48.22] | 29.45 [16.08, 43.29] | -0.038 / 0.417 |

NVENC has the lower observed median on four profiles. X is the exception: CPU is faster in this run. Its complete four-clip CAS comparison loses 0.334 pooled mean VMAF and 0.549 pooled p5 versus NVENC. The selected X recipe retains NVENC for that measured quality advantage, not a false claim that NVENC is always faster. `--encoder libx264` exposes the CPU tradeoff. The test does not establish equal quality at a different software CRF or isolate system-load effects.

Raw trials are in [performance.json](evidence/performance.json). The short-clip extrapolations in `evidence/tables.md` are diagnostic timings, not the sustained timings above.

## Visual inspection

The sheets use fixed source coordinates, the same frame in every arm, and nearest-neighbor enlargement. Crop positions are chosen to include actual content. In particular, the portrait UI crop is not the empty center of the code panel.

All sheets were inspected with `vision_analyze`. Observations are descriptive, not a blinded perceptual study:

- Native-resolution YouTube and portrait-platform differences are often small. Both simulator arms remove some texture from the dark editor background. Existing motion-blurred code is already blurred in the reference.
- X CAS slightly strengthens text strokes and edges. The inspected text crop has no conspicuous new halo, but stronger contrast is not recovered source detail.
- At 720p, Lanczos plus CAS preserves more letter and road-label definition than naive scaling. At 480p, all arms lose fine satellite detail; sharpening does not reconstruct it. Linear-light UI scaling changes stroke and edge appearance and loses badly on the full-reference metrics.
- The synthetic-pan filmstrips show the box target and blend smearing glyphs at fast portions of the pan. Interpolation keeps sharper glyphs in some snapshots but does not reliably match the instantaneous reference. The original-motion filmstrips show much smaller differences.
- The procedural ramp crops show horizontal contouring after 8-bit delivery. Differences are subtle in these displayed PNGs; they do not justify a blanket claim that Main10 removes banding. The display path is not a calibrated 10-bit viewing system.

Artifact directory: `/mnt/zer0models/project-artifacts/fframestudio/delivery/`.

| Sheets under `sheets/` | Subject |
|---|---|
| `youtube-crops.png`, `shorts-crops.png`, `tiktok-crops.png`, `reels-crops.png`, `x-crops.png` | Reference, naive, and selected output for every real content class |
| `lowres-ui-720.png`, `lowres-ui-480.png` | Colored text, matched-quality control, and linear-light alternative |
| `lowres-satellite-720.png`, `lowres-satellite-480.png` | Buildings, roads, and map labels |
| `temporal-30-filmstrip.png`, `temporal-60-filmstrip.png` | Unmodified source at three times |
| `temporal-pan-30-filmstrip.png`, `temporal-pan-60-filmstrip.png` | Explicit synthetic pan at three times |
| `gradient10-youtube.png`, `gradient10-reels.png` | Native 10-bit ramp through 8-bit delivery |

## Verification and remaining limits

- The final suite passes 18 executable regression and integration tests, including real NVENC fixed-GOP encoding, SVT-AV1 simulation, audio normalization, special-character metric paths, geometry and alignment rejection, cache invalidation, and preservation of earlier recipe artifacts. [Test log](evidence/tests-final.log), [test receipt](evidence/tests-final.json).
- All 20 selected platform/content uploads were replayed through the shipping CLI and default JSON profiles. Their decoded SHA-256 hashes match the uploads used for the published scores. [Replay receipts](evidence/default-profile-replay.json).
- Both optional low-resolution profile files were loaded by the CLI and produced the required geometry and decoded frame count. [Low-resolution CLI receipts](evidence/lowres-profile-smoke.json).
- Ruff checks, Ruff formatting, compilation, and whitespace checks pass. The static scan found no listed secret, shell-evaluation, or unsafe-deserialization patterns. These checks are not a security audit. [Gate receipts](evidence/gates.json), [code hashes](evidence/code.json).
- The cohort audit finds exactly 40 main groups with frame indices 0 through 89, totaling 3,600 frame scores. There are 62 main and ablation rows, 30 sustained performance trials, and 15 inspected sheets. [Results](evidence/results.json), [artifact hashes](evidence/artifact-integrity.json), [356 recorded command receipts](evidence/commands.json).

The delegated run used self-review, not an independent reviewer. The optional `no-mistakes` gate is not initialized in this repository, so no pipeline approval is claimed.

The lab caught and repaired NVENC scene-cut insertion, JPEG matrix misinterpretation, stale export receipts after rejected output, wrong-track audio analysis, incompatible SVT CRF/target-rate options, interpolation-reference phase mismatch, and benchmark filename collisions across recipe revisions. Affected measurements were rerun. Versioned reference preparation rejects stale cached references; changing original source content still requires a fresh output directory.

The original request's real-platform claim remains unproved. Required next evidence is authorized upload/download measurement across accounts and devices, with delayed transcode observations, held-out native portrait content, natural fast motion and sky gradients, longer videos, calibrated HDR handling, and real-time perceptual assessment. PQ/HLG input is rejected by this SDR exporter. Wide-gamut SDR and non-square pixels are outside the qualified corpus. The README explains how to reproduce the local measurements without posting anything.
