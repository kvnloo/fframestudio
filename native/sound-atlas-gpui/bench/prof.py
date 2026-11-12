"""Unreported profiling pass: per Chrome process-type CPU during the web side's idle phase."""
import os, subprocess, sys, tempfile, time
HERE = os.path.dirname(os.path.abspath(__file__)); T = os.sysconf("SC_CLK_TCK")
env = {**os.environ, "WAYLAND_DISPLAY": "wayland-1", "XDG_RUNTIME_DIR": os.path.join(HERE, "wl", "rt"), "WEB_WL": "1", "WEB_NOVK": "1"}
env.pop("DISPLAY", None)
srv = subprocess.Popen([sys.executable, "-I", "-m", "http.server", "28791", "-b", "127.0.0.1", "-d", os.path.join(HERE, "mirror")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
pr = subprocess.Popen(["node", os.path.join(HERE, "web.mjs"), "http://127.0.0.1:28791/index.html", tempfile.mkdtemp()], env=env, stdout=subprocess.PIPE, text=True)
def kids():
    m = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            try: m.setdefault(int(open(f"/proc/{d}/stat").read().rsplit(")", 1)[1].split()[1]), []).append(int(d))
            except OSError: pass
    out, t = [], [pr.pid]
    while t: p = t.pop(); out.append(p); t += m.get(p, [])
    return out
def snap():
    s = {}
    for p in kids():
        try:
            f = open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split(); cmd = open(f"/proc/{p}/cmdline").read().replace("\0", " ").split()
            ty = next((a.split("=")[1] for a in cmd if a.startswith("--type=")), "browser" if "chrome" in cmd[0] else os.path.basename(cmd[0]))
            if ty == "utility": ty += ":" + next((a.split("=")[1] for a in cmd if a.startswith("--utility-sub-type=")), "?")
            s[p] = (ty, (int(f[11]) + int(f[12])) / T)
        except OSError: pass
    return s
for line in pr.stdout:
    if line.startswith("BENCH idle_start") or line.startswith("BENCH play_start"):
        print(line.split()[1])
        a = snap(); time.sleep(4); b = snap(); agg = {}
        for p, (ty, c) in b.items(): agg[ty] = agg.get(ty, 0) + c - a.get(p, (ty, c))[1]
        for ty, c in sorted(agg.items(), key=lambda x: -x[1]): print(f"{ty:40} {100 * c / 4:6.1f}%")
pr.wait(); srv.terminate()
