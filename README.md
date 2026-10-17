# fframestudio

A theme-agnostic, platform-agnostic video studio: simple on the surface, a full editor underneath.
Seeded from the I-880 pretotype film studio (kvnloo/expresslane-pretotypes, `scripts/studio/`).
Status: editor core. The library opens imported projects into one v1 document with synchronized
Story, Timeline, Canvas and Inspector views, atomic undo/redo, versions and reviewable ACP
proposals. The preview is editorial (proxy/thumbnails + text), not a final compositor; video
export is not yet available. Performance thresholds are explicit and currently not all qualified:
see [docs/perf.md](docs/perf.md).

## Run it

    npm install
    npm run build:acp                 # bundle the ACP client for the browser
    python3 tools/import_projects.py  # import every project in projects/sources.json
    npm run bridge                    # prints an /open?token=... link; open it

The bridge listens on 127.0.0.1 only and serves the app, the library (`~/fframestudio/projects`)
and an ACP socket to the agents installed on this machine.

## Projects

`projects/sources.json` lists existing films; `tools/import_projects.py` writes
`~/fframestudio/projects/<id>/project.json` plus poster, shot thumbnails and a browser proxy.
Sources are read, never changed. The editor migrates v0 in memory; Save writes
`fframestudio.project/1`. Text overrides, rational frame time, stable IDs and command history
are described in [docs/project-format.md](docs/project-format.md). Do not re-import over an
edited v1 file. Use the copy-only migration CLI when migrating outside the app.

## Editor controls and verification

Space / J-K-L transport; arrows step frames or selection; I/O trim to playhead; S split;
Delete removes the selection; Mod-Z / Mod-Shift-Z undo/redo; Mod-S saves. Mod-K opens the
searchable command palette. Workspace settings remember theme tokens, keybindings, side-panel
widths and collapsed state. Story cards reorder by drag; timeline edges trim with snapping.

```sh
npm run test:doc          # pure commands/migration + real bridge persistence
npm run test:editor       # disposable library, owned bridge, Chromium desktop + 390px
npm run test:editor-acp   # real Hermes proposal, inspect/apply/undo/redo/save
npm run test:perf         # strict Node + browser performance gate (see current failures)
```

Test bridges use port 7879 by default (`FFS_PORT` overrides it), TMPDIR library copies and
printed evidence paths. They do not edit your production library or bridge config.
Assistant edits now follow [docs/agent-commands.md](docs/agent-commands.md): proposal files,
explicit diff review and one-step undo, never an instruction to silently rewrite the project.

| kind | timeline from | projects |
| --- | --- | --- |
| studio-spec | the studio's buildSpec(), run headless | I-880 Express Lanes |
| fframes | logs/timeline.txt, else cut detection | Omarchy Themes, Hermes launch, One Take |
| fframes-clips | one shot per rendered clip | Hermes x Tern clips |
| html-film | the SHOTS table in film.js | Hermes x Tern (30 s) |
| capture-manifest | a clip manifest | God's Eye View showcase (once captured) |

## AI assistant over ACP

The studio is an Agent Client Protocol client. The bridge starts the agent you pick as a local
process, so it uses that agent's own login (Claude, ChatGPT or Google subscription, or Hermes's
provider). No API keys pass through the studio.

| agent | adapter | verified |
| --- | --- | --- |
| Claude Code | @agentclientprotocol/claude-agent-acp@0.93.0 | prompt + file edit |
| Codex (ChatGPT) | @agentclientprotocol/codex-acp@2.2.2 | prompt + file edit |
| Hermes Agent | hermes acp | prompt, and from the app UI |
| Gemini CLI | gemini --acp | connects; Google retired the free Code Assist login |
| OpenCode | opencode acp | local install broken (postinstall not run) |

Override or add agents in `~/.config/fframestudio/agents.json`, e.g.
`{"codex": {"append": ["-c", "model=\"gpt-6-astra\""]}}`.

Security: loopback only; random token per launch (WebSocket subprotocol, bearer, or a
SameSite=Strict cookie set by /open); Origin and Host checks against DNS rebinding; agents run in
the project folder; /fs cannot leave it; /file serves only paths a project references.
`npm run test:acp -- claude codex hermes --edit claude` checks this against real agents.
