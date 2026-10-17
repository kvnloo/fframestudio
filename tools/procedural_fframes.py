"""Read-only source-aware metadata for ff-tracking and ff-unmute projects.

Both use a Rust HUD, SVG flat pass, and SkSL lens. The HUD owns source timing;
detecting cuts in a final MP4 would misrepresent these projects.
No Rust source is executed or modified here.
"""

import math
from pathlib import Path
import re


def _constant(source, name):
    match = re.search(rf"\bpub\s+const\s+{re.escape(name)}\s*:\s*usize\s*=\s*(\d+)\s*;", source)
    if not match or int(match.group(1)) < 1:
        raise ValueError(f"Missing or invalid Rust usize constant: {name}")
    return int(match.group(1))


def _numbers(source, name, rust_type="f32"):
    match = re.search(
        rf"\bpub\s+const\s+{re.escape(name)}\s*:\s*\[{re.escape(rust_type)}\s*;\s*(\d+)\]\s*=\s*\[([^\]]*)\]\s*;",
        source, re.S,
    )
    if not match:
        return None
    raw = [s.strip().replace("_", "") for s in match.group(2).split(",") if s.strip()]
    try:
        values = [int(s) if rust_type == "usize" else float(s) for s in raw]
    except ValueError as e:
        raise ValueError(f"Invalid {name} values") from e
    if len(values) != int(match.group(1)):
        raise ValueError(f"Declared {name} count does not match values")
    if not all(math.isfinite(v) and v >= 0 for v in values):
        raise ValueError(f"Non-finite or negative {name} values")
    return values


def _tracking_scenes(source, count):
    block = re.search(r"\bpub\s+const\s+SCENE_LIST\b[^=]*=\s*\[(.*?)\n\s*\];", source, re.S)
    if not block:
        raise ValueError("Missing SCENE_LIST in tracking HUD")
    snippets = re.findall(r'^\s*text:\s*"((?:\\.|[^"\\])*)"\s*,', block.group(1), re.M)
    palettes = re.findall(r'\bpalette:\s*Palette::(\w+)\s*,', block.group(1))
    kinds = re.findall(r'\bkind:\s*Kind::(\w+)\s*,', block.group(1))
    if not (len(snippets) == len(palettes) == len(kinds) == count):
        raise ValueError("SCENE_LIST does not agree with declared SCENES")
    return [{"text": s, "palette": p, "scene_kind": k} for s, p, k in zip(snippets, palettes, kinds)]


def inspect(root, video_info):
    """Read generated HUD metadata, validating fps/duration against ffprobe.

    Return source-aligned shots and read-only metadata. Unsupported or stale
    workspaces fail closed rather than claiming to contain correct footage.
    """
    root = Path(root)
    required = ["Cargo.toml", "hud/src/lib.rs", "flat/Cargo.toml", "lens/Cargo.toml"]
    if not all((root / rel).is_file() for rel in required):
        raise ValueError("Expected a two-pass fframes Rust workspace (hud/flat/lens)")
    hud = (root / "hud/src/lib.rs").read_text(encoding="utf-8")
    fps = _constant(hud, "FPS")
    video_fps = float(video_info["fps"])
    duration = float(video_info["duration_s"])
    if not math.isfinite(duration) or duration <= 0 or abs(video_fps - fps) > 0.01:
        raise ValueError(f"Rendered fps/duration disagrees with HUD ({fps} fps)")
    metadata = {"schema": "fframestudio.procedural/0", "fps": fps,
                "source_files": required[:], "editable": False,
                "notes": "Source-derived, read-only metadata; preview is a baked render."}

    generated = root / "hud/src/generated.rs"
    if (root / "music/gen_hud.py").is_file() and generated.is_file():
        # One unbroken camera take. SHOT_FRAMES are editorial markers, NOT cuts.
        source = generated.read_text(encoding="utf-8")
        length = _constant(source, "LENGTH_FRAMES")
        frames = _numbers(source, "SHOT_FRAMES", "usize")
        if not frames or frames[0] != 0 or frames[-1] != length or any(a >= b for a, b in zip(frames, frames[1:])):
            raise ValueError("Invalid ff-unmute editorial SHOT_FRAMES")
        metadata.update(family="ff-unmute", total_frames=length,
                        editorial_marker_frames=frames,
                        render_steps=["music/synth.py", "music/analyze.py", "music/gen_hud.py", "flat", "lens"])
        metadata["source_files"] += ["hud/src/generated.rs", "music/gen_hud.py"]
        events = {}
        for kind, constant in [("kick", "KICKS"), ("clap", "CLAPS"), ("token", "TOKENS")]:
            times = _numbers(source, constant)
            if times is not None:
                times = [round(t * fps) for t in times]
                if any(frame < 0 or frame >= length for frame in times):
                    raise ValueError(f"{constant} marker out of range")
                events[kind] = times
        metadata["event_frames"] = events
        metadata["measurement_sources"] = [p for p in ("out/measured.json", "out/events.json") if (root / p).is_file()]
        shots = [{"id": "s01", "name": "Continuous camera take", "t0": 0,
                  "t1": length / fps, "origin": "hud/src/generated.rs LENGTH_FRAMES",
                  "procedural": {"camera_take": "continuous", "editorial_markers": len(frames) - 2}}]
    elif "SCENE_LIST" in hud:
        count, per_scene = _constant(hud, "SCENES"), _constant(hud, "SCENE_FRAMES")
        length = count * per_scene
        snippets = _tracking_scenes(hud, count)
        metadata.update(family="ff-tracking", total_frames=length,
                        render_steps=["hud/tracks", "flat", "tools/sfx.py", "lens"])
        shots = [{"id": f"s{i+1:02d}",
                  "name": f"{i+1:02d} · {entry['text'] or entry['scene_kind']}",
                  "t0": i * per_scene / fps, "t1": (i + 1) * per_scene / fps,
                  "origin": "hud/src/lib.rs SCENE_LIST",
                  "procedural": {"source_text": entry["text"], "palette": entry["palette"],
                                 "scene_kind": entry["scene_kind"]}}
                 for i, entry in enumerate(snippets)]
    else:
        raise ValueError("Unrecognized procedural fframes workspace")

    # Source clip must be complete. Allow at most 1.5 frames of encoder padding.
    if duration * fps < length - 0.05 or duration * fps > length + 1.5:
        raise ValueError(f"Render is {duration:.3f}s but HUD specifies {length / fps:.3f}s; rebuild it")
    return {"shots": shots, "metadata": metadata}
