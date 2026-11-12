"""Unreported profiling pass: GPUI per-thread CPU during the play phase on the private Sway."""
import os, subprocess, sys, time
H = os.path.dirname(os.path.abspath(__file__)); T = os.sysconf("SC_CLK_TCK")
env = {**os.environ, "WAYLAND_DISPLAY": "wayland-1", "XDG_RUNTIME_DIR": os.path.join(H, "wl", "rt"), "SA_BENCH": "1", "SA_BASE": "http://127.0.0.1:28791/"}
env.pop("DISPLAY", None)
if "x11" in sys.argv: env.pop("WAYLAND_DISPLAY"); env.update(DISPLAY=":20", XAUTHORITY=os.environ.get("XAUTHORITY", ""))
srv = subprocess.Popen([sys.executable, "-I", "-m", "http.server", "28791", "-b", "127.0.0.1", "-d", os.path.join(H, "mirror")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
pr = subprocess.Popen([os.environ.get("SA_BIN", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "target", "release", "sound-atlas-gpui")), os.path.join(H, "mirror", "catalog.json")], env=env, stdout=subprocess.PIPE, text=True)
def snap():
    s = {}
    for t in os.listdir(f"/proc/{pr.pid}/task"):
        try:
            name = open(f"/proc/{pr.pid}/task/{t}/comm").read().strip(); f = open(f"/proc/{pr.pid}/task/{t}/stat").read().rsplit(")", 1)[1].split()
            cs = sum(int(l.split()[1]) for l in open(f"/proc/{pr.pid}/task/{t}/status") if "ctxt_switches" in l)
            s[t] = (name, (int(f[11]) + int(f[12])) / T, cs)
        except OSError: pass
    return s
for line in pr.stdout:
    if line.startswith("BENCH idle_start") or line.startswith("BENCH play_start"):
        a = snap(); time.sleep(4); b = snap(); agg = {}
        for t, (n, c, cs) in b.items(): o = a.get(t, (n, c, cs)); x = agg.setdefault(n, [0, 0]); x[0] += c - o[1]; x[1] += cs - o[2]
        print(line.split()[1], {k: f"{100 * v[0] / 4:.1f}% {v[1] / 4:.0f} ctxsw/s" for k, v in sorted(agg.items(), key=lambda x: -x[1][0]) if v[0] > 0})
pr.wait(); srv.terminate()
