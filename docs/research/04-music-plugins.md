# Music and sound plugins for fframestudio

**Checked:** 2026-10-17 (CDT). **Scope:** catalogue discovery/import, music generation, sound design, audio analysis, and export licensing. This is an implementation-oriented research assessment, not legal advice or clearance of individual recordings.

**Evidence labels:** **Verified** means observed in the cited documentation, licence text, repository, or a read-only API response—not independently audited or benchmarked. **UNVERIFIED** means missing, inaccessible, ambiguous, or not tested. Performance figures attributed to authors are not fframestudio measurements. “No public API found” is a research result, not proof that a private partnership API cannot exist.

## 1. Decision

Build **three independent plugin families**: `audio.catalogue`, `audio.generate`, and `audio.analyze`. A provider can implement more than one family, but generation must not be required to browse music, and analysis must not imply that an asset is licensed.

1. **Ship the existing local CC BY seed catalogue first**, with licence evidence, source links, credits, and explicit beat-grid coordinates. Add a curated ccMixter adapter: its public Query API explicitly permits third-party applications.[23][24]
2. **Add Openverse for discovery, not rights clearance.** It aggregates other hosts, requires independent licence verification, and prohibits catalog scraping. Its results must route through each originating provider's permitted download path.[60]
3. **Freesound is a strong SFX source, but commercial API use requires a separate arrangement.** CC0 or CC BY on a sound does not remove Freesound's API-use restrictions.[15][16][59]
4. **Pilot ACE-Step 1.5 as the first local music generator.** Its code and model card declare MIT, the model card explicitly permits commercial generated music, and upstream documents a configuration appropriate to 8–12 GB GPUs. Pin the exact checkpoint and dependencies before promotion.[7][30]
5. **The likely “earshot” is `Leonxlnx/earshot`: CPU audio understanding, soundtrack QA, and procedural SFX—not a replacement for a full-song music model.** Integrate it as analysis/selection/optional sound synthesis.[1]
6. **Do not promote MusicGen/MusicGPT into a default commercial generation lane.** MIT wrappers do not remove the CC BY-NC weight restrictions. DiffRhythm also needs special handling: its DiT is Apache-2.0, but its VAE has the Stability AI Community licence.[4][9][71]
7. **Treat cloud and commercial catalogue integrations as contracts, not just endpoints.**
   Epidemic Sound and Artlist have genuine partner APIs.[33][42]
   ElevenLabs has an official Music API, but its current terms restrict multi-model resale and third-party music libraries.[45][46]
   Suno has no official developer API verified here; Udio expressly says it has no public API and its current terms prohibit downloadable/commercial output use.[52][51]

### Important changes a stale comparison would miss

- **YuE v1 and YuE2 are not licence-equivalent:** v1 declares Apache-2.0 including weights; current YuE2 has Apache-2.0 code but CC BY-NC weights plus an individual-creator exception. Commercial company use requires a separate agreement.[35][36][37]
- **Magenta RealTime is now MRT2 on the default branch:** Apache-2.0 code, CC BY 4.0 weights; current native real-time support is Apple Silicon, while NVIDIA is documented for offline inference.[11][31]
- **SongGeneration's original GitHub and Hugging Face targets were unavailable** in this check. Search still indexes older content, and a retained fork contains a research/education-only licence. Do not describe it as MIT based on old snippets.[38][39]
- **Suno's current terms condition permitted commercial exploitation on an authorized download**, in addition to the applicable plan and restrictions. Older “paid generation means unrestricted commercial use” summaries are incomplete.[47][49] A current remix help page describes paid-download eligibility even for some original free-plan songs, while other help pages retain older wording; resolve the specific asset/transaction against the governing terms rather than assuming every upgrade is retroactive.[50]

## 2. What “copyright-free” must mean in the product

Use precise labels: **public domain / CC0**, **commercial use with credit**, **commercial use with ShareAlike obligations**, **noncommercial only**, **custom licence**, and **unknown**. “Royalty-free” is not a universal redistribution or sublicensing grant. Incompetech explicitly says its recordings are copyrighted, despite free licensed use.[57]

| Licence / status | Commercial synchronized video | Attribution / other obligations | Default export policy |
|---|---|---|---|
| CC0 | Generally allowed within the rights waived | No CC0 credit condition; preserve provenance anyway. Privacy, publicity, and third-party rights remain relevant.[65] | Allow after provenance check. |
| Verified public domain | Depends on jurisdiction and both composition and recording | A public-domain assertion is not proof; retain evidence | Review jurisdiction and recording provenance. |
| CC BY | Allowed | Creator and supplied notices, source, licence link, and indication of modifications; no endorsement claim.[63] | Allow with generated credits. |
| CC BY-SA | Commercial use is not prohibited, but synchronized audiovisual adaptations trigger ShareAlike obligations | Assess licensing of the resulting adaptation, not merely the extracted music file.[64] | Manual review/explicit compatible export mode. |
| CC BY-NC variants | Not for commercial use without separate permission | Attribution plus NC and any SA/ND obligations | Block commercial export. |
| CC BY-ND variants | Do not assume video synchronization is unmodified redistribution | Synchronization is treated as adaptation in the CC BY-ND 4.0 legal text, which permits producing but not sharing adaptations; obtain separate permission for distribution of the adaptation.[73] | Block video export pending a separate grant. |
| Legacy Sampling+ / unusual licences | Not equivalent to CC BY; advertising restrictions can apply | Parse exact version and scope.[24][59] | Manual review; no blanket whitelist. |
| Custom royalty-free / subscription | Only within licensed media, user, project, territory, and dates | Download certificates, unique credit tokens, safelisting, publication windows, or partner permission may apply.[40][41][67] | Evaluate actual entitlement, not provider name. |
| Unknown / missing licence | Not established | “Found online,” “free download,” and a search engine licence filter are not permission.[60] | Block public export. |

**Separate rights layers:** (1) composition/lyrics, (2) master recording, (3) samples/performers/voices, (4) catalogue metadata and service access, (5) plugin code and all model checkpoints, and (6) output-use terms. A permissive layer does not clear the others. Do not automatically impose a model's NC licence on every output as a legal conclusion; instead block commercial *generation using restricted weights* and require output provenance/permission for imported generated assets.

## 3. A — Libraries and bulk catalogues

### 3.1 Openly licensed / community sources

Rate limits below are provider-published unless explicitly labelled a live observation. **UNVERIFIED** is not permission to bulk crawl. Where no API exists, API auth/rate limits are **N/A**; website access limits and automation permission remain separate.

