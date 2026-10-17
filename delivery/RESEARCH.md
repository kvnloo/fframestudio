# Platform evidence and simulator assumptions

Research date: **2026-10-17**. Upload requirements are not playback ladders. This project does not claim to reproduce any platform's proprietary transcode, popularity gating, device negotiation, HDR conversion, network ABR, or subsequent reprocessing.

## Verified upload guidance

| Platform / exact surface | Official guidance retrieved | Export implication |
|---|---|---|
| YouTube VOD [Y1] | MP4 fast-start; H.264 High, progressive, 4:2:0, closed GOP, two B frames; BT.709 SDR; match recorded FPS. 1080p30: 8 Mbps; 1080p60: 12 Mbps; 1440p30: 16 Mbps; 1440p60: 24 Mbps; 2160p30: 35–45 Mbps; 2160p60: 53–68 Mbps. Explicitly **no bitrate limit required**: these are recommendations, not hard maxima. | High-quality upload, correct matrix/range conversion, fixed GOP. Do not fabricate a maximum accepted bitrate. |
| YouTube Shorts creation [Y2] | Help says: “You can upload Short videos with a maximum resolution of 1080p.” | 1080×1920 default. This wording is upload guidance, **not proof of a universal playback cap across every surface**. |
| TikTok Content Posting API [T1] | MP4 recommended; MOV/WebM; H.264 recommended, HEVC/VP8/VP9 accepted; 23–60 FPS; both dimensions 360–4096 pixels; ≤4 GB. | 1080×1920 default is a conservative choice, **not a documented 1080p ingest cap**. Published maximum video bitrate not found. |
| Instagram Graph API Reels [I1] | Retrieved page updated Sep 28, 2026: MOV/MP4 fast-start; H.264/HEVC, progressive, closed GOP, 4:2:0; 23–60 FPS; maximum horizontal pixels 1920; recommended aspect 9:16; VBR ≤25 Mbps; AAC ≤48 kHz, 128 kbps, mono/stereo; 3 seconds–15 minutes; ≤300 MB. | 1080×1920, nominal maxrate 20 Mbps with a 10 Mbit buffer, measured average-video rejection above 25 Mbps, AAC 128k. These are this API's requirements and our conservative rate-control choices, not all app surfaces. |
| X **Media Studio** [X1] | MP4/MOV; H.264; recommended 5–8 Mbps; maximum 60 FPS; up to 1920×1080 landscape for ≤2h; 1280×720 recommended for longer video; AAC. Page explicitly excludes developer API, desktop/mobile upload guidance. | H.264 default, 8 Mbps VBV ceiling as a choice, **not a documented hard upload maximum**. Other X surfaces need separate validation. |

## What is known about playback

- **YouTube resolution/codec promotion:** Google recommends VP9-capable playback for new 4K uploads [Y1]. A creator's single-video measurement [M1, 2025-04-24] found VP9 bitrate allocations rising disproportionately above 1080p. Its reported values are 873 / 1,563 / 4,288 / 11,351 for 720/1080/1440/2160p60, but its table labels `bps` ambiguously (the magnitudes suggest kbps). This is weak, single-content evidence, not a controlled upload-resolution experiment and not proof that upscaling improves the *1080p rendition*. **Guaranteed 1440p→VP9 or AV1 promotion: UNVERIFIED.** The default experiment gives both arms the same codec/bitrate; it cannot manufacture a win by assigning our upload a better transcode.
- Google publishes generic VP9 web-distribution starting points [G1]: 1080p30 1800 kbps, 1080p60 3000 kbps; 1440p30 6000 kbps; CQ 31 at 1080. **This is not YouTube's current private ladder.** Our 1080p30 VP9 3000 kbps nominal rate is a deliberately explicit sensitivity-test assumption, not an extracted service bitrate.
- Meta's own engineers [I2, 2023-02-21] describe AVC/VP9/AV1 Reels, per-video convex-hull optimization, device-dependent decoding, and watch-time-dependent advanced encodes. They report 1080p30 AV1, 1080p60 on capable iPhones, and 10-bit HDR delivery up to 1080p30 in their then-current rollout. Their earlier engineering report [I3] describes basic H.264 ABR/progressive encodes and advanced encodes. **A single fixed H.264 transcode is only a basic-lane approximation; not representative of every Reels view.**
- TikTok playback codec, precise bitrate ladder, universal 1080p cap, HDR/10-bit behavior, and account/device-dependent quality: **UNVERIFIED**. The API accepts dimensions above 1080p; do not conflate ingest with playback.
- X playback codec/bitrate ladder and universal resolution limits: **UNVERIFIED** here. X states it may modify resolution and bitrate depending on viewer connection [X2].
- YouTube HDR [Y3] explicitly accepts 10/12-bit Rec.2020, PQ/HLG with correct metadata; recommends VP9 profile 2, AV1, HEVC. **10-bit SDR is not HDR.** This pipeline is SDR-only and rejects PQ/HLG rather than retagging it. HEVC Main10 is an experimental SDR precision path; no claim that the viewer receives 10-bit.
- Audio: Ian Shepherd's measurements [A1] report YouTube playback around −14 LUFS. This is a third-party measurement, **not a published YouTube upload requirement**. −14 LUFS / −1.5 dBTP is our configurable house target on all profiles. Exact TikTok, Reels, X and Shorts normalization targets: **UNVERIFIED**. Do not advertise a per-service loudness guarantee.

