# Taste: read-only contract and visual direction (issue #11, A + B)

## What ships

**My Taste**, beside Direction, accepts a user-supplied **aggregate JSON profile**.
It starts Off. Choose strength 0–100, signal toggles and task/project application
scope; inspect original vs adjusted palette/type/pace studies and the explained
dial diff, then **Apply direction**. Apply is one ordinary `apply-taste` command,
with normal Save, recovery, Undo and Redo. Turning Off stops preview/application;
it does not reverse a prior committed edit—use Undo for that.

Palette (first ink) and bundled typography update the selected video's shared
styles and editorial text preview. Framing, motion, cuts/pacing, transition,
density and soundtrack mood are **direction tokens**, not a new compositor:
applying them never silently retimes footage, adds transitions or replaces music.
The comparison uses a sample phrase, not newly generated footage. No #9 component
catalogue/ranking is claimed by this delivery; launch-film direction is the
integration surface. Unknown signals remain unchanged and disabled. Confidence
weights numeric/colour changes; categorical tokens require weight >= 0.35.
No claim that these choices improve aesthetic quality has been evaluated.

## Versioned, bounded contract

`web/src/taste/profile.js` exports Draft 2020-12 JSON Schemas `profileSchema` and
`applicationSchema`, plus their dependency-free validators. `profile.d.ts` and
`adapters.d.ts` define the typed public interfaces. Schema IDs:

- `fframestudio.taste-profile/1`: immutable revision, eight named signals with
  bounded value, evidence count and confidence, and provenance summary counts.
- `fframestudio.taste-application/1`: user revision and scoped revision pins,
  scope, intensity, enabled/changed signals, resolved dials, aggregate counts and
  ISO timestamp. Receipts contain neither a profile nor source references.

The vocabulary is intentionally closed: colours are hex, type is one of the four
bundled font families, other categorical choices are enums, dials are 0–100.
Missing evidence is represented by null/0/0, never an inferred genre or tempo.
JSON import is limited to 32 KiB. Additional fields are rejected at every nested
level, including raw text, URLs, posts, media, credentials and source identifiers.
This is a shape/minimization boundary, not a guarantee about the truth of supplied
aggregate counts. A human must review them.

`resolveScopes(user, {brand, project, task, constraints})` overlays non-null
signals in user → brand → project → task order; final brand constraints always
win, including when a signal is unchecked. Project brand locks are stored in
`metadata.tasteBrandConstraints`, a partial dial object. Commands enforce those
locks too, not merely the inspector. Distinct revision counts are summed once;
reusing a revision assumes the same immutable snapshot and deduplicates it. Do
not add cross-user profiles: the API accepts no tenant selector. The inspector
uses the explicitly selected profile at task/project scope, without mutating a
durable user or brand default. Administrative scope/profile management is not a
new UI in A/B. Receipts pin every supplied scope revision and resolved values.

`previewTaste` is pure and deterministic for the same profile, project and
controls; timestamps are supplied separately to `tasteReceipt`, at Apply time.
A profile's revision must change whenever its aggregate signals change.

## Adapters and privacy

- **Mock:** `mockAdapter` receives the synthetic fixture under
  `test/fixtures/taste/`, or returns explicit offline/disconnected/unauthorized
  states. No account or service calls are made.
- **File:** `fileAdapter` validates before storing one aggregate profile in this
  origin's `fframestudio.taste` IndexedDB database. Hosted mode uses the same
  adapter. Delete waits for queued writes, removes the stored record and clears
  the mounted preview; reload cannot resurrect it. Storage failure is explicit.
  There is no background refresh or learning. An existing project's undoable
  receipts/dials are intentional history, not a cached source profile, and remain
  until undone/removed from that project. No profile is bundled into static builds.
- **AgentWeb:** browser `bridgeAdapter` can explicitly read the authenticated
  bridge's `/taste/profile`, never the service directly. The server adapter sends
  **GET `/api/taste/profile`**, accepts the PR #57 `{profile: {...}}` envelope,
  bounds response bytes, refuses redirects, validates schema/source/count/style
  fields and drops all terms/domains before returning anything to the browser.

AgentWeb PR #57 was verified **OPEN, not merged**, when implementing this seam.
Its legacy `taste.profile.v1` response includes `sourceCount`, `itemCount`,
`sources: [{source: 'x_bookmarks'|'collection', itemCount}]`, `topDomains`,
`topTerms`, `styleSignals: [{name, score}]`, and nullable `updatedAt`. It does
**not** provide per-visual-signal evidence counts, palettes or fonts. Therefore
normalization preserves summary counts and a hashed revision but leaves all
visual signals **unknown**, rather than pretending textual style scores are
measured visual evidence. File import supports actual human-reviewed visual
dials now. AgentWeb #62–67 are future coordination, not deployed functionality.

The HTTP adapter is **disabled by default**. A bridge owner can explicitly pass
`--enable-agentweb-taste` and supply `FFS_TASTE_AGENTWEB_URL` (fixed HTTPS origin)
and `FFS_TASTE_AGENTWEB_TOKEN` in the bridge environment through their secret
manager. No token-entry UI, discovery file, project field or browser storage is
added. The environment token is removed before spawning ACP children. A bridge
represents exactly its owner's signed-in service user; the service bearer owns
tenant resolution. The bridge route requires existing Host/Origin/auth guards,
accepts no query parameters and no writes. Missing configuration/404 returns
`disconnected`, 401/403 `unauthorized`, network/5xx `offline`, malformed service
output `invalid`. No service error bodies, terms or credentials are surfaced.

**No live AgentWeb endpoint, social account, credential store or personal source
was accessed by these tests.** Remote deletion/tenant isolation/source access
remain PR C qualification. In A/B remote profiles are ephemeral read-only
results; Delete applies only to the local file profile.

## Converting a TASTE.md-style document

Run locally on a document you are authorized to use; do not commit the input,
candidate or approved personal profile:

```sh
python3 tools/taste-from-md.py my-TASTE.md --out candidate.json
# Inspect/edit candidate.json: review every dial, count and uncertainty.
python3 tools/taste-from-md.py --review candidate.json --out approved.json --approve
# Type APPROVE at the review prompt, then import approved.json in My Taste.
```

The first stage proposes only explicit hex colours and a recognized bundled font,
with **one document** of evidence and low confidence (0.25). It cannot safely infer
contextual pacing, motion, negation, music genre or bookmark counts from prose.
Those stay unknown until a human edits/reviews the aggregate JSON. No prose,
citations, file paths, raw URLs, account identifiers or personal titles are copied.
The separate approval stage runs the application's real validator, prints the
aggregate JSON for review, and requires confirmation before writing a new 0600
file. It refuses existing output paths and never sends data to a service.

## Verification and what is left

`npm test` exercises raw-field rejection, scope precedence/brand locks,
determinism, adapter states, mocked HTTP contract, pending-write deletion, the
review converter and command undo/save. `npm run verify` includes both bridge and
CSP-served static-host journeys:

`import file profile → preview diff → apply → Save/readback → Undo → delete → reload`

The layout matrix includes My Taste, and screenshots cover 1896×880 and 390×780.
`npm run test:perf` retains existing budgets unchanged. This work adds no runtime
dependencies and does not commit a personal TASTE.md or derived profile.

Left: **C** real X/AgentWeb source import and remote deletion/tenant qualification;
**D** official Pinterest/YouTube capability work; **E** voice and durable feedback;
**F** opt-in blind preference evaluation. These are not simulated as working APIs.
