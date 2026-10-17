# Roadmap

This file compares fframestudio against CapCut, Descript, DaVinci Resolve, Premiere Pro, Kdenlive and Clipchamp, and records what exists, what is planned and what we will not build. Status is shipped, in progress, planned or not planned; M1 is DESIGN.md build-order steps 1–3, M2 is steps 4–5, and M3 is step 6 plus the deferred work.

## Edit

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| Project library with tag filters | CapCut, Descript, Resolve, Premiere, Kdenlive, Clipchamp | shipped | M1 | Local library over imported projects; search is planned. |
| Import of fframes projects | — | shipped | M1 | Reads originals only; edits saved in the studio copy. |
| Project player with shot seek | CapCut, Descript, Resolve, Premiere, Kdenlive, Clipchamp | shipped | M1 | Selecting a shot seeks the video; playhead follows. |
| Editable shot text saved to project | Descript, CapCut, Clipchamp | shipped | M1 | Text fields per shot; edits marked and persisted. |
| Undoable commands with labelled history | CapCut, Descript, Resolve, Premiere, Kdenlive, Clipchamp | in progress | M1 | Pointer, menu and assistant use one command contract. |
| Story, Timeline and Inspector views | Descript, Resolve, Premiere | in progress | M1 | One document, several views (DESIGN §1). |
| Versions (whole-film alternatives) | Descript | in progress | M2 | Comparison between alternatives; takes mean performances (05 §3). |
| Crash recovery and autosave | Kdenlive, Resolve, Premiere | planned | M1 | Durable local saves before feature breadth (01 §G). |
| Trimming: ripple, roll, slip, slide | Resolve, Premiere, Kdenlive | planned | M2 | Visible duration and handle rules; undo restores state. |
| Insert, overwrite and three-point editing | Resolve, Premiere, Kdenlive | planned | M3 | Explicit verbs with visible collision results. |
| Nested sequences and compound clips | Resolve, Premiere, Kdenlive | planned | M3 | Reusable groups with open-in-place and cycle checks. |
| Multicam sync and angle switching | Resolve, Premiere, Kdenlive | planned | M3 | Timecode or waveform sync; audio master stays explicit. |
| Media relinking and missing-media warnings | Resolve, Premiere, Kdenlive | planned | M2 | Stable asset identity; a filename is not identity (02 §11.2). |
| Proxies and optimised media | Resolve, Premiere, Kdenlive | planned | M3 | Original and proxy availability per participant (02 §11.5). |
| Separate simple and pro project formats | — | not planned | — | One document, several views (DESIGN §1). |
| Node graph as the main editing surface | Resolve | not planned | — | Graph stays behind ordinary controls (02 §11.2). |

## Timeline

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| Zoomable, scrubbable timeline with thumbnails | CapCut, Descript, Resolve, Premiere, Kdenlive, Clipchamp | planned | M1 | Trim handles and reorder preview (05 §4 first slice). |
| Frame-exact seeking | Resolve, Premiere, Kdenlive | planned | M1 | Mediabunny spike: 50/50 seeks frame-exact against FFmpeg (DESIGN §5). |
| Frame and sample stepping, JKL transport | Resolve, Premiere, Kdenlive | planned | M2 | Keyboard and pointer share one resolver (02 §12). |
| Beat and bar ruler with editable offset | — | planned | M2 | Editable beat grid and cues (FFRAMES §4 F19). |
| Markers and in/out ranges | Resolve, Premiere, Kdenlive | planned | M2 | Named markers feed review and export ranges. |
| Snapping with visible consequences | Resolve, Premiere, Kdenlive, CapCut | planned | M2 | Show what will move before committing (02 §11.3). |
| Explicit gaps and absolute-position mode | — | planned | M2 | Preserve time instead of always closing space (02 §4). |
| Keyframes and curve editing | Resolve, Premiere, Kdenlive | planned | M3 | Parameters animate only when asked (02 §3). |
| Retiming: speed maps, hold, reverse | Resolve, Premiere, Kdenlive | planned | M3 | Source time and sequence time stay separate (02 §12). |
| Track targeting and locks | Resolve, Premiere, Kdenlive | planned | M3 | Explicit ordering and routing containers (02 §11.3). |
| Onion skins and consecutive strips | — | planned | M3 | Review frames without exporting the whole film (FFRAMES F36). |
| Long-timeline interaction budgets | — | planned | M2 | p95 seek and edit targets (ETHOS §3). |