## Configurable simulator

All lanes use 30 FPS, 8-bit limited-range BT.709 4:2:0, 2-second GOP, bicubic playback scaling, constrained-quality single-pass encoding. CRF + maxrate is not CBR; actual bitrate depends on content. The row's bitrate is a **nominal target/maxrate request**, not an assertion that the service sends that average rate or a hard cap on a three-second file. The measured VP9 encodes can overshoot it substantially; actual container bitrates are reported alongside quality. Config: `platforms.json`; sweep nominal-rate multipliers 0.6/1.0/1.5. Every treatment arm gets identical settings.

| Platform | Playback dimensions | Codec / preset | CRF | Nominal kbps | Provenance / uncertainty |
|---|---:|---|---:|---:|---|
| YouTube | 1920×1080 | libvpx-vp9 good/cpu-used 4 | 31 | 3000 | G1 informs codec/CQ; exact rate/preset **UNVERIFIED** |
| Shorts | 1080×1920 | libvpx-vp9 good/cpu-used 4 | 32 | 2500 | Y2 informs resolution; codec/rate/CQ **UNVERIFIED** |
| TikTok | 1080×1920 | libx264 medium | 26 | 2500 | T1 informs conservative interoperable format; all playback parameters **UNVERIFIED** |
| Reels | 1080×1920 | libx264 medium | 25 | 3000 | I3 supports basic AVC lane; rate/CQ **UNVERIFIED**; AV1 sensitivity lane separate |
| X | 1280×720 | libx264 medium | 25 | 2000 | X1 informs dimensions; rate/CQ/playback codec **UNVERIFIED** |

## Sources

- **Y1** https://support.google.com/youtube/answer/1722171?hl=en — YouTube recommended upload encoding settings, retrieved 2026-10-17.
- **Y2** https://support.google.com/youtube/answer/10059070?hl=en — Get started creating YouTube Shorts, retrieved search text 2026-10-17.
- **Y3** https://support.google.com/youtube/answer/7126552?hl=en — Upload HDR videos, retrieved 2026-10-17.
- **T1** https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide — Media Transfer Guide, retrieved through Jina Reader 2026-10-17 after direct extraction failed.
- **I1** https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ — Reel Specifications, retrieved 2026-10-17; source page says updated Sep 28, 2026.
- **I2** https://engineering.fb.com/2023/02/21/video-engineering/av1-codec-facebook-instagram-reels/ — How Meta brought AV1 to Reels, primary engineering account.
- **I3** https://engineering.fb.com/2022/11/04/video-engineering/instagram-video-processing-encoding-reduction/ — Reducing Instagram's basic video compute time by 94 percent, primary engineering account.
- **X1** https://help.x.com/en/using-x/media-studio-faqs — Media Studio Library, retrieved 2026-10-17.
- **X2** https://help.x.com/en/using-x/premium-longer-videos — About longer videos, retrieved 2026-10-17.
- **G1** https://developers.google.com/media/vp9/settings — Google VP9 recommended settings, retrieved 2026-10-17.
- **M1** https://note.com/depachika/n/n4e3e8422c358 — creator analysis, one Nintendo Switch 2 promotional video; published 2025-04-24, revised 2025-06-08; retrieved 2026-10-17. Bits-per-pixel is **not** perceptual quality and cannot establish a universal win.
- **A1** https://productionadvice.co.uk/youtube-loudness/ — Ian Shepherd, third-party loudness measurements; retrieved 2026-10-17. Page's date text is inconsistent (March 2015 heading and December 2015 prose); treat as historical observation, not current contractual specification.

No test content was uploaded or posted to any platform. Real upload→download calibration with authorized accounts, multiple devices, time-to-transcode observations and repeated trials remains required before marketing service-specific gains.
