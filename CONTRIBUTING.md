# Contributing

Thanks for looking. fframestudio is small and moves fast; the bar is that every change is measured
and proven, not that it is big.

## Start

```sh
npm run setup     # checks tools, installs, builds, makes a demo project, runs tests
npm run verify    # drives the real app in Chromium and saves screenshots + report.json
```

`npm run doctor` tells you what is missing. You need Node 20+, Python 3 and ffmpeg.

## Before you open a pull request

- `npm test` and `npm run verify` pass. Open the screenshots in `verify-out/` and look at them.
- If you changed behaviour a user can see, update the matching file in
  `.agents/skills/verify-fframestudio/features/` and the journey in `test/verify.mjs`.
  Never weaken a check to make it pass.
- If you touched anything on the hot path (editor, timeline, preview, export), run
  `npm run test:perf` and put the before/after numbers in the PR. The budgets live in
  `docs/perf.md`; read `docs/ETHOS.md` for how we measure.
- If you add a dependency or media, check its licence against `docs/research/03-oss-engines.md` §8.
- One concern per pull request. Say what you verified and how.

## Where to help

`ROADMAP.md` lists every planned feature with a milestone. Issues labelled `good first issue`
are scoped to one file or one journey. Bigger features start as a short issue that names the
budget and the proof you will use.

## Using a coding agent

Agents are welcome. `AGENTS.md` (also `CLAUDE.md`/`GEMINI.md`) tells them how to set up and
verify. You are responsible for what you submit: read the diff, run the checks yourself.

## Security

The bridge runs agents on your machine. Report anything that lets a web page, another user or a
project file reach outside the library privately through GitHub's
"Report a vulnerability" (Security tab), not in a public issue.
