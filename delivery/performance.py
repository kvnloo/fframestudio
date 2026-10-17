#!/usr/bin/env python3
"""Measure complete export calls on a looped real UI reference, without a simulator."""

import argparse
import json
import os
from pathlib import Path
import time
from deliver import export, probe, run


def benchmark(main, out, duration=60, repeats=1, platforms=None, encoders=None):
    platforms = platforms or ["youtube", "shorts", "tiktok", "reels", "x"]
    encoders = encoders or ["h264_nvenc", "libx264"]
    if duration <= 0 or repeats < 1:
        raise ValueError("Require positive duration and repeats")
    out.mkdir(parents=True, exist_ok=True)
    cohort = json.loads((main / "results.json").read_text())
    rows = []
    for platform in platforms:
        matches = [
            r
            for r in cohort
            if r["platform"] == platform
            and r["content"] == "ui"
            and r["variant"] == "fast"
        ]
        if len(matches) != 1:
            raise ValueError(f"Require one selected UI reference for {platform}")
        source = matches[0]
        loop = out / f"{platform}-loop.mkv"
        prep = run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-stream_loop",
                "-1",
                "-i",
                source["reference"],
                "-an",
                "-t",
                str(duration),
                "-c:v",
                "copy",
                str(loop),
            ]
        )
        Path(str(loop) + ".receipt.json").write_text(json.dumps(prep, indent=2) + "\n")
        for encoder in encoders:
            p = dict(source["profile"], encoder=encoder)
            export(
                loop,
                out / f"{platform}-{encoder}-warmup.mp4",
                p,
                duration=min(3, duration),
            )
            for repeat in range(repeats):
                output = out / f"{platform}-{encoder}-{repeat}.mp4"
                load = os.getloadavg()
                started = time.perf_counter()
                receipt = export(loop, output, p, duration=duration)
                elapsed = time.perf_counter() - started
                frames = int(probe(output, True)["streams"][0]["nb_read_frames"])
                if frames != round(duration * float(p["fps"])):
                    raise ValueError("Performance output frame count mismatch")
                row = {
                    "platform": platform,
                    "encoder": encoder,
                    "repeat": repeat,
                    "duration": duration,
                    "frames": frames,
                    "profile": p,
                    "input": str(loop),
                    "output": str(output),
                    "load_average_at_start": load,
                    "encode_seconds_per_minute": receipt["wall_seconds"]
                    / duration
                    * 60,
                    "end_to_end_seconds_per_minute": elapsed / duration * 60,
                    "input_preparation_seconds_excluded": prep["wall_seconds"],
                    "caveat": "Looped UI, warm cache, no audio, shared host. Not a production capacity estimate.",
                }
                rows.append(row)
                (out / "performance.json").write_text(json.dumps(rows, indent=2) + "\n")
                print(
                    json.dumps(
                        {
                            k: row[k]
                            for k in (
                                "platform",
                                "encoder",
                                "repeat",
                                "frames",
                                "end_to_end_seconds_per_minute",
                            )
                        }
                    ),
                    flush=True,
                )
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--duration", type=float, default=60)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--platforms", default="youtube,shorts,tiktok,reels,x")
    parser.add_argument("--encoders", default="h264_nvenc,libx264")
    args = parser.parse_args()
    benchmark(
        args.main,
        args.out,
        args.duration,
        args.repeats,
        args.platforms.split(","),
        args.encoders.split(","),
    )


if __name__ == "__main__":
    main()
