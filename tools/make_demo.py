#!/usr/bin/env python3
"""Make a small demo film so a fresh clone has something to open.

Writes ~/fframestudio/demo-src/{demo.mp4,timeline.txt}: 12 s, 1280x720 @ 30 fps, four titled
shots over moving test patterns with a tone, plus a timeline in fframes' timeline.txt format.
Needs ffmpeg with the drawtext filter (falls back to no text if drawtext is missing).
"""
import os, pathlib, subprocess

OUT = pathlib.Path(os.path.expanduser("~/fframestudio/demo-src")); OUT.mkdir(parents=True, exist_ok=True)
FPS, W, H = 30, 1280, 720
SHOTS = [("Hook", "testsrc2"), ("Reveal", "smptehdbars"), ("Detail", "mandelbrot"), ("Ask", "rgbtestsrc")]
SEC = 3
has_drawtext = "drawtext" in subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
parts = []
for i, (name, src) in enumerate(SHOTS):
    f = OUT / f"_part{i}.mp4"
    vf = f"scale={W}:{H},format=yuv420p"
    if has_drawtext:
        vf += f",drawtext=text='{i + 1:02d}  {name.upper()}':fontcolor=white:fontsize=64:box=1:boxcolor=black@0.55:boxborderw=24:x=80:y=h-180"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"{src}=size={W}x{H}:rate={FPS}",
                    "-f", "lavfi", "-i", f"sine=frequency={220 * (i + 2)}:sample_rate=48000",
                    "-t", str(SEC), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-shortest", str(f)], check=True)
    parts.append(f)
lst = OUT / "_parts.txt"; lst.write_text("".join(f"file '{p}'\n" for p in parts))
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(OUT / "demo.mp4")], check=True)
for p in parts + [lst]: p.unlink()
lines = [f"{W}x{H} @ {FPS} fps, {len(SHOTS) * SEC * FPS} frames ({len(SHOTS) * SEC:.2f}s)"]
for i, (name, _) in enumerate(SHOTS):
    a, b = i * SEC * FPS, (i + 1) * SEC * FPS
    lines.append(f"#{i:<3} {name:<28} frames {a:>9}..{b:<6} {a / FPS:.2f}s..{b / FPS:.2f}s")
(OUT / "timeline.txt").write_text("\n".join(lines) + "\n")
print("demo film:", OUT / "demo.mp4")
