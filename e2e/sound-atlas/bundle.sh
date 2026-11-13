#!/usr/bin/env bash
# Build the site under test from this checkout's code into ./site (or $1): the same bundle the deploy ships.
# Catalogue + listening layer come from the deployed snapshot (SA_CATALOG, default the atlas-site artifact),
# the 14 shortlist MP3s from SA_TRACKS. The other 1,801 tracks stream from their sources, as in production.
#   bash bundle.sh [out-dir]
#   CANARY=1 bash bundle.sh site-canary   # same build with the seeded defects from canary.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(cd "$here/../.." && pwd)
out=$(realpath -m "${1:-$here/site}")
CAT=${SA_CATALOG:-/mnt/zer0models/project-artifacts/music-finder/atlas-site}
TRK=${SA_TRACKS:-/mnt/zer0models/project-artifacts/music-finder/feat-job/tracks}
[ -f "$CAT/catalog.json" ] || { echo "no catalogue at $CAT (set SA_CATALOG)"; exit 2; }
c=$(mktemp -d); trap 'rm -rf "$c"' EXIT
ln -s "$CAT/catalog.json" "$c/catalog.json"; ln -s "$CAT/vectors.bin" "$c/vectors.bin"
[ -f "$CAT/sound.json" ] && ln -s "$CAT/sound.json" "$c/feat.json"
[ -f "$CAT/sound.bin" ] && ln -s "$CAT/sound.bin" "$c/feat.json.clap.bin"
rm -rf "$out"
bash "$repo/tools/sound-atlas-bundle.sh" "$c" "$out" "$([ -d "$TRK" ] && echo "$TRK")" >/dev/null
git -C "$repo" rev-parse --short HEAD > "$out/build.txt"
[ "${CANARY:-0}" = 1 ] && bash "$here/canary.sh" "$out"
echo "$out ($(cat "$out/build.txt")$([ "${CANARY:-0}" = 1 ] && echo ', canary'))"
