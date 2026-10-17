#!/usr/bin/env python3
"""Create fixed-coordinate diagnostic crops from recorded experiment artifacts."""

import argparse
import io
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw


def frame(path, index, width=None, height=None):
    filters = [f"select=eq(n\\,{index})"]
    if width is not None:
        filters.append(f"scale={width}:{height}:flags=bicubic")
    data = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-threads",
            "2",
            "-i",
            str(path),
            "-vf",
            ",".join(filters),
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ]
    )
    return Image.open(io.BytesIO(data)).convert("RGB")


def cell(sheet, column, row, image, xy, label, size=(320, 180)):
    width, height = size
    left = max(0, min(image.width - width, xy[0] - width // 2))
    top = max(0, min(image.height - height, xy[1] - height // 2))
    crop = image.crop((left, top, left + width, top + height)).resize(
        (width * 2, height * 2), Image.Resampling.NEAREST
    )
    x, y = column * width * 2, row * (height * 2 + 40)
    sheet.paste(crop, (x, y + 32))
    ImageDraw.Draw(sheet).text(
        (x + 5, y + 5), f"{label}; crop {left},{top}; 2x nearest", fill="white"
    )


def generate(root):
    out = root / "sheets"
    out.mkdir(exist_ok=True)
    low = json.loads((root / "lowres/lowres.json").read_text())
    for content in ("ui", "satellite"):
        for height in (720, 480):
            rows = {
                r["variant"]: r
                for r in low
                if r["content"] == content and r["height"] == height
            }
            reference = frame(rows["naive"]["reference"], 45)
            xy = (600, 853) if content == "ui" else (960, 540)
            sheet = Image.new("RGB", (1920, 800), "#181818")
            for row, variants in enumerate(
                (("naive", "lanczos_cas"), ("matched_bicubic", "linear_cas"))
            ):
                cell(
                    sheet,
                    0,
                    row,
                    reference,
                    xy,
                    f"{content} {height} reference frame 45",
                )
                for col, variant in enumerate(variants, 1):
                    image = frame(
                        rows[variant]["playback"], 45, reference.width, reference.height
                    )
                    cell(sheet, col, row, image, xy, variant + " frame 45")
            sheet.save(out / f"lowres-{content}-{height}.png")
    for folder in ("temporal", "temporal-pan"):
        rows = json.loads((root / folder / "temporal.json").read_text())
        for fps in (30, 60):
            chosen = {r["mode"]: Path(r["playback"]) for r in rows if r["fps"] == fps}
            sources = [
                ("instant reference", root / folder / f"reference-decimate-{fps}.mkv"),
                ("box target", root / folder / f"reference-blend-{fps}.mkv"),
                *chosen.items(),
            ]
            sheet = Image.new("RGB", (1800, 840), "#181818")
            for row, index in enumerate(
                (int(fps * 0.2), int(fps * 0.5), int(fps * 0.8))
            ):
                for col, (label, path) in enumerate(sources):
                    image = frame(path, index)
                    cell(
                        sheet,
                        col,
                        row,
                        image,
                        (image.width // 2, image.height // 2),
                        f"{label} frame {index}",
                        (180, 120),
                    )
            sheet.save(out / f"{folder}-{fps}-filmstrip.png")
    ramp = root / "gradient10/gradient10.json"
    if ramp.exists():
        rows = json.loads(ramp.read_text())
        for platform in ("youtube", "reels"):
            chosen = {r["variant"]: r for r in rows if r["platform"] == platform}
            if len(chosen) != 3:
                raise ValueError("Incomplete native 10-bit ramp experiment")
            source = frame(chosen["naive"]["reference"], 45)
            sheet = Image.new("RGB", (1920, 800), "#181818")
            for row, variants in enumerate((("naive", "fast"), ("fast", "hevc10"))):
                cell(
                    sheet,
                    0,
                    row,
                    source,
                    (source.width // 2, source.height // 2),
                    "procedural ramp reference",
                )
                for col, variant in enumerate(variants, 1):
                    image = frame(chosen[variant]["playback"], 45)
                    cell(
                        sheet,
                        col,
                        row,
                        image,
                        (image.width // 2, image.height // 2),
                        variant,
                    )
            sheet.save(out / f"gradient10-{platform}.png")
    return sorted(str(p) for p in out.glob("*.png"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    print(json.dumps(generate(parser.parse_args().root), indent=2))
