"""A/B harness: GPUI Sound Atlas vs web Sound Atlas (Chrome), same display, same phases.
Alternates sides per run. For each BENCH marker it records time since spawn, process-tree CPU
seconds and (at idle_end / play_end) process-tree PSS. Writes results.jsonl.
usage: python3 -I harness.py RUNS
"""
import json, os, shutil, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
GPUI = os.environ.get("SA_BIN", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "target", "release", "sound-atlas-gpui"))
CAT = os.path.join(HERE, "mirror", "catalog.json")
PORT = 8791
URL = f"http://127.0.0.1:{PORT}/index.html"
TCK = os.sysconf("SC_CLK_TCK")
ENV = {**os.environ, "DISPLAY": os.environ.get("BENCH_DISPLAY", ":20"), "XAUTHORITY": os.environ.get("XAUTHORITY", "")}
ENV.pop("WAYLAND_DISPLAY", None)
if os.environ.get("WL"):  # private headless Sway on the NVIDIA render node: real dmabuf presentation, no X readback
    ENV.pop("DISPLAY", None); ENV.update(WAYLAND_DISPLAY="wayland-1", XDG_RUNTIME_DIR=os.path.join(HERE, "wl", "rt"), WEB_WL="1", WEB_NOVK="1")


def tree(root):
    kids = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            try:
                st = open(f"/proc/{d}/stat").read()
                kids.setdefault(int(st.rsplit(")", 1)[1].split()[1]), []).append(int(d))
            except OSError:
                pass
    out, todo = [], [root]
    while todo:
        p = todo.pop(); out.append(p); todo += kids.get(p, [])
    return out


def comm(p):
    try: return open(f"/proc/{p}/comm").read().strip()
    except OSError: return ""


def cpu(pids):
    s = 0
    for p in pids:
        try:
            f = open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split()
            s += int(f[11]) + int(f[12])
        except OSError: pass
    return s / TCK


def pss(pids):
    s = 0
    for p in pids:
        try:
            for l in open(f"/proc/{p}/smaps_rollup"):
                if l.startswith("Pss:"): s += int(l.split()[1])
        except OSError: pass
    return s / 1024


def run(side, i):
    udd = tempfile.mkdtemp(prefix="sa-web-")
    if side == "gpui":
        cmd = [GPUI, CAT]; env = {**ENV, "SA_BENCH": "1", "SA_BASE": f"http://127.0.0.1:{PORT}/"}
    else:
        cmd = ["node", os.path.join(HERE, "web.mjs"), URL, udd]; env = {**ENV, **({"WEB_REDUCED": "1"} if side == "web-rm" else {})}
    t0 = time.monotonic()
    pr = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd=HERE)
    rec = {"side": side, "run": i, "marks": {}, "lines": []}
    load0 = os.getloadavg()[0]
    for line in pr.stdout:
        if not line.startswith("BENCH "): continue
        t = time.monotonic() - t0
        pids = [p for p in tree(pr.pid) if not (side.startswith("web") and comm(p) == "node")]
        body = line[6:].strip(); key = body.split()[0]
        m = {"t": round(t, 3), "cpu": round(cpu(pids), 3), "nproc": len(pids)}
        if key in ("idle_end", "play_end"): m["pss_mb"] = round(pss(pids), 1)
        rec["marks"][key] = m; rec["lines"].append(body)
    pr.wait(timeout=120)
    rec["exit"] = pr.returncode; rec["load1"] = load0
    shutil.rmtree(udd, ignore_errors=True)
    return rec


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    srv = subprocess.Popen([sys.executable, "-I", "-m", "http.server", str(PORT), "-b", "127.0.0.1", "-d", os.path.join(HERE, "mirror")],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with open(os.path.join(HERE, os.environ.get("OUT", "results.jsonl")), "a") as out:
            for i in range(n):
                sides = sys.argv[2].split(",") if len(sys.argv) > 2 else ["gpui", "web"]
                for side in (sides if i % 2 == 0 else sides[::-1]):
                    r = run(side, i); out.write(json.dumps(r) + "\n"); out.flush()
                    print(side, i, "exit", r["exit"], "marks", len(r["marks"]), flush=True)
                    time.sleep(2)
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
