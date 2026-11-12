#!/usr/bin/env bash
# Package, sign and install the Sound Atlas Samsung TV app, then launch it.
# Uses the Tizen author profile from the Jellyfin sideload (~/src/jellyfin-tizen-sideload/LOG.md).
# Usage: tools/sound-atlas-tv/install.sh [tv-ip]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); TV=${1:-192.168.1.29}; PROFILE=${TIZEN_PROFILE:-JellyfinTV}
export PATH="$HOME/tizen-studio/tools/ide/bin:$HOME/tizen-studio/tools:$PATH"
out=$(mktemp -d); cp "$here"/config.xml "$here"/index.html "$here"/icon.png "$out/"
# The TV only accepts sdb from its developer-mode Host PC IP; a relay bound to this host's LAN address gets through.
src=$(curl -fsS --max-time 4 "http://$TV:8001/api/v2/" | grep -oP '"developerIP":"\K[0-9.]+'); port=26111
ip -4 addr | grep -q "inet $src/" || { echo "TV developer mode wants Host PC IP $src, which is not on this host" >&2; exit 1; }
socat TCP-LISTEN:$port,bind=127.0.0.1,reuseaddr,fork TCP:$TV:26101,bind="$src" & relay=$!; trap 'kill $relay 2>/dev/null; rm -rf "$out"' EXIT
sleep 0.5; sdb connect 127.0.0.1:$port
# Same flow as jellyfin-tizen-sideload/update.sh: packaging the raw dir hangs, packaging build-web output signs.
(cd "$out" && tizen build-web -- . >/dev/null && tizen package -t wgt -s "$PROFILE" -o "$out" -- "$out/.buildResult" </dev/null | tail -1)
# tizen install fails on the "Sound Atlas.wgt" name it packages (space), so rename first.
mv "$out"/*.wgt "$out/SoundAtlas.wgt"; tizen install -s 127.0.0.1:$port -n SoundAtlas.wgt -- "$out" | tail -3
curl -fsS -X POST "http://$TV:8001/api/v2/applications/SndAtlasTV.SoundAtlas" && echo " launched"
