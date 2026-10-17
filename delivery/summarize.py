#!/usr/bin/env python3
"""Fail-closed cohort aggregation; every published number comes from saved frame logs."""

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import statistics
import subprocess

KEYS = ("vmaf", "vmaf_neg", "psnr_y", "psnr_cb", "psnr_cr", "float_ssim", "cambi")
PLATFORMS = ["youtube", "shorts", "tiktok", "reels", "x"]
CONTENTS = ["ui", "gradient", "satellite", "motion"]


def stats(values):
    if not values:
        raise ValueError("No values")
    ordered = sorted(values)
    position = (len(ordered) - 1) * 0.05
    lo = int(position)
    return {
        "mean": statistics.mean(ordered),
        "p5": ordered[lo]
        + (ordered[min(lo + 1, len(ordered) - 1)] - ordered[lo]) * (position - lo),
    }


def aggregate(rows, platforms=PLATFORMS, contents=CONTENTS):
    output = {}
    records = []
    for platform in platforms:
        output[platform] = {}
        for variant in ("naive", "fast"):
            pooled = {k: [] for k in KEYS}
            for content in contents:
                matches = [
                    r
                    for r in rows
                    if r["platform"] == platform
                    and r["content"] == content
                    and r["variant"] == variant
                    and r["multiplier"] == 1
                ]
                if len(matches) != 1:
                    raise ValueError(
                        f"Require exactly one {platform}/{content}/{variant}; got {len(matches)}"
                    )
                row = matches[0]
                log = Path(row["playback"].replace("-playback.mp4", "-metrics.json"))
                frames = json.loads(log.read_text())["frames"]
                if len(frames) != row["metrics"]["frames"] or len(frames) != round(
                    row["duration"] * row["simulator"]["fps"]
                ):
                    raise ValueError("Frame count mismatch")
                for frame in frames:
                    record = {
                        "platform": platform,
                        "content": content,
                        "variant": variant,
                        "frame": frame["frameNum"],
                    }
                    for key in KEYS:
                        value = frame["metrics"][key]
                        pooled[key].append(value)
                        record[key] = value
                    records.append(record)
            output[platform][variant] = {k: stats(v) for k, v in pooled.items()}
            output[platform][variant]["frames"] = len(pooled["vmaf"])
        output[platform]["gain"] = {
            k: {
                s: output[platform]["fast"][k][s] - output[platform]["naive"][k][s]
                for s in ("mean", "p5")
            }
            for k in KEYS
        }
    return output, records


