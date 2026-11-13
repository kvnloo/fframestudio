#!/usr/bin/env python3
"""Live wall of every Boat lane, for screen sharing: one tile per sandbox desktop with its current goal.
Usage: python3 boat/wall.py runs/boat/sandboxes.tsv [PORT] [BIND]   (tsv: lane, sandbox id, `boat host` URL)
Read-only: it only fetches frames. Open http://<host>:PORT/ on any screen (or a phone pop-up window)."""
import http.cookiejar, json, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SRC = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 18777
BIND = sys.argv[3] if len(sys.argv) > 3 else "0.0.0.0"
frames, lanes, openers, lock = {}, {}, {}, threading.Lock()


def get(n, url, path):
    base, _, tok = url.partition("?")
    if n not in openers:  # the first request trades the URL token for a cookie
        openers[n] = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        return openers[n].open(f"{base}/{path}?{tok}", timeout=8).read()
    return openers[n].open(f"{base}/{path}", timeout=8).read()


def poll():
    while True:
        try:
            rows = [l.rstrip("\n").split("\t") for l in open(SRC) if l.strip()]
        except OSError:
            rows = []
        for n, _, url in rows:
            try:
                f, lane = get(n, url, "f.jpg"), json.loads(get(n, url, "lane.json") or b"{}")
                with lock:
                    frames[n], lanes[n] = f, lane
            except Exception:  # sandbox finished and was deleted, or not up yet: keep the last frame
                openers.pop(n, None)
                with lock:
                    lanes.setdefault(n, {})["status"] = "offline"
        time.sleep(1.0)


PAGE = b"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Tester army</title><style>
body{margin:0;background:#0b0e13;color:#d8dee9;font:13px system-ui}#g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;padding:4px}
.t{background:#141a22;border-radius:6px;overflow:hidden}img{width:100%;display:block;aspect-ratio:16/10;object-fit:contain;background:#000}
.l{padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}b{color:#7dd3fc}</style><div id=g></div><script>
const g=document.getElementById('g');async function tick(){try{const s=await(await fetch('state.json',{cache:'no-store'})).json();
if(g.children.length!==s.length)g.innerHTML=s.map(x=>`<div class=t><img id=i${x.n}><div class=l id=l${x.n}></div></div>`).join('');
const t=Date.now();for(const x of s){document.getElementById('i'+x.n).src=`m/${x.n}.jpg?${t}`;
document.getElementById('l'+x.n).innerHTML=`<b>M${x.n}</b> ${x.id||''} &middot; ${x.status||''}`}}catch(e){}setTimeout(tick,1200)}tick()</script>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, ctype, body):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Cache-Control", "no-cache")
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/":
            return self.reply(200, "text/html; charset=utf-8", PAGE)
        if p == "/state.json":
            with lock:
                return self.reply(200, "application/json", json.dumps([{"n": n, **lanes.get(n, {})} for n in sorted(frames)]).encode())
        if p.startswith("/m/") and p.endswith(".jpg"):
            with lock:
                b = frames.get(p[3:-4])
            return self.reply(200, "image/jpeg", b) if b else self.reply(404, "text/plain", b"no frame")
        self.reply(404, "text/plain", b"not found")


threading.Thread(target=poll, daemon=True).start()
ThreadingHTTPServer((BIND, PORT), H).serve_forever()
