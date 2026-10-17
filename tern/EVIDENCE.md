# Native qualification receipts

Qualified with **Tern 0.8.3 (e2b8656)** and Node 26.7.0 on Linux. The plugin is linked
in the real user's Tern configuration and its daemon reports `status: ready`, `window: true`,
`problems: []`. No existing tabs were closed and no settings.json was edited.

Interaction tests used an ordinary signed-in Tern window on private Xvfb display `:147`,
with an isolated config/daemon and owned tabs. This was **not** `tern serve`, `tern shot`,
a surface replay or a fake web page. Jev selection was unavailable (`no_key`); semantic
Tern control and post-action state checks were used directly on the isolated window.

## Passed

- `npm --prefix tern test`: **11 passed, 0 failed**, including an actual bridge process
  started from stale PID discovery and a stale 0644 file tightened to 0600.
- `npm run build:acp`: success; all add-on `.mjs` files pass `node --check`.
- Palette command opened native library with all **6 imported projects**, posters, kind,
  duration and shot count. A real click selected Hermes × Tern (30 s), showing five shots,
  array-valued text and review notes.
- Native **Open web editor** action opened a real browser block; `/open` redirected to
  `/#/p/hermes-launch`, authenticated successfully, and DOM inspection returned the project,
  four shots, four available agents and a video element.
- Actual browser playback: `currentTime: 2.934566027`, `readyState: 4`, `paused: false`;
  the test then paused the video.
- Native **ACP assistant** action opened an adjacent native pane. Selecting Hermes reached
  `hermes ready`. Typed `Reply exactly NATIVE_ACP_OK. Do not use tools or change files.`
  through the actual composer; the rendered agent card read **NATIVE_ACP_OK** and status
  read **Turn ended: end_turn**. No project-edit prompt was submitted.
- The render-status palette command displayed the imported outputs and the explicit
  no-scheduler notice. No fictional jobs/progress were shown.

## Screenshots (local, inspected)

Evidence directory: `/mnt/zer0models/fframestudio-tern-evidence/`

| File | Shows |
| --- | --- |
| `live/library-final.png` | Native six-project library and poster blobs |
| `live/project.png` | Native shot text, precise ranges and review notes |
| `live/render-status.png` | Native imported-output inventory and scheduler limitation |
| `editor-window.png` | Actual Tern window with native review and rendered web editor/video |
| `assistant-window.png` | Native review + completed native ACP reply + rendered web editor |
| `live/assistant-native.png` | Native assistant surface, useful separately from the webview |

Every listed PNG was opened with image inspection. Native `ctl shot` screenshots omit the
platform webview pixels, so `editor-window.png` and `assistant-window.png` were captured
from the actual isolated X display. Layout JSONs accompanying native shots were scrubbed
of credential-bearing URL parameters; do not publish unfiltered browser/control dumps.

## Qualification caveats

- The SDK archive URL supplied for discovery returned 404; current official docs point to
  `stencil-hq/tern-sdk`, which was read alongside the installed npm SDK.
- The initial isolated WPE web process failed in EGL dmabuf setup. Process-local Mesa/software
  environment flags fixed it; this did not require modifying Tern or the user's settings.
- One window plugin reload hit Tern's 50 ms load budget during host load. A subsequent reload
  and actual command invocation succeeded. Daemon `ready` alone was not counted as GUI proof.
- Concurrent external tests temporarily replaced the global bridge discovery file with dead
  fixtures. The original live bridge on port 7878 was preserved. Native qualification used an
  owned bridge on port 17888 and a private discovery snapshot until the default was restored.
- Native review has explicit refresh, not live synchronization. Queue scheduling is unavailable
  because the bridge exposes no scheduler. Linux/local-host operation is the qualified scope.
