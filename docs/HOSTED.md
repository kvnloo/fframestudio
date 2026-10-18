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

## Examples are editable copies

`/examples/manifest.json` describes the optional shelf. Opening an example creates
an editable IndexedDB copy; the published example never changes. **Save to my
folder** copies its project and referenced media to your selected folder (or your
connected bridge library). Attribution appears on the card and in **Source**.
The shelf currently includes upstream fframes films by **Dmitriy Kovalenko**, MIT;
the source link pins their upstream revision. `examples/LICENSES.md` retains the
provided redistribution notices when present. Rendered proxies are baked films:
their original titles/effects are not separate editable compositor layers.

## Original launch film (local only)

The featured **fframes — Original launch film** is the upstream long-form showcase
by Dmitriy Kovalenko. Its public catalog entry is `awaiting-permission`: MIT covers
code, but the music, sound effects, clips and stills lack source/licence metadata.
**Do not redistribute the master, proxy, contact sheet or poster without permission.**
The public card therefore uses typography, not derived media. The existing synthetic
12-second demo (`npm run demo`) and permitted short examples remain independent.

From a checkout, with Node, Python, FFmpeg/ffprobe, Git, Rust/Cargo, native Skia
build prerequisites and a supported Vulkan/Metal GPU:

```sh
npm run example:fframes-intro
# Optional existing, unmodified pinned checkout and an explicit output location:
npm run example:fframes-intro -- --source <upstream-checkout> --out <local-output>
# Optional explicit library import (never automatic):
npm run example:fframes-intro -- --import-library <your-library-projects-folder>
```

The tool pins `44745c09a6c8c51071609097326a820cf59d087b`, refuses tracked
source changes, builds the original binary without patching upstream, saves its
`timeline --json`, renders a native master and creates a 720p H.264/AAC faststart
proxy and poster. It runs ffprobe/frame/audio checks and saves a receipt and contact
sheet. A default run writes only `~/.cache/fframestudio/examples/intro`; it never
writes bridge configuration or your library. Select its **project/** subfolder with
**Open a folder** / **Open read-only** in Studio, or use the explicit import flag.
Do not select the build root: it also contains the large master, checkout and caches.
The portable package contains only the proxy, poster, document, timeline and notices. The output
`project.json` uses the app's project/0 → project/1 migration with all 16 real scene
boundaries and raw upstream audio timing in provenance. No beat grid is fabricated;
the browser measures the embedded mix for its waveform. Titles, shaders and scene
effects are baked pixels, not editable source layers.

Upstream advertises **128 seconds / 2:08**. At the pinned revision its actual CLI
timeline is **7,650 frames at 60 fps = 127.5 seconds**; the project preserves that
exact duration, not a padded or trimmed substitute. Native dependencies differ by
platform; build failures are fatal and logged under the output's `logs/`. Existing
build environments can use `CARGO_TARGET_DIR`, standard compiler/FFmpeg environment
variables, or `--binary <already-built-original-binary>`. `--reuse-master` avoids
rendering a second time when regenerating local assets. These are local development
options, not a hosted render service. Review `contact-sheet.jpg` before use.

After obtaining permission, the owner can place that generated folder's files in
the selected examples directory and deliberately opt in:

```sh
python3 tools/build_demo_site.py --examples <local-output> --allow-unlisted-media fframes-intro
```

This flag is **not a licence grant**. The default build strips intro video, project
and poster references even if an input manifest claims `available`. The catalog
records `sourceRepo`, `sourcePath`, `duration` (seconds), `provenance`, `credits`,
`poster`, `readiness` (`available | local-build-only | awaiting-permission`), category
(`Demo | Short film | Long-form`) and featured status. Existing cleared manifests
are upgraded by the builder. The metadata-only entry is present even without assets.
No master is bundled and the existing 60 MB site budget remains enforced.

```sh
npm run verify:intro  # clean skip without a local artifact
FFS_INTRO_ARTIFACT=<local-output> FFS_EVIDENCE=<evidence-directory> npm run verify:intro
```

This optional Chromium journey opens a disposable copy through the hosted folder
input, seeks first/middle/last real scenes, plays, verifies decoded audio and a
measured waveform, checks attribution and reopens. It never connects to a user
bridge or writes a real library. CI retains the fast synthetic fixture, with no
Rust/GPU requirement, and checks the feature on desktop and mobile. The portable
[issue #8 qualification receipt](evidence/issue-8-intro.json) records verified media,
real playback, passing runs and retained timing/readiness failures; it does not claim
universal frame-budget reliability on a contended host.

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
artifact directory above the checkout, or takes `--examples`. Missing optional short
examples are omitted; the metadata-only launch-film card and generated 12-second
synthetic Demo remain. The Demo is generated in a disposable HOME using FFmpeg,
never a visitor library. Referenced example media/project JSON and fonts/ACP assets
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
