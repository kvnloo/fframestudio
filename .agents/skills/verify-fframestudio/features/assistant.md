# Assistant

The Assistant box on a project lists the ACP agents installed on this machine, connects to the chosen one over the bridge, and streams its replies, tool calls and permission prompts into a transcript.

## Sub-features

- `assistant-list` renders one `[data-agent]` pill per agent from `GET /agents`.
- `assistant-disabled` disables the pill of an agent that is not installed.
- `assistant-connect` starts a session for the chosen agent, at the project folder.
- `assistant-transcript` streams agent text, tool calls and notes into `#chat`.
- `assistant-permission` answers a permission request from the option buttons.
- `assistant-send` sends the prompt in `#ask` on `send` or on Ctrl/Cmd+Enter.
- `assistant-requires-agent` toasts `Pick an agent first` when no session is open.
- `assistant-live-edit` reloads the project when the agent writes `project.json`.
- `assistant-status` shows the agent count in the header and the connected hint in `#aghint`.

## How to get to it (user POV)

- Open a project.
- Select the Assistant slate tab (`[data-slate-tab="assistant"]`) on the right or below the timeline. Proposals share this tab.
- Choose an agent pill to connect.
- Type a request in the prompt and choose `send`.

## Driving it with Playwright

Preconditions:

- The library lists `Demo film` and a project is open.
- The bridge answers `GET /agents` with at least one agent.
- The `npm run verify` run does not start any agent.

- **List the agents.** Run `await page.$$eval('[data-agent]', (e) => e.map((b) => ({ id: b.dataset.agent, disabled: b.disabled })));`. The list has at least one entry.
- **Check the disabled state.** Each pill carries `data-agent`, a `disabled` flag for unavailable agents, and a `title` of the agent login. Agents that fail the bridge check are disabled.
- **Read the header.** Run `await page.$eval('#bridge', (b) => b.textContent);`. It reads `bridge · N agents`, where N is the number of available agents.
- **Connect.** Choose an available pill. Run `await page.click('[data-agent="<id>"]');`. `#chat` shows `Starting <name>…`, then `<name> ready · <info>`, and `#aghint` reads `Connected to <name>. It can read and edit this project's file.`
- **Send a prompt.** Run `await page.fill('#ask', 'text');` and `await page.click('#send');`. `#ask` clears, a `you` message appears, and agent `agent` messages stream into `#chat`.
- **Send without an agent.** With no session, choose `send`. The app toasts `Pick an agent first` and sends nothing.
- **Permission.** When the agent asks for a tool, `#chat` shows a `perm` block with one button per option. Run `await page.click('[data-perm]');`. The block shows the chosen answer and the agent continues.
- **Live edit.** When the agent writes this project's `project.json`, the view reloads and toasts `Project updated by the assistant`.
- **Coverage note.** `npm run verify` only proves the pills list and the disabled state. A real ACP round trip — initialize, new session, one prompt, an edit that lands on disk — is covered by `npm run test:agents`, not `npm run verify`. That script is `node test/acp-e2e.mjs claude codex hermes --edit claude`.

## Gotchas

- `npm run verify` never starts an agent. A green verify does not prove ACP works. Run `npm run test:agents` for the round trip.
- Availability is probed on the bridge with `command -v` and an optional probe. A pill can be listed and still be disabled.
- Connecting rebuilds the whole project view and clears the transcript (`CHAT = []`).
- Sending is ignored while a turn is busy, and `#ask` uses Enter only with Ctrl or Cmd.
- The first prompt prepends a fixed context block about the project path and the `edits` schema. Assert on the reply, not on the sent text.
- A session runs in the project folder with the user's own login. Connecting starts a real process on this machine.
- The project file is on disk, so a passing check needs the file read back, not only the rendered view.
