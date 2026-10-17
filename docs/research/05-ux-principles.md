# fframestudio: pro power without a pro-shaped obstacle course

## Decision in one paragraph

Build **one editable video, with several synchronized ways to understand and change it**: a story/transcript view for meaning, a timeline for time, a canvas for space, and an inspector for precise properties. Start with a playable result and a few visible actions; expose depth on the selected object rather than making users graduate into a different application. AI should propose ordinary, inspectable edits—not become the only route to power. This is a design synthesis from direct manipulation, creativity-support, learnability, and video-editing research, not a claim that any paper has validated this exact product.[1][3][4]

**Definition of intuitive for this project:** a person can predict the next action, find it, predict its scope, recognize its result, and recover from a mistake without translating their creative goal into the editor's implementation model. Expertise should reduce effort without requiring them to discard what they learned initially. “Feels natural” is a testable hypothesis about particular users and tasks, not an innate property of a sparse screen.[4][9][10]

## Reading method and evidence boundaries

- Primary PDFs, author-hosted copies, ACM papers, and versioned arXiv HTML were retrieved with `web_extract`. The annotated bibliography below identifies what was read: substantive sections of papers, complete short essays where accessible, or explicitly limited metadata/abstract material. This is **not** a claim of cover-to-cover reading of every paper or a systematic literature review.
- Readings span foundational work through **VideoDiff, CHI 2025**. This is a selected framework, not an exhaustive survey of everything published through 2026. Author names and dates below come from retrieved papers or publication records, not inferred titles.
- Long extractions were locally inspected beyond their abstracts for the concepts carrying the recommendations: gulfs and directness, instrumental indirection, threshold/ceiling, cognitive dimensions, progressive-disclosure criteria, novice–expert transitions, and the interfaces/discussions of LAVE, ExpressEdit, and VideoDiff.
- Distinguish **empirical findings**, **conceptual frameworks**, and **our proposed product behavior**. Small exploratory studies do not establish universal productivity gains; word-processing and programming findings need validation in video editing. Recommendations and numerical acceptance targets below are proposals unless explicitly described as study findings.
- PDF extraction has layout/OCR defects. The Shneiderman 2007 extraction also contained an unrelated paragraph; it is excluded from the evidence. Do not quote that extraction indiscriminately. Hick was accessible as a partial uploaded reproduction, not a clean publisher PDF. The bibliography states this limitation.
- The seed critique is a **static source inspection**, not a live usability test, accessibility audit, or verified rendering/export test. No application code was changed.

## 1. Annotated bibliography

Each entry includes a citation and direct reading URL, followed by a takeaway and application. Numeric references resolve again in the generated Sources section.

### Foundations: representation, feedback, and creative power

