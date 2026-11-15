#!/usr/bin/env bash
# Perf A/B on Boat (boat.dev): a perf harness on an isolated, otherwise idle sandbox, so the host's own load
# (agents, GPU jobs) stays out of the numbers. Variants run interleaved, rep by rep.
# reuse-checked: boat/up.sh -- that runs explore goals per lane; this runs the frame harness on one box.
#
#   bash boat/perf.sh <site-dir> 'base=?lean=0 lean= gpu=?gpu=1'                # one bundle, variants by URL query
#   bash boat/perf.sh 'inc=<dir>,cand=<dir>' 'base=inc cand=cand cand2=cand?x=1'  # several bundles (code changes)
#   env: HARNESS=perf-frames|perf-climb (default perf-frames)  REPS=4  ONLY=play-dance,pan-playing  BOX=<reuse id>  THROTTLE=4 (perf-climb CPU slowdown)
#
# Each bundle gets its own port (bundles use <base href="/">). Boat `large` boxes render on an Intel UHD 620 iGPU,
# roughly a weak phone: compare variants with each other, never with groot numbers.
# Results: runs/boat-perf/<stamp>/<variant>-<rep>.json; the box is deleted on exit unless BOX was given.
set -u
cd "$(dirname "$0")/.."
SITES=${1:?site dir, or k=dir,k2=dir2}; VARIANTS=${2:?'name=[site]?query ...'}
REPS=${REPS:-4}; ONLY=${ONLY:-play-dance,pan-playing}; HARNESS=${HARNESS:-perf-frames}
case $SITES in *=*) ;; *) SITES="site=$SITES" ;; esac
OUT=runs/boat-perf/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
B=$(mktemp -d); trap 'rm -rf "$B"' EXIT
mkdir -p "$B/pkg/h" "$B/pkg/sites"; declare -A PORT; port=18967; first=
for s in ${SITES//,/ }; do k=${s%%=*}; cp -r "${s#*=}" "$B/pkg/sites/$k"; PORT[$k]=$port; port=$((port + 1)); first=${first:-$k}; done
{ echo 'cd ~/pkg'
  for k in "${!PORT[@]}"; do echo "(setsid python3 -m http.server ${PORT[$k]} -d sites/$k --bind 127.0.0.1 >/tmp/site-$k.log 2>&1 </dev/null &)"; done
  echo 'sleep 2; cd h && mkdir -p runs && : > runs/log'
  for r in $(seq "$REPS"); do for v in $VARIANTS; do n=${v%%=*} rest=${v#*=}; k=${rest%%\?*}; q=${rest#"$k"}; k=${k:-$first}
    [ -n "${PORT[$k]:-}" ] || { echo "unknown site '$k' in $v" >&2; exit 1; }
    echo "THROTTLE=${THROTTLE:-4} URL='http://127.0.0.1:${PORT[$k]}/$q' OUT=runs/$n-$r.json REPS=1 ONLY=$ONLY CHROME=/usr/bin/google-chrome-stable node $HARNESS.mjs >>runs/log 2>&1 || echo 'fail $n $r' >>runs/log"
  done; done; echo 'echo ALLDONE >> runs/log'; } > "$B/run.sh" || exit 1
cp "$HARNESS.mjs" "$B/pkg/h/"; tar -czf "$B/pkg.tgz" -C "$B" pkg
ex() { boat exec "$id" --timeout "${T:-120}" -- bash -lc "$1" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("stdout",""),end="")'; }
id=${BOX:-}
if [ -z "$id" ]; then
  id=$(boat new --type large --ttl 7200 --name sa-perf --json | jq -r 'select(.event=="ready")|.id' | tail -1)
  [ -n "$id" ] || { echo "boat new failed"; exit 1; }
  trap 'rm -rf "$B"; boat delete "$id" --yes >/dev/null 2>&1' EXIT
fi
echo "box $id"
boat scp "$B/pkg.tgz" "$id:/tmp/pkg.tgz" >/dev/null
T=400 ex "rm -rf ~/pkg && tar xzf /tmp/pkg.tgz -C ~ && cd ~/pkg/h && npm init -y >/dev/null && npm i --no-audit --no-fund playwright-core@$(jq -r '.devDependencies["playwright-core"] // .dependencies["playwright-core"]' package.json | tr -d '^~') >/dev/null 2>&1 && echo deps ok"
boat scp "$B/run.sh" "$id:/tmp/perf-run.sh" >/dev/null
boat exec "$id" --detach -- bash -lc 'bash /tmp/perf-run.sh' >/dev/null
for w in $(seq 180); do ex 'grep -q ALLDONE ~/pkg/h/runs/log && echo y' | grep -q y && break; sleep 30; done # cap: 90 min
T=120 ex 'tar -czf /tmp/runs.tgz -C ~/pkg/h runs' >/dev/null; boat scp "$id:/tmp/runs.tgz" "$OUT/runs.tgz" >/dev/null
tar -xzf "$OUT/runs.tgz" -C "$OUT" --strip-components=1 && rm "$OUT/runs.tgz"
grep -h fail "$OUT/log"; echo "$OUT"
