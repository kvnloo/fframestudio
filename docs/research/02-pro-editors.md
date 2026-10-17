# Professional NLEs: how they organize power

## Decision in brief

**Recommendation for fframestudio:** combine Final Cut Pro’s relationship-aware editing, Resolve Cut’s fast assembly, Premiere’s contextual controls, and an OTIO-compatible editorial core. Do not copy an entire desktop workspace or make a node graph the opening screen.

Build one project with several synchronized views: **Story**, **Timeline**, and an on-demand **Finish** workspace. Start with a primary story lane and attached visual/audio elements; reveal explicit tracks, routing, curves, and compositing only when needed. All views must operate on the same underlying edit, not on lossy “simple” and “advanced” project formats.

**Build on OpenTimelineIO for editorial semantics and interchange, not as the whole application document or rendering engine.** Keep a versioned fframestudio project model for relationships, roles, alternatives, effects, automation, collaboration, and narrative intent. Compile a portable editorial projection to OTIO and provide explicit loss reports when translating it to other editors. OTIO describes editorial cut information and external media references; its own feature matrix warns that adapters do not preserve every feature.[10][11]

## Scope and evidence

This is a documentation-based design analysis, not a hands-on benchmark or a claim that all eight products have equal professional maturity. Sources are primarily vendor documentation and upstream project documentation. Search-result evidence is used only for the specific features stated in the returned excerpt. Some documents are historical; they establish a design or feature’s existence, not its exact current shortcut, edition entitlement, or round-trip fidelity.

**UNVERIFIED** means this research did not establish the claim. It does **not** mean the product lacks the feature. Performance sections describe documented mechanisms, not measured comparative speed. Product facts have numbered citations; recommendations and UX judgments are explicitly analysis.

Two currency traps matter:

- Premiere’s former **Essential Graphics** editing functions moved to **Properties** beginning with version 25.0; do not specify a new product using an obsolete panel inventory.[8]
- Olive’s official site currently says “Olive will return,” while its upstream repository explicitly calls the software highly unstable alpha. Treat it as an architectural reference, not a demonstrated production baseline.[12][13]

## 1. Comparative map

The “lesson” and “cost” columns are design judgments based on the documented mechanisms, not usability measurements.

| Product | Organizing mechanism | What it makes easier | Complexity cost / lesson for fframestudio |
|---|---|---|---|
| DaVinci Resolve | Task-specific pages over a shared project; two editing surfaces.[1][27] | Assembly can stay in Cut; precision editing and finishing have dedicated environments. | Preserve continuity across views; avoid forcing page changes for trivial adjustments. |
| Adobe Premiere Pro | Dockable task workspaces, contextual Properties, and specialist panels; nested sequences.[8][38][58] | Familiar track editing can coexist with transcript editing and guided audio tasks.[9][23] | Do not make panel management a prerequisite for editing. |
| Final Cut Pro | Primary storyline, connected clips, semantic roles, auditions, and compound clips.[5][7][60] | Structural revisions preserve relationships; variants and delivery groups need not become permanent tracks. | Magnetic behavior needs visible anchors, predictable rules, and an explicit timing-preservation escape hatch. |
| Avid Media Composer | Bins, dedicated workspaces, trim tools, source/record distinction, and controlled shared-project workflows.[22] | Large editorial teams can divide work and maintain media discipline. | Ownership and sync protection are useful; copying the whole operational vocabulary is not. |
| Shotcut | Dockable panels and straightforward multitrack editing; filters, presets, and action search.[3] | Basic editing and incremental effects without a separate finishing application. | A flat filter catalog still needs curation; small interface is not the same as simple mental model. |
| Kdenlive | Configurable docks, project bin, sequences, effects stack, and track/master effect scopes.[4][32][46] | Substantial power remains in a recognizable editing workspace. | Always show whether a change affects one occurrence, a source, a track, or the whole project. |
| Olive | Timeline plus node editor, parameter editor, and curves.[28][51] | Reusable processing relationships are not limited to a linear effect stack. | Keep the graph behind ordinary controls; graph wiring is not an acceptable first-edit requirement. |
| Blender VSE | Strips in channels, meta strips, modular editors, and shared application capabilities.[29][33][44] | Editing can combine footage, generated material, scenes, and reusable groups. | Domain-general flexibility creates navigation overhead; expose only video-relevant tools initially. |

## 2. DaVinci Resolve: specialization without project conversion

### Workspace and timeline model

Resolve separates Media, Cut, Edit, Fusion, Color, Fairlight, and Deliver into task-oriented pages; the current product page additionally describes a Photo page. This analysis concentrates on video editing rather than treating every page as necessary for fframestudio.[27]

**Cut is a different interaction model, not simply Edit with fewer buttons.** Its upper timeline shows the whole program while the lower one shows the local editing region. Source Tape presents a bin’s clips as one browsable tape. Smart Insert targets a nearby edit, Append adds at the end, and Source Overwrite puts a synchronized cutaway above the existing footage.[1]

**Edit** exposes the familiar multitrack/dual-viewer workflow, source in/out marking, insert/overwrite/replace/fit-to-fill operations, track targeting and sync controls. Compound clips and nested timelines are documented alongside multicam clips; these are containers within the editing model, not separate project types.[2][64]

Multicam has two useful surfaces: Cut’s Sync Bin finds footage aligned with the current timeline position; Edit provides a fuller angle viewer, audio/timecode synchronization, independent audio/video switching, and access inside the multicam clip.[1][2]

### Trimming, animation, and finishing

The context-sensitive trim cursor exposes ripple, roll, slip, and slide based on pointer location. Edit also supports dynamic JKL trimming during looping playback and multitrack/asymmetric trimming.[1][2]

