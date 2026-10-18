"""Read-only source-aware metadata for ff-tracking and ff-unmute projects.

Both use a Rust HUD, SVG flat pass, and SkSL lens. The HUD owns source timing;
detecting cuts in a final MP4 would misrepresent these projects.
No Rust source is executed or modified here.
"""

import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import tomllib


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


def _array(source, name):
    match = re.search(rf"\b(?:pub\s+)?const\s+{name}\s*:\s*\[.*?;\s*(\w+)\]\s*=\s*\[(.*?)\]\s*;", source, re.S)
    return (int(match[1]) if match[1].isdigit() else 0, match[2]) if match else (0, "")


def _finite(raw):
    values = [float(s.strip().replace("_", "")) for s in raw.split(",") if s.strip()]
    if not all(math.isfinite(v) for v in values):
        raise ValueError("Non-finite camera/measurement value")
    return values


def _tuples(source, name, width):
    count, body = _array(source, name)
    values = [_finite(s) for s in re.findall(r"\(([^()]*)\)", body)]
    if len(values) != count or any(len(v) != width for v in values):
        raise ValueError(f"Unsupported {name} tuple data")
    return values


def _tracking_scenes(source, count):
    _, body = _array(source, "SCENE_LIST")
    # Each SceneDef may contain an inline Cam struct; split at the next definition,
    # not at the first closing brace. Only the supported literal forms are read.
    blocks = re.split(r"\bSceneDef\s*\{", body)[1:]
    if len(blocks) != count:
        raise ValueError("SCENE_LIST does not agree with declared SCENES")
    scenes = []
    for block in blocks:
        def field(name, pattern):
            match = re.search(rf"\b{name}:\s*{pattern}", block)
            if not match:
                raise ValueError(f"Unsupported SceneDef {name}")
            return match[1]
        text = json.loads('"' + field("text", r'"((?:\\.|[^"\\])*)"') + '"')
        palette = field("palette", r"Palette::(\w+)")
        kind = field("kind", r"Kind::(\w+)")
        call = re.search(r"\bcam:\s*cam\(([^()]*)\)", block)
        if call:
            values = _finite(call[1])
            if len(values) != 8:
                raise ValueError("Unsupported cam() signature")
            tx, ty, roll, z0, z1, px, py, blur = values
            camera = dict(tilt_x=tx, tilt_y=ty, roll=roll, zoom=[z0, z1], pan=[px, py], blur=blur, shake=0)
        else:
            camera = {}
            for name in ["tilt_x", "tilt_y", "roll", "blur", "shake"]:
                camera[name] = _finite(field(name, r"([^,}]+)"))[0]
            for name in ["zoom", "pan"]:
                camera[name] = _finite(field(name, r"\(([^()]*)\)"))
                if len(camera[name]) != 2:
                    raise ValueError(f"Unsupported Cam {name}")
        hero = _finite(field("hero", r"\(([^()]*)\)"))
        if len(hero) != 2:
            raise ValueError("Unsupported hero position")
        scenes.append(dict(source_text=text, palette=palette, scene_kind=kind, camera=camera,
                           hero=hero, size=_finite(field("size", r"([^,}]+)"))[0],
                           focus="Per-frame tracker target (hud::track); hero is baseline, not focal plane"))
    return scenes


def _workspace(root):
    manifest = tomllib.loads((root / "Cargo.toml").read_text())
    if not {"hud", "flat", "lens"} <= set(manifest.get("workspace", {}).get("members", [])):
        raise ValueError("Expected hud/flat/lens workspace members")
    for name in ["flat", "lens"]:
        crate = tomllib.loads((root / name / "Cargo.toml").read_text())
        if crate.get("package", {}).get("name") != name or not any(b.get("name") == name for b in crate.get("bin", [])):
            raise ValueError(f"Expected {name} package and executable")


