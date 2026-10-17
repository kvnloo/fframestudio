# Bridge security

The bridge serves the web app and can start agents that run shell commands, so it refuses anything that is not the signed-in local app. The gate journey proves the app hides the studio without the token cookie.

## Sub-features

- `gate-show` shows the `.gate` sign-in page without the `ffs` cookie.
- `gate-message` names the `npm run bridge` command and the `/open?token=…` link.
- `auth-open` `/open?token=T` sets the `ffs` cookie and redirects to `/`.
- `auth-api` `/me` returns `{ ok: false }` without a token and `{ ok: true, root }` with one.
- `auth-agents` `/agents` returns 401 without a token.
- `guard-origin` rejects a foreign `Origin` and a non-loopback `Host`.
- `guard-ws` refuses the `/acp` socket without a valid token subprotocol or cookie.
- `guard-paths` keeps `/lib/` inside `projects/`, keeps `/fs` inside `--root`, and serves `/file` only for paths a project references.
- `guard-loopback` listens on `127.0.0.1` only.

## How to get to it (user POV)

- Open the bridge URL without the `/open` link.
- Open the `/open?token=…` link the bridge prints.
- Find the same link again in `~/.config/fframestudio/bridge.json`.

## Driving it with Playwright

Preconditions:

- The harness started its own bridge on a free loopback port with a throwaway token.
- The browser context has no `ffs` cookie yet.
- `base` is `http://127.0.0.1:<port>`.

- **Open without the link.** Run `await page.goto(base + '/');` and `await page.waitForSelector('.gate', { timeout: 10000 });`. The gate renders instead of the library.
- **Read the gate.** The gate shows the cap `fframestudio` and the heading `Open the link the bridge printed`. The paragraph names `npm run bridge`, the `/open?token=…` link and `~/.config/fframestudio/bridge.json`.
- **API refuses without the token.** Run `await fetch(base + '/agents').then((r) => r.status);`. It is 401.
- **Open the link.** Run `await page.goto(`${base}/open?token=${token}`);`. The response is a 302 that sets the `ffs` cookie and redirects to `/`.
- **Signed-in state.** The library renders and `#bridge` reads `bridge · N agents` with a green dot. `GET /me` returns `{ ok: true, root }`.
- **Proof.** Screenshot the gate. The harness writes `01-gate.png`. It shows the sign-in page without any project data.
- **Guards beyond the gate.** The origin, host, WebSocket, path-escape and token checks are covered by `npm run test:acp` (`node test/acp-e2e.mjs`). That run asserts 401 without a token, 401 with a bad token, 403 for a foreign `Origin`, 403 for a rebinding `Host`, 400 for a path escape, and a refused WebSocket without a token.

## Gotchas

- `/me` returns 200 with `{ ok: false }` when signed out, so it is not a failed request. The gate is driven by `ME.ok`, not by a redirect.
- The token lives in the `ffs` cookie, which is `HttpOnly` and `SameSite=Strict`. The app does not store the URL token.
- `originOk` allows any loopback origin. `--allow-origin` widens the allowlist, so a check there proves less.
- `loopHost` requires a loopback `Host`. A rebinding `Host` is refused with 403 before any auth check.
- `/file` serves a path outside the library only when some `project.json` references it by absolute path.
- `npm run verify` covers the gate only. A green verify is not full bridge-security proof; run `npm run test:acp` for the guards.
- The harness runs its own bridge and never touches a bridge the user started. Do not kill processes by name.
