#!/usr/bin/env python3
"""Separate intent-aware temporal experiment. Does not choose a blur winner by self-reference."""

import argparse
import json
from pathlib import Path
import statistics
import subprocess
from deliver import HERE, export, measure, probe, run, simulate, video_filters


def lossless(source, output, filters, fps, duration):
    return run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-threads",
            "4",
            "-filter_threads",
            "2",
            "-i",
            str(source),
            "-an",
            "-vf",
            ",".join(filters),
            "-t",
            str(duration),
            "-r",
            str(fps),
            "-c:v",
            "ffv1",
            "-threads",
            "4",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
            str(output),
        ]
    )


def temporal_residual(distorted, reference):
    """Temporal derivative error, not a perceptual flicker score; 160x90 luma proxy."""

    def frames(path):
        raw = subprocess.check_output(
            [
                "ffmpeg",
                "-v",
                "error",
                "-threads",
                "2",
                "-i",
                str(path),
                "-vf",
                "scale=160:90,format=gray",
                "-f",
                "rawvideo",
                "-",
            ]
        )
        return [raw[i : i + 14400] for i in range(0, len(raw), 14400)]

    a, b = frames(distorted), frames(reference)
    if len(a) != len(b):
        raise ValueError("Temporal frame count mismatch")
    errors = [
        sum(
            abs((x - y) - (u - v)) for x, y, u, v in zip(a[i], a[i - 1], b[i], b[i - 1])
        )
        / 14400
        for i in range(1, len(a))
    ]
    return {
        "mean_delta_error_8bit": statistics.mean(errors),
        "max_delta_error_8bit": max(errors),
    }


def temporal(out, smoke=False, pan_stress=False):
    out.mkdir(parents=True, exist_ok=True)
    high = out / "high-fps.mkv"
    w, h = (320, 240) if smoke else (960, 540)
    sourcefps = 120 if smoke else 540
    duration = 1
    args = ["ffmpeg", "-y", "-v", "error", "-threads", "4", "-filter_threads", "2"]
    if smoke:
        args += ["-f", "lavfi", "-i", "testsrc2=s=320x240:r=120:d=1"]
    else:
        args += [
            "-ss",
            "8",
            "-i",
            __import__("benchmark").SOURCES["motion"]["path"],
        ]
    args += [
        "-t",
        str(duration),
        "-an",
        "-vf",
        (
            "crop=iw/2:ih/2:x=(iw-ow)/2+(iw-ow)/16*sin(2*PI*t):y=(ih-oh)/2,"
            if pan_stress
            else ""
        )
        + f"scale={w}:{h}:flags=lanczos,format=yuv420p",
        "-c:v",
        "ffv1",
        "-threads",
        "4",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        str(high),
    ]
    source_receipt = run(args)
    (out / "source.receipt.json").write_text(
        json.dumps(source_receipt, indent=2) + "\n"
    )
    rows = []
    for fps in [30] if smoke else [30, 60]:
        p = json.loads((HERE / "profiles/youtube.json").read_text())
        p.update(
            width=w,
            height=h,
            fps=fps,
            encoder="libx264" if smoke else "h264_nvenc",
            quality=14,
        )
        refs = {}
        for mode in ("decimate", "blend"):
            p["conform"] = mode
            path = out / f"reference-{mode}-{fps}.mkv"
            lossless(
                high, path, video_filters(probe(high)["streams"][0], p), fps, duration
            )
            refs[mode] = path
        sparse = out / f"sparse-{fps}.mkv"
        lossless(
            refs["decimate"],
            sparse,
            ["select='not(mod(n,2))'", f"setpts=N/({fps / 2}*TB)"],
            fps / 2,
            duration,
        )
        for mode in ("decimate", "blend", "interpolate"):
            p["conform"] = mode
            upload = out / f"{mode}-{fps}-upload.mp4"
            playback = out / f"{mode}-{fps}-playback.mp4"
            enc = export(
                sparse if mode == "interpolate" else high, upload, p, duration=duration
            )
            sim = {
                "width": w,
                "height": h,
                "fps": fps,
                "codec": "libx264",
                "bitrate_kbps": 1500,
                "crf": 25,
                "gop_seconds": 2,
            }
            simulate(upload, playback, sim)
            box = measure(playback, refs["blend"], out / f"{mode}-{fps}-box.json")
            instant = measure(
                playback, refs["decimate"], out / f"{mode}-{fps}-instant.json"
            )
            row = {
                "mode": mode,
                "pan_stress": pan_stress,
                "source_fps": sourcefps if mode != "interpolate" else fps / 2,
                "fps": fps,
                "width": w,
                "height": h,
                "duration": duration,
                "box_metrics": box,
                "instant_metrics": instant,
                "temporal_vs_box": temporal_residual(playback, refs["blend"]),
                "export_seconds_per_minute": enc["wall_seconds"] / duration * 60,
                "playback": str(playback),
            }
            rows.append(row)
            (out / "temporal.json").write_text(json.dumps(rows, indent=2) + "\n")
            print(
                json.dumps(
                    {
                        k: row[k]
                        for k in (
                            "mode",
                            "fps",
                            "temporal_vs_box",
                            "export_seconds_per_minute",
                        )
                    }
                ),
                flush=True,
            )
    return rows


