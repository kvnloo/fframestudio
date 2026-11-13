#!/usr/bin/env bash
# Runs ON a Boat sandbox: the lane's goals one after another, headed on the sandbox desktop (DISPLAY=:0).
# Usage: bash boat/lane.sh 'j01-first-look|j07-to-canvas'   Status for the host: ~/army/lane.json
set -u
cd ~/army
pgrep -f "http.server 18931" >/dev/null || (cd site && setsid python3 -m http.server 18931 --bind 127.0.0.1 >/tmp/site.log 2>&1 < /dev/null &)
export DISPLAY=:0 CHROME_EXE=${CHROME_EXE:-/usr/bin/google-chrome} E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
mkdir -p runs; : > runs/exits.txt
grep -E "^(${1:-.})"$'\t' goals.tsv | while IFS=$'\t' read -r id target goal; do
  printf '{"id":"%s","status":"running"}' "$id" > lane.json
  setsid npx e2e explore "$goal" --config army.config.ts --target "$target" --max-steps "${STEPS:-8}" --timeout 900000 \
    --output "runs/$id" --reporter list < /dev/null > "runs/$id.log" 2>&1
  echo "$id exit=$?" >> runs/exits.txt
done
printf '{"id":"idle","status":"done"}' > lane.json