| Source | Audio licence and commercial video use | Attribution | Access, auth, limits, and third-party app constraints | Metadata / plugin fit |
|---|---|---|---|---|
| **Free Music Archive (website)** | Per-track CC variants, including NC/ND/SA; some special/legacy statuses. Commercial video only with a compatible specific track licence.[18] | Per-track BY obligations; do not use the FAQ's statement that CC0 requires attribution as the CC0 legal rule—CC0 itself does not.[18][65] | **API shut down.** FMA forbids hotlinking and forwarding user searches to scrape HTML without explicit approval. Self-hosting compatible licensed music is allowed; coordinate app use with FMA. No live API quota.[17] | Genre, artist, tags, duration; BPM/mood completeness **UNVERIFIED**. Curated import, not a live scraped search adapter. |
| **FMA research dumps (`mdeff/fma`)** | **Code MIT; metadata CC BY 4.0; audio retains each artist's licence.** Dataset availability is not blanket commercial permission.[12] | Credit metadata separately from each recording; preserve track-level licence fields.[12] | Downloadable ZIPs: `fma_small` 8,000 × 30-second excerpts (7.2 GiB); `medium` 25,000 excerpts (22 GiB); `large` 106,574 excerpts (93 GiB); `full` 106,574 untrimmed tracks (879 GiB). No API auth required by documented download route; host bandwidth/quota **UNVERIFIED**. Historical snapshot, not current catalogue.[12] | `tracks.csv`, genres, tags, features; Echonest feature subset covers 13,129 tracks, not everything. Suitable for offline indexing/analysis experiments after licence filtering.[12] |
| **Jamendo API v3** | Per-track CC plus separate Jamendo commercial licensing. Use actual licence URL; filter NC/ND out for commercial sync, and review SA. `prolicensing=true` indicates licensing availability, not a purchased grant.[14] | Artist/CC credit plus Jamendo API attribution/branding.[14][66] | Public reads require `client_id`; OAuth2 for user actions. Advertised noncommercial allowance **35,000 requests/month**; list limit up to **200**. Commercial API apps require a quote. Honour `audiodownload_allowed`; no download when false. Terms disallow apps specifically designed to cache/provide offline content, allowing only reasonably necessary caching—negotiate editor storage/rendering rights.[13][14][66] | Rich genres/instruments/themes, vocal/instrumental, duration, speed categories, `musicinfo`, lyrics/licences. Numeric BPM is not a guaranteed field in the reviewed tracks schema.[14] |
| **ccMixter / dig.ccMixter** | Mainly CC BY and CC BY-NC paths; historic licences also exist. CC BY can support commercial sync; inspect remix ancestry and every included sample. Never treat all uploads as advertising-safe.[23][24] | Title, creator, source, exact licence and supplied remix/sample credits | Public `https://ccmixter.org/api/query`, JSON/RSS/HTML and licence/tag filtering; documented read queries do not require a key. Third-party websites/apps explicitly permitted. Numeric rate limit/bulk mirror permission **UNVERIFIED**: conservative caching and contact for scale.[23][24] | Tags, artists, licences, uploads; useful stems/a cappellas/remix relationships. BPM/tag quality varies; do not promise a normalized beat grid.[23][24] |
| **Openverse audio API** | Aggregates CC/CC0/public-domain metadata; commercial permission depends on the original recording. Openverse does **not verify licensing**.[60] | Track attribution plus prominent “made using Openverse, not endorsed/certified” notice.[60] | `/v1/audio/`; anonymous access or registered bearer-token flow. **Live observed:** 20 requests/minute and 200/day anonymous headers. Authenticated numeric quota **UNVERIFIED**, inspect response headers/account. No catalog scraping or rate-limit bypass. Hosting-provider terms still apply.[34][60] | Live response included creator, licence/version/URL, original landing URL, tags, genres, duration, sample rate, waveform and attribution. No BPM field in the inspected result. Best discovery aggregator, with provider-specific resolution. |
| **Freesound API (SFX, loops, ambience)** | CC0, CC BY, CC BY-NC; legacy Sampling+ exists. CC0/BY candidates can be used commercially subject to rights/credit; NC blocked.[59] | BY creator/source/licence; also properly credit Freesound in API integration.[16][59] | API token for search/previews; OAuth2 for original-quality downloads. Standard **60/min, 2,000/day**; originals and specified write resources **30/min, 500/day**. Free API is **noncommercial only**; commercial app needs agreement. Do not replicate Freesound or bypass quotas with extra keys.[15][16] | Tags, licence, duration, audio descriptors including estimated BPM/pitch, previews, similar-sound search. Analysis may be inaccurate. Strong SFX plugin once API permissions are secured.[15] |
| **Incompetech** | Kevin MacLeod recordings under CC BY 4.0; separate paid Standard Licence when credit is unwanted/impossible. Commercial sync allowed under compatible terms.[21][57][63] | Use provided credit generator, retaining title/author/licence/source and changes.[21][57] | Website downloads; no supported public search/download API or unrestricted bulk-app integration verified. API auth/quota N/A. Prefer curated self-hosted assets under their CC grants; avoid scraping/hotlink dependence. | Existing seed supplies local BPM/mood. Provider BPM/genre/mood coverage and stable machine catalogue **UNVERIFIED**. Excellent first curated pack. |
| **TeknoAXE** | The checked “Leftside Travels” source explicitly grants CC BY 4.0. Check each track rather than generalizing from one page.[58] | Creator, title, source, licence and changes | Track-page downloads; public API/bulk licence catalogue **UNVERIFIED**, API auth/quota N/A. Curated imports fit better than a scraper. | Existing seed already has two tracks and approximate measured BPM. Site-wide structured metadata coverage **UNVERIFIED**. |
| **Musopen** | Public-domain-oriented classical catalogue, but the site tells users to inspect each recording's licence icon. Terms disclaim PD certainty and also contain personal/noncommercial website-download language; obtain clarification where relevant.[28][62] | Depends on actual recording status; preserve composer/performer and source even when PD | No supported public API or blanket bulk-app permission verified. Account/download-plan limits **UNVERIFIED**. Do not implement purported `/api/v1/search` endpoints copied from third-party articles. | Composer, performer, instrument, period, moods, length and licence filters verified; BPM not verified.[62] Manual import only pending recording-specific clearance. |
| **Internet Archive audio** | Heterogeneous: PD, CC and restricted/all-rights-reserved material can coexist. Archive access is not a universal sync grant; it asserts no new copyright over deposited material.[27] | Per-item rights; preserve uploader, creator, original source and rights text | Official developer APIs and `internetarchive`/`ia` support discovery and file access. Public item access generally needs no login; restricted items can. A universal safe rate limit was **not verified**. Use provider backoff, bounded downloads, and collection/item restrictions; no indiscriminate mirror. | Flexible item/file metadata, titles/subjects/creator; BPM/genre/mood not consistently structured. Curated PD/CC collections, with rights review.[27] |
| **OpenGameArt** | CC0, CC BY, CC BY-SA and GPL/other offered alternatives; exact submission controls. FAQ permits commercial use with licence compliance, not unconditional proprietary-video compatibility.[26] | Follow `Copyright/Attribution Notice`; preserve chosen licence. If multi-licensed, record the particular alternative selected.[26] | Downloadable assets/packs; no supported audio search API or bulk mirror grant verified. API auth/quota N/A. Use curated packs rather than assuming Drupal internals are a contract. | Music/SFX tags and descriptions; BPM/mood mostly submission-dependent (**UNVERIFIED** as normalized fields). Review SA/GPL media obligations. |

**Bulk-download recommendation:** start with a small, audited CC0/CC BY manifest; optionally index the FMA metadata snapshot offline and download only eligible items. A research archive's full ZIP is technically bulk-downloadable, but that does not make every included track suitable for a commercial video editor.[12] Openverse must not be used to work around Freesound/Jamendo service restrictions.[60]