The Inspector groups clip settings; diamond controls enable keyframes, while timeline keyframe/curve editors reveal finer timing and easing. Cut also has a compact viewer tool strip for common transforms, audio, stabilization, and speed changes, avoiding an Inspector visit for every adjustment.[1][2]

Fusion supplies node-based compositing and animation; Color provides primary controls followed by secondary correction, windows, qualifiers, tracking, and HDR tools; Fairlight provides a DAW-like environment with sample-accurate editing, processing, and mixing.[27] Basic titles, Fusion title templates, subtitles, audio levels, EQ, and cleanup effects remain accessible from Edit rather than requiring a specialist page for every task.[2]

### Project, extension, and performance model

Project libraries support collaboration locally or through Blackmagic Cloud; the collaboration documentation describes bin/timeline locking, individually locked grading clips, update acceptance, timeline comparison, and private Project Server deployment. Project sharing and media availability are distinct concerns.[54]

OpenFX effects and third-party templates extend the creative tools. Resolve Studio documents Python/Lua scripting and JavaScript-based Workflow Integration plug-ins; exact API access and edition restrictions must be checked for the intended deployment.[2][18]

Resolve documents native OTIO/OTIOZ timeline import/export, with DRT for Resolve-to-Resolve timeline transfers and XML/AAF fallbacks for other applications. The cited OTIO introduction is an 18.5 beta feature guide, not proof of lossless conversion in every subsequent release.[26] DRT exports are also documented in the later 19.1 guide.[64] **EDL direction/variant coverage and DRP archive semantics: UNVERIFIED in this research.**

The Blackmagic Proxy Generator creates and links proxies from watched folders; collaborators can maintain their own caches.[54] Smart/User Render Cache modes are established in the historical reference manual: automatic caching of costly processing versus user-selected caching. Exact present-day cache invalidation behavior was not benchmarked.[65]

**Design takeaway:** use overview-plus-detail, direct edit verbs, and contextual trim previews. Keep the expert surface one click away without requiring a conversion, duplicate timeline, or new mental model.

## 3. Adobe Premiere Pro: contextual controls on a conventional track model

### Workspace and timeline model

Premiere organizes editing through panels/workspaces, with a conventional sequence/track/clip document model exposed by its developer APIs.[20][58] Nested sequences encapsulate multiple tracks as linked timeline clips: their source changes propagate to instances, while instance trimming does not trim the source itself.[38] A dedicated multi-camera source/target-sequence workflow is documented in Adobe’s user-guide navigation; the detailed synchronization and channel-mapping options were not evaluated here.[8]

The contextual **Properties** panel consolidates frequently used controls for selected video, audio, text, and graphics. It also supports multiselection and mixed property values, and provides links to more specialized tools. Essential Graphics is the historical reference; current guidance points to Properties and Graphics Templates instead.[8]

### Trimming, keyframes, color, audio, and titles

Premiere documents separate ripple, rolling, and slip tools, with slide editing in the same trim-tool family. Trim mode provides a two-sided editing context and dynamic JKL trimming.[41][58] This suggests a useful distinction for fframestudio: everyday edge dragging versus an explicit precision-trim view, not a toolbar permanently containing every edit operation.

Effect Controls and timeline keyframes expose animation; expanding an effect parameter reveals value and velocity graphs. The default should therefore remain a simple property control until the user asks to animate it.[63] Adobe’s current documentation includes Lumetri color workflows and specialist color panels; this study did not benchmark their grading output or enumerate every color-management mode.[8]

Essential Sound’s semantic tags—Dialogue, Music, Sound Effects, Ambience—support guided processing. Auto Ducking produces ordinary editable gain keyframes, rather than an opaque rendered result; generating them again overwrites manual changes, a behavior fframestudio should make explicit before regeneration.[23]

Text-Based Editing creates an editable assembly from transcripts: users select, reorder, and remove text to change the timeline, including pause/filler-word cleanup. It is another view of editorial operations, not a substitute for the final timeline.[9] Titles and graphics are edited contextually through Properties, with template discovery separated from property editing.[8]

### Collaboration, extensions, interchange, performance

Team Projects stores/manages the shared project in the cloud; Productions divides larger work into smaller linked projects, with shared media access and locking. Adobe explicitly distinguishes these workflows instead of presenting “collaboration” as one undifferentiated feature.[35]

UXP provides UI/file/network facilities and Premiere document APIs for projects, sequences, tracks, clips, effects, and export. Capabilities depend on both the host Premiere version and UXP version; manifest permissions matter. Do not base a new integration on undocumented internal APIs.[20]

Premiere exports AAF, CMX3600 EDL, and **Final Cut Pro 7 XML**, not the same XML dialect used by modern Final Cut Pro. Adobe warns about limited feature transfer and provides a translation log; AAF export also has explicit relinking, merged-clip, effects-rendering, and media-handling restrictions.[37][50][52] **Native OTIO import/export: UNVERIFIED; do not confuse an external OTIO adapter or extension with built-in support.**

Attached lower-resolution proxies enable editing against lighter media and switching back to originals. Preview files cache processed sequence segments and can optionally be used on export; proxies and previews solve different problems.[36][67]

**Design takeaway:** organize common controls around the selection, sound tasks around intent, and transcript editing around words. Keep advanced curves and effect ordering accessible without requiring users to discover the right workspace first.

## 4. Final Cut Pro: relationships and semantics instead of permanent track administration

### Workspace and timeline model

The main interface combines Libraries/events, a browser, viewer, and Magnetic Timeline. Events organize clips and projects; ratings and keywords aid selection.[6]

