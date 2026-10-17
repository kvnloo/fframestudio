#!/usr/bin/env bash
# Fail if a tracked file contains an absolute path from someone's machine (/home/<user>/, /Users/<user>/, /mnt/).
# Evidence and logs should use repo-relative paths or <local>/name.
set -euo pipefail
cd "$(dirname "$0")/.."
hits=$(git grep -n -I -E '(^|[^A-Za-z0-9_.])/(home|Users)/[A-Za-z0-9._-]+/|(^|["'"'"' (=])/mnt/[A-Za-z0-9]' -- . ':!scripts/check-no-local-paths.sh' ':!**/package-lock.json' || true)
if [ -n "$hits" ]; then echo "Absolute local paths found (replace with relative paths or <local>/name):"; echo "$hits" | cut -c1-200 | head -40; exit 1; fi
echo "no local paths"
