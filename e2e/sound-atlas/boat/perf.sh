#!/usr/bin/env bash
# Perf A/B on Boat (boat.dev): perf-frames.mjs on an isolated, otherwise idle sandbox, so the host's own load
# (agents, GPU jobs) stays out of the numbers. Variants are URL query strings of one bundled site, run interleaved.
# reuse-checked: boat/up.sh -- that runs explore goals per lane; this runs the frame harness on one box.
#
#   bash boat/perf.sh <site-dir> 'base=?lean=0 lean= gpu=?gpu=1'     # REPS=4 ONLY=play-dance,pan-playing BOX=<reuse id>
#
# Boat boxes have no GPU: Chrome rasters in software (SwiftShader), so compare variants with each other, never with
# GPU-host numbers. Results: runs/boat-perf/<stamp>/<variant>-<rep>.json; the box is deleted on exit unless BOX was given.
set -u
cd "$(dirname "$0")/.."
SITE=${1:?site dir (a bundle, e.g. from bundle.sh)}; VARIANTS=${2:?'name=?query ...'}
REPS=${REPS:-4}; ONLY=${ONLY:-play-dance,pan-playing}
OUT=runs/boat-perf/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
B=$(mktemp -d); trap 'rm -rf "$B"' EXIT
mkdir -p "$B/pkg/h"; cp -r "$SITE" "$B/pkg/site"; cp perf-frames.mjs "$B/pkg/h/"; tar -czf "$B/pkg.tgz" -C "$B" pkg
ex() { boat exec "$id" --timeout "${T:-120}" -- bash -lc "$1" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("stdout",""),end="")'; }
id=${BOX:-}
if [ -z "$id" ]; then
  id=$(boat new --type large --ttl 7200 --name sa-perf --json | jq -r 'select(.event=="ready")|.id' | tail -1)
  [ -n "$id" ] || { echo "boat new failed"; exit 1; }
  trap 'rm -rf "$B"; boat delete "$id" --yes >/dev/null 2>&1' EXIT
fi
echo "box $id"
boat scp "$B/pkg.tgz" "$id:/home/user/pkg.tgz" >/dev/null
T=400 ex "rm -rf ~/pkg && tar xzf ~/pkg.tgz -C ~ && cd ~/pkg/h && npm init -y >/dev/null && npm i --no-audit --no-fund playwright-core@$(jq -r '.devDependencies["playwright-core"] // .dependencies["playwright-core"]' package.json | tr -d '^~') >/dev/null 2>&1 && echo deps ok"
{ echo 'cd ~/pkg && (setsid python3 -m http.server 18967 -d site --bind 127.0.0.1 >/tmp/site.log 2>&1 </dev/null &); sleep 2; cd h && mkdir -p runs && : > runs/log'
  for r in $(seq "$REPS"); do for v in $VARIANTS; do n=${v%%=*} q=${v#*=}
    echo "URL='http://127.0.0.1:18967/$q' OUT=runs/$n-$r.json REPS=1 ONLY=$ONLY CHROME=/usr/bin/google-chrome-stable node perf-frames.mjs >>runs/log 2>&1 || echo 'fail $n $r' >>runs/log"
  done; done; echo 'echo ALLDONE >> runs/log'; } > "$B/run.sh"
boat scp "$B/run.sh" "$id:/home/user/perf-run.sh" >/dev/null
boat exec "$id" --detach -- bash -lc 'bash ~/perf-run.sh' >/dev/null
for w in $(seq 180); do ex 'grep -q ALLDONE ~/pkg/h/runs/log && echo y' | grep -q y && break; sleep 30; done # cap: 90 min
T=120 ex 'tar -czf /tmp/runs.tgz -C ~/pkg/h runs' >/dev/null; boat scp "$id:/tmp/runs.tgz" "$OUT/runs.tgz" >/dev/null
tar -xzf "$OUT/runs.tgz" -C "$OUT" --strip-components=1 && rm "$OUT/runs.tgz"
grep -h fail "$OUT/log"; echo "$OUT"