## Text & captions

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| Editable titles on the canvas | CapCut, Clipchamp, Resolve | planned | M2 | Text edits apply to the selected shot. |
| Transcript-linked editing (words to media) | Descript, Premiere | planned | M2 | Words view edits media; correction differs from cutting. |
| Separate correct-text and cut-media commands | Descript | planned | M2 | Two distinct commands, not one ambiguous delete (05 P10). |
| Automatic captions and speech-to-text | CapCut, Descript, Clipchamp, Premiere, Kdenlive | planned | M2 | Transformers.js in browser; whisper.cpp natively (DESIGN §5). |
| Subtitle import, edit and export | Kdenlive, Resolve, CapCut | planned | M2 | SRT and VTT sidecars plus caption tracks. |
| Speaker labels and diarisation | Descript | planned | M3 | Speaker labels attach to transcript spans. |
| Filler-word and pause removal | Descript, Premiere, Clipchamp | planned | M2 | Proposal over ordinary cuts, reviewable first (05 P10). |
| Caption styles and timing templates | CapCut, Descript, Clipchamp | planned | M3 | Styles expand into editable properties (05 P03). |
| Translation and dubbing | Descript | planned | M3 | A Business-tier capability in Descript (01 §12). |
| Safe areas and title guides | Resolve, Premiere, Clipchamp, CapCut | planned | M3 | Guides per delivery target (FFRAMES P04). |
| Missing-glyph and font-portability report | — | planned | M2 | Report missing glyphs instead of substituting silently (FFRAMES F48). |
| Animatable title presets | CapCut, Resolve, Premiere | planned | M3 | Presets initialise editable timing and easing (05 P03). |

## Audio

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| Audio lanes with waveforms | Resolve, Premiere, Kdenlive, CapCut, Clipchamp | planned | M2 | Sample-accurate placement is M3 (FFRAMES §2 D5). |
| Semantic audio roles (dialogue, music, effects) | Premiere, Resolve | planned | M2 | Roles are labels and export intent (02 §11.3). |
| Volume, fades and gain keyframes | Resolve, Premiere, Kdenlive, Clipchamp | planned | M2 | Editable automation, not a rendered result. |
| Auto ducking as editable keyframes | Premiere | planned | M2 | Regeneration warns before overwriting manual curves (02 §3). |
| Noise reduction and audio cleanup | CapCut, Premiere, Descript, Kdenlive | planned | M2 | Task-named operations that stay undoable (01 §8). |
| Loudness and true-peak checks | Resolve, Premiere, Kdenlive | planned | M3 | Audio report beside export (FFRAMES F24). |
| Beat detection with editable cues | — | planned | M2 | Analysis cached; cues owned by the user (FFRAMES F20). |
| Licensed music and SFX catalogue | CapCut, Clipchamp, Kdenlive | planned | M2 | CC BY catalogue first; credits generated (DESIGN §6). |
| Music generation | — | planned | M3 | ACE-Step 1.5 pilot, MIT weights (DESIGN §6). |
| Soundtrack critique plugin | — | planned | M3 | Earshot audio.analyze plugin (DESIGN §6). |
| Channel mapping, buses and routing | Resolve, Premiere, Kdenlive | planned | M3 | Mix and routing revealed on request (05 P06). |
| Voiceover recording | CapCut, Descript, Clipchamp, Kdenlive | planned | M3 | Records into an ordinary audio lane. |
| Audio-only export | Clipchamp | planned | M3 | WAV or AAC alongside the video file. |

