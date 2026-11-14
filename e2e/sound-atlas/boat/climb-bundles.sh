#!/usr/bin/env bash
# Build the two bundles one perf-climb round compares: the incumbent commit and the candidate commit of fframestudio,
# each bundled from a clean `git archive` (never a dirty worktree) with the same catalogue and local tracks.
#   bash boat/climb-bundles.sh <repo> <incumbent-ref> <candidate-ref-or-WORKTREE> <out-dir>
# WORKTREE bundles the repo's working tree as is (a candidate before it is committed). Prints the two bundle dirs.
set -euo pipefail
repo=${1:?repo}; inc=${2:?incumbent ref}; cand=${3:?candidate ref}; out=${4:?out dir}
CAT=${CAT:-/mnt/zer0models/project-artifacts/music-finder/atlas-site}; TRACKS=${TRACKS:-/mnt/zer0models/project-artifacts/music-finder/feat-job/tracks}
rm -rf "$out"; mkdir -p "$out/src"
for side in inc cand; do ref=$([ $side = inc ] && echo "$inc" || echo "$cand"); s="$out/src/$side"; mkdir -p "$s"
  if [ "$ref" = WORKTREE ]; then cp -r "$repo/web" "$repo/tools" "$s/"; else git -C "$repo" archive "$ref" web tools | tar -x -C "$s"; fi
  bash "$s/tools/sound-atlas-bundle.sh" "$CAT" "$out/$side" "$TRACKS" >/dev/null
  echo "$side $(git -C "$repo" rev-parse --short "$([ "$ref" = WORKTREE ] && echo HEAD || echo "$ref")")$([ "$ref" = WORKTREE ] && echo +worktree) -> $out/$side"
done
rm -rf "$out/src"
