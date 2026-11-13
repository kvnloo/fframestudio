# Sourced: make sure SITE_URL answers. Without one, build this checkout and serve it on 18941 with the isolated schema.
if [ -z "${SITE_URL:-}" ]; then
  export SITE_URL=http://127.0.0.1:18941/
  if ! curl -sf -o /dev/null "$SITE_URL"; then
    [ -d site ] || bash bundle.sh site >/dev/null
    env_file=${SA_ENV:-$HOME/.hermes/profiles/clean/cache/scratch/sa-social/.env.neon}
    ( [ -f "$env_file" ] && { set -a; . "$env_file"; set +a; }; SA_SCHEMA=sa_e2e exec node ../../tools/sound-atlas-serve.mjs site 18941 >/dev/null 2>&1 ) & SA_SERVER=$!
    trap 'kill $SA_SERVER 2>/dev/null' EXIT
    timeout 30 bash -c "until curl -sf -o /dev/null $SITE_URL; do sleep 0.5; done"
  fi
fi