### 3.2 Free/custom and commercial libraries

| Source | Licence / commercial-video scope | Credit requirements | API / auth / rate / embedding | Metadata and decision |
|---|---|---|---|---|
| **Pixabay Music** | Custom Pixabay Content Licence, **not CC0**. Allows free use/adaptation under restrictions, including no standalone distribution. Additional third-party rights can remain.[20] | Content licence does not require creator credit; keep evidence/certificate for claims.[20] | **No public music API documented.** Official API covers images/videos, not audio. Its key auth, **100 requests/60s**, 24-hour caching and no systematic mass downloads are **image/video rules**, not an audio endpoint entitlement.[19] | Music catalogue metadata fields/API coverage **UNVERIFIED**. Manual user import with licence evidence or negotiated integration; do not ship an unofficial scraper. |
| **YouTube Audio Library** | Creative Commons tracks and standard YouTube Audio Library licence. Official help explicitly permits monetized YouTube videos; off-platform scope of a standard-licence recording must be confirmed from its actual terms.[25] | CC tracks require the copied credit in video description; standard no-attribution filter exists.[25] | Access through signed-in YouTube Studio. No public Audio Library catalogue/download API verified; do not confuse it with YouTube Data API. No automation/bulk-app permission or rate limit verified. | Genre, mood, title, artist, duration; SFX category/duration. User-mediated import, retaining the exact licence and credit text.[25] |
| **Mixkit Music** | Custom Stock Music Free Licence: commercial/noncommercial web/social/VOD, podcasts and ads; **not TV/radio, CDs/DVDs or video games**. No music-only remix/rights-registration use.[22] | No credit obligation identified in the reviewed Music Free Licence text; recheck full user terms and exact asset (**full terms not reviewed here**). | No public music API/bulk integration verified. Website downloads are not permission to redistribute an in-app stock library. API auth/quota N/A. | Genre/mood/BPM structured API **UNVERIFIED**. Manual imports; export destination must distinguish online video from broadcast/game. |
| **Bensound** | Custom Free/paid licences. Free applies to specified freely accessible online videos/live streams, or non-revenue educational theatrical/film use; paid tiers expand scope. SaaS/platform integrations are explicitly an Enterprise/Custom use case.[41] | Free download's **unique, single-video attribution code** must be retained verbatim; paid licences have certificates.[41] | No public catalogue API verified. Enterprise agreement needed for platform scope; API credentials/quotas **UNVERIFIED**. No standalone redistribution, and editing is limited to allowed basic operations.[41] | Search metadata completeness **UNVERIFIED**. Licence-receipt import before any integrated catalogue. Do not assume stems/time-stretch/remix are covered. |
| **Uppbeat** | Custom licences. Current Basic licence is for solo creators, not client work/organizations or paid ads; affiliations/sponsorships can be included. Other business/solo-professional/custom terms must match use.[40] | Free users must include the supplied Music Credit; preserve the download-specific credit and licence version.[40] | No public API, quotas or bulk/app distribution rights verified. Do not treat an ordinary subscription as partner authorization. Trial downloads do not authorize publication.[40] | Rich discovery UI is not a documented API; BPM/genre/mood machine contract **UNVERIFIED**. User imports or negotiated partnership. |
| **Epidemic Sound** | Commercial, custom partner licences; no open-content grant. Free API plan is **prototype only**, up to **50 downloads**, no commercial launch. Paid production terms and end-user permissions govern release.[33] | API AUP has attribution obligations; exact brand/end-user-credit treatment comes from the negotiated licence.[67] | **Official API.** API key recommended, ES Connect user auth also supported. Quotas shown in account/contract, no universal number verified. Temporary track/collection caching at most **60 minutes**; explicit user-selected downloads have additional workflow provisions. Safelisting and production agreement required as applicable.[33][67] | Music/SFX search, collections and partner metadata. Confirm BPM, moods, stems and rendering-storage rights against purchased endpoint contract before implementing. Strong paid-provider candidate. |
| **Artlist** | Custom enterprise licensing, not CC. Appropriate agreement can authorize platform catalogue integration and commercial uses; ordinary creator licence is not a blanket sublicence.[42][44] | Contract-specific credit/branding: **UNVERIFIED**; do not promise credit-free API embedding | **Official Enterprise API** for browse/search/stream/download. Account-manager-issued API keys obtain access tokens; tokens expire after **1 hour**. Numeric quotas, caching and end-user sublicensing must be confirmed with account manager.[42][43] | Verified genre/category, vocal-type, duration, waveform and BPM min/max filters. Strong paid search/preview candidate after contract review.[44] |

**Not interchangeable permissions:** hearing a preview, downloading an original, storing it for rendering, distributing editable projects, sharing stems, and exporting a finished video are different actions. Each plugin must declare which actions its service contract and asset licence authorize.

## 4. B — Generation and audio tools

### 4.1 GitHub snapshot, obtained with `gh`

Commands used: `gh search repos earshot --sort stars`, related repository searches, and `gh api repos/<owner>/<repo>`, `/readme`, `/license`, and selected `/contents` endpoints. Stars and `pushed_at` are a check-date snapshot, not a quality ranking or last stable release date. GitHub's SPDX classification describes the detected repository licence only.

| Repository | Stars observed | Last pushed (UTC date) | GitHub-detected code licence | Source |
|---|---:|---|---|---|
| `Leonxlnx/earshot` | 410 | 2026-10-16 | MIT | [1] |
| `pykeio/earshot` | 217 | 2026-08-30 | Apache-2.0 | [2] |
| `EnvelopSound/Earshot` | 73 | 2026-10-08 | GPL-2.0 | [3] |
| `facebookresearch/audiocraft` | 23,737 | 2026-03-03 | MIT | [4] |
| `Stability-AI/stable-audio-tools` | 3,887 | 2026-10-09 | MIT | [5] |
| `ace-step/ACE-Step` | 4,945 | 2026-02-15 | Apache-2.0 | [6] |
| `ace-step/ACE-Step-1.5` | 13,695 | 2026-10-11 | MIT | [7] |
| `multimodal-art-projection/YuE` (now YuE2 default branch) | 12,055 | 2026-10-06 | Apache-2.0 | [35] |
| `ASLP-lab/DiffRhythm` | 2,347 | 2025-11-27 | Apache-2.0 | [8] |
| `tencent-ailab/SongGeneration` | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED — HTTP 404** | [38] |
| `gabotechs/MusicGPT` | 1,462 | 2025-02-09 | MIT | [9] |
| `riffusion/riffusion-hobby` (redirect from `riffusion/riffusion`) | 3,900 | 2024-07-22 | MIT | [10] |
| `magenta/magenta-realtime` (now MRT2) | 1,833 | 2026-10-02 | Apache-2.0 | [11] |

### 4.2 “Earshot” disambiguation

**Most likely match: `Leonxlnx/earshot`.** Its README describes “ears for coding agents,” CPU-only CLI/Python/MCP interfaces, soundtrack listening/critique, matching and locating sounds, and a Forge subsystem for code/DSP synthesis and fitting recordings. It also includes a real-recordings soundtrack workflow. This is unusually close to the user's video-studio context, but identity remains an inference until the user confirms.[1]

