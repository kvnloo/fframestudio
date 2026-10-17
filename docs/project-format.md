# Project document v1

`web/src/doc/project.js` is the canonical loader/validator. The browser migrates in a dedicated
module Worker. Opening a v0 file does not write it; Save writes v1 through the bridge.

```json
{
  "schema": "fframestudio.project/1",
  "id": "example",
  "title": "Example",
  "revision": 0,
  "fps": {"num": 30000, "den": 1001},
  "canvas": {"width": 1920, "height": 1080},
  "media": [{"id":"media-1", "kind":"video", "file":"media/source.mp4", "duration":300}],
  "videos": [{
    "id":"video-1", "name":"Main edit", "styles":{"default":{"color":"#ecebe7"}},
    "beats":[0,30,60], "scenes":[],
    "clips":[{
      "id":"clip-1", "name":"Opening", "mediaId":"media-1",
      "start":0, "sourceIn":0, "duration":90, "speed":{"num":1,"den":1},
      "thumb":null, "text":{"title":"Original words"}, "textOverrides":{},
      "styleId":"default", "beatLock":false,
      "attached":[{"id":"text-1","kind":"text","field":"title","offset":0,"duration":90}]
    }]
  }],
  "versions": [], "preview": {}, "metadata": {}
}
```

## Time and identity

* All timeline and normalized source times are **integer project frames**, not decimal seconds.
  Half-open ranges `[start, start + duration)` are used throughout. `fps` and `speed` are
  positive rational pairs. Migration rounds each original boundary to the nearest project
  frame; it records original seconds in metadata. A numeric 29.97 is preserved as 2997/100,
  not silently reinterpreted as 30000/1001.
* Stable IDs are persisted; existing shot IDs survive migration. New interactive objects use
  UUIDs. Imported media IDs are deterministic within the project. Duplicate IDs are rejected.
* `start` is materialized primary-story position. Every structural command reflows the lane;
  no gaps or overlaps in the primary lane. Attached items have clip-relative offset/duration.
* `sourceIn + localTimelineFrame * speed.num / speed.den` is the source mapping. Retime and
  split reject nonintegral frame boundaries rather than silently rounding. Known source
  bounds reject missing handles; unknown bounds remain unknown (not verified media availability).
* Text layers bind to a field of `textOf(clip) = {...text, ...textOverrides}`. String arrays
  remain arrays, editable as multiline text. Audio/overlay attachments may reference media.
  Splitting partitions crossing attachments; moving retains attachment identity; deleting
  a parent deletes its attachments; text trims clip their visible range. Audio/overlay tails
  may extend beyond the parent. This is editorial structure, not a full processing graph.
* Scenes are optional `{id,name,clipIds}` groups. Versions contain `{id,name,videoId,video}`
  snapshots, not recursive copies of all versions. Restoring a version is undoable.
* `revision` increases on apply, undo and redo. Revisions do not rewind with undo. Persistent
  file concurrency additionally uses a SHA-256 compare-and-swap of the exact loaded bytes.

## v0 migration

`fromV0(project)` is pure, deterministic and idempotent for v1. All importer kinds are supported:

| Import kind | Media and timing |
| --- | --- |
| studio-spec | Per-shot media assets, independent source in = 0; text, chapters and provenance retained |
| fframes | Master/proxy source ranges from timeline/cut boundaries |
| fframes-clips | Independent render per shot, source in = 0; repeated zero-based ranges assembled consecutively |
| html-film | SHOTS ranges plus array-valued head/body text; original metadata retained |
| capture-manifest | Independent captured media, source in = 0; sequential story assembly |

The entire original v0 object is kept under `metadata` for loss-aware future adapters; it is
not an alternate editable timeline. Original `edits` become `textOverrides`. Imported music
beat lists (`beats` / `beat_times`, seconds relative to `starts_at_s`) become frame lists.
BPM alone **does not invent a measured beat grid**. The current import of one real project includes
BPM but not beat times; its timeline correctly has no manufactured beat lines.

Use `node tools/migrate-project.mjs INPUT.json OUTPUT.json` to migrate a **copy**. The tool
refuses an existing output and identical real paths. Tests copy every project from
`FFS_LIBRARY` (default `~/fframestudio/projects`) to TMPDIR, migrate, read back, and verify
original bytes. Never re-run an importer over a v1 edit without explicit recovery planning.

## Commands, history, patches

`CommandStore.preview(cmd)` returns `{scope,diff,after}` without mutation. `apply(cmd)` validates
atomically, returns the preview plus a trusted inverse, and adds one history entry. A `batch`
is one transaction: any failed command leaves both the document and history unchanged.
The external proposal allowlist excludes internal `restore-document` inverses.

Names: add, select, move, trim, split, replace, edit-text, duplicate, group, set-beat-lock,
retime, delete, edit-style, save-version, restore-version. Selection is an ephemeral named
command with an inverse, not a dirty document edit or a content undo entry. Playback never
changes edit selection. Shared style commands explicitly report all-instance scope. Beat
locks protect both start and duration, including displacement by earlier ripple edits.

The worker sends JSON-pointer-like patches (`path`, `before`, `after`) with escaped path
segments, rather than retransferring the project on each edit. Array length changes replace
the affected array. `applyPatches` preserves untouched references. Views reconcile stable
visible clip nodes; an edit never replaces the whole editor or its canvas/player.

Save is explicit (button / Mod-S) with Saving, Saved, Unsaved, Error and Conflict states.
The bridge atomically renames the new file after checking `X-FFS-Expected`. External changes
reload only a clean document; dirty documents show a conflict with explicit discard or
reviewed overwrite. The latter still performs a new compare-and-swap. Navigation and tab
close warn about unsaved edits. No CRDT or automatic conflict merge is claimed.

## Current boundary

The source proxy plus thumbnail/text preview is **not** a faithful final composite. Baked
source titles remain visible beneath new text. Audio mixing, arbitrary overlay compositing,
transitions, waveform generation, native export and OTIO are not implemented here. Export
is visibly unavailable, never a fake success. Undo history is session-local; saved Versions
and project edits survive reload. Media files are never written by editor commands.
