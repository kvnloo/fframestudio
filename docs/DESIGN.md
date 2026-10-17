# fframestudio design direction (v0)

Synthesis of `docs/research/01–05` (checked 2026-10-17). Every decision below cites the report
it comes from; open questions are listed at the end. This is the plan for the editor, not a
description of what exists yet.

## 1. The product in one sentence

One editable video, several synchronized ways to see and change it: **Story** (meaning, order,
words), **Timeline** (time), **Canvas** (space), and an **Inspector** for the selected thing.
They are views over one document, never separate "simple" and "pro" projects. (01 §C, 02 §Decision, 05 §Decision)

## 2. What the user sees

- **Nouns:** Project → Media, Video, Versions. A Video holds Clips and Layers; Scenes are optional
  groups. "Take" is reserved for recorded performances; whole-film alternatives are Versions. (05 §3)
- **Verbs learned once:** Add, Select, Move, Trim, Split, Replace, Edit, Duplicate, Group, Preview,
  Compare, Undo, Export. Advanced verbs extend the same command system. (05 §3)
- **First minute:** open an editable example or drop media → it plays → change a word, trim a
  clip → Export. No tour. (01 §B, 05 P02)
- **Where power lives:** contextual inspector groups, a command palette that shows shortcuts,
  direct manipulation on canvas and timeline, and the assistant. (05 table "Where power lives")
- **Novice to expert without a cliff:** the same objects all the way; menus teach shortcuts;
  saved command sequences and a scripting API reuse selection IDs and undo. (05 §3, 02 §12)

## 3. Editing model

- A primary story lane with attached clips (Final Cut-style relationships), explicit tracks only
  when overlap needs them; Resolve Cut-style fast assembly; Premiere-style contextual controls. (02 §Decision, §11.3)
- Beat grid as an editable relationship, not a hidden timer (the seed's strongest idea, kept). (01 §A, 02 §11.1)
- AI changes arrive as **proposals over ordinary objects**: previewable, diffable, undoable. (05 P10)
- Scope is always shown before a change (this clip / all clips using this style). (05 P07)

## 4. Document and interchange

- Versioned JSON project with stable IDs and rational time; edits never mutate sources.
  The current `fframestudio.project/0` (library importers) is the seed of this. (03 §6)
- OpenTimelineIO for editorial interchange with explicit loss reports, not as the whole document
  or the renderer. (02 §11.4, 03 §1)
- Collaboration: Yjs for document state and collaborative undo; media stays outside the CRDT. (03 §1)

## 5. Engine stack (conditional, each behind an adapter and a qualification gate)

| job | first candidate | risk to check |
| --- | --- | --- |
| preview + browser export | WebAV (MIT) | last push 2026-01-10: maintenance pace; Chromium-only |
| media I/O, proxies, thumbnails | Mediabunny (MPL-2.0) | file-level copyleft obligations |
| native / server export | audited FFmpeg build; fframes (MIT) as optional motion-graphics backend | fframes does not consume our spec yet |
| desktop shell | deferred: the web app + local bridge covers files, agents and offline; revisit for one-click install, identical export codecs, background renders | — |
| captions | Transformers.js (browser), whisper.cpp (native) | model sizes |
| masks | MediaPipe | quality on hard edges |
| beats | web-audio-beat-detector as an editable suggestion | not authoritative downbeats |

Licence traps to avoid: Remotion company licence, GSAP licence change, Theatre Studio AGPL,
Diffusion Studio watermark terms. (03 §8)

## 6. Plugins

- Three audio families: `audio.catalogue`, `audio.generate`, `audio.analyze`. (04 §1, §5)
- Ship first: the existing CC BY catalogue (incompetech, TeknoAXE) with credits and beat grids;
  ccMixter (API permits third-party apps); Openverse for discovery only.
- Generation pilot: **ACE-Step 1.5** (MIT code and weights, commercial output permitted, 8–12 GB
  GPU configuration). Not MusicGen/MusicGPT (CC BY-NC weights).
- **Earshot** = `Leonxlnx/earshot` (MIT, CPU): soundtrack critique, sync and loudness checks,
  procedural SFX. An `audio.analyze` plugin, not a song generator. Confirmed by Kevin 2026-10-17.
- Export is fail-closed: non-commercial or unverifiable assets block a commercial export, and
  credits are generated automatically. (04 §6)
- Executable plugins run in capability-scoped workers or sandboxed iframes; no desktop IPC. (03 §1)

## 7. AI over ACP (built)

The assistant is an ACP client; the local bridge runs Claude Code, Codex, Hermes, Gemini or
OpenCode with their own logins. Today agents edit `project.json` directly; next step is to route
them through the command system so their changes become reviewable proposals (§3).

## 8. How we will know it is intuitive

Time to first export, task success on scripted edits, SUS and NASA-TLX, recovery after an error,
and how quickly people move to faster routes such as shortcuts and the palette. (05 §5)

## 9. Platforms (decided 2026-10-17)

- **Web app is the product.** Every feature ships there first, served by the local bridge
  (files, agents, renders) and usable by collaborators in any Chromium browser.
- **Tern "beta-ui" is a secondary add-on.** A Luau plugin plus Tern Surface Protocol views:
  native library, render queue, assistant and review notes, with preview/timeline opened in a
  Tern browser pane. Same `project.json`, bridge and ACP agents. Tern is closed beta, so nothing
  may depend on it.
- **Desktop shell deferred** (see §5).

## 10. Build order

1. Document v1 + command system with undo (everything else calls it).
2. Story / Timeline / Inspector over the imported projects; WebAV preview spike behind its gate.
3. Assistant proposals through commands; export with the licence gate.
4. Audio plugins: CC BY catalogue → ccMixter → ACE-Step → Earshot analysis.
5. OTIO export, collaboration.
6. Tern beta-ui add-on.

## Open questions

- Diffusion Studio and Freesound commercial terms need legal reading before use.
