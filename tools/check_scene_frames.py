#!/usr/bin/env python3
"""Scene-frame law for an fframes film: every scene is reached, and distinct scenes look distinct.

fframes already has the render contract (`Scene::render_frame(frame)` is a pure function of the
frame index) and the tools (`timeline --json`, `--json frame`, `strip`). This script only adds
the law on top of them:

1. `timeline --json` scenes tile [0, duration) with no gap, overlap or empty scene.
2. At least two frames per scene, evenly spaced inside it, are rendered with `frame`. fframes
   reports which scene each frame landed in; every scene must be reached.
3. For every pair of scenes, the closest pair of their samples must differ by at least
   --min-diff (mean absolute grey difference on a 96x54 thumbnail, 0..1). N copies of one
   page fail.
4. A contact sheet (`strip`) of the samples is written so a person can look at it.

Usage: check_scene_frames.py BIN [--samples 2] [--min-diff 0.02] [--out DIR]
BIN is the built fframes film binary (for example target/release/<crate>). Exit 1 on failure.
"""
import argparse, itertools, json, pathlib, subprocess, sys, tempfile

THUMB = (96, 54)


def mean_abs_diff(a, b):
    """Mean absolute difference of two equal-length grey pixel sequences, scaled to 0..1."""
    if len(a) != len(b) or not a:
        raise ValueError("thumbnails differ in size")
    return sum(abs(x - y) for x, y in zip(a, b)) / (255.0 * len(a))


def tiling_errors(timeline):
    errors, at = [], 0
    for s in timeline["scenes"]:
        if s["start_frame"] != at:
            errors.append(f"{s['name']}: starts at {s['start_frame']}, expected {at}")
        if s["end_frame"] <= s["start_frame"]:
            errors.append(f"{s['name']}: empty scene")
        at = s["end_frame"]
    if at != timeline["duration_frames"]:
        errors.append(f"scenes end at {at}, film ends at {timeline['duration_frames']}")
    return errors


def sample_frames(scene, k):
    """k frames evenly spaced strictly inside the scene."""
    a, b = scene["start_frame"], scene["end_frame"]
    return sorted({min(b - 1, a + (b - a) * (j + 1) // (k + 1)) for j in range(k)})


def identical_pairs(thumbs, min_diff):
    """thumbs: {scene: [grey sequence, ...]}. Pairs of scenes whose closest samples are too alike."""
    bad = []
    for x, y in itertools.combinations(thumbs, 2):
        d = min(mean_abs_diff(a, b) for a in thumbs[x] for b in thumbs[y])
        if d < min_diff:
            bad.append((x, y, round(d, 4)))
    return bad


def grey(path):
    from PIL import Image
    with Image.open(path) as im:
        return list(im.convert("L").resize(THUMB).getdata())


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("bin")
    ap.add_argument("--samples", type=int, default=2)
    ap.add_argument("--min-diff", type=float, default=0.02)
    ap.add_argument("--out")
    o = ap.parse_args(argv)
    if o.samples < 2:
        ap.error("--samples must be at least 2")
    out = pathlib.Path(o.out or tempfile.mkdtemp(prefix="scene-frames-"))
    out.mkdir(parents=True, exist_ok=True)
    run = lambda *a: subprocess.run([o.bin, *map(str, a)], check=True, capture_output=True, text=True).stdout
    timeline = json.loads(run("timeline", "--json"))
    errors = tiling_errors(timeline)
    plan = {s["name"]: sample_frames(s, o.samples) for s in timeline["scenes"]}
    frames = sorted({f for fs in plan.values() for f in fs})
    rendered = {r["frame"]: r for r in json.loads(run("--json", "frame", ",".join(map(str, frames)), "-o", out / "frames"))}
    thumbs = {}
    for name, fs in plan.items():
        for f in fs:
            r = rendered.get(f)
            if not r or name not in r.get("scenes", []):
                errors.append(f"{name}: frame {f} did not reach the scene (got {r and r.get('scenes')})")
                continue
            p = pathlib.Path(r["path"])
            thumbs.setdefault(name, []).append(grey(p if p.is_absolute() else out / "frames" / p.name))
    for x, y, d in identical_pairs(thumbs, o.min_diff):
        errors.append(f"{x} and {y} render the same page (difference {d} < {o.min_diff})")
    run("strip", ",".join(map(str, frames)), "-n", len(frames), "--columns", min(len(frames), o.samples * 2), "--width", 480, "-o", out / "contact.png")
    report = {"scenes": len(plan), "samples": frames, "contact": str(out / "contact.png"), "errors": errors}
    (out / "scene-frames.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
