#!/usr/bin/env python3
"""Collect every finding from <runs>/**/report.json into one table: session, severity, title, evidence PNG.
Also counts sessions that ended early (planner/model failures are coverage gaps, not app bugs).
Every finding still has to be reproduced against its PNG before anyone files or fixes it."""
import glob, json, os, sys

root = sys.argv[1] if len(sys.argv) > 1 else "runs"
rows, short = [], []
for rep in sorted(glob.glob(f"{root}/**/report.json", recursive=True)):
    sess = os.path.relpath(os.path.dirname(rep), root)
    data = json.load(open(rep))
    pngs = sorted(glob.glob(f"{os.path.dirname(rep)}/**/finding-*.png", recursive=True))

    def walk(o):
        if isinstance(o, dict):
            if "severity" in o and "title" in o:
                rows.append((sess, str(o["severity"]), o["title"], o.get("actual", "")))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(data)
    log = f"{root}/{sess}.log"
    if os.path.exists(log) and "cut short" in open(log, errors="replace").read():
        short.append(sess)
    if pngs:
        rows.append((sess, "", f"evidence: {', '.join(os.path.relpath(p, root) for p in pngs)}", ""))

seen, out = set(), ["| session | severity | finding | actual |", "|---|---|---|---|"]
for s, sev, t, a in rows:
    if (s, t) in seen:
        continue
    seen.add((s, t))
    out.append(f"| {s} | {sev} | {t} | {str(a)[:160]} |")
out.append(f"\nSessions cut short (rerun them; not app defects): {', '.join(short) or 'none'}")
text = "\n".join(out)
open(f"{root}/FINDINGS.md", "w").write(text + "\n")
print(text)