- **Licensing:** MIT code; README lists CLAP `laion/larger_clap_general` as Apache-2.0 and AST `MIT/ast-finetuned-audioset-10-10-0.4593` as BSD-3-Clause. Independently pin and verify those checkpoint terms before bundling. References used for recording-to-code fitting remain separately licensed; Earshot cannot certify provenance or licence compliance.[1]
- **Hardware/latency:** CPU-only; Python 3.10+, FFmpeg/ffprobe; first model use downloads roughly 1.4 GB. Author reports roughly 1.5 minutes for listening through a 60–90-second film on a laptop CPU. No GPU or browser-native inference required/verified.[1]
- **Controls/outputs:** sound search/ranking, sample-accurate trim suggestions, timeline analysis, loudness and sync checks, deterministic procedural recipes. Not a documented text-to-full-song model; BPM/genre/mood judgments are hints, not authoritative metadata. Generated/fitted sounds do not acquire clearance merely by passing its critic.[1]
- **Other plausible names:** `pykeio/earshot` is a small streaming **voice-activity detector**, useful for speech-aware ducking rather than music generation; `EnvelopSound/Earshot` is an **RTMP→DASH multichannel/ambisonic transcoder**, not a generator, with GPL/commercial-licensing considerations.[2][3]

### 4.3 Code, weights, and output rights

All local candidates below require checking dependency/checkpoint licences, not only the headline model. “Commercial candidate” means no known blocker in the reviewed main grant, not guaranteed non-infringement or copyright ownership.

| Tool/model | Code versus weights | Output/use conditions and commercial disposition |
|---|---|---|
| **MusicGen / AudioCraft** | MIT code; released model weights CC BY-NC 4.0.[4] | Commercial inference with those weights is not authorized by the MIT wrapper. No separate unrestricted output-ownership grant verified. **Research/noncommercial lane**; commercial exception requires documented permission. AudioCraft's AudioGen SFX weights need the same per-model review.[4] |
| **Stable Audio Open 1.0** | `stable-audio-tools` MIT; model card now identifies **Stability AI Community Licence**, not the older blanket noncommercial description.[5][29] | Community policy permits commercial use within its revenue/other conditions; enterprise licence above the stated USD $1M organization-revenue threshold. Stability says users own outputs as between the parties, subject to law/AUP. Exact gated checkpoint licence was inaccessible here: **release gate remains open**, including required notices/registration and threshold boundary.[53] |
| **ACE-Step v1 / v1.5** | v1 code and HF model metadata: Apache-2.0. v1.5 code/model card: MIT.[6][69][7] | v1.5 model card explicitly permits commercial generated music. Preserve code/weight notices on redistribution; output copyright/non-infringement is not guaranteed. v1's distinct output ownership statement **UNVERIFIED**. **Preferred local pilot: v1.5**, with pinned component manifest.[30] |
| **YuE v1** | Original model and weights declared Apache-2.0; preserved on `YuE-v1` branch.[36] | README encourages commercial incorporation of outputs and attribution. Current licence section makes attribution encouragement, not the earlier news item's mandatory-credit wording; pin exact release/legal files. Still audit codec components. Commercial candidate, heavy hardware burden.[36] |
| **YuE2** | Apache-2.0 code; **CC BY-NC 4.0 weights + additional individual-creator permission**.[35][37] | Individuals acting in their own creative capacity may monetize outputs, including client licensing, without model royalties; company commercial use needs a separate licence. Exception does not authorize commercial redistribution/sale of weights. **Do not enable company-hosted commercial generation by default.** Not simply “YuE is Apache.”[37] |
| **DiffRhythm** | Apache-2.0 code and DiT weights; **VAE derived from Stable Audio Open is under Stability AI Community Licence**.[70][71] | Full pipeline inherits VAE obligations: checked VAE licence requires commercial registration, revenue/Affiliate conditions, agreement/notice and “Powered by Stability AI” branding when making relevant products/services available. It says output belongs to the user as between user/Stability to the extent law permits. **Conditional candidate, not wholly Apache.**[72] |
| **SongGeneration / LeVo** | Current original repo returned 404; original HF model also unavailable. Retained fork's Tencent licence explicitly covers code **and weights**, allowing academic/research/education only, prohibiting commercial **or production** uses.[38][39] | Old indexed “MIT”/“Apache” metadata conflicts with retained actual licence. Current upstream grant/output ownership **UNVERIFIED**. **Block production/commercial plugin** until exact release is recovered and licensed. A permissive UI wrapper cannot cure this. |
| **MusicGPT (`gabotechs`)** | MIT Rust application; downloaded weights explicitly CC BY-NC 4.0.[9] | Local MusicGen packaging, not an independently commercially cleared model. Output ownership **UNVERIFIED**; same restricted-generation policy as MusicGen. Do not confuse it with unrelated hosted services using the MusicGPT name.[9] |
| **Riffusion hobby** | MIT code; model card declares **CreativeML OpenRAIL-M** weights, not MIT.[10][32] | Behaviour/use restrictions require exact licence review and preservation on redistribution. No blanket output ownership/non-infringement promise verified in the fetched model card; **conditional legacy experiment**, not cleared modern hosted-Riffusion API access. |
| **Magenta RealTime 2** | Apache-2.0 code; model card says weights CC BY 4.0.[11][31] | Google claims no rights in generated outputs; user responsible for inputs/output use. Preserve model attribution/notices when distributing weights; this is not automatically a mandatory credit on every waveform. **Commercial local candidate** with hardware caveats.[31] |

Model-card revisions observed through Hugging Face metadata (licence declarations, not downloaded/verified weight bytes):

- ACE-Step v1: `82cd0d7b6322bd28cd4e830fe675ddb6180ce36c` — `apache-2.0`.[69]
- ACE-Step 1.5: `19671f406d603126926c1b7e2adc169acbcade22` — `mit`.[30]
- Magenta RealTime 2: `010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc` — `cc-by-4.0`.[31]
- Riffusion model v1: `8f2e752c74e8316c6eb4fdaa6598a46ce1d88af5` — `creativeml-openrail-m`.[32]

### 4.4 Hardware, latency, controls, and runtime

**No generation benchmark was run in this research. Every RTX 3080 Ti 12 GB assessment below is feasibility analysis, not certification.** Reserve VRAM for the editor/rendering context, decode peaks and other processes; an advertised 12 GB requirement leaves no guaranteed headroom on a 12 GB card. None of these Python/CUDA demos proves browser-native WebGPU/WASM execution. Browser UI + local sidecar/cloud API is a different architecture.