## Effects & color

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| Effect stack with visible scope | Kdenlive, Resolve, Premiere | planned | M2 | Source, occurrence, track or whole project (02 §7). |
| Keyframeable effect parameters | Resolve, Premiere, Kdenlive | planned | M3 | Simple control until animation is requested (02 §3). |
| Exposure, white balance, contrast, look | Resolve, Premiere, Clipchamp, CapCut | planned | M2 | Basic correction before scopes (02 §12). |
| Scopes and colour-managed grading | Resolve, Premiere, Kdenlive | planned | M3 | Input, working and output transforms (02 §12). |
| Secondary corrections, masks, tracking | Resolve, Premiere | planned | M3 | Masks via MediaPipe; hard-edge quality unproven (DESIGN §5). |
| Transitions | CapCut, Descript, Resolve, Premiere, Kdenlive, Clipchamp | planned | M2 | Handles are explicit; none created silently (02 §11.2). |
| Preset motion and animated components | CapCut, Resolve, Premiere | planned | M3 | Presets expand into keyframes (05 P03). |
| Temporal blend and motion blur | — | planned | M3 | Same-duration blend differs from slow conform (FFRAMES F08). |
| Background removal and cutout | CapCut, Clipchamp | planned | M3 | MediaPipe masks; preview before applying (DESIGN §5). |
| Subject tracking and camera reframe | CapCut, Resolve | planned | M3 | Protected regions with manual override (FFRAMES P04). |
| Stabilisation | Resolve | planned | M3 | Task-named operation over ordinary parameters. |
| LUT import and management | Resolve, Premiere, Kdenlive | planned | M3 | Import, preview and scope-aware application. |
| HDR delivery validation | Resolve | planned | M3 | Validate output instead of claiming support (02 §12). |
| Node-based compositing | Resolve | not planned | — | Fusion-style graphs are not the editing model (02 §11.2). |

## Export & delivery

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| Export video with preflight and verification | CapCut, Descript, Resolve, Premiere, Kdenlive, Clipchamp | planned | M1 | Playable file checked, not a download event (05 P18). |
| Licence gate on export | — | planned | M1 | Fail-closed for unverified assets; credits generated (DESIGN §6). |
| Platform-personalised exports measured with VMAF | — (CapCut, Clipchamp have fixed platform presets) | in progress | M2 | Bridge verifies frame count, A/V sync and VMAF (DESIGN §5). |
| Resolution and rational-fps export fields | Resolve, Premiere, Kdenlive | planned | M2 | Independent width, height and fps; support warnings (FFRAMES F01). |
| Conform down from a high-fps source | Resolve, Premiere | planned | M3 | Conform, blend and frame dropping stay distinct (FFRAMES F07). |
| Aspect presets: landscape, portrait, square | CapCut, Clipchamp, Resolve | planned | M2 | One document, several targets (FFRAMES P03). |
| Lossless master plus derived deliveries | Resolve | planned | M3 | Immutable master; derivatives grouped under one render (FFRAMES F10). |
| Export queue with progress and cancellation | Resolve | planned | M2 | Bounded jobs with artifact receipts (FFRAMES F04). |
| Expected frame count and duration receipt | Resolve, Premiere, Kdenlive | planned | M2 | ffprobe plus decode checks (ETHOS §3). |
| OTIO export with an explicit loss report | Resolve, Kdenlive | planned | M2 | Report unsupported features; never flatten silently (02 §11.4). |
| AAF, EDL and FCP7 XML interchange | Resolve, Premiere | planned | M3 | Translation is conversion, never native support (02 §10). |
| Subtitle sidecar export | Kdenlive, Resolve | planned | M2 | SRT and VTT delivered with the video. |
| Direct publishing to social destinations | CapCut | planned | M3 | Public sharing stays an explicit action (01 §G). |
| Watermarked free exports | Descript | not planned | — | The free tier can finish a project cleanly (01 §F). |

## AI/agents

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| ACP assistant with local agents | — | shipped | M1 | Claude, Codex, Gemini, Hermes, OpenCode over ACP (README). |
| Agent edits as reviewable proposals | Descript, CapCut | in progress | M1 | Agents routed through commands, not project.json (DESIGN §7). |
| Accept or reject individual changes | — | planned | M1 | Previewed diff per change; undo covers the batch (05 P08). |
| Interpreting where, when and what | Descript | planned | M2 | Show selection, range and region before applying (05 P11). |
| Generated footage, images and avatars | CapCut, Descript | planned | M3 | Generated assets become ordinary editable clips. |
| Automatic rough-cut assembly | Clipchamp, CapCut, Descript | planned | M2 | The draft stays editable in the timeline (01 §D). |
| Cost shown before a run | — | planned | M2 | Estimated minutes or cost before commitment (01 §F). |
| Cloud AI processing service | CapCut, Descript | not planned | — | The assistant runs on your local agents (DESIGN §7). |
| Editing still works when the assistant is off | — | planned | M1 | Core editing never depends on the assistant (05 P10). |