The primary storyline contains the main sequence. Connected clips attach B-roll, titles, music, and effects to story moments and move with their parent. Connected storylines provide their own sequencing. The Position tool and explicit gap clips let an editor preserve time instead of always closing space.[5]

A **compound clip** is a reusable, nestable mini-project containing video/audio components and other clips. A **multicam clip** has an angle editor for synchronization/angle contents and an angle viewer for cutting or switching audio and video together or separately.[7]

**Auditions** group alternative takes or treatments into one timeline location, with one active pick. The documented creation workflow can duplicate a clip with or without its applied effects; this is a compact alternative to littering the timeline with disabled copies.[7][30]

**Roles are semantic identity, not just track color.** They can organize the timeline and support delivery of separate role-based stems, including mono/stereo/surround assignments. Video roles can also visually distinguish footage categories.[24][60]

### Trimming, inspector, and finishing

Ripple is the default primary-storyline trimming behavior; the documentation’s glossary and trim guidance distinguish it from roll, slip, and slide. The precision editor exposes handles, and JKL provides shuttle/step playback.[7][47][56] These are not permission to assume every connected clip follows identical trim rules: fframestudio needs explicit operation semantics for each relationship type.

Audio and Video Animation editors expose parameter changes over time, while audio components can be expanded down to individual channels.[7] Color corrections are applied and selected in the Color inspector, including wheels and curves; the wheel display can be all wheels or one enlarged wheel.[55] Titles are connected visual content in the timeline, keeping their relationship to the story explicit.[5]

### Files, collaboration, extensions, performance

Libraries and external media can live on supported shared storage, but shared storage alone is **not evidence of simultaneous conflict-safe editing of the same library**. That stronger collaboration claim is **UNVERIFIED** here.[40]

Apple explicitly distinguishes three integration surfaces: **FCPXML** for media/timeline metadata exchange, **Workflow Extensions** for embedding another workflow inside the interface, and **FxPlug** for custom effects used in Final Cut Pro and Motion.[21] **Direct EDL/AAF/OTIO support is UNVERIFIED**; third-party conversion through FCPXML must be described as conversion, not native support.

Optimized/proxy media can be created during import or later; their locations can be managed within or outside the library.[61] Background rendering creates temporary render files for segments that cannot play at full quality in real time; it can be disabled or controlled manually.[66]

**Design takeaway:** make “stays with this shot,” “belongs to dialogue,” and “try another take” first-class concepts. Add a deliberate absolute-position mode. A primary storyline without anchors, gaps, and visible consequences would be a trap rather than a simplification.

## 5. Avid Media Composer: editorial discipline and controlled ownership — brief

Media Composer documents Edit, Color, Effects, and Audio workspaces, bins and shared projects, and source/record differentiation. Its timeline has explicit audio/video tracks; group clips and MultiGroup support multicamera editing.[22]

Its historical Editing Guide explicitly covers ripple trimming, JKL trimming, and slipping/sliding segments. The key lesson is dedicated edit-point work, not merely dragging clip rectangles; exact current trim shortcuts should be validated against the shipping build.[57]

The Effect Editor exposes parameters and advanced per-parameter keyframe graphs. Nested effects are accessible within the editor, with documented differences between standard and advanced keyframe effects.[62] This is evidence for effects nesting, not a claim that every form of sequence nesting behaves like Premiere or FCP compounds.

Color correction and Symphony options, the audio mixer and subframe audio operations, and Titler+ are documented; availability varies by tier. AVX video and AAX audio plug-ins, plus Media Composer Extensions, provide extensibility.[22]

Shared-project/storage workflows and locking are explicit product capabilities rather than an implication of copying project files. AAF import/export is documented, as are EDL import, ALE exchange, and background render/transcode/consolidate.[22] **Native OTIO/FCPXML, current project/bin file internals, and exact proxy relinking behavior: UNVERIFIED here.**

**Design takeaway:** borrow visible ownership, synchronization protection, source identity, and predictable precision editing. Do not require a novice to understand an enterprise’s storage topology before making a cut.

## 6. Shotcut: a small number of reusable concepts

**Workspace/model.** Shotcut provides dockable panels, saved layouts, a playlist/bin, and a multitrack timeline. Track hide/mute/lock, clip grouping, and loading complex MLT XML as a clip are documented; the latter offers composition reuse, but should not be equated with every advanced nested-sequence workflow.[3]

**Trimming.** Source/timeline trimming includes ripple, insert/overwrite/lift/ripple delete, three-point editing, and roll edits. JKL and frame-step controls are explicitly documented.[3][42] **Dedicated slip/slide and a full multicam angle-switching object: UNVERIFIED.** Audio-based clip synchronization is documented, but that alone does not establish a multicam editor.[3]

**Effects/finish.** Filters expose keyframes and easing, with presets for reuse. Color wheels, LUTs, scopes, text filters, subtitle import/edit/export, audio filters, audio mixing, fades, and ducking are listed. Overlapping clips on the same track creates a dissolve/crossfade, reducing the number of concepts needed for a basic transition.[3]

**Files/extensions/performance.** Native editable projects are MLT XML with autosave; EDL export is listed. MLT XML is **not FCPXML**. Frei0r is documented; the current feature list explicitly marks OpenFX and VST2/LV2 support as **work-in-progress**, so they are not a qualified compatibility promise. Proxies, preview scaling, thumbnail/waveform caching, and hardware acceleration are listed; these are not evidence of a Resolve-equivalent rendered-effects cache.[3] **Built-in concurrent collaboration, AAF/FCPXML/OTIO interchange, and a stable general-purpose scripting API: UNVERIFIED.**

