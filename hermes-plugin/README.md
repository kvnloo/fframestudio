# Factory backend integration

## Current blockers

Production suggestions fail closed. Canonical `IntentService` at
`0a2874b0ae924ca82a3f56d9f0eb53c80e74bd06` uses `ingestUser` and
`omp-root-user-history` provenance, with no machine-proposal source. The injected
adapter refuses before `finish` writes a false pending document. It invokes no
inference and fabricates no installed OMP receipt.

Canonical OMP cannot open an existing factory proposal in this store for review.
Suggestions therefore report `review.available: false` with a reason. There is no
approve verb, approval button, production decision call, or invented `/aodl ID`
command. Only synthetic temporary test fixtures call the real decision API.

## Commands and wire contract

The dispatch seam is `/factory json VERB PARAMS`. The handler's `session_id` is
authoritative; missing sessions or conflicting parameter sessions fail closed.

- `suggest {}` proposes `render` for ready or failed runs, and `review` for done runs.
- `render {"run":"RUN","contract_id":"CONTRACT_ID"}` requests execution.
- Text equivalents are `/factory suggest` and `/factory render RUN CONTRACT_ID`.
- Existing `status`, `runs`, and `scenes` commands remain available.

```text
{
  runs: Array<{
    run: string, state: string, output: string | null, seconds: number | null,
    verdict: string | null, shot: unknown | null, compare: string | null
  }>,
  suggestions: Array<{
    run: string, action: "render" | "review", title: string,
    contract_id: string, session_id: string,
    status: "pending" | "approved" | "rejected",
    review: { available: false, reason: string },
    revision: number, sourceHash: string, contractHash: string
  }>,
  running_count: number
}
```

Suggestion failures retain these fields and add `error: string, fail_closed: true`.
With the current compiler, eligible actions return no suggestions and an explicit
machine-proposal unavailable error, never placeholder contract IDs. Render errors
use `{error, fail_closed: true}`; launch success uses `{run, state: "queued", log}`.
Running jobs create no suggestion. `running_count` covers all discovered runs.
Frontend filtering and polling remain frontend responsibilities, with polling no
faster than ten seconds.

## Storage and execution gate

Data directory precedence is `FACTORY_DATA_DIR`, then `ctx.state.data_dir` captured
by `register(ctx)`, then `$HERMES_HOME/plugin-data/factory` for older contexts.
`HERMES_HOME` defaults to `~/.hermes`. Registration changes no environment variables.
Hermes selects the host namespace under `plugin-data`, which may be hashed; the
plugin preserves that exact path rather than constructing its own namespace.
The clean-profile fallback canonical store is
`/home/kvn/.hermes/profiles/clean/plugin-data/factory/aodl/intent/<session_id>/`.
Registered contexts use their host-provided namespace instead of fallback `factory`.

`IntentService(root=plugin_data_dir / "aodl", ...)` owns canonical storage:

```text
<plugin_data_dir>/aodl/intent/<session_id>/
  .pending/<contract_id>.json
  .pending/current.json
  <contract_id>.json
  runtime/<contract_id>.json
```

Plugin-owned `proposals/<session_id>/<state-sha256>.json` stores references only.
Fingerprints bind action, run name, resolved directory, session, workflow bytes,
and render/result/manifest/compare-sheet bytes. Unchanged state reuses proposals
across polls and restarts. Changed state cannot inherit approval.

All render routes require the canonical approved root, Kevin identity, timestamp,
exact ID/session/revision/hashes/source/task scope, and current contract ID. An
approved pending copy is insufficient. Runtime must retain root approval and hash,
not precede the approved revision, and keep the task open. Only missing runtime
permits root fallback. Corrupt runtime fails closed.

An interprocess lock and exclusive fsynced `claims/<session-contract-sha256>.json`
prevent repeat execution. Claims record attempted launch, not success; failed
launches and process crashes do not release them. There is no automatic reset.
The plugin rechecks state before spawning but cannot lock external workflow
writers. The launcher's GPU lock remains separate. Canonical storage has one
current proposal per session; multi-item review remains an integration limitation.

## Dependencies and verification

Configure `z0int.intent_service` and `aodl_contract` in the plugin host's Python
environment or `PYTHONPATH`. The validator requires `aodl-canon-1`, pinned to
`68231658f0ec0338464c0916a2329b9587444312`. Retain the service's `intent_compile.mjs`
and sibling `omp-extensions/z0-relay-guard` files. Node must be on `PATH`, or set
`Z0INT_INTENT_NODE`. No Bun, weights, model endpoint, or inference setup is needed.

```sh
cd /mnt/zer0models/worktrees/fframestudio-factory/hermes-plugin
FACTORY_INTENT_SOURCE=/mnt/zer0models/z0-wt/intent-service \
FACTORY_AODL_SOURCE=/mnt/zer0models/worktrees/aodl-pattern-templates \
python3 tests/run_canonical.py
```

The runner extracts the pinned validator from local Git into a self-cleaning
directory and sets `PYTHONPATH` alongside the service's `src`. It installs nothing
and runs `python3 -m pytest -q -p no:cacheprovider tests`. The same direct command
works with those dependencies already on `PYTHONPATH`; dependency-related skips
without that configuration are not proof of the gate.

Tests use real canonical compilation, hashing, validation, and synthetic decisions
marked `factory/synthetic-test-only`. Only the GPU launcher is stubbed.
From the repository root, also run `npm run test:doc` and `git diff --check`.
The documentation suite needs the bridge workspace's declared `ws` dependency;
its owned bridge fixtures and CPU media checks do not require GPU services.
