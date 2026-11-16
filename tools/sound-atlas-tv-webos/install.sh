#!/usr/bin/env bash
# Package and install the Sound Atlas LG (webOS) TV app, then launch it.
# Once per TV: install "Developer Mode" from LG Apps, sign in with an LG Developer account, turn
# Dev Mode on (TV reboots), press Key Server, then run:  install.sh <tv-ip> <6-char passphrase>
# Later runs need only:  install.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); ares() { npx -y -p @webos-tools/cli "$@"; }
if [ $# -ge 2 ]; then
  key=$HOME/.ssh/webos_lgtv; curl -fsS --max-time 8 "http://$1:9991/webos_rsa" -o "$key"; chmod 600 "$key"
  ares ares-setup-device -r lgtv >/dev/null 2>&1 || true
  ares ares-setup-device -a lgtv -i "username=prisoner" -i "privatekey=webos_lgtv" -i "passphrase=$2" -i "host=$1" -i "port=9922"
fi
out=$(mktemp -d); pkg=$(mktemp -d); trap 'rm -rf "$out" "$pkg"' EXIT
cp "$here"/appinfo.json "$here"/index.html "$here"/main.js "$out/"
cp "$here"/../sound-atlas-tv/style.css "$out/"
# Launcher icons from the Samsung app's 512 px icon (webOS sizes: 80 and 130 px).
magick "$here"/../sound-atlas-tv/icon.png -resize 80x80 "$out/icon.png"
magick "$here"/../sound-atlas-tv/icon.png -resize 130x130 "$out/largeIcon.png"
ares ares-package --no-minify "$out" -o "$pkg" >/dev/null && ls "$pkg"/*.ipk
[ "${PACKAGE_ONLY:-}" ] && { cp "$pkg"/*.ipk "${PACKAGE_ONLY}"; exit 0; }
ares ares-install -d lgtv "$pkg"/*.ipk
ares ares-launch -d lgtv com.kvnloo.soundatlas