def lowres(out, main_dir, smoke=False):
    """Compare at ORIGINAL resolution after identical bicubic playback upscaling."""
    out.mkdir(parents=True, exist_ok=True)
    duration = 1 if smoke else 3
    contents = ["fixture"] if smoke else ["ui", "satellite"]
    if smoke:
        run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x240:r=30:d=1",
                "-c:v",
                "ffv1",
                str(main_dir / "ref-fixture-320x240.mkv"),
            ]
        )
    rows = []
    variants = {
        "naive": {
            "quality": 23,
            "encoder": "libx264",
            "scale": "bicubic",
            "prefilter": "none",
        },
        "matched_bicubic": {"scale": "bicubic", "prefilter": "none"},
        "lanczos_cas": {"scale": "lanczos", "prefilter": "cas"},
        "linear_cas": {"scale": "linear", "prefilter": "cas"},
    }
    for content in contents:
        source = main_dir / f"ref-{content}-1920x1080.mkv"
        if smoke:
            source = main_dir / "ref-fixture-320x240.mkv"
        original = probe(source)["streams"][0]
        for width, height in [(160, 120)] if smoke else [(1280, 720), (854, 480)]:
            for variant, overrides in variants.items():
                p = json.loads((HERE / "profiles/x.json").read_text())
                p.update(
                    width=width,
                    height=height,
                    encoder="libx264" if smoke else "h264_nvenc",
                    quality=14,
                    fit="pad",
                )
                p.update(overrides)
                stem = f"{content}-{height}-{variant}"
                upload = out / f"{stem}-upload.mp4"
                playback = out / f"{stem}-playback.mp4"
                view = out / f"{stem}-view.mkv"
                enc = export(source, upload, p, duration=duration)
                sim = {
                    "width": width,
                    "height": height,
                    "fps": 30,
                    "codec": "libx264",
                    "bitrate_kbps": 2000 if height >= 720 else 1000,
                    "crf": 25,
                    "gop_seconds": 2,
                }
                simulate(upload, playback, sim)
                lossless(
                    playback,
                    view,
                    [
                        f"scale={original['width']}:{original['height']}:flags=bicubic",
                        "setsar=1",
                    ],
                    30,
                    duration,
                )
                metrics = measure(view, source, out / f"{stem}-metrics.json")
                row = {
                    "content": content,
                    "height": height,
                    "variant": variant,
                    "profile": p,
                    "simulator": sim,
                    "metrics": metrics,
                    "export_seconds_per_minute": enc["wall_seconds"] / duration * 60,
                    "playback": str(playback),
                    "reference": str(source),
                }
                rows.append(row)
                (out / "lowres.json").write_text(json.dumps(rows, indent=2) + "\n")
                print(
                    json.dumps(
                        {
                            "content": content,
                            "height": height,
                            "variant": variant,
                            "vmaf": metrics["vmaf"],
                            "neg": metrics["vmaf_neg"],
                        }
                    ),
                    flush=True,
                )
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment", choices=["temporal", "lowres"])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--main-dir", type=Path)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument(
        "--pan-stress",
        action="store_true",
        help="Add a labeled synthetic pan to real high-rate frames",
    )
    args = parser.parse_args()
    if args.experiment == "temporal":
        temporal(args.out.resolve(), args.smoke, args.pan_stress)
    else:
        if not args.main_dir and not args.smoke:
            parser.error("--main-dir is required for lowres")
        lowres(args.out.resolve(), args.main_dir or args.out.resolve(), args.smoke)


if __name__ == "__main__":
    main()
