#!/usr/bin/env bash
# Tester army on Boat (boat.dev): one sandbox per lane, each running its goals headed on its own desktop,
# so each sandbox is one "monitor". Keeps your machine free for other work.
#
#   boat login                      # once, your own account
#   export NVIDIA_API_KEY=...       # vision model key (see agent.ts)
#   LANES=4 bash boat/up.sh         # from e2e/army; WALL=1 also serves the live wall on :18777
#
# - Deps live in a snapshot named after the lockfile hash, built once (npm ci on a sandbox) and reused.
# - Every run ships the current e2e/army files and the landing build (../../dist) to each lane.
# - Each sandbox is deleted as soon as its lane finishes (no idle VM hours), and all of them on exit/Ctrl+C.
# - Results come back to runs/boat/<lane>/; FINDINGS.md is written at the end.
set -u
cd "$(dirname "$0")/.."
LANES=${LANES:-4}; STEPS=${STEPS:-8}; TTL=${TTL:-5400}; TYPE=${TYPE:-default}
KEYVAR=${E2E_KEY_ENV:-NVIDIA_API_KEY}
[ -n "${!KEYVAR:-}" ] || { echo "export $KEYVAR (the vision model key, see agent.ts)"; exit 2; }
SNAP=army-deps-$(sha256sum package-lock.json | cut -c1-12)
OUT=runs/boat; mkdir -p "$OUT"; : > "$OUT/sandboxes.tsv"
j() { jq -r "$1"; }

# 1. bundle: army files (no node_modules / runs) + the landing build as site/
[ -d ../../dist ] || (cd ../.. && npm run build >/dev/null) || exit 1
B=$(mktemp -d); mkdir -p "$B/army/site"
tar --exclude=node_modules --exclude=runs --exclude=.e2e -cf - . | tar -xf - -C "$B/army"
cp -r ../../dist/. "$B/army/site/"; tar -czf "$B/army.tgz" -C "$B" army

# 2. deps snapshot, built once per lockfile
if ! boat new --from "$SNAP" --name "$SNAP-probe" --ttl 300 --json 2>/dev/null | j 'select(.event=="created")|.id' > "$B/probe"; then :; fi
if [ -s "$B/probe" ]; then boat delete "$(cat "$B/probe")" --yes >/dev/null 2>&1
else
  echo "building deps snapshot $SNAP (once)"
  id=$(boat new --name "$SNAP-build" --type "$TYPE" --ttl 1800 --json | j 'select(.event=="created")|.id' | head -1)
  trap 'boat delete "$id" --yes >/dev/null 2>&1' EXIT
  boat exec "$id" --timeout 30 -- bash -lc 'mkdir -p ~/army' >/dev/null
  boat scp package.json "$id:/tmp/army-package.json" >/dev/null && boat scp package-lock.json "$id:/tmp/army-package-lock.json" >/dev/null
  boat exec "$id" --timeout 900 --cwd army -- bash -lc 'mv /tmp/army-package.json ~/army/package.json && mv /tmp/army-package-lock.json ~/army/package-lock.json && npm ci --no-audit --no-fund >/tmp/ci.log 2>&1 && test -x node_modules/.bin/e2e' >/dev/null || { echo "npm ci failed on $id"; exit 1; }
  trap - EXIT
  boat snapshot "$id" "$SNAP" >/dev/null; boat delete "$id" --yes >/dev/null
fi

# 3. one sandbox per lane, goals dealt round-robin
cleanup() { while IFS=$'\t' read -r _ id _; do boat delete "$id" --yes >/dev/null 2>&1; done < "$OUT/sandboxes.tsv"; }
trap cleanup EXIT INT TERM
for n in $(seq "$LANES"); do
  ids=$(grep -E "^(${ONLY:-.})" goals.tsv | awk -F'\t' -v n="$n" -v L="$LANES" '(NR-1)%L==n-1 {print $1}' | paste -sd'|')
  [ -n "$ids" ] || continue
  id=$(boat new --from "$SNAP" --name "army-m$n" --type "$TYPE" --ttl "$TTL" -e "$KEYVAR=${!KEYVAR}" -e "E2E_KEY_ENV=$KEYVAR" \
       ${E2E_MODEL:+-e E2E_MODEL=$E2E_MODEL} ${E2E_BASE_URL:+-e E2E_BASE_URL=$E2E_BASE_URL} ${CANVAS_URL:+-e CANVAS_URL=$CANVAS_URL} \
       --json 2>/dev/null | j 'select(.event=="created")|.id' | head -1)
  [ -n "$id" ] || { echo "M$n: create failed"; continue; }
  boat scp "$B/army.tgz" "$id:/tmp/army.tgz" >/dev/null && boat exec "$id" --timeout 60 -- bash -lc 'tar -xzf /tmp/army.tgz -C ~' >/dev/null
  boat exec "$id" --detach -- bash -lc 'bash ~/army/boat/frames.sh' >/dev/null
  boat exec "$id" --detach --cwd army -- bash -lc "STEPS=$STEPS bash boat/lane.sh '$ids'" >/dev/null
  url=$(boat host "$id" 18780 --json 2>/dev/null | j .url)
  printf '%s\t%s\t%s\n' "$n" "$id" "$url" >> "$OUT/sandboxes.tsv"
  echo "M$n $id  $ids"
done
[ "${WALL:-0}" = 1 ] && { WP=${WALL_PORT:-18777}; python3 boat/wall.py "$OUT/sandboxes.tsv" "$WP" & echo "wall: http://localhost:$WP/ (any address of this machine)"; }

# 4. collect each lane the moment it finishes, then delete its sandbox
left=$(wc -l < "$OUT/sandboxes.tsv")
while [ "$left" -gt 0 ]; do
  sleep 30; left=0
  while IFS=$'\t' read -r n id _; do
    [ -f "$OUT/m$n.done" ] && continue
    st=$(boat exec "$id" --timeout 20 -- bash -lc 'cat ~/army/lane.json 2>/dev/null' 2>/dev/null | j '.stdout' | jq -r '.status // empty' 2>/dev/null)
    if [ "$st" = done ]; then
      boat exec "$id" --timeout 120 -- bash -lc 'tar -czf /tmp/runs.tgz -C ~/army runs' >/dev/null
      mkdir -p "$OUT/m$n" && boat scp "$id:/tmp/runs.tgz" "$OUT/m$n/runs.tgz" >/dev/null && tar -xzf "$OUT/m$n/runs.tgz" -C "$OUT/m$n"
      boat delete "$id" --yes >/dev/null && touch "$OUT/m$n.done" && echo "M$n done, sandbox deleted"
    else left=$((left+1)); fi
  done < "$OUT/sandboxes.tsv"
done
python3 findings.py "$OUT"
