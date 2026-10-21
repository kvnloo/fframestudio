#!/usr/bin/env python3
"""Write studio camera-key overrides into an isolated ff-unmute working copy.

The editor saves ``metadata.proceduralOverrides`` beside the read-only source
sidecar. This tool copies the pinned source (never writing it), replaces only
the ``KEYS`` literal in ``hud/src/lib.rs``, re-imports the copy with the same
adapter to prove the round trip, and can run ``cargo test -p hud`` there. It
does not render: camera keys feed hud::track (flat) and hud::shot (lens), so a
Rust rebuild plus both fframes passes are still required for a film.

  procedural_overrides.py export --source SRC --project project.json --out NEW_DIR [--cargo-test]
  procedural_overrides.py diff   --source SRC --project project.json
"""

import argparse
import difflib
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from procedural_fframes import inspect  # noqa: E402

SCHEMA = "fframestudio.procedural-overrides/0"
FIELDS = ["time_s", "look_y", "zoom", "tilt_x", "tilt_y", "roll", "dx", "blur"]
LIMITS = {"zoom": (1, 20), "blur": (0, 20)}  # studio editing limits; hud clamps zoom >= 1
STAGES_REQUIRED = ["cargo build --release -p hud -p flat -p lens", "flat render", "lens render"]
STAGES_SKIPPED = ["music/synth.py", "music/analyze.py", "music/gen_hud.py"]
LIB = "hud/src/lib.rs"
KEYS_RE = re.compile(r"(\bconst\s+KEYS\s*:\s*\[\(\s*f32(?:\s*,\s*f32){7}\s*\)\s*;\s*(\d+)\s*\]\s*=\s*\[)(.*?)(\]\s*;)", re.S)


class OverrideError(ValueError):
    pass


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_keys(keys, procedural):
    """Same rules as web/src/procedural-camera.js validateCameraKeys."""
    n, end = len(procedural["camera_keyframes"]), procedural["total_frames"] / procedural["fps"]
    if not isinstance(keys, list) or len(keys) != n:
        raise OverrideError(f"Camera overrides must keep the source's {n} keys")
    for i, k in enumerate(keys):
        if not isinstance(k, dict) or sorted(k) != sorted(FIELDS):
            raise OverrideError(f"Camera key {i + 1}: unexpected fields")
        for f in FIELDS:
            v = k[f]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise OverrideError(f"Camera key {i + 1}: {f} must be a finite number")
        for f, (lo, hi) in LIMITS.items():
            if not lo <= k[f] <= hi:
                raise OverrideError(f"Camera key {i + 1}: {f} must be {lo}-{hi}")
    if keys[0]["time_s"] != 0:
        raise OverrideError("Camera key 1 is pinned at 0 s")
    for i in range(1, n):
        if not keys[i]["time_s"] - keys[i - 1]["time_s"] >= 1e-3:
            raise OverrideError(f"Camera key {i + 1} must come after key {i}")
    if keys[-1]["time_s"] > end:
        raise OverrideError(f"Camera keys must end by {end} s")
    return keys


def load(project_path):
    project = json.loads(Path(project_path).read_text())
    meta = project.get("metadata") or {}
    procedural, overrides = meta.get("procedural"), meta.get("proceduralOverrides")
    if not procedural or procedural.get("family") != "ff-unmute":
        raise OverrideError("Project is not an imported ff-unmute source")
    if not overrides:
        raise OverrideError("Project has no camera overrides; it matches the source")
    if overrides.get("schema") != SCHEMA or overrides.get("family") != "ff-unmute":
        raise OverrideError("Unsupported override schema")
    validate_keys(overrides["camera_keyframes"], procedural)
    return procedural, overrides


def check_source(src, procedural, overrides):
    """Fail closed if any recorded source byte drifted since import."""
    recorded = procedural.get("source_sha256") or {}
    if LIB not in recorded or overrides.get("base", {}).get("lib_sha256") != recorded[LIB]:
        raise OverrideError("Overrides were not made against this source's hud/src/lib.rs")
    for rel, digest in recorded.items():
        if not (src / rel).is_file() or sha256(src / rel) != digest:
            raise OverrideError(f"Source changed since import: {rel}; re-import before remixing")


