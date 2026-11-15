#!/usr/bin/env bash
# Real-device climb on the owner's S25 via his Chrome (CDP over adb). Same rotation and A/A rules as boat/perf.sh.
# Prereq: the Chrome task sits on a focus-safe agent display (fsd_session.py `url ...`), and adb forward/reverse are set up:
#   adb forward tcp:9222 localabstract:chrome_devtools_remote; adb reverse tcp:<port> tcp:<port> for each site.
# Usage: REPS=6 bash device/s25.sh 'base=http://127.0.0.1:18981/ aa=http://127.0.0.1:18981/ font=http://127.0.0.1:18982/?c=font'
# It checks presence.py before each rep and stops (keeping the data) if the owner needs the phone.
set -euo pipefail
cd "$(dirname "$0")/.."
REPS=${REPS:-6}; PRES=${PRESENCE:?set PRESENCE=path/to/focus_safe/presence.py}
read -ra VA <<<"$1"; NV=${#VA[@]}
(( REPS % NV == 0 )) || { echo "REPS must be a multiple of $NV arms (rotation)"; exit 2; }
OUT=runs/s25/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"; echo "$1" >"$OUT/arms"
for r in $(seq 1 "$REPS"); do
  python3 "$PRES" s25 >/dev/null 2>&1 || { echo "presence gate closed at rep $r; stopping" | tee -a "$OUT/log"; break; }
  for j in $(seq 0 $((NV - 1))); do
    a=${VA[$(((j + r - 1) % NV))]}; n=${a%%=*}; u=${a#*=}
    echo "rep $r $n" | tee -a "$OUT/log"
    CDP_URL=http://127.0.0.1:9222 URL="$u" OUT="$OUT/$n-$r.json" timeout 240 node perf-climb.mjs >>"$OUT/log" 2>&1 || echo "  $n-$r failed" | tee -a "$OUT/log"
  done
done
echo "$OUT"
