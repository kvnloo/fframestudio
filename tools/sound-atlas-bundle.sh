#!/usr/bin/env bash
# Assemble the static Sound Atlas site: page + modules + fonts + catalogue (+ optional local tracks/).
# Usage: tools/sound-atlas-bundle.sh <catalog-dir> <out-dir> [tracks-dir]
# catalog-dir holds catalog.json and vectors.bin from tools/music-catalog.mjs, and optionally
# feat.json + feat.json.clap.bin from tools/music-features.py --clap.
set -euo pipefail
cat_dir=${1:?catalog dir}; out=${2:?out dir}; tracks=${3:-}
here=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out/src/music-atlas" "$out/fonts"
cp "$here"/web/src/music-atlas/*.{js,css} "$out/src/music-atlas/"
cp "$here"/web/fonts/{ArchivoBlack-Regular,InstrumentSans-Regular,InstrumentSans-Bold,InstrumentSerif-Italic,IBMPlexMono-Regular}.ttf "$here"/web/fonts/*OFL.txt "$out/fonts/"
# Deployed at the site root with pretty paths (/song/…, /room/…): <base href="/"> keeps every relative URL on the root.
sed -e 's#\.\./src/#./src/#g' -e 's#\.\./fonts/#./fonts/#g' -e 's#<head>#<head>\n<base href="/" />#' "$here/web/labs/sound-atlas.html" > "$out/index.html"
cp "$here/web/labs/sound-atlas.vercel.json" "$out/vercel.json" # rewrites the pretty paths to /api/page (link previews)
cp "$here"/web/labs/sound-atlas.webmanifest "$here"/web/labs/sound-atlas-icon.svg "$here"/web/labs/sound-atlas-icon.png "$out/" # installable, launches fullscreen
# Bundling in place (catalog-dir = out-dir, the deploy recipe) must not stop here: cp of a file onto itself
# fails, and set -e used to end the script before the tracks step, so the shortlist songs never shipped (404 on prod).
[ "$cat_dir" -ef "$out" ] || cp "$cat_dir/catalog.json" "$cat_dir/vectors.bin" "$out/"
# Optional listening layer from tools/music-features.py (feat.json + feat.json.clap.bin next to the catalogue).
[ -f "$cat_dir/feat.json" ] && cp "$cat_dir/feat.json" "$out/sound.json"
[ -f "$cat_dir/feat.json.clap.bin" ] && cp "$cat_dir/feat.json.clap.bin" "$out/sound.bin"
[ -d "$cat_dir/beats" ] && { mkdir -p "$out/beats"; cp -u "$cat_dir"/beats/*.bin "$cat_dir/beats/index.json" "$out/beats/"; } # measured beats + energy (tools/music-beats.py); optional
mkdir -p "$out/api" && cp -L "$here"/tools/sound-atlas-api/*.js "$out/api/" # same-origin stream proxy (ccMixter needs its Referer)
[ -f "$out/share.json" ] || echo '{}' > "$out/share.json" # deploy step may write {"base": "<entry link>"}; never commit it
if [ -n "$tracks" ]; then mkdir -p "$out/tracks"; cp -u "$tracks"/*.mp3 "$out/tracks/"; fi
du -sh "$out"