def crop_sheets(rows, out):
    from PIL import Image, ImageDraw

    out.mkdir(parents=True, exist_ok=True)
    positions = {
        "ui": (0.3125, 0.79),
        "gradient": (0.74, 0.20),
        "satellite": (0.5, 0.5),
        "motion": (0.5, 0.5),
    }
    for platform in PLATFORMS:
        sheet = Image.new("RGB", (1920, 1600), "#181818")
        draw = ImageDraw.Draw(sheet)
        for index, content in enumerate(CONTENTS):
            naive = next(
                r
                for r in rows
                if r["platform"] == platform
                and r["content"] == content
                and r["variant"] == "naive"
                and r["multiplier"] == 1
            )
            fast = next(
                r
                for r in rows
                if r["platform"] == platform
                and r["content"] == content
                and r["variant"] == "fast"
                and r["multiplier"] == 1
            )
            for column, (label, path) in enumerate(
                [
                    ("reference", naive["reference"]),
                    ("naive", naive["playback"]),
                    ("ours", fast["playback"]),
                ]
            ):
                data = subprocess.check_output(
                    [
                        "ffmpeg",
                        "-v",
                        "error",
                        "-threads",
                        "2",
                        "-ss",
                        "1.5",
                        "-i",
                        path,
                        "-frames:v",
                        "1",
                        "-f",
                        "image2pipe",
                        "-vcodec",
                        "png",
                        "-",
                    ]
                )
                image = Image.open(io.BytesIO(data)).convert("RGB")
                w, h = image.size
                x, y = (0.84, 0.32) if content == "ui" and h > w else positions[content]
                left = min(w - 320, max(0, int(w * x) - 160))
                top = min(h - 180, max(0, int(h * y) - 90))
                crop = image.crop((left, top, left + 320, top + 180)).resize(
                    (640, 360), Image.Resampling.NEAREST
                )
                sheet.paste(crop, (column * 640, index * 400 + 32))
                draw.text(
                    (column * 640 + 8, index * 400 + 8),
                    f"{platform} / {content} / {label} / frame 45 / crop {left},{top} / 2x nearest",
                    fill="white",
                )
        sheet.save(out / f"{platform}-crops.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--sheets", type=Path)
    args = parser.parse_args()
    rows = json.loads((args.main / "results.json").read_text())
    summary, frames = aggregate(rows)
    args.evidence.mkdir(parents=True, exist_ok=True)
    (args.evidence / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (args.evidence / "results.json").write_text(json.dumps(rows, indent=2) + "\n")
    with (args.evidence / "frames.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(frames[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(frames)
    lines = [
        "# Generated measured tables",
        "",
        "Pooled p5 is the 5th percentile of all 360 frames per arm, not the mean of clip p5 values.",
        "",
        "| Platform | Naive mean / p5 | Ours mean / p5 | Gain mean / p5 | NEG gain mean / p5 |",
        "|---|---:|---:|---:|---:|",
    ]

    def pair(d):
        return f"{d['mean']:.3f} / {d['p5']:.3f}"

    for platform, s in summary.items():
        lines.append(
            f"| {platform} | {pair(s['naive']['vmaf'])} | {pair(s['fast']['vmaf'])} | {pair(s['gain']['vmaf'])} | {pair(s['gain']['vmaf_neg'])} |"
        )
    lines += [
        "",
        "| Platform | Content | Arm | VMAF mean / p5 | NEG mean / p5 | PSNR-Y dB | SSIM | CAMBI | Actual playback Mbps (container) |",
        "|---|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for r in rows:
        if r["variant"] not in ("naive", "fast") or r["multiplier"] != 1:
            continue
        m = r["metrics"]
        lines.append(
            f"| {r['platform']} | {r['content']} | {r['variant']} | {pair(m['vmaf'])} | {pair(m['vmaf_neg'])} | {m['psnr_y']['mean']:.3f} | {m['float_ssim']['mean']:.6f} | {m['cambi']['mean']:.4f} | {r['playback_bytes'] * 8 / r['duration'] / 1e6:.3f} |"
        )
    lines += [
        "",
        "| Platform (UI clip only) | NVENC seconds/minute | x264 seconds/minute | NVENC minus x264 VMAF mean / p5 |",
        "|---|---:|---:|---:|",
    ]
    for platform in PLATFORMS:
        f = next(
            r
            for r in rows
            if r["platform"] == platform
            and r["content"] == "ui"
            and r["variant"] == "fast"
            and r["multiplier"] == 1
        )
        s = next(
            r
            for r in rows
            if r["platform"] == platform
            and r["content"] == "ui"
            and r["variant"] == "software"
            and r["multiplier"] == 1
        )
        delta = {
            k: f["metrics"]["vmaf"][k] - s["metrics"]["vmaf"][k] for k in ("mean", "p5")
        }
        lines.append(
            f"| {platform} | {f['export_seconds_per_minute']:.2f} | {s['export_seconds_per_minute']:.2f} | {pair(delta)} |"
        )
    (args.evidence / "tables.md").write_text("\n".join(lines) + "\n")
    paths = set()
    for row in rows:
        for key in ("reference", "upload", "playback"):
            paths.add(Path(row[key]))
        paths.add(Path(row["playback"].replace("-playback.mp4", "-metrics.json")))
    manifest = []
    for path in sorted(paths):
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        manifest.append(
            {"path": str(path), "bytes": path.stat().st_size, "sha256": digest}
        )
    (args.evidence / "artifacts.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if args.sheets:
        crop_sheets(rows, args.sheets)
    print(
        json.dumps(
            {
                "cohort_rows": len(frames),
                "platforms": len(summary),
                "gains": {p: v["gain"]["vmaf"] for p, v in summary.items()},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
