#!/usr/bin/env bash
# Runs ON a Boat sandbox: a JPEG of the desktop every ~1.5 s plus the lane label on :18780, for boat/wall.py.
# (Boat's own desktop stream works as a page of its own but not inside an iframe, so the wall polls frames.)
mkdir -p /tmp/frame && cd /tmp/frame
(while :; do DISPLAY=:0 import -silent -window root -resize 50% -quality 60 f.tmp.jpg 2>/dev/null && mv f.tmp.jpg f.jpg
   cp ~/army/lane.json lane.json 2>/dev/null; sleep 1.5; done) &
exec python3 -m http.server 18780 --bind 0.0.0.0