**Ben Shneiderman (1983). “Direct Manipulation: A Step Beyond Programming Languages.” IEEE Computer.** [PDF](https://www.cs.umd.edu/~ben/papers/Shneiderman1983Direct.pdf). **Read:** examples and direct-manipulation principles. Persistent representations, rapid incremental actions, visible consequences, and reversibility work together; a draggable interface without trustworthy feedback is not enough. Apply this to a trim handle that updates the picture and duration while dragging and can be undone, rather than a form that asks the user to imagine the result.[1]

**Edwin L. Hutchins, James D. Hollan, and Donald A. Norman (1985). “Direct Manipulation Interfaces.” Human–Computer Interaction.** [PDF](https://vis.csail.mit.edu/classes/6.859/readings/pdfs/Hutchins-DirectManipulationInterfaces.pdf). **Read:** semantic/articulatory distance, gulfs of execution/evaluation, and limitations. Directness concerns the distance between a person's intention and the system's representations, not merely physical proximity or familiarity. The paper also explains why repetition, precision, and sets can be better served symbolically: fframestudio needs direct dragging **and** exact values, batch commands, and scripting.[4]

**Ben Shneiderman (2007). “Creativity Support Tools: Accelerating Discovery and Innovation.” Communications of the ACM.** [PDF](https://dl.acm.org/doi/pdf/10.1145/1323688.1323689). **Read:** design principles and research-methods sections; extraction caveat above. Low thresholds, high ceilings, wide walls, exploration, histories, and collaboration support creative work, while evaluation must reach beyond timed benchmark tasks into actual practice. Apply this to editable starting points, reversible alternatives, and longitudinal studies of whether people can make different kinds of films—not just export the supplied demo quickly.[2]

**Mitchel Resnick, Brad Myers, Kumiyo Nakakoji, Ben Shneiderman, Randy Pausch, Ted Selker, and Mike Eisenberg (2005; revised October 30). “Design Principles for Tools to Support Creative Thinking.” Creativity-support workshop report.** [PDF](https://www.cs.umd.edu/hcil/CST/Papers/designprinciples.pdf). **Read:** exploration, low threshold/high ceiling/wide walls, multiple paths, collaboration, and open interchange. The report explicitly argues for trustworthy undo, self-revealing flexibility, diverse outcomes, and open formats; simple tools must not quietly impose a narrow creative space. Apply this by letting a starter animation become editable timing, typography, layers, and reusable components, with no mandatory traffic-film theme or fixed narrative template.[3]

**Michel Beaudouin-Lafon (2000). “Instrumental Interaction: An Interaction Model for Designing Post-WIMP User Interfaces.” CHI.** [PDF](https://dl.acm.org/doi/pdf/10.1145/332040.332473). **Read:** domain objects, instruments, and degree of indirection. The model separates meaningful objects from reusable instruments, and evaluates spatial and temporal distance between an action and its effect. Apply it to a crop instrument that can be invoked from a toolbar, palette, or shortcut but acts visibly on the same selected clip; do not implement three subtly different cropping workflows.[8]

**Donald A. Norman (2008). “Signifiers, Not Affordances.” interactions, 15(6); author-hosted essay.** [Article](https://jnd.org/signifiers-not-affordances/). **Read:** essay discussion of perceivable cues and action possibilities. Making an operation possible is not the same as making its availability understandable; people need cues they can interpret. Give clip edges visible trim handles, distinguish selection from the playhead, and label ambiguous actions instead of assuming that an icon, hover state, or empty canvas explains itself.[12]

**Jakob Nielsen (1994; page reviewed 2024). “10 Usability Heuristics for User Interface Design.”** [Article](https://www.nngroup.com/articles/ten-usability-heuristics/). **Read:** heuristic descriptions; practitioner guidance, not a controlled editor study. Visibility of status, user control, recognition rather than recall, consistency, error prevention, and recovery provide a practical inspection checklist. Apply them to explicit save/export state, visible scope, named undo operations, recoverable errors, and familiar platform shortcuts.[18]

**Jakob Nielsen (2006). “Progressive Disclosure.”** [Article](https://www.nngroup.com/articles/progressive-disclosure/). **Read:** benefits and usability criteria. Disclosure requires both a defensible split between common and specialized actions and an obvious route to the second level; hiding everything does not satisfy it. Show text, duration, and a motion preset for a title first, with a clearly named “Timing & easing” expansion and searchable access to individual properties.[19]

**Brad Myers, Scott E. Hudson, and Randy Pausch (2000). “Past, Present, and Future of User Interface Software Tools.” ACM Transactions on Computer-Human Interaction, 7(1).** [PDF](https://dl.acm.org/doi/pdf/10.1145/344949.344959). **Read:** overview and themes including threshold/ceiling, path of least resistance, and predictability. The paper distinguishes difficulty getting started from the amount that a system can express and cautions that tool structure channels outcomes. For fframestudio, templates should make good work easy while retaining a visible route to custom arrangements; unpredictable “helpfulness” is not a substitute for a high ceiling.[22]

**T. R. G. Green and M. Petre (1996). “Usability Analysis of Visual Programming Environments: A ‘Cognitive Dimensions’ Framework.” Journal of Visual Languages and Computing.** [Author-manuscript PDF mirror](https://history.futureofcoding.org/history/msg_files/F6R/F6R1A64AF.pdf). **Read:** framework, dimension definitions, and trade-off discussion. Viscosity, hidden dependencies, premature commitment, progressive evaluation, and visibility describe structural burdens that pretty controls can leave untouched; the dimensions are discussion tools with trade-offs, not independent scores to maximize. Apply them to global style inheritance, ripple edits, changing output formats, comparing versions, and previewing an unfinished sequence.[23]

### Learning, choice, and motor effort

**John M. Carroll and Caroline Carrithers (1984). “Training Wheels in a User Interface.” Communications of the ACM.** [PDF](https://dl.acm.org/doi/pdf/10.1145/358198.358218). **Read:** abstract, training-interface design, and examples of blocked error states. The intervention made troublesome states unreachable while allowing meaningful document creation, revision, and printing; it did not merely provide a longer explanation of errors. Apply the principle to a first editing task with valid media, safe defaults, and non-destructive operations, while making optional guidance removable rather than permanently disabling professional features.[25]

**Joey Scarr, Andy Cockburn, Carl Gutwin, and Philip Quinn (2011). “Dips and Ceilings: Understanding and Supporting Transitions to Expertise in User Interfaces.” CHI.** [PDF](https://dl.acm.org/doi/pdf/10.1145/1978942.1979348). **Read:** framework, Blur design, and reported study summary. An expert technique must be discovered, worth trying, and cheap enough to learn that its temporary performance dip does not drive people back to a comfortable slower technique. Apply calm, optional command/shortcut hints after successful menu actions, keep both routes available, and measure sustained adoption rather than counting how many shortcuts exist.[9]

**Tovi Grossman, George Fitzmaurice, and Ramtin Attar (2009). “A Survey of Software Learnability: Metrics, Methodologies and Guidelines.” CHI.** [PDF](https://dl.acm.org/doi/pdf/10.1145/1518701.1518803). **Read:** definitions of initial/extended learning, evaluation overview, and question-suggestion protocol rationale. Learnability is not a single first-use time: experience with the task, related applications, and the specific application changes what is being learned. Apply separate measures for first-time editing, transfer from another editor, advanced-feature discovery, and return after a break; use diagnostic questioning separately from unassisted timing.[10]

**Joanna McGrenere and Gale Moore (2000). “Are We All in the Same ‘Bloat’?” Graphics Interface.** [PDF](https://graphicsinterface.org/wp-content/uploads/gi2000-25.pdf). **Read:** study framing and objective/subjective bloat distinction. In their study of Microsoft Word users, unused functionality was not uniformly unwanted: different people wanted different subsets, and some valued availability even without current use. Apply this by simplifying what is presented in context, not removing every feature absent from the median novice's workflow or automatically rearranging a learned workspace.[11]

**Bret Victor. “Learnable Programming.” Author's design essay; publication date not present in the retrieved body.** [Essay](https://worrydream.com/LearnableProgramming/). **Read:** vocabulary, visible state, and creation through abstraction sections. Live output alone does not explain a system: the environment should reveal what values mean, how behavior unfolds, and how a concrete example becomes a general rule. Apply this to labeled animation controls with visible trajectories/keyframes and a “Make reusable” operation after a user has built something concrete; treat the essay as a design argument, not empirical proof.[20]

**Paul M. Fitts (1954). “The Information Capacity of the Human Motor System in Controlling the Amplitude of Movement.” Journal of Experimental Psychology, 47, 381–391.** [1992 reprint PDF](https://www.lri.fr/~mbl/FundHCI/papers/Fitts-JEP54.pdf). **Read:** problem framing and experimental scope in the reprint. Movement amplitude, tolerance, and speed are interrelated in constrained motor tasks; this motivates attention to effective target size and travel distance. Apply it to generous trim hit areas and nearby contextual controls, but measure with the actual input devices rather than deriving an entire UI's usability from a pointing formula.[31]

**W. E. Hick (1952). “On the Rate of Gain of Information.” Quarterly Journal of Experimental Psychology, 4(1), 11–26.** [Accessible partial reproduction](https://www.scribd.com/document/223215951/Hick-1952). **Read:** article title/citation, abstract, and introduction visible in the uploaded reproduction; publisher extraction failed. The experiments relate uncertainty and choice-reaction time in tightly specified stimulus-response tasks. Apply cautiously to predictable grouping and task-relevant choices, **not** a magical maximum number of buttons or a claim that deep menus always beat visible options; Hyman's separate original paper was not read here.[33]

### Video-specific interaction and human–AI editing

**Floraine Berthouzoz, Wilmot Li, and Maneesh Agrawala (2012). “Tools for Placing Cuts and Transitions in Interview Video.” ACM Transactions on Graphics / SIGGRAPH.** [PDF](https://www.floraine.org/papers/2012-video-transitions/paper.pdf). **Read:** introduction and proposed transcript/cut-suitability interaction. Linking words to footage lets editors act on semantic content, while suitability cues expose whether a seemingly sensible text cut may interrupt speech or motion. Apply a linked transcript and cut preview, but do not imply that syntactically deleting a sentence guarantees a natural audiovisual join.[13]

**Steve Rubin, Floraine Berthouzoz, Gautham J. Mysore, Wilmot Li, and Maneesh Agrawala (2013). “Content-Based Tools for Editing Audio Stories.” UIST.** [PDF](https://dl.acm.org/doi/pdf/10.1145/2501988.2501993). **Read:** introduction and key-feature descriptions. Their tools raise interaction from raw waveforms to words, alternate line readings, breaths/pauses, music characteristics, and musical structure. Apply semantic speech editing and “fit music to this section,” but retain waveform inspection and precise boundaries; the paper's informal first-user feedback is not a general controlled productivity result.[14]

**Anh Truong, Floraine Berthouzoz, Wilmot Li, and Maneesh Agrawala (2016). “QuickCut: An Interactive Tool for Editing Narrated Video.” UIST.** [Author-hosted PDF](https://graphics.stanford.edu/projects/quickcut/quickcut.pdf). **Read:** pipeline and interaction rationale; ACM PDF extraction failed, author copy succeeded. Spoken footage annotations and aligned narration transcripts support semantic matching, while user constraints guide automatic frame-level cut selection. Apply “keep this action aligned with these words” as an editable relationship; do not treat preprocessing, annotation, or reviewing footage as free labor.[26]

**Mackenzie Leake, Abe Davis, Anh Truong, and Maneesh Agrawala (2017). “Computational Video Editing for Dialogue-Driven Scenes.” ACM Transactions on Graphics, 36(4), Article 130.** [PDF](https://graphics.stanford.edu/papers/roughcut/files/roughcut-small.pdf). **Read:** input assumptions, editing idioms, composition, and tempo controls. Users combine interpretable filmmaking idioms over aligned script/take data rather than manually deciding every cut from scratch. Apply composable suggestions such as “start wide” or “favor the speaker,” with local overrides; the method's dialogue scenes and prepared takes do not justify promising automatic editing for arbitrary footage.[21]

**Miao Wang, Guo-Wei Yang, Shi-Min Hu, Shing-Tung Yau, and Ariel Shamir (2019). “Write-A-Video: Computational Video Montage from Themed Text.” ACM Transactions on Graphics, 38(6), Article 177.** [PDF](https://cg.cs.tsinghua.edu.cn/papers/TOG-2019-Write-a-Video.pdf). **Read:** pipeline, input assumptions, and text-editing interaction. Themed text, a related footage repository, semantic retrieval, and cinematographic optimization offer a higher-level route to a montage. Apply story-first assembly while retaining candidate replacement and exact edits; the authors explicitly constrain the input topic and available media, so “any prose becomes a good film” is not supported.[16]

**Bernd Huber, Hijung Valentina Shin, Bryan Russell, Oliver Wang, and Gautham J. Mysore (2019). “B-Script: Transcript-based B-roll Video Editing with Recommendations.” CHI.** [Versioned PDF](https://arxiv.org/pdf/1902.11216v1). **Read:** interface, abstract/study framing, and formative analyses. The paper compares timeline, transcript, and transcript-plus-recommendation interfaces in a within-subject study with 110 participants, reporting benefits for transcript-based B-roll insertion and recommendation-assisted engagement. Apply time-linked B-roll suggestions to speech-heavy material without generalizing the result to color grading, animation, or all editing tasks.[17]

**Bryan Wang, Yuliang Li, Zhaoyang Lv, Haijun Xia, Yan Xu, and Raj Sodhi (2024). “LAVE: LLM-Powered Agent Assistance and Language Augmentation for Video Editing.” IUI.** [Versioned full text](https://arxiv.org/html/2402.10294v1). **Read:** agent interaction, editing functions, discussion, and evaluation limitations. LAVE combines language descriptions of footage, plan-and-execute assistance, and manual editing; its evaluation with eight participants supports exploration of the interaction, not a universal efficiency claim. Apply an assistant that names the clips it will change and produces editable timeline operations, with manual control preserved throughout.[5]

**Bekzat Tilekbay, Saelyne Yang, Michal Lewkowicz, Alex Suryapranata, and Juho Kim (2024). “ExpressEdit: Video Editing with Natural Language and Sketching.” IUI.** [Versioned full text](https://arxiv.org/html/2403.17693v1). **Read:** interface, interpretation pipeline, results, and discussion. Temporal references, spatial references, and operation/parameter intent are separately interpreted and inspectable, while users can refine suggestions manually; the observational study involved ten novice editors. Apply selection plus language plus optional drawing, and show the interpreted “where, when, what” before accepting changes; correction is a core interaction, not an edge-case failure.[6]

**Mina Huh, Dingzeyu Li, Kim Pimmel, Hijung Valentina Shin, Amy Pavel, and Mira Dontcheva (2025). “VideoDiff: Human-AI Video Co-Creation with Alternatives.” CHI.** [Full text](https://ar5iv.labs.arxiv.org/html/2502.10190). **Read:** scope, interface, comparison/authoring findings, case studies, and discussion. The contribution is not simply generating more candidates: aligned transcripts/timelines and visible differences make alternatives reviewable, sortable, and refinable. Apply compare-by-difference to versions and AI proposals, with an incremental single-version path still available; the study does not establish that everyone wants ten options or a transcript-first editor.[7]

### Measurement instruments

**John Brooke (1996). “SUS: A ‘Quick and Dirty’ Usability Scale.” In Usability Evaluation in Industry.** [Publisher record and abstract](https://www.taylorfrancis.com/chapters/edit/10.1201/9781498710411-35/sus-quick-dirty-usability-scale-john-brooke); [university instrument description](https://site.unibo.it/hfrs/en/questionnaire-and-scales-2/sus). **Read:** publisher abstract/metadata and university description, **not** the full original chapter. SUS supplies a standardized ten-item assessment of perceived usability; the original abstract stresses intended users, tasks, and context. Apply it after a meaningful task set, alongside observed performance rather than treating a questionnaire as proof of intuitiveness or a substitute for export success.[35][30]

**NASA Human Systems Integration Division. “NASA Task Load Index (TLX).” Official instrument documentation; undated page.** [Documentation](https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/). **Read:** instrument overview and subscales, not every linked manual. NASA describes a subjective workload measure with mental, physical, temporal, performance, effort, and frustration subscales. Apply it after representative workflows to distinguish “I succeeded” from “I had to fight the editor”; specify the scoring variant in the research protocol before collection.[29]

### Explicit gaps—not silently claimed as read

Raskin's *The Humane Interface*, Carroll's broader minimalist-instruction literature, Hyman's original experiment, and Victor's *Inventing on Principle* talk were suggested leads but were **not substantively verified/read in this pass**. They are not evidentiary citations here. Stable behavior and recovery recommendations below instead rely on the actually read directness, heuristics, and learnability sources. No claim is made that this pass establishes a universal optimal noun hierarchy, maximum menu size, pixel target, latency threshold, or AI reliability rate.

## 2. Eighteen concrete design principles

These are **proposed fframestudio requirements derived from the readings**, not quotations or results from a deployed fframestudio. Each includes a video-editing example and a behavior to test.

### P01 — Organize around the result, not the production departments

**Basis:** semantic distance and content-based editing.[4][13][14] Put the video and the selected thing at the center; “Direction,” “Narrative,” and “Shot” should not become required conceptual doors before editing is possible. **Example:** clicking a title selects its text object and exposes “Text,” “Appearance,” and “Timing”; a user need not decide which department owns the change. **Test:** can a newcomer change the visible title without explanation or a wrong-scope edit?

### P02 — Make one useful result possible before asking for setup

**Basis:** low threshold, avoidance of premature commitment, meaningful safe learning.[3][23][25] Offer import, a small editable example, or a starter—not an obligatory questionnaire about codecs, frame rates, brand systems, and narrative arcs. **Example:** dropping three clips produces a playable sequence using explicit defaults; the user trims and exports, then can change format without rebuilding. **Test:** include a blank-project task so a prebuilt demo cannot disguise a high real threshold.

### P03 — Give every preset a path to its ingredients

**Basis:** high ceiling, wide walls, and tools' path of least resistance.[3][22] A preset should initialize editable structure, not conceal an unbreakable template. **Example:** “Gentle title entrance” expands into position, opacity, timing, and easing; changing one title's delay creates a visible override rather than silently detaching the entire design. **Test:** make a deliberately off-template title sequence without code or flattened media.

### P04 — Use the representation that matches the decision

**Basis:** directness and the transcript/narration editing systems.[4][13][26] Meaning belongs in story/transcript; exact time in timeline; spatial placement on canvas. **Example:** delete an unwanted sentence in the transcript, see the linked audio/video range, then audition and refine its cut in the timeline. **Test:** switching representations preserves the selected range and never creates divergent versions of the edit.

### P05 — Make actions continuously inspectable

**Basis:** immediate incremental feedback and intelligible state.[1][8][20] A changing number is not enough if the visual consequence is hidden. **Example:** dragging a clip edge shows incoming/outgoing frames, duration, snap target, and affected downstream clips; a lower-quality preview is explicitly labeled while final rendering catches up. **Test:** the user can state what changed and whether the preview is current; stale frames must never masquerade as the latest edit.

### P06 — Expose power where it is relevant, with a visible way deeper

**Basis:** progressive-disclosure criteria and subjective bloat.[19][11] Show common properties first, specialized controls under meaningful headings, and all available commands through search; don't scatter features among a dozen permanent panels. **Example:** selecting audio exposes volume, fades, and cleanup; “Mix & routing” reveals buses and channel control and can be pinned. **Test:** find an infrequent command without already knowing its exact name or the “advanced mode” ritual.

### P07 — Show scope and inheritance before a change

**Basis:** hidden dependencies, visibility, and evaluation distance.[23][4] Distinguish project defaults, video styles, scene settings, selection changes, and keyframe changes. **Example:** a color field says “Inherited from Video style”; “Change for this title” creates an override, while “Edit shared style” previews all affected titles. **Test:** predict which objects will change, perform the edit, and restore inheritance without guessing.

### P08 — Make recovery cheaper than caution

**Basis:** reversible actions and exploration.[1][3][18] A normal edit, batch action, preset change, and accepted AI proposal all belong to understandable undo history; version snapshots supplement rather than replace undo. **Example:** “Undo: shorten 4 clips” restores their timing and linked captions as one transaction, even if the change originated in chat. **Test:** recover from a bad batch edit, failed operation, and accidental version load without lost work.

### P09 — Let people compare alternatives without relying on memory

**Basis:** exploration and VideoDiff's comparison interaction.[3][7] Alternatives need synchronized context and visible differences, not merely a dropdown of names. **Example:** compare two music/pacing versions at the same story moment with duration deltas, changed clips highlighted, and “Keep this title from B.” **Test:** identify what changed and choose a version without replaying both from the beginning; verify that a simpler single-version workflow remains easy.

### P10 — Make automation an editable proposal over ordinary objects

**Basis:** hybrid assistance and inspectable multimodal interpretation.[5][6] AI, menu commands, and manual edits should converge on the same underlying edit operations. **Example:** “Make the opening tighter” produces a proposed clip/range list and duration changes; accept all, accept selected changes, refine manually, or undo. **Test:** after acceptance, every result is selectable/editable without reopening chat; with AI unavailable, core editing still works.

### P11 — Resolve “what, where, when” visibly

**Basis:** ExpressEdit and semantic alignment in QuickCut.[6][26] Ground language in explicit selection and visible temporal/spatial references. **Example:** the user circles a face and says “blur this throughout this clip”; show the chosen clip, tracked region, time range, and tracking gaps before applying. **Test:** deliberately ambiguous instructions produce a question or bounded proposal—not an unannounced project-wide change. This is a product safety requirement, not a claim of solved tracking accuracy.

### P12 — Make semantic constraints editable, not mysterious

**Basis:** composable editing idioms, narrated alignment, and themed montage.[21][26][16] “Keep this line,” “align reveal to this word,” “favor wide shots,” and “end at this time” are visible constraints with local exceptions. **Example:** music fitting preserves a marked speech beat and locked closing card; if the requested duration conflicts, the editor names the conflict and offers alternatives. **Test:** a user can explain why a suggestion was made and identify which constraint prevents it.

### P13 — Keep repeated actions behaviorally stable

**Basis:** consistency, predictable tools, and learned directness.[18][22][4] Context may reveal controls, but it must not silently redefine selection, scope, or shortcuts. **Example:** clicking a clip always selects it; playback moves the playhead, not the edit selection; “Follow playback” is an explicit option. **Test:** the same action from different prior inspector tabs has the same selection outcome, and keyboard commands operate on an unmistakable target.

### P14 — Teach the faster path while preserving the familiar one

**Basis:** transition costs and calm notification.[9][10] Menus display shortcuts, command search accepts user vocabulary, and contextual help follows successful actions rather than interrupting them. **Example:** after a menu-driven split, an optional hint shows the platform shortcut; the palette also finds “cut here,” “split clip,” and the same command. **Test:** measure voluntary repeat use, the temporary learning dip, and later speed—not merely shortcut recall on a quiz.

### P15 — Add precision and scale without making everyone program

**Basis:** limitations of direct manipulation and concrete-to-abstract learning.[4][20][22] Combine drag controls, exact fields, multi-selection, reusable styles, command sequences, and an optional scripting surface. **Example:** first position one lower third, then apply its style to selected clips, then save a reusable component; later expose the same transaction as an inspectable script. **Test:** complete a repetitive twenty-caption change without twenty separate repairs, while a first-time user can still edit just one caption.

### P16 — Reduce acquisition and decision effort, not just visible pixels

**Basis:** Fitts, Hick, and recognition heuristics.[31][33][18] Provide comfortably hit-testable edges, zoomable time, nearby actions, meaningful grouping, and keyboard/touch alternatives. **Example:** a thin cut line has a larger invisible hit region with visible active feedback; zoom separates adjacent targets rather than covering one with the other. **Test:** measure miss rate, accidental neighbor selection, and completion time on pointer, touch, and keyboard. Neither law supplies a universal button count or target size.

### P17 — Preserve spatial access and semantic access across platforms and themes

**Basis:** signifiers, consistency, and visibility of relevant objects.[12][18][23] Visual styling must not carry the only explanation; responsive layouts should not separate a control from all evidence of its effect. **Example:** a narrow layout uses a collapsible properties sheet with a persistent preview and selection label; approval has text/icon state, not only green/red dots. **Test:** keyboard-only, screen-reader, zoomed, touch, high-contrast, and reduced-motion workflows can select, change, undo, and export. These are proposed accessibility requirements, not an assertion that the seed passes them.

### P18 — Define completion as a verified deliverable, not a successful command

**Basis:** evaluation gulf, status, and open interchange.[4][18][3] “Export video” must yield a playable video with clear output settings; “Export project/spec” is a separately named technical operation. **Example:** export shows resolution, duration, destination, progress, and a playable result; failures offer retry without losing edits, and unavailable render backends are stated before submission. **Test:** open the exported artifact and check content, timing, audio, and chosen format—not just whether a download event fired.

## 3. Proposed information architecture

### A small object model, not a mandatory production pipeline

**Primary user nouns: Project, Video, Clip, Layer.** Add **Scene** only as an optional group, **Media** as the reusable source library, and **Version** when exploring alternatives. These names are hypotheses to test with editors; the papers support meaningful representations, not these exact labels.[4][23]

```text
Project
├── Media                         original assets, transcript, provenance
├── Video                         one editable sequence/output composition
│   ├── Clip                      a timed instance of media or generated content
│   ├── Scene (optional group)     related clips; may be collapsed/reordered
│   └── Layers                    text, overlays, audio, compositing content
└── Versions                      named snapshots/branches of a Video
```

Important semantics:

- A **source asset is not a timeline clip**. Reusing a source creates another instance; trimming an instance does not destructively change the source.
- A **Scene is optional**, not a required wrapper for every short clip. Ordinary projects can start as a flat sequence. Groups must not prohibit audio tails, transitions, or overlays crossing scene boundaries.
- A **Layer is compositing/timing structure**, not a requirement that every item fit a strict `Scene → Shot → Layer` tree. Reveal its stack/lane when overlap or selection makes it useful.
- **Story** is a view of the same Video: transcript, narrative cards, annotations, and scene ordering. It is not a separate document whose changes need a manual “sync to timeline” step.
- **Shot** can describe a source segment or appear in filmmaking metadata; do not use “shot,” “clip,” “scene,” and “chapter” interchangeably in the basic UI. Test which terminology each audience already knows.
- **Look/Style** is a reusable set of properties, not a theme-dependent project type. Project content must survive switching the app's light/dark/high-contrast theme, changing a video's visual style, or changing its delivery platform.
- **Version** means an alternative edit; reserve “take” for an actual recorded performance. The seed's whole-film “takes” conflate these concepts.

### The verbs users learn once

**Add · Select · Move · Trim · Split · Replace · Edit · Duplicate · Group · Preview · Compare · Undo · Export.** More specialized verbs extend these through the same command system: align, crop, mask, keyframe, mix, relink, transcribe, and render range. Prefer the user's object in the label: “Replace clip,” “Edit shared style,” “Export video,” not generic “Apply” with unknown scope.

### Where power lives

| Surface | Its job | Deliberately not its job |
|---|---|---|
| Canvas | Select, position, resize, crop, mask, edit visible text; show guides | Hide all interaction behind unlabeled gestures or require pixel-perfect precision |
| Timeline | Ordering, trims, overlaps, audio, keyframes when expanded, exact temporal relationships | Force every semantic story decision to become frame-by-frame scrubbing |
| Story/transcript view | Meaning, narrative ordering, line/phrase selection, B-roll suggestions | Pretend that a text edit guarantees a good audiovisual cut |
| Context inspector | Selected object's common properties, exact values, inheritance, named deeper groups | A universal scrolling warehouse of unrelated controls |
| Media library | Import, search, audition, inspect source/provenance, replace/relink | Confuse source selection with an edit to every placed instance |
| Command palette | Discover every supported action, search synonyms, show shortcuts and scope | Act as the only route to essential actions or invent unavailable features |
| Assistant | Suggest plans and alternatives; interpret intent; invoke normal editable commands | Own a separate hidden project model, publish without intent, or silently rewrite everything |
| History/versions | Undo, recover, name alternatives, compare changes | Replace source backups or make recovery contingent on naming a snapshot first |
| Optional automation surface | Reusable command sequences, parameterized components, scripts | Become mandatory for custom visual work or bypass undo/permissions |

This combines instruments, semantic views, and a continuous route to expertise rather than choosing “GUI versus AI” or “simple versus professional.”[8][9][5]

### The initial workspace

- **Top:** project/video name, save status, undo/redo, command search, and a prominent **Export video** action.
- **Center:** playable canvas; obvious play control; selected-object/range label.
- **Bottom:** compact timeline with zoom, source thumbnails, clear playhead, and selection distinct from playback.
- **Side:** collapsible Media/Story navigation and a contextual properties area. No selection produces useful video-level controls, not a wall of all capabilities.
- **Secondary:** versions/compare, assistant, scopes/styles, and advanced inspector groups open on request; user-pinned controls remain stable.
- **Small screen:** use purposeful sheets and alternate views while preserving selection, preview access, and all required actions. Platform-agnostic means stable semantics and portable projects—not pretending a phone, keyboard workstation, and browser have identical interaction capabilities.

### Novice → fluent → expert, without a migration cliff

1. **First result:** import or start from an editable example; preview, select, trim, change text, export. Provide in-context hints, not a forced tour of every panel.
2. **Second project:** reveal relationships as needed: source versus instance, shared style versus override, groups and layers. Keep the same objects and action names.
3. **Fluent use:** menus/tooltips show platform-correct shortcuts; palette search and optional post-action hints connect visible actions to faster routes. Users can pin controls without the software rearranging their habits automatically.
4. **Complex work:** multi-selection, named styles, keyframes, track/layer expansion, exact time/value entry, and compare views extend—not replace—the initial model.
5. **Automation:** saved command sequences and a documented scripting interface reuse the same selection IDs, validation, history, and operation results. A script can explain and preview its proposed change set.

A long-lived “beginner mode” with a different project representation would create the very transition cost the expertise literature warns about; optional guidance should fall away without changing the document underneath.[9][10]

### Worked journey: “Make this interview a short portrait, but keep the last line”

1. Import the interview. A Video opens immediately; transcription is a cancellable background task, not a prerequisite for playback or manual editing.
2. Select sentences in Story view, mark the last line “Keep,” and request a shorter alternative. The assistant proposes deletions with original words and linked time ranges; the current version remains intact.
3. Preview the joins, accept only the acceptable cuts, and fine-trim one boundary in the timeline. Transcript and timeline remain linked.
4. Select a phrase and choose “Add supporting footage.” Review candidates, insert one, then resize/reframe on the canvas. Its source and rights metadata remain accessible.
5. Choose a portrait output, inspect crop consequences, reposition a title, and compare against the original at the same story moment.
6. Export a video. Verify the generated file, including the retained last line, audio continuity, title placement, and output format. Export project/spec remains available separately.

This journey deliberately combines the contributions of transcript editing, constrained assembly, editable AI proposals, and comparison; its end-to-end success remains to be tested.[13][6][7]

### Engineering invariants that make the simple UX credible

These are implementation recommendations, not findings claimed for the seed:

- One canonical edit model with stable object IDs; views maintain selection/range mappings instead of independent copies of content.
- A command contract with explicit target IDs, scope, preconditions, proposed changes, validation results, and undo information. Pointer, menu, shortcut, assistant, and script use it.
- Transactional multi-object operations: never silently leave half an AI or batch edit applied. Pending work is visible, cancellable, and cannot overwrite newer manual changes unnoticed.
- Explicit dependency/provenance relationships for styles, constraints, captions, linked media, and generated assets. Preview impact before broad edits.
- Separate source data, edit decisions, cached previews, and exported files. Preview quality reductions do not alter the final project; stale caches expose their state.
- Render/export capability reporting and round-trip tests. Unsupported effects or formats produce actionable warnings, not a false “done.”
- Per-platform input adapters and semantic accessibility behavior over the same commands. Content theme tokens do not redefine interaction meaning.

## 4. Seed studio critique: preserve its intent, replace its ceilings

**Inspected source:**

- `<seed studio repo>/scripts/studio/studio.js`.
- `<seed studio repo>/scripts/studio/studio.css`.

Line references below identify those inspected files. They are source-level observations, not claims about uninspected repository features.

### What is worth keeping

- **Immediate playable context:** the monitor, timeline, and properties coexist; the source expresses the intent that scrubbing/playback/export share `render(T)` (`studio.js` 1–4). Preserve this coherence, but test actual preview/export equivalence rather than trusting a comment.
- **Choices are explained visually:** preview cards, descriptions, recommended defaults, and animated motion samples (`studio.js` 479–516; `studio.css` 141–160) make options more recognizable than parameter lists. Keep previews, with opt-in/hover/focus motion and reduced-motion handling.
- **High-level creative decisions already exist:** story arcs, pace, soundtrack, and chapter inclusion offer meaningful intent (`studio.js` 517–533). Generalize them into editable groups, constraints, and styles rather than discarding them for raw tracks alone.
- **Local variation exists:** shot overrides and inheritance from “film” (`studio.js` 535–555) are a useful seed for reusable styles.
- **Review and provenance are taken seriously:** approval/revision notes, source text, and REAL/SIM messaging are valuable (`studio.js` 551–559). Make provenance reusable metadata and policy, not hardcoded traffic-specific labels or an easily misunderstood factual guarantee.

### Specific problems and fixes

| Priority | Source evidence and likely burden | Concrete fix | Principles |
|---|---|---|---|
| P0 | `setS`, override, reset, and reorder handlers mutate/save state directly; no undo/redo mechanism appears in the inspected file (`js` 104, 595–617). Exploration requires confidence that a choice is safe. | Put all edits through transactional history; add labeled undo/redo, coalesce typing/drag gestures, preserve redo until a new edit, and make reset reversible. | P05, P08 |
| P0 | `exportSpec()` downloads JSON and says an external fframes build reads it (`js` 634–644); the button is correctly called “export spec” (`js` 658), but this is not a finished video-export workflow. | Preserve **Export project/spec**; add a genuinely working **Export video** path with capability/preflight, progress, retry, destination, and playback verification. Until supported, say so explicitly. | P02, P18 |
| P0 | Clicking a timeline shot keeps Direction open but switches other tabs to Shot (`js` 467). Selection behavior depends on prior tab state. | Always establish the same selected object and reveal its inspector; make a pinned global-style panel an explicit separate state with visible scope. | P01, P07, P13 |
| P0 | The chapter list's displayed order is not always rendered order: cold-open/day arcs reorder it again, acknowledged in help text (`js` 173, 177–180, 526–528). | Show actual order in Story/timeline. Mark a computed sort/constraint explicitly, allow “Use this order” or “Manual order,” and preview changes; don't rely on a footnote. | P04, P07, P12 |
| P1 | Direction starts with several brand concepts and accumulates style, soundtrack, motion, transitions, footage, overlays, and guides (`js` 499–516). Useful controls are mixed with project-specific selection overhead. | Move brand/style into reusable project assets; expose relevant properties on selection and a small video-level Style panel. Begin with editing content rather than selecting a traffic-product identity. | P01, P02, P06 |
| P1 | The timeline fits the whole film into percentages; shot labels disappear below a width threshold (`js` 431–438). Timeline handlers select/seek/loop but do not expose clip-edge trimming or reorder (`js` 462–474). | Add zoom, scroll, fit-selection, thumbnails, trim handles, reorder previews, keyboard alternatives, and clear ripple semantics. Keep a compact overview as a separate aid. | P04, P05, P16 |
| P1 | Length offers only one to four bars; motion/transitions come from finite lists (`js` 547–549). Musical pacing is helpful but becomes an expressive ceiling. | Retain beat snapping and bar presets; add exact duration/frame entry, free trims, keyframes, and editable preset ingredients. Make switching timing representations explicit. | P03, P12, P15 |
| P1 | Local controls say “film,” but do not explicitly show the inherited value or affected dependency set (`js` 548–549). | Show “Inherited: Glide from Video style,” “Override here,” and “Reset to inherited.” Global edits preview affected objects and preserve deliberate local overrides. | P07 |
| P1 | Takes are named whole-state snapshots in a select; restoring one merges current notes into the loaded state (`js` 588–611). An approval may therefore survive content changes without renewed review. | Rename to Versions, show thumbnails/diffs and current unsaved changes, and version-bind or mark review notes stale when their target content changes. Keep actual source takes separate. | P08, P09 |
| P1 | `A` clicks the approval button currently present in the inspector (`js` 629), while playback and selected-shot state are distinct (`js` 429, 535). Potential target ambiguity exists when reviewing moving playback. | Bind approval to an explicit selected clip/version, show the target in the action, and offer deliberate “Follow playback” review mode. Test playing, paused, and pinned-inspector cases. | P07, P13 |
| P1 | Chapter navigation/shot targets include clickable `div`s; tabs lack tab roles in generated markup; some controls rely on tiny dots/hover titles (`js` 435–438, 527, 664; `css` 59–60, 116). | Use semantic buttons and tab behavior, named controls, keyboard selection/range navigation, status text/icons, visible focus, and comfortable targets. Verify the accessible tree and real assistive interaction. | P16, P17 |
| P1 | At narrower widths, the layout becomes a vertical stack and the inspector pane loses internal scrolling (`css` 281–287). Changing properties can separate the user from the preview. | Keep preview/selection context available while editing in a collapsible sheet; test landscape/portrait, keyboard viewport, and zoom. This is a layout hypothesis, not a measured viewport failure. | P05, P17 |
| P1 | Local-storage writes swallow failures (`js` 92–94); changes are saved without an explicit reliable persistence result. Share links encode state and notes in the fragment (`js` 646–648). | Surface saved/unsaved/error status and recovery export; distinguish private local data from shareable project state, preview included notes, and never imply that media access is included merely because settings serialize. | P08, P18 |
| P2 | Shortcut help exists, which is good (`js` 665), but there is no palette or visible route from a successful action to batch use/automation in this file. | Preserve the cheatsheet, show shortcuts at command sites, add synonym search, and introduce reusable command sequences only when useful. | P14, P15 |
| P2 | Fixed traffic themes, chapter data, GEV sources, watermarks, and a fixed export size/fps are embedded in the implementation (`js` 19–88, 508–516, 636–639). | Separate generic editing schema, media providers, content style tokens, provenance policies, and export presets from this one demonstration. Validate a non-traffic, non-template project. | P03, P17, P18 |

**First implementation slice:** selection/scope consistency, undo, real export, and a zoomable directly editable timeline. Next, linked story editing and visible style inheritance. Only then add AI planning and many alternatives; otherwise automation multiplies the cost of ambiguous state and poor recovery.

## 5. Measuring intuitiveness rather than claiming it

### Research questions and cohorts

Test distinct populations: **editing novices**, **experienced creators new to fframestudio**, and **returning fframestudio users**. Also recruit relevant keyboard-only, assistive-technology, touch, and small-screen users. Do not equate novice software use with novice filmmaking or combine all groups into one mean.[10]

Use two complementary tracks:

1. **Controlled usability/learning:** comparable tasks and media, controlled asset readiness, counterbalanced condition order when comparing designs. Keep timed unassisted trials separate from think-aloud or question-suggestion diagnosis.
2. **Longitudinal creative work:** people edit their own materially different projects over repeated sessions. Observe whether the tool supports exploration and non-template outcomes, not just whether it accelerates a predetermined script.[2][3]

For comparisons, use a faithful executable seed workflow only for tasks it actually supports; compare broader tasks to an appropriate existing editor or baseline prototype. The seed cannot fairly be scored as a video-export competitor when its inspected action exports a JSON spec.

### Task battery

| Task | Objective completion criterion | What it diagnoses |
|---|---|---|
| First export from new project | Import supplied media, remove an unwanted section, change title, produce and open the correct playable file | Threshold and end-to-end completeness |
| Correct a rough interview | Remove a sentence without clipping speech; insert relevant B-roll; preserve a required line | Semantic editing, joins, and constraint visibility |
| Change shared visual style | Update all intended titles but preserve one intentional override | Scope, inheritance, dependency comprehension |
| Repair a mistake | Undo a multi-clip edit and restore the intended version without unrelated loss | Recovery and trust |
| Compare pacing alternatives | Identify substantive differences, choose one, retain a useful local change from another | Evaluation effort and exploration |
| Finish off-template work | Construct a custom overlapping composition, exact timing, and audio fade without prescribed templates | Ceiling and wide walls |
| Repeat and return | Repeat an operation via a faster route, then perform it again after a break | Learning dip, transfer, retention |
| Small-screen/accessibility path | Select, change, preview, undo, and export using the participant's input/access setup | Whether simplicity survives different access conditions |

### Operational measures

- **Time to first playable export:** start at opening a new project, end when the exported file is opened and passes the task checklist. Record import/transcription/render waiting separately from active interaction; report full elapsed time too. Include failures and abandoned trials rather than reporting only successful fast users.
- **Task success:** independently judge correct output and scope; report unassisted, assisted, partial, and failed outcomes separately. “Clicked export” is not success.
- **Discoverability:** first correct action, time to locate it, wrong-panel visits, unsuccessful searches, and help requests. Ask participants where they expected the action before revealing it.
- **Prediction/evaluation:** before a broad change, ask which objects they expect to change; afterward, ask what changed and whether the result is final. Score against actual project state.
- **Recovery:** time to restore intended state, lost edits, unrelated damage, and whether a person avoids experimentation because recovery feels risky.
- **Perceived usability:** standard SUS after the task set, administered consistently and scored with the selected validated instrument instructions. Report distributions and uncertainty, not just an average or an unexplained “good” cutoff; do not treat it as a percentage of tasks passed.[35][30]
- **Workload:** NASA-TLX after representative workflows, especially precise editing, batch changes, and AI correction. Use the same declared scoring variant throughout and retain the six subscales so low physical effort does not conceal high mental demand or frustration.[29]
- **Novice–expert transition:** time/trial until voluntary faster-method use, persistence across later trials, fallback rate, maximum temporary slowdown, trials until old performance is regained, and eventual task-time/error plateau. Shortcut availability is not adoption.[9]
- **Retention/transfer:** repeat after a planned break and introduce a related unfamiliar task. Track whether the user can infer the new interaction from previous ones.[10]
- **Creative breadth:** independent review of the brief, diversity of chosen structures, off-template completion, quality of alternatives, and participant ownership/control. A fast uniform set of outputs would not fulfill wide walls.[3]
- **AI correction burden:** proposal acceptance is only one signal. Measure time inspecting proposals, wrong scope, missed constraints, manual repair, reversions, final output quality, and completion when the assistant is disabled. High acceptance can reflect fatigue, not correctness.[6][7]

### Example provisional release gates—not literature constants

Set final targets after a baseline study and a power/precision plan. The following are **starting product hypotheses**, not outcomes measured here:

| Gate | Provisional criterion |
|---|---|
| First-use path | At least 80% of editing novices complete the specified first-export task without moderator assistance within a predeclared 10-minute task window, using supplied ready assets; report cold-import results separately |
| Scope | At least 90% correct target-set prediction for the shared-style task, with no silent project-wide changes |
| Recovery | All tested edit types undo correctly in product tests; in usability sessions at least 90% recover the intentional batch mistake without assistance |
| Completion integrity | Every claimed successful export in the test set opens and passes its content/audio/format checklist; failures never show success |
| Expert route | A visible improvement over each participant's practiced menu route after repeated trials, with no increase in consequential errors; quantify the dip and sustained use rather than forcing a shortcut quota |
| Access | No blocking defect in the selected keyboard, assistive, touch, or zoomed task paths; do not hide failures inside aggregate success |

Do not choose a sample size by declaring that a handful of participants proves these percentages. Use small formative rounds to locate problems; determine confirmatory sample size from the desired precision or effect, expected variability, attrition, and cohort comparisons. Report participant counts, intervals, assistance rules, and exclusions with every gate result.

### Instrumentation and decision rules

Log consented interaction metadata such as `command_id`, invocation surface, explicit scope, selection type, operation latency, undo linkage, preview-ready state, export outcome, and error/recovery category. Avoid collecting raw media, transcripts, notes, or prompts by default; use optional study recordings with explicit consent and a retention policy. Inspect exported artifacts locally when possible.

Separate command acceptance, preview readiness, final-render completion, and artifact verification in telemetry. Relate observed errors to P01–P18, and prioritize problems that prevent completion, change the wrong scope, or destroy recovery before visual polish or adding more generated options.

**The success condition:** users spend their attention on what the film should say and how it should feel, while the editor makes actions discoverable, consequences visible, and mistakes reversible. That is a stricter goal than a clean screenshot or a powerful chat box.

## Sources

[1] https://www.cs.umd.edu/~ben/papers/Shneiderman1983Direct.pdf
[2] https://dl.acm.org/doi/pdf/10.1145/1323688.1323689
[3] https://www.cs.umd.edu/hcil/CST/Papers/designprinciples.pdf
[4] https://vis.csail.mit.edu/classes/6.859/readings/pdfs/Hutchins-DirectManipulationInterfaces.pdf
[5] https://arxiv.org/html/2402.10294v1
[6] https://arxiv.org/html/2403.17693v1
[7] https://ar5iv.labs.arxiv.org/html/2502.10190
[8] https://dl.acm.org/doi/pdf/10.1145/332040.332473
[9] https://dl.acm.org/doi/pdf/10.1145/1978942.1979348
[10] https://dl.acm.org/doi/pdf/10.1145/1518701.1518803
[11] https://graphicsinterface.org/wp-content/uploads/gi2000-25.pdf
[12] https://jnd.org/signifiers-not-affordances
[13] https://www.floraine.org/papers/2012-video-transitions/paper.pdf
[14] https://dl.acm.org/doi/pdf/10.1145/2501988.2501993
[16] https://cg.cs.tsinghua.edu.cn/papers/TOG-2019-Write-a-Video.pdf
[17] https://arxiv.org/pdf/1902.11216v1
[18] https://www.nngroup.com/articles/ten-usability-heuristics
[19] https://www.nngroup.com/articles/progressive-disclosure
[20] https://worrydream.com/LearnableProgramming
[21] https://graphics.stanford.edu/papers/roughcut/files/roughcut-small.pdf
[22] https://dl.acm.org/doi/pdf/10.1145/344949.344959
[23] https://history.futureofcoding.org/history/msg_files/F6R/F6R1A64AF.pdf
[25] https://dl.acm.org/doi/pdf/10.1145/358198.358218
[26] https://graphics.stanford.edu/projects/quickcut/quickcut.pdf
[29] https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx
[30] https://site.unibo.it/hfrs/en/questionnaire-and-scales-2/sus
[31] https://www.lri.fr/~mbl/FundHCI/papers/Fitts-JEP54.pdf
[33] https://www.scribd.com/document/223215951/Hick-1952
[35] https://www.taylorfrancis.com/chapters/edit/10.1201/9781498710411-35/sus-quick-dirty-usability-scale-john-brooke