| Candidate | RTX 3080 Ti 12 GB assessment | Latency evidence | Controls / length / stems | Deployment |
|---|---|---|---|---|
| **MusicGen** | Small model is plausible; upstream recommends 16 GB for medium and says smaller GPUs can use small/short sequences. Medium is not a supported 12 GB default.[61] | Exact 3080 Ti and target-length latency **UNVERIFIED**; autoregressive jobs should be asynchronous | Text, duration, model-dependent melody conditioning/continuation. BPM mostly prompt intent, not hard grid; native multi-stem output not verified.[61] | Python sidecar/server; not browser-native verified |
| **Stable Audio Open 1.0** | 12 GB suitability **UNVERIFIED**; test fp16/batch-one/offload before recommending | No dependable end-to-end 3080 Ti timing verified | Up to **47s**, 44.1 kHz stereo; text/length/seed; BPM in prompt is not a guarantee; not realistic vocals; no native stems verified.[29] | Local `stable-audio-tools`/Diffusers; self-host HTTP job adapter |
| **ACE-Step v1** | Upstream optimized/offload path claims **8 GB** max VRAM; promising on 12 GB, not measured here.[6] | Author reports four minutes in 20s on A100; separate benchmark table reports 60s generated in 4.70s on 3090 at 27 steps. Different settings; do not transplant to 3080 Ti.[6][69] | Text/lyrics, duration, editing/remix/conditioning; StemGen is a specific additional capability, not universally available in every checkpoint.[6] | Local Python/Gradio; versioned sidecar |
| **ACE-Step 1.5** | Best documented fit: 2B turbo/sft + **0.6B LM for 8–12 GB**; low-memory mode can disable LM/use offload. XL requires ≥12 GB with offload/quantization, ≥20 GB recommended—exclude XL from default.[7] | Author claims full song under 10s on RTX 3090; prompt/length/think-mode dependent, not a measured 3080 Ti SLA.[7] | **10–600s**, lyrics, BPM, key/scale, time signature, edit/repaint, structure planning; track separation/completion depend on model/task. Record requested and measured values separately.[7] | Local API/worker; Gradio is UI, not browser inference |
| **YuE v1** | Native large pipeline not a safe 12 GB default. Upstream links community quantized 8 GB routes; these need a separate pin/licence/quality test.[36] | Author: 30s audio ≈150s on H800 or ≈360s on RTX 4090.[36] | Lyrics/genre, sectional generation, audio prompts, vocals/accompaniment; long multi-section songs need much more memory. Multi-instrument StemGen remains a TODO in reviewed v1 README.[36] | Python worker, preferably remote; avoid blocking editor |
| **YuE2** | Official quick start: BF16 NVIDIA **24 GB**. **No verified 12 GB path.**[35] | 3080 Ti/production latency **UNVERIFIED** | Lyrics/style → editable melody/chord ABC plan → audio; covers and score editing. Tempo/form via score, but an edit rerenders a recording; not waveform-preserving localized editing. Native exported instrument stems **UNVERIFIED**.[35] | Python staged API, remote GPU candidate; not browser-native |
| **DiffRhythm** | Base requires minimum **8 GB with `--chunked`**; plausible 12 GB pilot. Do not extrapolate to full model/duration.[8] | End-to-end 3080 Ti timings **UNVERIFIED** | Base **95s**, full **285s**; text/audio style reference, timed lyrics, instrumental/vocal options, extension/editing. Numeric BPM enforcement and isolated instrument stems **UNVERIFIED**.[8] | Python/Docker sidecar; validate exact DiT+VAE bundle |
| **SongGeneration** | Indexed upstream README claims base **10/16 GB**, base-full **12/18 GB**, large **22/28 GB** profiles. **UNVERIFIED live upstream**; do not promise 12 GB operation.[38] | Indexed A100 RTF table lacks a live verified implementation context; no usable latency commitment | Lyrics/reference/style and full-song output reported; exact BPM, stems and runtime capability **UNVERIFIED** for recoverable version | Quarantined research only; no production adapter |
| **MusicGPT** | CPU or CUDA execution documented; small-model 12 GB fit is plausible but untested | README benchmarks exist, but exact 3080 Ti performance **UNVERIFIED** | Natural-language prompt, duration/model choice; MusicGen limitations; no verified hard BPM/structure/native stems.[9] | Native Rust/ONNX application, local web UI/Docker—not browser-native inference |
| **Riffusion hobby** | Stable-Diffusion-class GPU path; 12 GB fit **UNVERIFIED** for pinned settings | Upstream says real time needs ~50 steps in under 5s, citing 3090/A10G; CPU is slow.[10] | Spectrogram-based prompt/seed interpolation and short evolving audio; exact BPM, long-form structure, isolated stems not verified | Local Python inference server; browser playback/UI, not local browser model |
| **Magenta RT / MRT2** | MRT2 documents NVIDIA offline inference but no 3080 Ti memory guarantee. Small 230M variant is a sensible test target; base 2.4B is not certified.[11] | MRT2 native real-time tables apply to Apple Silicon. Original v1 moved to `v1_legacy`; do not mix v1 TPU metrics with MRT2.[11] | Continuous instrumental generation, style conditioning and example note-control applications; exact tempo locking/stems **UNVERIFIED** for chosen runtime.[11][31] | Python JAX/MLX; C++ Apple-Silicon engine and AUv3 examples. No verified browser-native port |

### 4.5 Proprietary generation APIs (not open-source models)

| Provider | Official integration / auth / limits | Output terms and commercial export | Controls, latency, hardware |
|---|---|---|---|
| **Suno** | **No official public developer API verified** in this research. Unofficial “Suno API” businesses and GitHub cookie wrappers are not evidence of Suno authorization. Current terms prohibit robots/scraping and competing uses.[47] | Pro/Premier assignment covers Suno's rights, subject to restrictions; free/basic personal noncommercial. Current terms require a **permitted download** for commercial exploitation; remixes have separate restrictions. Help pages have changing generation/download/upgrade wording, so retain actual plan/download receipt, not a generic paid-plan boolean.[47][48][49] | Hosted web app, no local weights or browser-local inference. Prompt/lyrics/structure/stem capabilities are product-version dependent; no supported plugin API schema, quota or latency verified. **User-authorized import only** pending official partner contract. |
| **Udio** | Help explicitly: **no public API**.[52] | Current terms claim company/licensor ownership of output, permit personal/noncommercial use, prohibit output downloads, and restrict publication/distribution outside allowed service sharing. Old paid-commercial-use advice is unsafe. **Not a viable export source under reviewed terms.**[51] | Cloud generation; feature controls do not overcome unavailable lawful export. Plugin latency, BPM/stem API and hardware requirements N/A; no weights. |
| **ElevenLabs Music** | Official `POST /v1/music` / compose API; `xi-api-key` authentication. Generation/download/concurrency limits vary by plan/model; query actual entitlement, do not assume unlimited.[46][68] | Music Terms retain user input/output rights as between parties but impose clearance responsibility and plan media limits. Non-Enterprise media rights exclude film/TV/radio/studio games in current table. **Music Library distribution and Model Resale—including alongside third-party models—need written authorization.** A generic multi-provider generation selector needs explicit review, even with BYOK.[45] | Endpoint supports **3,000–600,000 ms**, prompt **or** composition plan, sections/lyrics, instrumental option, seed with constraints; API marketing lists streaming/stems/editing. Older overview says 5 minutes: use selected model's actual endpoint/entitlement. Latency **UNVERIFIED**, cloud only; 3080 Ti irrelevant.[46][68] |
| **Google Lyria** | Official Gemini API. Lyria RealTime uses bidirectional WebSocket; batch Lyria 3 Clip/3.5 also documented. API key/project quota; numerical plan/model limits **UNVERIFIED** here.[54][56] | Google says it does not claim ownership of generated content; that is not exclusive copyright or an infringement warranty. Apply Gemini API terms, model/region restrictions and AUP; verify commercial deployment scope for the selected experimental/paid service. Unpaid-service data use differs from paid-service protections.[55] | RealTime: stereo PCM, weighted prompts, **BPM 60–200**, scale/density/brightness, mute/reduce bass/drums; BPM/scale change resets context. Always watermarked. Controls are not downloadable independent stems. Clip model 30s; Lyria 3.5 prompt-directed multi-minute songs/structure. Cloud streaming/batch; browser client is remote inference. End-to-end latency on target network **UNVERIFIED**.[54][56] |