def inspect(root, video_info=None, artifacts=None):
    """Read generated HUD metadata, validating fps/duration against ffprobe.

    Return source-aligned shots and read-only metadata. Unsupported or stale
    workspaces fail closed rather than claiming to contain correct footage.
    """
    root = Path(root)
    data_root = Path(artifacts) if artifacts else root
    if artifacts:
        for rel in ("hud/src/lib.rs", "hud/src/generated.rs"):
            original, staged = root / rel, data_root / rel
            if original.is_file() and (not staged.is_file() or original.read_bytes() != staged.read_bytes()):
                raise ValueError("Artifact HUD differs from source; regenerate in a matching copy")
    required = ["Cargo.toml", "hud/src/lib.rs", "flat/Cargo.toml", "lens/Cargo.toml"]
    if not all((root / rel).is_file() for rel in required):
        raise ValueError("Expected a two-pass fframes Rust workspace (hud/flat/lens)")
    _workspace(root)
    hud = (root / "hud/src/lib.rs").read_text(encoding="utf-8")
    fps = _constant(hud, "FPS")
    duration = None
    if video_info is not None:
        video_fps = float(video_info["fps"])
        duration = float(video_info["duration_s"])
        if not math.isfinite(video_fps) or not math.isfinite(duration) or duration <= 0 or abs(video_fps - fps) > 0.01:
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
                times = [math.floor(t * fps + 0.5) for t in times]
                if any(frame < 0 or frame >= length for frame in times):
                    raise ValueError(f"{constant} marker out of range")
                events[kind] = times
        metadata["event_frames"] = events
        metadata["event_seconds"] = {kind: _numbers(source, constant) or [] for kind, constant in [("kick", "KICKS"), ("clap", "CLAPS"), ("token", "TOKENS")]}
        bpm = re.search(r"pub const BPM:\s*f32\s*=\s*([\d.]+)", source)
        if not bpm or not 0 < float(bpm[1]) < 1000:
            raise ValueError("Missing or invalid generated score BPM")
        metadata["bpm"] = float(bpm[1])
        metadata["bpm_origin"] = "music/score.py via generated.rs; measured tempo is a separate cross-check"
        metadata["event_origins"] = {"kick": "Measured kick-stem onsets", "clap": "Synthesized score event timestamps", "token": "Synthesized score event timestamps (count measured)", "bar": "4/4 authored score grid"}
        metadata["event_frames"]["bar"] = [round(i * 4 * 60 / metadata["bpm"] * fps) for i in range(math.ceil(length / fps / (4 * 60 / metadata["bpm"])))]
        metadata["bar_origin"] = "4/4 score grid at generated BPM; bars are not detected kick onsets"
        metadata["waveform"] = _numbers(source, "WAVE") or []
        if any(v > 1 for v in metadata["waveform"]):
            raise ValueError("Invalid normalized WAVE")
        keys = _tuples(hud, "KEYS", 8)
        if not keys or keys[0][0] != 0 or any(a[0] >= b[0] for a, b in zip(keys, keys[1:])) or keys[-1][0] > length / fps:
            raise ValueError("Invalid camera KEYS")
        metadata["camera_keyframes"] = [dict(zip(["time_s", "look_y", "zoom", "tilt_x", "tilt_y", "roll", "dx", "blur"], k), frame=round(k[0] * fps)) for k in keys]
        metadata["camera_interpolation"] = "Catmull–Rom (hud::camera); source keys, not sampled motion"
        metadata["measurement_sources"] = [p for p in ("out/measured.json", "out/events.json") if (data_root / p).is_file()]
        shots = [{"id": "s01", "name": "Continuous camera take", "t0": 0,
                  "t1": length / fps, "origin": "hud/src/generated.rs LENGTH_FRAMES",
                  "procedural": {"camera_take": "continuous", "editorial_markers": len(frames) - 2}}]
    elif "SCENE_LIST" in hud:
        count, per_scene = _constant(hud, "SCENES"), _constant(hud, "SCENE_FRAMES")
        length = count * per_scene
        snippets = _tracking_scenes(hud, count)
        metadata.update(family="ff-tracking", total_frames=length,
                        render_steps=["hud/tracks", "flat", "tools/sfx.py", "lens"])
        metadata["palettes"] = {name: ['#' + h for h in re.findall(r"0x([\da-fA-F]{6})", values)] for name, values in re.findall(r"Palette::(\w+)\s*=>\s*s\(([^)]*)\)", hud)}
        tracks = data_root / "out/tracks.json"
        if tracks.is_file():
            data = json.loads(tracks.read_text())
            focus = data.get("focus", [])
            if data.get("fps") != fps or data.get("frames") != length or len(focus) != length or any(len(x) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in x) for x in focus):
                raise ValueError("Invalid per-frame tracker focus export")
            metadata["focus_frames"] = focus
            metadata["tracker_sha256"] = hashlib.sha256(tracks.read_bytes()).hexdigest()
            for i, entry in enumerate(snippets):
                entry["focus_start"] = focus[i * per_scene]
                entry["focus_mid"] = focus[i * per_scene + per_scene // 2]
                entry["focus_end"] = focus[(i + 1) * per_scene - 1]
        metadata["scenes"] = snippets
        shots = [{"id": f"s{i+1:02d}",
                  "name": f"{i+1:02d} · {entry['source_text'] or entry['scene_kind']}",
                  "t0": i * per_scene / fps, "t1": (i + 1) * per_scene / fps,
                  "origin": "hud/src/lib.rs SCENE_LIST", "procedural": entry}
                 for i, entry in enumerate(snippets)]
    else:
        raise ValueError("Unrecognized procedural fframes workspace")

    # Source clip must be complete. Allow at most 1.5 frames of encoder padding.
    if duration is not None and (duration * fps < length - 0.05 or duration * fps > length + 1.5):
        raise ValueError(f"Render is {duration:.3f}s but HUD specifies {length / fps:.3f}s; rebuild it")
    metadata["render_verified"] = video_info is not None
    metadata["credits"] = ["Mustafa Saraç · original film · MIT", "Dmitriy Kovalenko · fframes · MIT", "JetBrains Mono · SIL OFL 1.1"]
    if metadata["family"] == "ff-tracking":
        metadata["credits"].append("nooga · optional Slab score · MIT (not used by tools/render.sh)")
    metadata["source_url"] = "https://github.com/mrsarac/" + metadata["family"]
    metadata["measurement_sha256"] = {p: hashlib.sha256((data_root / p).read_bytes()).hexdigest() for p in metadata.get("measurement_sources", [])}
    metadata["source_sha256"] = {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in metadata["source_files"]}
    revision = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True)
    metadata["source_revision"] = revision.stdout.strip() if revision.returncode == 0 else None
    metadata["future_write_surface"] = ["text", "palette", "camera", "focus / tracker"] if metadata["family"] == "ff-tracking" else ["score", "camera keyframes", "palettes", "audio response"]
    return {"shots": shots, "metadata": metadata}
