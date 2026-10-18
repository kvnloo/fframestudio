# Hosted Studio: your files stay local

The public Studio is a static build of the same editor served by `npm run bridge`.
It has no account system, upload endpoint, hosted agent or project database. Its
library contains only projects you explicitly open from your device or your own
loopback bridge. **Examples** is a separate, lazily loaded shelf, never your library.

## Open your projects

- **Chromium:** choose **Open a folder**. Studio requests a `showDirectoryPicker`
  handle in `readwrite` mode and persists it in IndexedDB. On a later visit it
  checks permission without prompting; **Reconnect folder** requests permission
  again from a user gesture. Both a library containing project subdirectories and
  a folder containing `project.json` are supported. Save writes through
  `createWritable`, stages a temporary file, and compares the loaded content hash
  before replacement. Browsers without handle rename support use a final
  `createWritable` replacement; that fallback is not an atomic filesystem rename.
- **Firefox/Safari or read-only access:** choose **Open read-only** (the
  `webkitdirectory` file input). Files are kept in this origin's IndexedDB. Save
  updates a browser-local copy, never the original files. **Export project.json**
  downloads the current edited document; keep it beside the original media.
- Compatible fframes `timeline.txt` plus a master video can be imported after
  confirmation. This is an editorial project, not an execution of source code.

Autosave, recovery, undo/redo history, example copies and hosted workspace
preferences use IndexedDB. Clearing site data deletes these browser-local copies
and remembered handles. Private browsing, storage quotas, permission revocation
and browser eviction can make them unavailable. Export or save to your folder for
portable storage. Imported local media is played with object URLs. Video export
still requires the local engine/bridge; a project Save is not a rendered export.

## Local generation

Generate shot requires an authenticated bridge with an optional local GPU worker;
static hosting and browser-folder projects explicitly show local inference
unavailable. No model or paid API is required for editing. Open a project from
your connected bridge library to use its generation queue. See
[generation.md](generation.md) for setup, licence conditions and qualification
limits. The experimental hosted adapter is disabled; Portal/Space Bunny are not
advertised as free video backends.

## Examples are editable copies

`/examples/manifest.json` describes the optional shelf. Opening an example creates
an editable IndexedDB copy; the published example never changes. **Save to my
folder** copies its project and referenced media to your selected folder (or your
connected bridge library). Attribution appears on the card and in **Source**.
The shelf currently includes upstream fframes films by **Dmitriy Kovalenko**, MIT;
the source link pins their upstream revision. `examples/LICENSES.md` retains the
provided redistribution notices when present. Rendered proxies are baked films:
their original titles/effects are not separate editable compositor layers.

## Connect your own bridge

Start your own `npm run bridge` and open the **hosted studio** link it prints:

```text
https://fframestudio.vercel.app/#bridge=http://127.0.0.1:<port>&token=<token>
```

The token is in the fragment, never a query parameter sent to the static host.
Studio clears that fragment before API requests and keeps the connection in
`sessionStorage` for the tab. REST and streamed events carry a bearer header;
ACP WebSocket authentication uses the existing subprotocol, not the URL. Media
is fetched from the bridge with that header and exposed through local blob URLs.
**Disconnect** clears this tab's saved connection; restarting the bridge rotates
its token and revokes old links. Never publish, paste or screenshot a real link.

The bridge listens only on `127.0.0.1`. It allowlists
`https://fframestudio.vercel.app` in addition to existing loopback origins and
explicit `--allow-origin` values. `--hosted-origin` configures a different trusted
host for a private build. Do not allowlist untrusted sites. PNA preflights receive
CORS and `Access-Control-Allow-Private-Network` only for allowed origins. Normal
API requests still require the token and a loopback Host; WebSockets still check
Origin, Host and token. A preflight grants no file access by itself. Browser
local-network permission prompts/policies may additionally require approval or
block the connection; test results do not override browser policy.

### Trust boundary

Opening the hosted link explicitly grants this site's JavaScript access to your
bridge library and configured ACP agents. The website's origin/code, browser,
local extensions, local OS and bridge are trusted. A compromised trusted origin
or a stolen bridge token is not contained by the folder picker or by CORS. CORS
is a browser-origin boundary, not protection from another local process that
already knows the token. Bridge paths retain their root/symlink checks. Assistant
file callbacks allow only numbered proposal files for the current project, but
an agent's independent shell tools are **not sandboxed by those callbacks**.
Review proposals and use agents whose local tool permissions you trust.

The static host receives ordinary page/asset requests and their network metadata,
not your project files. The app makes no project/media uploads, analytics calls,
remote-font requests or third-party runtime requests. Source/install links leave
the site only when you explicitly follow them. Without a bridge connection,
runtime requests are same-origin; with one, the only additional endpoint is your
selected loopback bridge. The CSP limits connections accordingly. Do not treat
CSP as protection against a malicious replacement of the trusted site's code.

## Build and verify (no deployment required)

```sh
npm run build:site
python3 tools/build_demo_site.py --examples <rendered-example-directory>
npm test
bash scripts/check-no-local-paths.sh
npm run verify             # existing journeys plus four hosted journeys
npm run test:perf          # existing budgets unchanged
npm run verify:hosted
FFS_EVIDENCE=<evidence-directory> node tools/capture-hosted.mjs
FFS_EVIDENCE=<evidence-directory> node tools/compare-hosted-cold.mjs
```

The portable [qualification receipt](evidence/hosted-demo.json) records the three
21-journey runs, unit/security results, visual review, unchanged performance
budgets and both cold-open comparisons. It also retains the failed Node CPU timing
outlier alongside the passing serial rerun; it does not claim universal zero
latency overhead or physical compositor presentation timings.

`site/` is generated and ignored by Git. No visitor library is copied into it.
The builder discovers the optional `project-artifacts/fframestudio/examples/out`
artifact directory above the checkout, or takes `--examples`. Missing examples
are silently omitted. Referenced example media/project JSON and fonts/ACP assets
have content-versioned names. `site/vercel.json` enables clean URLs, revalidation
for HTML/code/manifest, year-long immutable caching for versioned assets, no-referrer,
MIME sniffing protection, frame denial and the local-only CSP. Serve **site/**,
not the repository. This build does not deploy anything.

The automated native-folder test uses an **in-memory directory-handle fake** to
exercise reads, `createWritable` writes, hash conflicts, saved-copy readback and
permission re-request. A real native `showDirectoryPicker` dialog cannot be driven
headlessly here. Real IndexedDB, file-input folder imports, recovery, reload,
export, example copies, loopback media and ACP proposals are exercised in Chromium
through a plain static server. That is not a claim of Firefox/Safari browser or
production HTTPS local-network-dialog qualification.