**Ownership caution:** contractual permission to monetize, a provider declining to claim output ownership, copyrightability in a jurisdiction, and freedom from third-party infringement are four different questions. Do not market any generator as “copyright guaranteed.”

## 5. Proposed plugin contract (design, not implemented)

Keep the core framework theme/platform agnostic. Plugins return data, capabilities and jobs—not DOM, theme tokens, absolute filesystem paths, or provider-specific UI components. Browser, desktop, CLI and headless-renderer hosts can consume the same contract.

```ts
type Decision = "allow" | "deny" | "review" | "unknown";
type Capability =
  | "search" | "preview" | "acquire" | "generate" | "continue"
  | "edit" | "beatGrid" | "stems" | "analyze" | "creditLine";

type ExportUse = {
  commercial: boolean;
  media: "online-video" | "paid-ad" | "broadcast" | "film" | "game";
  territories: string[];
  clientWork: boolean;
  publishAt: string;
  distributingEditableProject: boolean;
  distributingStems: boolean;
};

type Evidence = {
  url: string;
  checkedAt: string;
  snapshotSha256?: string;
  receiptRef?: string; // host secret/evidence store, not public URLs
  checkpointRevision?: string;
};

type Rights = {
  label: string;
  spdxOrCustomId: string;
  version?: string;
  licenseUrl: string;
  evidence: Evidence[];
  commercialSync: Decision;
  adaptation: Decision;
  redistributeOriginal: Decision;
  redistributeStems: Decision;
  attributionRequired: boolean;
  shareAlike: boolean;
  noDerivatives: boolean;
  nonCommercial: boolean;
  suppliedCredit?: string; // preserve single-use tokens verbatim
  creditPlacement?: ("description" | "end-card" | "package-notice")[];
  restrictions: string[];
  rightsHolder?: string;
  entitlementRef?: string;
};

type AudioAsset = {
  id: string; // `${providerId}:${providerAssetId}`
  providerId: string;
  sourceUrl: string;
  title: string;
  creators: { name: string; url?: string; role?: string }[];
  durationSeconds?: number;
  genre: string[];
  mood: string[];
  bpm?: { value: number; origin: "provider" | "measured"; confidence?: number };
  rights: Rights;
  parentAssetIds: string[]; // samples, reference tracks, derivation lineage
  generated?: {
    codeRevision: string;
    models: { id: string; revision: string; weightLicense: string }[];
    settingsRef: string;
    seed?: number;
    providerJobId?: string;
    entitlementRef?: string;
  };
};

type BeatGrid = {
  audioSha256: string;
  sampleRate: number;
  timeOrigin: "asset-start";
  analyzedRangeSamples: [number, number];
  beatSamples: number[];
  downbeatSamples?: number[];
  tempoSegments?: { startSample: number; bpm: number }[];
  confidence?: number;
  method: { name: string; version: string };
};

type AudioStem = {
  asset: AudioAsset;
  role: string;
  method: "provider-native" | "generated-native" | "source-separated";
  alignedStartSample: number;
  sampleRate: number;
  sourceAudioSha256: string;
};

type Context = {
  signal: AbortSignal;
  credentialsRef?: string; // resolved by host; never hand keys to UI
  intendedUse: ExportUse;
};

type SearchRequest = {
  query: string; genre?: string[]; mood?: string[];
  bpm?: [number, number]; durationSeconds?: [number, number];
  commercialOnly: boolean; allowShareAlike: boolean;
  cursor?: string;
};

type Job = { id: string; state: "queued" | "running" | "done" | "failed" };
type AudioRef = { hostAssetId: string; sha256: string };
type GenerationRequest = {
  prompt: string; lyrics?: string; durationSeconds: number;
  bpm?: number; key?: string; timeSignature?: string;
  sections?: { name: string; durationSeconds: number; prompt: string }[];
  reference?: AudioRef; seed?: number; requestedStems?: string[];
};

interface MusicPlugin {
  id: string;
  version: string;
  capabilities: Capability[];
  runtime: "browser" | "local-worker" | "remote-api";
  servicePolicy: {
    commercialAppAccess: Decision;
    cacheTtlSeconds?: number;
    offlineStorage: Decision;
    requiresPartnerAgreement: boolean;
    termsEvidence: Evidence[];
  };
  search?(q: SearchRequest, ctx: Context): Promise<{
    assets: AudioAsset[]; nextCursor?: string; unsupportedFilters: string[];
  }>;
  preview?(id: string, ctx: Context): Promise<{
    url: string; expiresAt?: string; previewOnly: boolean;
  }>;
  acquire?(id: string, ctx: Context): Promise<{
    audio: AudioRef; asset: AudioAsset; evidence: Evidence[];
  }>;
  generate?(q: GenerationRequest, ctx: Context): Promise<Job>;
  poll?(jobId: string, ctx: Context): Promise<{
    job: Job; audio?: AudioRef; asset?: AudioAsset; stems?: AudioStem[];
  }>;
  cancel?(jobId: string, ctx: Context): Promise<void>;
  beatGrid?(audio: AudioRef, ctx: Context): Promise<BeatGrid>;
  stems?(audio: AudioRef, ctx: Context): Promise<Job>;
  creditLine(asset: AudioAsset, use: ExportUse): Promise<{
    text: string; placements: string[]; evidenceRefs: string[];
  }>;
}
```

### Contract rules

- **Core owns the final licence decision.** A plugin's `commercialSync: allow` is an assertion with evidence, not authority to bypass policy. Preserve raw licence URLs/versions and distinguish preview availability from acquisition/export rights.
- **Unknown is not false or true.** Unknown licence, absent BPM, unavailable stems and unsupported filters remain explicit. Do not silently broaden `commercialOnly` when a provider lacks that filter; post-filter/review or return no eligible result.
- **Model capability negotiation:** pin model/version, expose supported length range, hard versus soft BPM/structure controls, and native versus separated stems. Reject unsupported inputs rather than silently dropping them. This can extend `GenerationRequest`/plugin manifest in implementation.
- **Worker boundary:** local CUDA/JAX/Rust/FFmpeg work runs outside the UI thread. Jobs support progress, cancellation, timeouts, idempotency keys, cost estimates, GPU-memory admission and cleanup. Remote retries must not duplicate paid generations.
- **Storage is policy-aware:** signed previews expire; cache only permitted bytes/metadata and TTLs. A service prohibiting offline caching cannot be placed behind a generic permanent media cache. Persist lawful project assets separately from preview caches.
- **Secure resolution:** proxy only allowlisted provider hosts; defend against SSRF, oversized payloads, malformed codecs, path traversal and token leakage. Store credentials in the host secret system, never project JSON. An arbitrary plugin cannot exfiltrate reference audio without user consent.
- **Credits have placement and scope:** render human-readable credits and a machine-readable licence manifest. Preserve provider-issued single-use codes; do not invent or recycle Bensound/Uppbeat clearance tokens.[40][41]
- **Stems inherit source restrictions:** source separation is processing, not a new recording licence. Record separator/model licence, source hash, sample alignment, and reconstruction quality; never relabel extracted stems CC0.
- **Preview rights can differ from downloadable-asset rights.** OpenGameArt explicitly warns that previews may contain separate all-rights-reserved elements. Never extract a preview into the export merely because its nearby downloadable pack is CC-licensed.[26]
- **Quality metadata is qualified:** store requested BPM separately from measured BPM/beat confidence; allow tempo maps and nonmetrical audio. Generated output needs analysis just like library music.