**Design takeaway:** reuse one filter/property system, visible presets, overlap gestures, and action search. Preserve simple operations without pretending that all professional workflows are already covered.

## 7. Kdenlive: accessible tracks plus explicit effect scope

**Workspace/model.** Kdenlive combines a project bin, configurable monitors/docks, and a multitrack timeline. Nested timelines/sequences are documented; newer docking allows widgets to be grouped, hidden on demand, and layouts saved/shared.[4][32]

Its multicam tool works over aligned clips on different tracks: the monitor presents the angles, and selecting an angle cuts/lifts the other visual tracks while playback continues. Audio is not part of that switching operation. This is materially different from assuming a fully encapsulated FCP-style multicam clip.[16]

**Trimming.** The current editing manual describes slip, ripple, ripple-to-playhead, track targeting, independent A/V adjustments, and grouped resizing.[16] A legacy Kdenlive handbook describes JKL and roll/slip/slide concepts, but it is not proof of current tool parity. **Current dedicated roll/slide implementation and exact JKL mapping: UNVERIFIED in this research.**[43]

**Effects/finish.** The Effect/Composition Stack is the contextual property inspector. Effects can apply to a project-bin source, one timeline occurrence, a track, or Master. Favorites, reusable effect stacks, and descriptions reduce catalog navigation.[46] Keyframeable effects, scopes, titles, subtitles/speech-to-text, and Glaxnimate integration are documented; audio has a mixer and audio effects rather than requiring a separate application.[4][16][32]

**Files/extensions/performance.** `.kdenlive` is an XML project format, with autosaves, backups, and archiving for transfer.[45] Effects are supplied through the underlying processing framework, including frei0r/avfilter, and effect templates can be shared.[46] OpenTimelineIO import/export is documented; the 25.04 release explicitly warns that effects, filters, and transitions are not exported, despite work-in-progress transition support appearing in its changelog.[49] Proxies and timeline preview zones/automatic preview address source-decoding and effects-playback costs separately.[4][16]

**Native concurrent collaboration, direct AAF/FCPXML/EDL paths, and a stable scripting SDK: UNVERIFIED.** The April 2026 state report describes OpenFX and a keyframing/dopesheet refactor as upcoming work; do not turn that roadmap into a shipped-feature claim without checking the chosen release.[32]

**Design takeaway:** put the effect’s scope beside its controls. “This shot / every use of this source / this group / whole film” is more understandable than four nearly identical panels with implicit targeting.

## 8. Olive: useful processing architecture, unqualified production baseline

**Status.** The official site and upstream alpha warning are more reliable than third-party pages presenting Olive as a mature production suite. Upstream wiki pages also warn that information may be outdated.[12][13][51]

**Workspace/model.** The documented interface has footage/sequence viewers, Project, Timeline, Parameter Editor, Node Editor, Curve Editor, and Audio Monitor panels. The menu documents Nest, linking/unlinking, insert/overwrite, and ripple operations. **Multicam is UNVERIFIED.**[51]

**Trimming/effects.** The wiki lists ripple, rolling, slip, slide, and JKL tools. These are documented design capabilities, not a tested guarantee for a particular downloadable build.[51] Nodes allow effects to be connected modularly and a single effect configuration to influence multiple clips or tracks; the default remains bottom-to-top track compositing. Parameter controls and curves can coexist with the graph.[28][51]

**Color/audio/titles.** The 0.2 quickstart documents OpenColorIO-based end-to-end color management, project/source color settings, and floating-point image processing. Audio Monitor and linking controls are documented, but **current audio-mixing depth, title tooling, and parameter-keyframe behavior across node types are UNVERIFIED**.[28][51]

**Files/extensions/performance.** The quickstart describes XML-based project files and configurable disk/project cache paths. The wiki links `.ove` format and shader documentation; these links establish extension-oriented documentation, not a qualified OpenFX/FxPlug/VST compatibility layer.[28] **Production-safe collaboration, proxies, EDL/XML-interchange/AAF/OTIO support, and a supported scripting SDK are UNVERIFIED.** Native project XML does not establish interchange support.

**Design takeaway:** share processing nodes internally and offer an expert graph later. Never let removing an ordinary transform unexpectedly disconnect the image path in the basic UI; the quickstart’s manual relinking example illustrates why graph freedom needs guardrails.[28]

## 9. Blender VSE: compositional power inside a general creative application

**Workspace/model.** The Video Editing workspace separates Sequencer and Preview editors; the sidebar contains active-strip properties. Strips can contain images, video, audio, and scenes.[44] Channels provide spatial organization; **meta strips** collapse related strips into one movable/trimmable object, can nest, and can be entered/exited for focused editing.[31][33]

A Multicam Selector effect strip is part of the documented strip family. This establishes angle selection, not an automatically synchronized media-group workflow equivalent to Resolve/FCP.[29]

**Trimming.** Handle trims, move/extend, slip contents, retiming keys, and gap insertion/removal are documented. Overlap modes are explicitly Expand, Overwrite, and Shuffle; the operation’s collision policy is therefore a visible part of the model.[31] **Native default JKL and dedicated NLE-style ripple/roll/slide parity: UNVERIFIED.** Do not relabel Blender’s move operation “slide” and assume its neighboring-clip semantics match an NLE slide edit.

**Effects/finish.** Strip properties group transform/crop/color/sound/time/source settings; text, adjustment, compositor, transition, and effect strips supply additional processing.[29] Blender provides general animation editors for keyframes and curves, but this study did not verify every VSE property’s animation support.[59] Sound-strip and color tools should not be equated with Fairlight routing or Resolve grading depth without an explicit test.

