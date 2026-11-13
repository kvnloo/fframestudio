#!/usr/bin/env bash
# The exploratory army: PAR `e2e explore` sessions from goals.tsv against the site, results in runs/<id>/.
#   [PAR=3] [STEPS=12] [ONLY=regex] [SITE_URL=...] bash run.sh
# Needs NVIDIA_API_KEY (or E2E_KEY_ENV/E2E_BASE_URL/E2E_MODEL, see agent.ts).
# Without SITE_URL it builds this checkout (bundle.sh) and serves it on 18941 with SA_SCHEMA=sa_e2e
# (DATABASE_URL from SA_ENV, default the clean profile's sa-social/.env.neon; without it /api/social is off).
set -uo pipefail
cd "$(dirname "$0")"
export E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 STEPS=${STEPS:-12} CHROME_EXE=${CHROME_EXE:-/usr/bin/google-chrome-stable}
. ./serve.sh || exit $?
mkdir -p runs; : > runs/exits.txt
one() {
  IFS=$'\t' read -r id target goal <<<"$1"
  echo "{\"id\":\"$id\",\"status\":\"running\"}" > "runs/$id.lane.json"
  setsid npx e2e explore "$goal" --config army.config.ts --target "$target" --max-steps "$STEPS" --timeout 1500000 \
    --output "runs/$id" --reporter list < /dev/null > "runs/$id.log" 2>&1
  local status=$?
  echo "$id exit=$status" >> runs/exits.txt
  return "$status"
}
export -f one
grep -E "^(${ONLY:-.})" goals.tsv | tr '\n' '\0' | xargs -0 -P "${PAR:-3}" -I{} bash -c 'one "$1"' _ {}
status=$?
cat runs/exits.txt
# Keep the evidence even when one of the exploratory lanes fails.
python3 findings.py runs || exit $?
exit "$status"
