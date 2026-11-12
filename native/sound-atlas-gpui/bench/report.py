import json, re, statistics as S, sys, os
rows = [json.loads(l) for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.environ.get("OUT", "results.jsonl")))]
def m(r):
    k = r["marks"]; o = {}
    o["ready_s (spawn->first frame w/ data)"] = k["ready_ms"]["t"]
    o["idle CPU % (5 s)"] = 100 * (k["idle_end"]["cpu"] - k["idle_start"]["cpu"]) / (k["idle_end"]["t"] - k["idle_start"]["t"])
    o["idle PSS MB"] = k["idle_end"]["pss_mb"]
    o["scroll CPU-s (240 frames)"] = k["scroll_end"]["cpu"] - k["scroll_start"]["cpu"]
    o["play CPU % (10 s)"] = 100 * (k["play_end"]["cpu"] - k["play_start"]["cpu"]) / (k["play_end"]["t"] - k["play_start"]["t"])
    o["play PSS MB"] = k["play_end"]["pss_mb"]
    o["processes"] = k["play_end"]["nproc"]
    for l in r["lines"]:
        if l.startswith("filter_ms"):
            q, v = re.match(r'filter_ms (".*?") ([\d.]+)', l).groups(); o[f"filter ms {q}"] = float(v)
        if l.startswith("scroll_frames"):
            f = l.split(); o["scroll p95 ms"] = float(f[5]); o["scroll max ms"] = float(f[7])
        if l.startswith("audio_ms"): o["click->audio ms"] = float(l.split()[1])
    return o
by = {}
for r in rows:
    if r["exit"] != 0 or "play_end" not in r["marks"]: print("FAILED RUN", r["side"], r["run"], r["exit"], list(r["marks"])); continue
    by.setdefault(r["side"], []).append(m(r))
keys = list(by["gpui"][0])
print(f"runs: gpui={len(by['gpui'])} web={len(by['web'])}; load1 at start of runs: {[round(r['load1'],1) for r in rows]}")
print(f"{'metric':40} {'GPUI median [range]':>26} {'Web median [range]':>26}  web/gpui")
for k in keys:
    a = [x[k] for x in by["gpui"] if k in x]; b = [x[k] for x in by["web"] if k in x]
    if not a or not b: continue
    ma, mb = S.median(a), S.median(b)
    print(f"{k:40} {ma:10.1f} [{min(a):6.1f}-{max(a):6.1f}] {mb:10.1f} [{min(b):6.1f}-{max(b):6.1f}]  {mb/ma if ma else float('nan'):6.1f}x")
for r in rows:
    if r["side"] == "web":
        print("web errors run", r["run"], [l for l in r["lines"] if l.startswith("page_errors") or l.startswith("gpu")]); break