**Files/extensions/performance.** Blender’s Python sequencer API exposes strip/effect operations, making automation a concrete extension path.[48] Memory and disk caches plus lower-resolution strip proxies are documented independently.[44] **The exact portable `.blend`/external-media packaging contract, same-timeline collaboration, native EDL/FCPXML/AAF/OTIO, and native OpenFX hosting are UNVERIFIED here.** An add-on could implement an interchange path, but that is not evidence that the base editor provides one.

**Design takeaway:** adopt nested groups and compositional reuse. Preserve the ability to place generated scenes alongside footage, but do not expose an entire 3D application’s controls to someone trimming an interview.

## 10. Interchange: separate file syntax from fidelity

| Product | Established route in this research | Important boundary |
|---|---|---|
| Resolve | OTIO/OTIOZ import/export; DRT; XML/AAF fallback.[26][64] | Native project/timeline transfer and cross-application exchange are different promises; EDL coverage not verified here. |
| Premiere | AAF export, EDL export, FCP7 XML export.[37][50][52] | FCP7 XML is not modern FCPXML; merged clips, effects, relinking, and nested content can change. Native OTIO unverified. |
| Final Cut Pro | FCPXML exchange; role-based media stems.[21][60] | Do not advertise AAF/EDL/OTIO as native based on a converter. |
| Avid | AAF import/export; EDL import; ALE exchange.[22] | ALE metadata is not a general editable effects/timeline interchange. Native OTIO/FCPXML unverified. |
| Shotcut | MLT XML project load/save; EDL export.[3] | MLT XML is not FCPXML or FCP7 XML; other named formats unverified. |
| Kdenlive | Native XML project; OTIO import/export.[45][49] | The cited release warns that effects, filters, and transitions are omitted. |
| Olive | XML-based native project documentation.[28] | No qualified EDL/FCPXML/AAF/OTIO route established. |
| Blender VSE | Python automation established.[48] | No native interchange route qualified by this research. |

**OTIO adapter availability is not product support.** The OTIO feature matrix separately lists EDL, FCP7 XML, FCP X, and AAF, with differences in tracks, nesting, transitions, retimes, and effects. It does not certify a specific NLE version’s import/export implementation.[11]

For fframestudio, every handoff should produce: a timeline file, media-resolution report, unsupported-feature report, optional rendered reference, and an explicit choice between **editable approximation** and **baked appearance**. Never silently imply both were preserved.

## 11. Recommended fframestudio document and editing model

Everything in this section is a proposed design, not a claim about implemented fframestudio functionality.

### 11.1 Preserve the seed’s strongest idea; replace its timing substrate

Local source inspected: `/mnt/zer0models/workspace/zer0/products/traffic-vision/expresslane-pretotypes/scripts/studio/studio.js`.

The inspected seed has:

- Global direction, narrative configuration, shot overrides, and notes (`DEF`, `S`, lines 85–104).
- A detected beat grid and narrative-to-shot compilation (`prepBeats`, `buildShots`, `timeFilm`, lines 116–200).
- Chapter/shot lanes with waveform, energy, and beat visualization (`renderTimeline`, `drawWave`, lines 430–460).
- Selection-driven inspection and separate Direction/Narrative controls (`bindTimeline`, `renderInspector`, lines 462–529).
- An explicit design intent that scrubbing/playback/export use film-time rendering (opening comment and `render(t)`). This is an architectural intent observed in code, not a verified export-parity test.

**Keep:** story-level decisions, beat-aware pacing, global styles with local overrides, and one timeline-time evaluation path.

**Change:** shot durations must not exist only as bars in a generated flat list. Source ranges, audio sample timing, explicit gaps, overlaps, anchors, retimes, and transitions need first-class representation. Changing the song must not silently rearrange dialogue or invalidate frame-accurate editorial work. Beat snapping should be an optional constraint over canonical time.

Separate the **editor’s UI theme** from **content styling tokens**. Preserve global film direction as editable project content, but remove hardcoded product/brand/traffic semantics from the editor core.

### 11.2 A canonical project with two related graphs

| Entity/layer | Proposed responsibility |
|---|---|
| Project | Versioned schema, stable IDs, asset registry, sequences, delivery settings, and revision log. UI layout remains user-local. |
| MediaAsset | Stable identity, stream/channel metadata, source timecode, frame/sample rates, color interpretation, original/proxy references, relink candidates. Never use a filename alone as identity. |
| Sequence | Own timebase, resolution, audio configuration, compositing order, tracks/lanes, markers, and nested references. Reject nesting cycles. |
| ClipInstance | Asset/sequence reference, source range, timeline placement, A/V linkage, enabled state, role, effect chain, and optional time map. Separate the source asset from each usage. |
| Gap / Transition | Explicit duration and transition handles; validate source media availability. A transition must not create fake handles silently. |
| Editorial relationships | Primary story order; connected anchors; sync groups; role tags; fixed-position constraints; alternative/take groups; multicam angle maps. These are not just visual positions. |
| Processing graph | Typed video/audio/effect/generator nodes, ordered processing, color transforms, parameters, and automation curves. Simple Inspector controls are views over this graph. |
| Narrative layer | Chapters, beats, transcript spans, arc suggestions, and content tokens linked to stable clip IDs. Suggestions compile into reviewable edit operations. |
| Revision/operation layer | Validated insert, overwrite, trim, ripple, roll, slip, slide, nest, replace, and parameter operations with atomic undo/redo. Add actor/base-revision information for collaboration. |
| Derived state | Thumbnails, waveforms, proxies, render chunks, analysis, and UI indices. Rebuildable and independently evictable; never the sole project record. |

