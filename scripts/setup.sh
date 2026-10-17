#!/usr/bin/env bash
# One command from a fresh clone to a running studio: ./scripts/setup.sh  (or npm run setup)
# Idempotent. Checks tools, installs, builds, makes a demo project if the library is empty,
# runs the fast tests, and prints how to start. --check only reports (same as npm run doctor).
set -uo pipefail
cd "$(dirname "$0")/.."
CHECK_ONLY=0; [ "${1:-}" = "--check" ] && CHECK_ONLY=1
ok=0; bad=0
say() { printf '%-28s %s\n' "$1" "$2"; }
need() { # name, command, min-version-regex-hint, required(1/0)
  if command -v "$2" >/dev/null 2>&1; then say "$1" "ok  $($2 --version 2>&1 | head -1 | cut -c1-60)"; ok=$((ok+1));
  else say "$1" "$([ "$3" = 1 ] && echo MISSING || echo 'missing (optional)')"; [ "$3" = 1 ] && bad=$((bad+1)); fi; }
need node node 1; need npm npm 1; need python3 python3 1; need ffmpeg ffmpeg 1; need ffprobe ffprobe 1
need uv uv 0   # headless browser checks and the studio-spec importer use `uv run --with playwright`
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then say "node version" "need >= 20"; bad=$((bad+1)); fi
for a in claude codex gemini hermes opencode; do command -v $a >/dev/null && say "agent: $a" "installed" || say "agent: $a" "-"; done
[ -f ~/.config/fframestudio/sources.json ] && say "your projects" "~/.config/fframestudio/sources.json" || say "your projects" "none yet (demo only); see projects/sources.example.json"
[ $bad -gt 0 ] && { echo; echo "Install the MISSING tools above, then re-run."; exit 1; }
[ $CHECK_ONLY = 1 ] && exit 0

set -e
echo; echo "== install"; npm ci --no-audit --no-fund --silent || npm install --no-audit --no-fund --silent
echo "== build"; npm run --silent build:acp
LIB=~/fframestudio/projects
if [ ! -f "$LIB/library.json" ]; then
  echo "== demo project"; python3 tools/make_demo.py
fi
echo "== import"; python3 tools/import_projects.py
echo "== test"; npm test --silent
echo
echo "Ready. Start the studio with:  npm run bridge   (then open the /open?token=... link it prints)"