## 6. Licence-safety policy and acceptance gates

### 6.1 Fail-closed export flow

1. Determine project use: commercial/client/paid advertising, distribution medium, territories, publication date, and whether editable audio/stems are delivered. Treat client/promotional/monetized exports as commercial by product policy unless an approved override establishes otherwise.
2. Resolve every audible asset and its sample/reference/stem parents to a rights record. Capture the original provider page, licence version, acquisition time and any entitlement/receipt. Unknown origin or contradictory evidence → `review`, not “free.”
3. Enforce **both** service integration rights and track/model rights. A CC BY sound cannot authorize commercial API access that the API agreement withholds.[16][66]
4. Block NC recordings in commercial exports, ND synchronization absent permission, and unfulfilled SA obligations. Default ordinary proprietary export should not quietly accept SA music; offer a reviewed compatible-publication mode.[64]
5. For local generation, inspect every required checkpoint, including VAE/codec/style encoder and adapters. Missing component licence → no production promotion. DiffRhythm's VAE is the concrete regression case.[71][72]
6. For cloud generation, validate model/version, plan, use category, authorized download and partner/resale rights. Do not infer entitlement from “paid” alone. Reject Udio output acquisition under reviewed terms; do not route around its download prohibition.[45][47][51]
7. Check modification and distribution permissions before time-stretching, remixing, stem extraction, or project packaging. A synchronization licence may authorize a finished video while forbidding raw-asset delivery.[41]
8. Generate credits and required brand disclosures, validate placement, and show the user exactly what must accompany publication. An internal `CREDITS.md` alone does not satisfy a requirement for a public video description.[25][41]
9. Export a `music-license-manifest.json` alongside the render: asset hashes, selected licence/grant, evidence refs, generation/checkpoint revisions, transformations, and credit strings. Keep private receipts out of the publicly shareable version.
10. Recheck expiring entitlements and applicable publication deadlines; do not blindly replace the original licence snapshot with today's terms. Valid historical grants and current service-access terms are distinct. Preserve disputes/Content ID evidence and provide a takedown/replace workflow.

### 6.2 Regression fixtures to require before release

| Fixture | Expected result |
|---|---|
| Known CC0 SFX with source evidence | Commercial video allowed; voluntary provenance credit retained |
| CC BY Incompetech track, no public credit placement | Block/repair until credit placed; export then allowed |
| NC Freesound loop in a paid client advertisement | Block even if manually downloaded or separated into stems |
| CC0 Freesound asset through unlicensed commercial API app | Service integration blocked despite compatible content licence |
| BY-SA synchronized music in ordinary proprietary export | Review, not silent allow |
| BY-ND track under unmodified background-video use | Block synchronization pending separate grant |
| Jamendo result with `audiodownload_allowed=false` | Preview-only; no acquisition through alternate URL |
| Openverse “commercial” result with missing origin licence | Review/block; aggregator flag insufficient |
| MusicGPT MIT wrapper with MusicGen NC weights | Commercial generation blocked |
| DiffRhythm Apache DiT plus unapproved Community VAE | Production generation blocked until all obligations satisfied |
| YuE v1 licence record accidentally reused for YuE2 | Reject model-revision mismatch |
| Bensound credit copied from another video | Block/obtain a fresh valid entitlement |
| Mixkit music exported for TV/game | Block under Music Free Licence |
| ElevenLabs used in multi-model selector without reviewed resale permission | Disabled pending written/contractual approval |
| Expired signed preview, malformed beat grid, failed source download | Explicit recoverable error; no placeholder audio presented as success |
| Generated 120-BPM request measures at a different tempo | Preserve measurement/confidence; do not claim exact beat synchronization |

### 6.3 RTX 3080 Ti qualification plan

This is **future work**, not completed testing: benchmark ACE-Step 1.5 2B turbo with 0.6B LM first; compare cold/warm generation of instrumental 15s, 30s and 60s cues, then one long song. Capture peak VRAM, host RAM, download/model hashes, wall time, audio duration, real-time factor definition, prompt/seed, decode time, clipping/loudness, measured beat drift and human listening notes. Repeat with editor/render load. Only promote settings with headroom and reliable cancellation. Run Earshot separately on CPU; do not assume its evaluation can judge taste or licences.[1]

## 7. Seed-studio migration

Read-only inspection confirmed **six** entries in:

- `/mnt/zer0models/workspace/zer0/products/traffic-vision/expresslane-pretotypes/music/tracks.json`
- `/mnt/zer0models/workspace/zer0/products/traffic-vision/expresslane-pretotypes/music/CREDITS.md`

| ID | Track | Artist | Existing declared licence | Existing approximate BPM |
|---|---|---|---|---:|
| `field` | Clean Soul | Kevin MacLeod | CC BY 4.0 | 80 |
| `dawn` | Lightless Dawn | Kevin MacLeod | CC BY 4.0 | 61.5 |
| `rise` | Inspired | Kevin MacLeod | CC BY 4.0 | 117.5 |
| `pulse` | Leftside Travels | TeknoAXE | CC BY 4.0 | 120 |
| `drive` | EDM Detection Mode | Kevin MacLeod | CC BY 4.0 | 129.2 |
| `reference` | Racket and Bang | TeknoAXE | CC BY 4.0 | 161.5 |

These are existing manifest declarations, not a new forensic clearance of every source file. The reviewed Incompetech FAQ and TeknoAXE track page corroborate the licensing approach.[57][58] The manifest contains beat arrays, peaks, excerpt offsets and approximate BPM notes measured from 24-second excerpts; credits describe three-minute loudness-normalized source excerpts.

Recommended migration:

- Implement `local-seed` as a catalogue plugin with manifest search/preview/acquisition, no network credentials.
- Resolve existing relative audio paths against an explicit manifest root; do not assume they are relative to the new studio working directory.
- Add source-specific landing pages, licence URLs, acquisition evidence and audio hashes. Preserve original `licence` strings; normalize into a separate parsed rights field, not by overwriting source text.
- Mark `bpm.origin = measured`, retain `bpm_note`, and record the actual analyzed interval. Verify whether `beats`, `first_beat_s`, and `excerpt_from_s` refer to full-asset or excerpt coordinates before converting to sample positions.
- Include “excerpted/loudness normalized” and any later edits in change notices. Credit every track that actually survives into the final audible cut, including its applicable licence link.
- Do not ship the old `reference` asset automatically merely because it is in a manifest; distinguish evaluation/reference material from publishable project assets and verify provenance.