**Two graphs, not one universal graph:** the editorial structure answers “what plays when, and what stays attached?” The processing graph answers “how is that material transformed and mixed?” Avoid forcing novice users—or every timeline operation—to manipulate compositing wires.

### 11.3 Time, relationships, and magnetic behavior

Use explicit frame-rate numerators/denominators and integer frame/sample counts where possible; define half-open ranges and conversion/rounding rules. OTIO provides RationalTime and TimeRange concepts, but its documented `value/rate` representation should not be misrepresented as a guarantee that every implementation performs arbitrary-precision rational arithmetic.[53]

Maintain source time, sequence time, and audio sample time separately. A retime maps between them. Beat coordinates and transcript-word coordinates are additional mappings, not the underlying clock.

Default to **Story mode**: a primary sequence, attached B-roll/titles/audio, ripple insertion/deletion, and visible connection points on selection. Offer **Track mode** as another view with explicit targeting, locks, compositing order, and audio routing. Switching views must not flatten relationships or discard data.

Define anchor behavior for moving, trimming, deleting, replacing, and nesting a parent. Show what will move before committing. If constraints conflict—fixed delivery duration, beat lock, sync lock, insufficient handles—ask which constraint to relax rather than making an unexplained edit.

Roles are semantic labels and routing/export intent; lanes are a display; tracks are explicit ordering/routing containers. These must not be interchangeable fields. Likewise, an audition is a selectable alternative set, a compound is an encapsulated sequence, and a multicam object is a synchronized angle set. Do not implement all three as “group clips.”

### 11.4 How to use OpenTimelineIO

**Adopt OTIO, with a bounded role.** Its canonical structure is Timeline → Stack of Tracks → clips/transitions/subcontainers, with external media references and source ranges.[10][53]

Recommended integration:

1. Use OTIO semantics for portable cuts, nesting, gaps, transitions, media references, markers, and timing.
2. Keep the authoritative native project richer than OTIO. Store relationships, roles, alternatives, processing graphs, narrative constraints, and collaborative operations in a versioned native schema.
3. Export a materialized OTIO view of the selected sequence. Resolve anchors into timed placements/tracks; retain extra semantics as namespaced metadata where useful, but assume another application may drop them.
4. Import OTIO as editable editorial data with provenance. Do not invent magnetic relationships, plugin settings, or audio routing that the file did not contain.
5. Put adapters behind a versioned, tested boundary. A server/desktop bridge using supported OTIO bindings is an initial option; a browser-native/WASM path requires a separate qualification spike. **A production-ready browser OTIO runtime has not been verified here.**
6. Offer explicit baking for unsupported composites, titles, retimes, or audio processing, retaining the original editable project alongside the handoff.

OTIO is not the renderer, decoder, asset database, collaboration protocol, or a universal effect interchange standard. The adapter matrix specifically demonstrates limitations around effects, complex speed changes, and transitions.[10][11]

### 11.5 Collaboration and performance architecture

Start with durable local-first project saving, crash recovery, version history, and media relinking. Add review comments and sequence ownership before claiming unrestricted simultaneous editing. Concurrent timeline edits require domain-aware conflict rules; a generic last-write-wins JSON merge is not sufficient.

Separate project metadata sync from large media transfer. Represent proxy/original availability per participant. Background work needs cancellation, priorities, and resource budgets so generation/transcription/rendering cannot starve scrubbing or audio playback.

Cache by source identity plus source range, processing dependencies, color configuration, render quality, and engine/plugin version. Preserve unaffected chunks after edits. Show a simple playback-quality indicator, with detailed decode/render/cache diagnostics available on demand. Never silently export proxy quality when originals were expected.

## 12. The 12 professional capabilities that matter most

These are product priorities and progressive-disclosure proposals, not claims that the seed already implements them.

| # | Professional capability | Simple first surface | Progressive expert surface / underlying requirement |
|---|---|---|---|
| 1 | Reliable media, proxies, and relinking | Drop media; one “Ready / Optimizing / Missing” badge. | Asset details, original/proxy selection, source timecode/channels, ingest verification, relink matching, media collection. |
| 2 | Precise, sync-safe editorial operations | Drag edges, split, delete; visible ripple preview. | Ripple/roll/slip/slide, trim-to-playhead, insert/overwrite, three-point editing, JKL, frame/sample stepping, track targeting and locks. |
| 3 | Relationship-aware layered composition | Story lane; “Attach above” and “Add sound.” | Connection anchors, gaps, explicit tracks, A/V sync groups, collision policies, masks and compositing order. |
| 4 | Nested sequences and reusable scenes | “Make a scene” collapses selected elements. | Open in place with breadcrumbs, instance versus source editing, independent overrides, versioned reusable templates and cycle checks. |
| 5 | Alternatives and reversible decisions | “Try another take” keeps one active choice. | Audition groups, compare views, revision snapshots, per-choice effects, explicit duration-change preview. |
| 6 | Multicam and external-audio synchronization | Select related recordings → “Sync”; click an angle to cut. | Timecode/waveform/manual offsets, angle editor, audio-follow-video toggle, separate sound master, drift/relink diagnostics. |
| 7 | Keyframes, retiming, and procedural motion | Change a property; click “Animate,” choose an editable preset. | Per-parameter keys, easing/curves, source-versus-sequence time, speed maps, hold/reverse, masks/tracking, reusable effect graphs. |
| 8 | Color-managed correction and grading | Exposure, white balance, contrast, look intensity, before/after. | Input/working/output transforms, scopes, wheels/curves, secondary masks, tracking, shared grades, HDR delivery validation. |
| 9 | Professional audio and semantic roles | Dialogue/Music/Effects tags, level meters, fades, “Duck music.” | Channel mapping, sample-accurate trims, editable automation, EQ/dynamics, buses, loudness/true-peak checks, role stems. |
| 10 | Titles, captions, and responsive graphics | Edit text on canvas; choose a content style; caption transcript. | Safe areas, typography/layout constraints, template parameters, language/caption tracks, timing, animated graphics, font portability. |
| 11 | Semantic assembly with full manual control | Story cards, transcript selections, beat-aware pacing suggestions. | Source-linked word timing, chapter constraints, search/selects tape, per-cut beat locks, provenance, previewed bulk edits, non-destructive regeneration. |
| 12 | Trustworthy finishing, collaboration, and handoff | Save continuously; Share for review; Export with a preflight check. | Version history/ownership, comments, render queue/cache, plugin capability checks, media manifests, OTIO/XML/AAF/EDL translation reports and reference renders. |