def source_files(src):
    """Tracked files when src is its own Git checkout; else all but build outputs."""
    top = subprocess.run(["git", "-C", str(src), "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if top.returncode == 0 and Path(top.stdout.strip()).resolve() == src:
        listed = subprocess.run(["git", "-C", str(src), "ls-files", "-z"], capture_output=True, check=True)
        return sorted(p for p in listed.stdout.decode().split("\0") if p)
    skip = {".git", "target", "out"}
    return sorted(str(p.relative_to(src)) for p in src.rglob("*")
                  if p.is_file() and not skip & set(p.relative_to(src).parts))


def fmt(v):
    """Rust f32 literal for a finite JSON number; repr round-trips exactly."""
    text = repr(float(v))
    return text if any(c in text for c in ".e") else text + ".0"


def rewrite_keys(lib_text, keys):
    matches = list(KEYS_RE.finditer(lib_text))
    if len(matches) != 1:
        raise OverrideError("Expected exactly one supported KEYS literal in hud/src/lib.rs")
    m = matches[0]
    if int(m[2]) != len(keys):
        raise OverrideError("KEYS length differs from overrides")
    body = "\n" + "".join("    (" + ", ".join(fmt(k[f]) for f in FIELDS) + "),\n" for k in keys)
    return lib_text[:m.start(3)] + body + lib_text[m.end(3):]


def plan(src, project_path):
    src = Path(src).resolve()
    procedural, overrides = load(project_path)
    check_source(src, procedural, overrides)
    before = (src / LIB).read_text(encoding="utf-8")
    after = rewrite_keys(before, overrides["camera_keyframes"])
    return src, procedural, overrides, before, after


def changed(procedural, overrides):
    src = procedural["camera_keyframes"]
    return [{"key": i + 1, "field": f, "before": src[i][f], "after": k[f]}
            for i, k in enumerate(overrides["camera_keyframes"]) for f in FIELDS if k[f] != src[i][f]]


def export(src, project_path, out, cargo_test=False):
    src, procedural, overrides, _, after = plan(src, project_path)
    out = Path(out).resolve()
    if out == src or src in out.parents or out in src.parents:
        raise OverrideError("Working copy must be outside the source checkout")
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise OverrideError("Working copy directory must be new or empty")
    files = source_files(src)
    hashes = {rel: sha256(src / rel) for rel in files}
    for rel in files:
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / rel, out / rel)
    (out / LIB).write_text(after, encoding="utf-8")
    # Round trip: the same read-only adapter must read back exactly the overrides,
    # and every non-camera fact (score, events, waveform, timing) must be unchanged.
    reread = inspect(out)["metadata"]
    if [{f: k[f] for f in FIELDS} for k in reread["camera_keyframes"]] != overrides["camera_keyframes"]:
        raise OverrideError("Round trip failed: re-imported KEYS differ from overrides")
    original = inspect(src)["metadata"]
    for key in ("total_frames", "fps", "bpm", "event_seconds", "event_frames", "waveform", "editorial_marker_frames"):
        if reread.get(key) != original.get(key):
            raise OverrideError(f"Round trip changed non-camera source data: {key}")
    for rel, digest in reread["source_sha256"].items():
        if rel != LIB and digest != original["source_sha256"][rel]:
            raise OverrideError(f"Working copy changed another source file: {rel}")
    tests = {"ran": False}
    if cargo_test:
        env = os.environ | {"CARGO_TARGET_DIR": str(out / "target")}
        run = subprocess.run(["cargo", "test", "-p", "hud"], cwd=out, env=env, capture_output=True, text=True)
        log = run.stdout + run.stderr
        (out / "fframestudio-hud-test.log").write_text(log)
        summary = [line for line in log.splitlines() if line.startswith("test result:") or line.startswith("test ")]
        tests = {"ran": True, "command": "cargo test -p hud", "exit_code": run.returncode, "summary": summary[-12:]}
    if {rel: sha256(src / rel) for rel in files} != hashes:
        raise OverrideError("Source checkout bytes changed during export")
    receipt = {
        "schema": "fframestudio.procedural-remix/0", "family": "ff-unmute",
        "source_revision": procedural.get("source_revision"), "source_url": procedural.get("source_url"),
        "source_lib_sha256": procedural["source_sha256"][LIB], "remix_lib_sha256": sha256(out / LIB),
        "files_copied": len(files), "source_unchanged": True, "round_trip": True,
        "changed": changed(procedural, overrides), "hud_tests": tests,
        "stages_required": STAGES_REQUIRED, "stages_skipped": STAGES_SKIPPED, "rendered": False,
        "note": "Working copy only. Not rendered; flat and lens passes must run on a compatible fframes host.",
        "credits": procedural.get("credits", []),
    }
    (out / "fframestudio-remix.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("export", "diff"):
        s = sub.add_parser(name)
        s.add_argument("--source", required=True)
        s.add_argument("--project", required=True)
        if name == "export":
            s.add_argument("--out", required=True)
            s.add_argument("--cargo-test", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "diff":
            _, _, _, before, after = plan(a.source, a.project)
            sys.stdout.writelines(difflib.unified_diff(before.splitlines(True), after.splitlines(True), "a/" + LIB, "b/" + LIB))
            return 0
        receipt = export(a.source, a.project, a.out, a.cargo_test)
        print(json.dumps(receipt, indent=2))
        return 0 if not receipt["hud_tests"]["ran"] or receipt["hud_tests"]["exit_code"] == 0 else 3
    except OverrideError as e:
        print(f"procedural_overrides: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