## Collaboration & review

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| Comments on clips, ranges and transcript | Descript | planned | M2 | Feedback stays attached to the content (01 pattern 14). |
| Compare versions by difference | Descript, Resolve | planned | M2 | Duration deltas and changed clips highlighted (05 P09). |
| Review link for non-editors | Descript | planned | M3 | Reviewers do not need the editor (01 §G). |
| Simultaneous editing with conflict rules | Resolve, Premiere | planned | M3 | Yjs document state; media outside the CRDT (DESIGN §4). |
| Bin and timeline locking | Resolve | planned | M3 | Ownership before simultaneous editing (02 §11.5). |
| Timeline comparison after concurrent edits | Resolve | planned | M3 | Accept or reject incoming changes. |
| Approval tied to a revision | — | planned | M2 | Notes go stale when their target changes (FFRAMES D7). |
| Stems export by role | — | planned | M3 | Dialogue, music and effects as separate files. |

## Platform

| feature | who has it | status | milestone | notes |
|---|---|---|---|---|
| Tern beta-ui add-on | — | shipped | M1 | Optional Luau plugin and Surface views; never a dependency (DESIGN §9). |
| Command palette with shortcut discovery | — | in progress | M1 | Search every command and synonym (05 P14). |
| Workspace customisation: layouts, remappable commands | Kdenlive, Premiere, Resolve | in progress | M2 | Layouts stay user-local (02 §12, DESIGN §2). |
| Offline work without uploading originals | Clipchamp | planned | M1 | Local bridge handles files and renders (01 §G). |
| Desktop shell and one-click install | CapCut, Clipchamp, Resolve, Premiere, Kdenlive | planned | M3 | Deferred until web and bridge gaps justify it (DESIGN §5). |
| Native mobile application | CapCut, Clipchamp | not planned | — | The web app is the product (DESIGN §9). |
| Touch and keyboard adapters over the same commands | CapCut, Clipchamp | planned | M3 | Same operations, different input (02 §12). |
| Accessibility: keyboard, screen reader, reduced motion | — | planned | M2 | Proposed requirements, not claimed passes (05 P17). |
| Sandboxed plugin execution | Resolve, Premiere | planned | M2 | Workers or iframes; no desktop IPC (DESIGN §6). |
| Optional scripting surface over commands | Resolve, Premiere | planned | M3 | Same IDs, validation and undo (05 P15). |
| Closed, app-specific project file | Resolve, Premiere, Kdenlive | not planned | — | Versioned open JSON with OTIO export (DESIGN §4). |
| UI theme separate from content style tokens | — | planned | M2 | Content survives theme changes (05 §3). |
| Telemetry without media, transcripts or prompts | — | planned | M2 | Log command IDs and outcomes only (05 §5). |

## Where we intend to beat them

- **Render at any resolution or fps, then conform down** (FFRAMES-FEATURES §3 F01, F06, F07). Width, height and rational fps are export fields; authored-clock migration and conform still need same-instant comparison tests before we claim them.
- **Platform-personalised exports measured with VMAF** (DESIGN §5, export row; FFRAMES-FEATURES P03). The bridge owns final encoding and verifies frame count, A/V sync and VMAF per target.
- **Agent-native editing through ACP on your own subscription** (DESIGN §7; README "Assistant"). Agents run locally with their own logins, no studio API key, and their changes go through the command system.
- **Frame-exact seeking** (DESIGN §5, preview and media rows). The Mediabunny spike measured 50/50 seeks frame-exact against an FFmpeg oracle; VFR and rotation are untested.
- **Performance budgets enforced in CI** (ETHOS §3). p95 preview, edit, seek and main-thread targets plus a controlled performance runner are proposed gates, not achieved numbers.
- **Open project format** (DESIGN §4; 02 §11.4). Versioned JSON with stable IDs and rational time, plus OTIO export with an explicit loss report for other editors.