Do not equate progressive disclosure with hiding warnings. Missing media, out-of-sync audio, changed shared instances, overwritten animation, and lossy exports must be visible at the basic level.

### Suggested disclosure sequence

- **Opening view:** media shelf, one viewer, Story/Timeline switch, contextual Inspector, transport, undo/redo, save status. No permanent graph, mixer, or scopes.
- **On selection:** only relevant controls; persistent actions for trim, replace/take alternatives, animate, and inspect source.
- **On precision work:** overview-plus-detail timeline and edit-point preview; shortcut hints available without forcing keyboard-only learning.
- **On finishing:** expand Color, Sound, Graphics, or Effects inside the same project; preserve playhead, selection, and navigation history.
- **For repeat experts:** saved layouts and remappable commands; every shortcut also has a discoverable command. Touch/pointer/keyboard adapters invoke the same operations.

## 13. What to validate before promising “pro power, simple UX”

These are proposed acceptance tests, **not tests executed by this research**:

1. A beginner assembles a short story without opening specialist panels; an expert then refines the same document without conversion.
2. Moving a story section preserves declared attachments and audio sync; the preview identifies every affected clip.
3. Ripple/roll/slip/slide obey their duration and source-handle invariants, including nested and mixed-rate cases; undo restores the exact prior state.
4. Changing music or narrative arc previews a diff and preserves locked edits, source links, and manual overrides.
5. Multicam angle changes do not unexpectedly switch the chosen sound master.
6. A property preset expands into editable automation; regeneration warns before replacing hand-edited curves.
7. Missing originals/proxies, font dependencies, and unsupported plugins produce explicit diagnostics before export.
8. Qualified OTIO round trips cover cuts, gaps, nested sequences, transitions, mixed frame rates, retimes, audio channels, markers, Unicode names, and missing media. Unsupported constructs produce a report, not silent flattening.
9. Playback/export parity is checked on representative frames and audio ranges; preview quality is not mistaken for output quality.
10. Conflicting edits and interrupted saves recover predictably; no collaborator silently overwrites another’s timeline.

**Bottom line:** the differentiator is not fewer capabilities. It is a consistent edit model, meaningful defaults, reversible operations, and specialist depth that appears exactly when the work requires it.

## Sources

