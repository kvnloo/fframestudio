# fframestudio · Tern beta-ui

An **optional secondary UI**. The web app remains the product; nothing in the web app,
project format, importers or bridge depends on Tern. All add-on code lives here.

## Install

Requirements: a signed-in Tern closed-beta installation, Node **22+**, and an imported
fframestudio library. From a checkout of this branch:

```sh
npm ci
npm run build:acp
npm --prefix tern ci
tern plugin link "$PWD/tern"
tern plugin list
```

`link` is reversible and references this checkout, so keep the worktree in place.
No `settings.json` changes are needed. Remove with `tern plugin unlink fframestudio`.
After updating the Luau file, run `tern plugin reload`; reopen existing native panes to
pick up Node changes. An unusually busy machine can hit Tern's 50 ms plugin-load budget;
reload and check the palette as well as the daemon's plugin list.

## Commands

In Tern's command palette:

- **fframestudio: open library** — opens a new tab with native project cards.
- **fframestudio: open project** — opens the library as a project picker; select **Open project**.
- **fframestudio: render queue / status** — native imported-output inventory.

Action IDs are `plugin.fframestudio.open-library`, `plugin.fframestudio.open-project`,
and `plugin.fframestudio.render-queue`. The plugin installs no global shortcuts and does
nothing at window startup. It does not close or replace existing sessions or tabs.

Inside a native review pane: **L** library, **R** refresh, **Q/Escape** close. Buttons offer
the same actions. **Open web editor** creates a Tern browser pane with the selected project.
**ACP assistant** creates a native agent pane alongside the review. Pick an agent explicitly,
type a prompt, then Enter/Send. Cancel turn requests ACP cancellation. Escape disconnects
and closes that assistant. Permission requests show the agent's choices and a **Deny** button;
nothing is auto-approved. No agent is started merely by opening the library or assistant pane.

Direct use (in Tern, or read-only text outside Tern):

```sh
node tern/app.mjs
node tern/app.mjs --project hermes-x-tern
node tern/app.mjs --queue
node tern/app.mjs --assistant hermes-launch
node tern/app.mjs --plain --project hermes-x-tern
```

## Native versus browser

| Surface | Implementation |
| --- | --- |
| Library | Native TSP lists/cards, title, kind, duration, shot count; local posters sent as image blobs when the terminal advertises `image` |
| Project review | Native shot names, subsecond ranges, original text merged with `edits`, array-valued text, review notes |
| Render status | Native inventory of the project's `renders`; explicitly **not** a scheduler |
| Assistant | Native TSP composer, streamed ACP replies/tool titles, explicit permissions; the existing bridge runs installed agents with their own login |
| Preview/editor/timeline | Existing web application in a Tern browser pane; video stays in the browser |

The Luau entry only registers palette commands and launches a Node process in a new tab.
The process uses the official `@stencil-hq/tern` SDK for handshake, native trees, image blobs,
credit-controlled reconciliation, input and terminal cleanup. Slow work never runs in a
Luau window callback.

## Bridge lifecycle and credentials

The default discovery file is `~/.config/fframestudio/bridge.json`. At startup the add-on
checks its PID, `/health`, and authenticated `/me`. A healthy bridge is reused. If its PID
is absent/dead, it starts this checkout's `bridge/bridge.mjs --quiet` on loopback port 7878,
serving `~/fframestudio`. The launcher has a bounded startup lock, verifies health, suppresses
bridge stdout/stderr and leaves the healthy bridge running after native panes close.
A live unhealthy PID is **not** killed or replaced; an occupied port fails visibly. A stale
`tern-start.lock` must be removed manually after confirming no launcher is running.

Tokens are read at runtime, not compiled into the plugin. Authenticated REST uses bearer
headers, ACP uses the WebSocket subprotocol, and the browser's `/open?token=…&to=…` link sets
the existing HttpOnly cookie before redirecting to the project. The credential-bearing
control command is a temporary **0600 file in a 0700 directory**, removed in `finally`;
CLI output is discarded, and the token is never supplied in process argv or TSP output.
Do not collect browser history/screenshots until `/open` has redirected: the initial address
is a credential. Do not share raw Tern browser inventories or request logs.

Optional environment variables:

- `FFS_NODE`: Node executable used by the Luau launcher (default `node`).
- `FFS_TERN_BIN`: Tern executable used for pane actions (default `~/.local/bin/tern`).
- `FFS_BRIDGE_FILE`: an alternate discovery JSON for an **already running**, externally
  managed bridge. It must pass the same loopback/PID/auth checks; auto-start is disabled.
  Useful for isolated qualification while other tests own the default discovery file.

Client-mediated ACP filesystem callbacks resolve paths under the selected project and reject
traversal/symlink escapes. This is **not an agent sandbox**: installed agents can run shell
tools with the user's permissions, just as in the web assistant. Treat project text and model
output as untrusted. This beta exposes replies and tool titles, not a full tool-diff viewer.

## Verification

```sh
npm --prefix tern test
```

Tests exercise bridge discovery/auth/loopback restrictions, PID/health reuse, real bridge
startup, the private browser-control file lifecycle, project/array/edit rendering, honest
render status, composer Unicode handling, permission controls and ACP path boundaries.
The integration test uses a disposable HOME and project fixture, starts the actual bridge,
reads the CLI's three views, verifies the browser redirect, then stops its owned bridge.
It never sends a model prompt. Tests need root dependencies installed as above.

Native qualification receipts are described in [EVIDENCE.md](EVIDENCE.md).

## Beta limitations

- Library/project/notes are read-only native views. Refresh explicitly after web/assistant edits;
  there is no background file watcher yet. Posters are cached for the life of a pane.
- The bridge has **no render scheduler API**. The queue command reports imported outputs and
  says so; no submit/cancel/progress controls or invented active jobs.
- Local Linux Tern is the verified target. Windows paths and remote-host pane launch are not
  qualified. The browser-control scenario-file approach avoids Linux Node pipe reopening errors.
- TSP is not a browser DOM. Use `el` containers for CSS classes; ordinary `col` classes did not
  style the real renderer. Basic typing still arrives as pty keys even with native edit support.
- `tern ctl shot` captures native surfaces but shows a placeholder for the platform webview;
  capture the actual window/display to verify web pixels. Both were tested.
- On this machine the isolated X11 WPE browser initially crashed in EGL dmabuf setup. The
  **test process only** used `LIBGL_ALWAYS_SOFTWARE=1`,
  `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json`, and
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`. These are not installed into the user's settings/plugin.
- No full-editor features are reimplemented here. Availability, rendering and editing behavior
  in a browser pane are the current web app's capabilities.