## 8. Rollout priorities and unresolved work

| Priority | Plugin/workstream | Promotion gate |
|---|---|---|
| P0 | Core rights/credit/beat-grid interfaces + `local-seed` | Six source records, file resolution, hashes, public credits, time-coordinate tests |
| P1 | ccMixter discovery + audited local CC0/CC BY imports | API schema/auth smoke test, rate policy agreed for intended scale, sample ancestry review |
| P1 | Earshot CPU analysis/QA | Pin model licences; real CLI/Python smoke test; uncertainty exposed |
| P1 | ACE-Step 1.5 local worker | Complete component licence manifest + actual 3080 Ti memory/latency/listening benchmark |
| P2 | Openverse discovery + Freesound resolver | Origin-specific access rules; Freesound commercial API agreement before commercial deployment |
| P2 | Epidemic Sound / Artlist partner adapters | Production contract, end-user sync rights, storage/preview/export/credits and quotas confirmed |
| P2 | Google Lyria cloud generator | Chosen API/model/plan terms, region/quota/data handling and cost verification |
| P3 | Jamendo | Commercial API permission and offline/render asset handling clarified |
| P3 | Stable Audio Open / DiffRhythm / Magenta RT2 | Full component licence review and hardware test; conditional licence obligations implemented |
| Hold | MusicGen/MusicGPT commercial generation; SongGeneration production; YuE2 company hosting; Udio export; unofficial Suno API | Written compatible permission or materially changed verified upstream terms |
| Manual import | Pixabay, YouTube Audio Library, Bensound, Uppbeat, Mixkit, Musopen | Exact source entitlement and use scope; no scraping or assumed sublicence |

### Research limitations / verification record

- Verified GitHub stats/licence metadata and read relevant README/licence files through `gh`; no repositories cloned, no code installed, no generation executed, no purchases or contracts initiated.
- Verified a real anonymous Openverse audio search HTTP 200, returned fields and quota headers. Other provider API calls requiring keys/contracts were **not exercised**; documentation availability is not a working integration test.
- Exa search hit its shared free rate limit; research continued with the available web search/extraction tools and primary sources. Agent Reach update check reported current. Jev retrieval screening had no configured key and failed open; retrieved text was treated as untrusted data, not executable instructions.
- SongGeneration GitHub returned 404 through both `gh` and page retrieval; official HF target unavailable. Fork legal text is labelled historical/retained evidence, not proof of a current upstream grant.
- Stable Audio Open's direct gated licence required authenticated acceptance, which was not attempted. The model card/current licensing page and publicly accessible DiffRhythm VAE licence establish the conditional-licence issue, but do not substitute for saving the accepted checkpoint's exact agreement.
- Musopen FAQ timed out; official music/terms pages were retrieved instead. Several formerly plausible documentation paths returned 404 and were replaced by live primary sources.
- **No claim of exhaustive provider partnerships, complete catalogue licence coverage, actual GPU performance, browser-native generation, or legal clearance is made.** Unknowns above are release gates, not invitations to invent endpoints or terms.

## Sources

[1] https://github.com/Leonxlnx/earshot
[2] https://github.com/pykeio/earshot
[3] https://github.com/EnvelopSound/Earshot
[4] https://github.com/facebookresearch/audiocraft
[5] https://github.com/Stability-AI/stable-audio-tools
[6] https://github.com/ace-step/ACE-Step
[7] https://github.com/ace-step/ACE-Step-1.5
[8] https://github.com/ASLP-lab/DiffRhythm
[9] https://github.com/gabotechs/MusicGPT
[10] https://github.com/riffusion/riffusion-hobby
[11] https://github.com/magenta/magenta-realtime
[12] https://github.com/mdeff/fma
[13] https://developer.jamendo.com/v3.0
[14] https://developer.jamendo.com/v3.0/tracks
[15] https://freesound.org/docs/api/overview.html
[16] https://freesound.org/docs/api/terms_of_use.html
[17] https://freemusicarchive.org/app-developers
[18] https://freemusicarchive.org/faq
[19] https://pixabay.com/api/docs
[20] https://pixabay.com/service/license-summary
[21] https://incompetech.com/music/royalty-free/licenses
[22] https://mixkit.co/license
[23] https://ccmixter.org/query-api
[24] https://ccmixter.org/about
[25] https://support.google.com/youtube/answer/3376882
[26] https://opengameart.org/content/faq
[27] https://archive.org/developers
[28] https://musopen.org/tos
[29] https://huggingface.co/stabilityai/stable-audio-open-1.0
[30] https://huggingface.co/ACE-Step/Ace-Step1.5
[31] https://huggingface.co/google/magenta-realtime-2
[32] https://huggingface.co/riffusion/riffusion-model-v1
[33] https://developers.epidemicsound.com/docs
[34] https://api.openverse.org
[35] https://github.com/multimodal-art-projection/YuE
[36] https://github.com/multimodal-art-projection/YuE/tree/YuE-v1
[37] https://github.com/multimodal-art-projection/YuE/blob/main/MODEL_LICENSE
[38] https://github.com/tencent-ailab/SongGeneration
[39] https://github.com/6Morpheus6/songgeneration-tencent/blob/main/LICENSE
[40] https://uppbeat.io/uppbeat-basic-license
[41] https://www.bensound.com/terms-and-conditions
[42] https://developer.artlist.io/welcome
[43] https://developer.artlist.io/authentication
[44] https://developer.artlist.io/use-cases
[45] https://elevenlabs.io/music-terms
[46] https://elevenlabs.io/eleven-music-api
[47] https://suno.com/terms
[48] https://help.suno.com/en/articles/2416769
[49] https://help.suno.com/en/articles/9601665
[50] https://help.suno.com/en/articles/9604993
[51] https://www.udio.com/terms-of-service
[52] https://help.udio.com/en/articles/10756277-udio-public-api
[53] https://stability.ai/license
[54] https://ai.google.dev/gemini-api/docs/realtime-music-generation
[55] https://ai.google.dev/gemini-api/terms
[56] https://ai.google.dev/gemini-api/docs/music-generation
[57] https://incompetech.com/music/royalty-free/faq.html
[58] https://teknoaxe.com/Link_Code_3.php?q=2391
[59] https://freesound.org/help/faq
[60] https://docs.openverse.org/terms_of_service.html
[61] https://github.com/facebookresearch/audiocraft/blob/main/docs/MUSICGEN.md
[62] https://musopen.org/music
[63] https://creativecommons.org/licenses/by/4.0
[64] https://creativecommons.org/licenses/by-sa/4.0/legalcode.en
[65] https://creativecommons.org/publicdomain/zero/1.0
[66] https://devportal.jamendo.com/api_terms_of_use
[67] https://developers.epidemicsound.com/policy/acceptable-use-policy
[68] https://elevenlabs.io/docs/api-reference/music/compose
[69] https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B
[70] https://huggingface.co/ASLP-lab/DiffRhythm-base
[71] https://huggingface.co/ASLP-lab/DiffRhythm-vae
[72] https://huggingface.co/ASLP-lab/DiffRhythm-vae/raw/main/LICENSE.md
[73] https://creativecommons.org/licenses/by-nd/4.0/legalcode.en
