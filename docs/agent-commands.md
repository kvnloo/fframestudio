# Assistant command proposals

ACP remains the transport; users retain their local agents and subscriptions. The app saves
its current v1 document before sending a request, then supplies the exact path, selection,
video ID, revision, allowed command shapes, and a unique numeric proposal filename.

**Do not edit project.json or source media.** Read the project, then write
`projects/<project-id>/proposals/<n>.json`, relative to the bridge library root:

```json
{
  "schema": "fframestudio.proposal/1",
  "projectId": "omarchy-themes",
  "baseRevision": 0,
  "title": "Tighten the opening and clarify its title",
  "commands": [
    {"type":"trim", "clipId":"s01", "duration":150},
    {"type":"edit-text", "clipId":"s01", "field":"title", "value":"A clearer opening"}
  ]
}
```

Every timing value is an **integer project frame**. No executable code, paths to mutate,
source modifications, or shell scripts belong in a proposal. `videoId` is optional for the
first video; specify it for other videos. Commands refer to stable IDs, never displayed indices
except the explicit destination of `move`/`add`.

| Command | Parameters besides `type` / optional `videoId` |
| --- | --- |
| add | `clip` (ID, name, duration, optional mediaId/sourceIn etc), optional `index` |
| move | `clipId`, `index` (zero based final story index) |
| trim | `clipId`, optional `sourceIn`, optional `duration` |
| split | `clipId`, `at` (clip-local frame), `newId` |
| replace | `clipId`, `mediaId` (or null), optional `sourceIn` |
| edit-text | `clipId`, `field`, `value` (string or array of strings) |
| duplicate | `clipId`, `newId` |
| group | `clipIds`, `id`, `name` |
| set-beat-lock | `clipId`, boolean `value` |
| retime | `clipId`, `speed: {num,den}` |
| delete | `clipId` |
| edit-style | `styleId`, hex `color` — **all clips using that shared style** |
| save-version | `id`, `name` |
| restore-version | `id` |

Timing changes ripple the primary story and preserve declared attachments. Beat-locked
clips reject direct timing edits or upstream ripple displacement. Ask permission to unlock
or include an explicit reviewed `set-beat-lock:false` command. Never silently relax locks.

## Review lifecycle

1. `/events` or ACP's write callback notices the proposal; the app reads the file.
2. The worker checks schema, project ID, exact base revision, command allowlist, limits
   (1–100 commands), IDs, ranges and source handles. It computes a diff without applying it.
3. **Inspect** shows scope plus before/after paths. A stale proposal is disabled; ask the agent
   to regenerate against the current revision. No hidden rebase.
4. **Apply** revalidates against the live document and executes a single undoable transaction.
5. **Reject** leaves the document and history unchanged. The proposal file remains as evidence.
6. Applied content is ordinary editable clips/text. Undo/redo and Save work identically to
   manual edits. Review status is currently session-local (not a persisted audit ledger).

The browser ACP file-write handler permits only the proposal directory; absolute paths are
resolved relative to the bridge root rather than the nested project working directory.
**This is not an OS sandbox.** Agents with independent shell/file tools can still write files
using their own permissions. The prompt prohibits it, and external-change handling prevents
silent overwrite of dirty local edits. Do not treat the review contract as containment of an
untrusted local agent. Approval UI remains available for ACP permission requests.

## Reproduce the live test

```sh
npm run build:acp
node tools/verify-editor.mjs --acp
```

This starts a bridge on port 7879 (override `FFS_PORT`) with a disposable library, drives
Chromium, connects real `hermes acp`, asks it to write a proposal, verifies no document change
before acceptance, then Inspect → Apply → Undo → Redo → Save. It records screenshots, actual
proposal JSON and chat in the printed evidence directory. No mocked model response is used.