[1] https://www.blackmagicdesign.com/products/davinciresolve/cut
[2] https://www.blackmagicdesign.com/products/davinciresolve/edit — DaVinci Resolve – Edit - Blackmagic Design
[3] https://www.shotcut.org/features
[4] https://docs.kdenlive.org/en/getting_started/introduction.html
[5] https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac
[6] https://support.apple.com/guide/final-cut-pro/final-cut-pro-interface-ver92bd100a/mac
[7] https://support.apple.com/en-ge/guide/final-cut-pro/ver90ba496f/mac — Glossary - Apple Support (GE)
[8] https://helpx.adobe.com/premiere/desktop/add-text-images/stylize-text/about-properties-panel.html — Use Properties panel in Premiere | Premiere
[9] https://www.adobe.com/products/premiere/editing-and-trimming.html
[10] https://opentimelineio.readthedocs.io/en/latest — Welcome to OpenTimelineIO’s documentation! — OpenTimelineIO 0.19.0.dev1 documentation
[11] https://opentimelineio.readthedocs.io/en/latest/tutorials/feature-matrix.html — Feature Matrix — OpenTimelineIO 0.19.0.dev1 documentation
[12] https://www.olivevideoeditor.org — Olive Video Editor
[13] https://github.com/olive-editor/olive — GitHub - olive-editor/olive: Free open-source non-linear video editor · GitHub
[16] https://docs.kdenlive.org/en/cutting_and_assembling/editing.html — Editing — Kdenlive 26.08 Manual 26.08 documentation
[18] https://www.blackmagicdesign.com/products/davinciresolve/studio — DaVinci Resolve – Studio | Blackmagic Design
[20] https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis — Understanding UXP APIs
[21] https://developer.apple.com/documentation/professional_video_applications — Professional Video Applications
[22] https://www.avid.com/es/media-composer/comparison — Comparison
[23] https://helpx.adobe.com/premiere/desktop/add-audio-effects/adjust-volume-and-levels/automatically-duck-audio.html — Automatically duck audio in Premiere - Adobe Help Center
[24] https://support.apple.com/guide/final-cut-pro/show-video-role-colors-ver0753c4884/mac — Show video role colors in Final Cut Pro for Mac - Apple Support
[26] https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_18.5_New_Features_Guide.pdf?_v=1681801210000 — DaVinci Resolve 18.5 Beta New Features Guide
[27] https://www.blackmagicdesign.com/products/davinciresolve — DaVinci Resolve | Blackmagic Design
[28] https://github.com/olive-editor/olive/wiki/Olive-0.2.x-Quickstart — Olive 0.2.x Quickstart · olive-editor/olive Wiki · GitHub
[29] https://docs.blender.org/manual/en/latest/video_editing/edit/montage/strips/index.html — Strips - Blender 5.2 LTS Manual
[30] https://support.apple.com/en-euro/guide/final-cut-pro/verbbd353d6/10.6.2/mac/11.5.1 — Create auditions in Final Cut Pro
[31] https://docs.blender.org/manual/en/latest/video_editing/edit/montage/editing.html — Editing Strips - Blender 5.2 LTS Manual
[32] https://kdenlive.org/news/2026/state-2026 — State of Kdenlive - 2026
[33] https://docs.blender.org/manual/en/latest/video_editing/edit/montage/meta.html — Meta Strips - Blender 5.2 LTS Manual
[35] https://helpx.adobe.com/premiere/desktop/collaborate-with-others/collaborate-using-team-projects/when-to-use-team-projects-and-when-to-use-productions.html — Team Projects vs Productions in Premiere | Premiere
[36] https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/ingest-and-proxy-workflow.html — Ingest and proxy workflows in Premiere | Premiere
[37] https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/export-aaf-files.html — Export AAF files in Premiere | Premiere
[38] https://helpx.adobe.com/premiere/desktop/edit-projects/edit-nested-sequences/about-nested-sequences.html — Manage nested sequences in Premiere | Premiere
[40] https://support.apple.com/en-us/101919 — Use shared storage with Final Cut Pro - Apple Support
[41] https://helpx.adobe.com/si/premiere-pro/using/trim-mode-editing.html — Edit in Trim mode - Adobe Help Center
[42] https://www.shotcut.org/howtos/keyboard-shortcuts — www.shotcut.org · howtos · keyboard-shortcutsShotcut - Keyboard Shortcut Reference
[43] https://kdenlive.org/video-editing-applications-handbook — Video editing applications handbook
[44] https://docs.blender.org/manual/en/latest/editors/video_sequencer/introduction.html — Introduction - Blender 5.2 LTS Manual
[45] https://docs.kdenlive.org/en/project_and_asset_management/file_management.html — File Management — Kdenlive 26.08 Manual 26.08 documentation
[46] https://docs.kdenlive.org/en/effects_and_filters.html — Effects and Filters — Kdenlive 26.08 Manual 26.08 documentation
[47] https://support.apple.com/guide/final-cut-pro/make-slip-edits-ver1632d8e4/10.5.1/mac/10.15.6 — Make slip edits in Final Cut Pro
[48] https://docs.blender.org/api/current/bpy.ops.sequencer.html — Sequencer Operators¶
[49] https://kdenlive.org/news/releases/25.04.0 — Kdenlive 25.04.0 released
[50] https://helpx.adobe.com/ph_fil/premiere/desktop/render-and-export/export-files/export-a-project-as-an-edl-file.html — Export a project as an EDL file - Adobe Help Center
[51] https://github.com/olive-editor/olive/wiki/Menus — Menus · olive-editor/olive Wiki · GitHub
[52] https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/export-a-project-as-a-final-cut-pro-xml-file.html — Export projects as Final Cut Pro XML in Premiere | Premiere
[53] https://opentimelineio.readthedocs.io/en/latest/tutorials/architecture.html — Architecture — OpenTimelineIO 0.19.0.dev1 documentation
[54] https://www.blackmagicdesign.com/products/davinciresolve/collaboration — DaVinci Resolve – Collaboration | Blackmagic Design
[55] https://support.apple.com/zh-tw/guide/final-cut-pro/verd5e1fdffd/10.6/mac/11.5.1 — Use color wheels in Final Cut Pro
[56] https://support.apple.com/guide/final-cut-pro/play-media-ver90ba4ef0/mac — Play media in Final Cut Pro for Mac - Apple Support
[57] https://resources.avid.com/SupportFiles/attach/Media_Composer_Editing_Guide_8.2.pdf — Editing Guide
[58] https://helpx.adobe.com/in_hi/premiere-pro/using/panels.html — Working with Panels
[59] https://docs.blender.org/manual/en/latest/animation/animation_editors.html — Animation Editors - Blender 5.2 LTS Manual
[60] https://support.apple.com/guide/final-cut-pro/export-roles-verb71cb7e5/mac — Export roles in Final Cut Pro for Mac - Apple Support
[61] https://support.apple.com/fr-fr/guide/final-cut-pro/verb8e5f6fd/mac — Création de fichiers optimisés et proxy dans Final Cut Pro pour Mac
[62] https://resources.avid.com/SupportFiles/attach/Media_Composer_Effects_and_CC_Guide_2019.x.pdf — Media Composer Effects and Color Correction Guide
[63] https://helpx.adobe.com/vn_en/premiere/desktop/add-video-effects/control-effects-and-transitions-using-keyframes/add-keyframes.html — Add keyframes
[64] https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_19_1_New_Features_Guide.pdf?_v=1731398410000 — DaVinci Resolve 19.1 New Features Guide
[65] https://documents.blackmagicdesign.com/UserManuals/DaVinci_Resolve_12_Reference_Manual.pdf — Reference Manual
[66] https://support.apple.com/guide/final-cut-pro/background-rendering-ver717f3ca3/10.6.6/mac/12.6 — Background rendering in Final Cut Pro for Mac
[67] https://helpx.adobe.com/premiere/desktop/render-and-export/render-sequences-for-playback/use-preview-files-when-rendering.html — Use preview files when rendering in Premiere
