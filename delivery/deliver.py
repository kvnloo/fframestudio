#!/usr/bin/env python3
"""Reproducible SDR delivery CLI. Python stdlib + FFmpeg/libvmaf only."""

import argparse
from fractions import Fraction
import json
from pathlib import Path
import subprocess
import time

HERE = Path(__file__).resolve().parent


def probe(path, count=False):
    args = ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json"]
    if count:
        args += ["-count_frames"]
    return json.loads(subprocess.check_output(args + [str(path)]))


def run(command, cwd=None):
    start = time.perf_counter()
    result = subprocess.run(
        [str(x) for x in command], capture_output=True, text=True, cwd=cwd
    )
    if result.returncode:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {command}\n{result.stderr}"
        )
    return {
        "command": [str(x) for x in command],
        "wall_seconds": time.perf_counter() - start,
    }


def video_filters(video, p):
    w, h, fps = p["width"], p["height"], Fraction(str(p["fps"]))
    source_fps = Fraction(video["avg_frame_rate"])
    mode = p["conform"]
    if mode == "blend":
        ratio = source_fps / fps
        if ratio.denominator != 1 or not 1 <= ratio <= 128:
            raise ValueError("Blend requires integral source/target ratio in [1,128]")
        n = int(ratio)
        temporal = (
            [
                f"tmix=frames={n}:weights=1",
                f"select=eq(mod(n\\,{n})\\,{n - 1})",
                f"setpts=N/({fps}*TB)",
            ]
            if n > 1
            else [f"fps={fps}"]
        )
    elif mode == "interpolate":
        temporal = [
            "tpad=stop_mode=clone:stop_duration=0.2",
            f"minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir",
        ]
    elif mode == "decimate":
        temporal = [f"fps={fps}"]
    else:
        raise ValueError("Unknown conform mode")
    matrix = video.get("color_space", "bt709")
    if matrix in ("unknown", "reserved", "gbr"):
        matrix = "bt709"
    # Explicit conversion before any sharpening or transfer-function scaling.
    filters = temporal + [
        f"scale=iw:ih:in_color_matrix={matrix}:out_color_matrix=bt709:out_range=tv",
        "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited",
    ]
    if p["prefilter"] == "denoise":
        filters += ["hqdn3d=1.2:0.9:1.5:1.2"]
    fit = p.get("fit", "pad")
    ratio = (max if fit == "crop" else min)(w / video["width"], h / video["height"])
    sw, sh = (
        max(2, round(video["width"] * ratio / 2) * 2),
        max(2, round(video["height"] * ratio / 2) * 2),
    )
    if p["scale"] == "linear":
        filters += [
            "zscale=transfer=linear:npl=100",
            "format=gbrpf32le",
            f"zscale=w={sw}:h={sh}:filter=lanczos",
            "zscale=transfer=bt709:matrix=bt709:range=limited",
            "format=yuv444p16le",
        ]
    else:
        if p["scale"] not in ("lanczos", "bicubic", "bilinear"):
            raise ValueError("Unknown scaler")
        filters += [f"scale={sw}:{sh}:flags={p['scale']}+full_chroma_int"]
    filters += [
        f"crop={w}:{h}" if fit == "crop" else f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"
    ]
    if p["prefilter"] == "cas":
        filters += ["cas=strength=0.15"]
    elif p["prefilter"] == "chroma":
        filters += ["format=yuv444p", "gblur=sigma=0.4:planes=6"]
    elif p["prefilter"] not in ("none", "denoise"):
        raise ValueError("Unknown prefilter")
    filters += [
        "setsar=1",
        "format=yuv420p10le"
        if p["encoder"] in ("hevc_nvenc", "libx265")
        else "format=yuv420p",
    ]
    return filters


def normalize_audio(source, start, duration, p):
    """Measure the selected audio interval before applying EBU R128 normalization."""
    import math

    base = f"loudnorm=I={p['audio_lufs']}:TP={p['audio_true_peak']}:LRA=11"
    command = [
        "ffmpeg",
        "-v",
        "info",
        "-ss",
        str(start),
        "-i",
        str(source),
        "-t",
        str(duration),
        "-vn",
        "-map",
        "0:a:0",
        "-af",
        "aformat=channel_layouts=stereo," + base + ":print_format=json",
        "-f",
        "null",
        "-",
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    begin = result.stderr.rfind("{")
    end = result.stderr.rfind("}") + 1
    data = json.loads(result.stderr[begin:end])
    if not all(
        math.isfinite(float(data[k]))
        for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
    ):
        return "anull", data  # Silence has no finite integrated loudness.
    mapping = {
        "measured_I": "input_i",
        "measured_TP": "input_tp",
        "measured_LRA": "input_lra",
        "measured_thresh": "input_thresh",
        "offset": "target_offset",
    }
    return "aformat=channel_layouts=stereo," + base + ":linear=true:" + ":".join(
        f"{k}={data[v]}" for k, v in mapping.items()
    ), data


def export(source, output, profile, start=0, duration=None):
    p = dict(profile)
    w, h, fps = p["width"], p["height"], Fraction(str(p["fps"]))
    if min(w, h) < 2 or w % 2 or h % 2 or fps <= 0:
        raise ValueError("Require positive even dimensions and positive fps")
    meta = probe(source)
    video = next(s for s in meta["streams"] if s["codec_type"] == "video")
    if video.get("color_transfer") in ("smpte2084", "arib-std-b67"):
        raise ValueError(
            "HDR input requires an explicit tone-map; refusing to mislabel as SDR"
        )
    filters = video_filters(video, p)
    if duration is None:
        duration = float(meta["format"]["duration"]) - start
    if start < 0 or duration <= 0:
        raise ValueError("Require nonnegative start and positive duration")
    audio_start = time.perf_counter()
    audio_filter, audio_analysis = ("anull", None)
    if any(s["codec_type"] == "audio" for s in meta["streams"]):
        audio_filter, audio_analysis = normalize_audio(source, start, duration, p)
    audio_wall = time.perf_counter() - audio_start
    encoder = p["encoder"]
    q = str(p["quality"])
    codec = ["-c:v", encoder]
    if encoder in ("h264_nvenc", "hevc_nvenc"):
        codec += [
            "-preset",
            "p6",
            "-tune",
            "hq",
            "-rc",
            "vbr",
            "-cq",
            q,
            "-b:v",
            "0",
            "-spatial-aq",
            "1",
            "-temporal-aq",
            "1",
            "-rc-lookahead",
            "20",
            "-no-scenecut",
            "1",
        ]
        if encoder == "hevc_nvenc":
            codec += ["-profile:v", "main10", "-tag:v", "hvc1"]
    elif encoder == "libx265":
        codec += [
            "-preset",
            "medium",
            "-crf",
            q,
            "-x265-params",
            "pools=4:frame-threads=2:scenecut=0:open-gop=0:log-level=error",
            "-tag:v",
            "hvc1",
        ]
    elif encoder == "libx264":
        codec += [
            "-preset",
            "medium",
            "-crf",
            q,
            "-sc_threshold",
            "0",
            "-x264-params",
            "open-gop=0",
        ]
    else:
        raise ValueError(f"Unsupported encoder {encoder}")
    codec += [
        "-maxrate",
        f"{p['maxrate_kbps']}k",
        "-bufsize",
        f"{p.get('bufsize_kbits', p['maxrate_kbps'] * 2)}k",
        "-g",
        str(max(1, round(float(fps) * p["gop_seconds"]))),
        "-bf",
        "2",
        "-flags",
        "+cgop",
    ]
    command = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-threads",
        "4",
        "-filter_threads",
        "2",
        "-ss",
        str(start),
        "-i",
        str(source),
    ]
    if duration is not None:
        command += ["-t", str(duration)]
    command += [
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        ",".join(filters),
        *codec,
        "-threads",
        "4",
        "-r",
        str(fps),
        "-fps_mode",
        "cfr",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        "-af",
        audio_filter,
        "-c:a",
        "aac",
        "-b:a",
        f"{p['audio_kbps']}k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        str(output),
    ]
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(str(output) + ".receipt.json").unlink(missing_ok=True)
    receipt = run(command)
    output_meta = probe(output, True)
    limit = p.get("max_upload_bitrate_kbps")
    output_video = next(s for s in output_meta["streams"] if s["codec_type"] == "video")
    if limit is not None and (
        "bit_rate" not in output_video or int(output_video["bit_rate"]) > limit * 1000
    ):
        raise ValueError(
            "Measured output video bitrate exceeds upload limit (or bitrate is unavailable); lower maxrate/bufsize"
        )
    receipt.update(
        {
            "profile": p,
            "input": str(source),
            "input_probe": meta,
            "output_probe": output_meta,
            "audio_analysis": audio_analysis,
            "audio_analysis_seconds": audio_wall,
        }
    )
    receipt["wall_seconds"] += audio_wall
    Path(str(output) + ".receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


def simulate(source, output, platform, multiplier=1.0):
    """Identical constrained-quality transcode for both treatment arms."""
    p = platform
    rate = round(p["bitrate_kbps"] * multiplier)
    args = [
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
        f"fps={p['fps']},scale={p['width']}:{p['height']}:flags=bicubic,setsar=1,format=yuv420p",
        "-c:v",
        p["codec"],
        "-b:v",
        f"{rate}k",
        "-maxrate",
        f"{rate}k",
        "-bufsize",
        f"{rate * 2}k",
        "-crf",
        str(p["crf"]),
        "-g",
        str(round(p["fps"] * p["gop_seconds"])),
        "-threads",
        "4",
    ]
    if p["codec"] == "libvpx-vp9":
        args += ["-deadline", "good", "-cpu-used", "4", "-row-mt", "1"]
    elif p["codec"] == "libx264":
        args += ["-preset", "medium", "-sc_threshold", "0"]
    elif p["codec"] == "libsvtav1":
        # SVT CRF mode forbids a nonzero target bitrate; maxrate supplies its cap.
        args[args.index("-b:v") + 1] = "0"
        args += ["-preset", "8", "-svtav1-params", "lp=4"]
    else:
        raise ValueError("Unsupported simulator codec")
    args += [
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
    receipt = run(args)
    receipt.update(
        {"platform": p, "multiplier": multiplier, "output_probe": probe(output, True)}
    )
    Path(str(output) + ".receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


def measure(distorted, reference, log):
    """Reject mismatched frame geometry/count/rate; score every aligned frame."""
    import statistics

    d = next(s for s in probe(distorted, True)["streams"] if s["codec_type"] == "video")
    r = next(s for s in probe(reference, True)["streams"] if s["codec_type"] == "video")
    for key in ("width", "height", "nb_read_frames", "avg_frame_rate"):
        if d[key] != r[key]:
            raise ValueError(f"Misaligned {key}: {d[key]} != {r[key]}")
    # Set common rational timestamps, never score with repeatlast padding.
    fps = Fraction(r["avg_frame_rate"])
    graph = f"[0:v]settb=AVTB,setpts=N/({fps}*TB)[d];[1:v]settb=AVTB,setpts=N/({fps}*TB)[r];[d][r]libvmaf=model=version=vmaf_v0.6.1\\\\:name=vmaf|version=vmaf_v0.6.1neg\\\\:name=vmaf_neg:feature=name=psnr|name=float_ssim|name=cambi:log_fmt=json:log_path=metrics.json:n_threads=4:shortest=1:repeatlast=0"
    # A fixed basename in an owned cwd avoids FFmpeg filter-graph path injection.
    import tempfile

    with tempfile.TemporaryDirectory(prefix="delivery-metric-") as tmp:
        receipt = run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-threads",
                "4",
                "-i",
                str(Path(distorted).resolve()),
                "-threads",
                "4",
                "-i",
                str(Path(reference).resolve()),
                "-filter_complex_threads",
                "2",
                "-lavfi",
                graph,
                "-an",
                "-f",
                "null",
                "-",
            ],
            cwd=tmp,
        )
        raw = (Path(tmp) / "metrics.json").read_text()
    data = json.loads(raw)
    Path(log).parent.mkdir(parents=True, exist_ok=True)
    Path(log).write_text(raw)
    Path(str(log) + ".receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    frames = data["frames"]
    if len(frames) != int(r["nb_read_frames"]):
        raise ValueError("Metric frame count does not match reference")
    summary = {"frames": len(frames), "wall_seconds": receipt["wall_seconds"]}
    for key in frames[0]["metrics"]:
        values = sorted(f["metrics"][key] for f in frames)
        pos = (len(values) - 1) * 0.05
        lo = int(pos)
        p5 = values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (
            pos - lo
        )
        summary[key] = {"mean": statistics.mean(values), "p5": p5}
    Path(str(log) + ".summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    exp = sub.add_parser("export")
    exp.add_argument("source")
    exp.add_argument("output")
    exp.add_argument(
        "--platform",
        choices=sorted(path.stem for path in (HERE / "profiles").glob("*.json")),
        required=True,
    )
    exp.add_argument("--profile", type=Path)
    for key, typ in [
        ("width", int),
        ("height", int),
        ("fps", str),
        ("encoder", str),
        ("quality", int),
    ]:
        exp.add_argument("--" + key, type=typ)
    exp.add_argument("--start", type=float, default=0)
    exp.add_argument("--duration", type=float)
    for key in ("conform", "scale", "prefilter", "fit"):
        exp.add_argument("--" + key)
    exp.add_argument("--maxrate-kbps", type=int)
    sim = sub.add_parser("simulate", help="UNVERIFIED playback approximation")
    sim.add_argument("source")
    sim.add_argument("output")
    sim.add_argument(
        "--platform",
        required=True,
        choices=sorted(json.loads((HERE / "platforms.json").read_text())["platforms"]),
    )
    sim.add_argument("--config", type=Path, default=HERE / "platforms.json")
    sim.add_argument("--multiplier", type=float, default=1)
    for key in ("width", "height", "fps"):
        sim.add_argument("--" + key, type=int)
    metric = sub.add_parser("measure")
    metric.add_argument("distorted")
    metric.add_argument("reference")
    metric.add_argument("--log", type=Path, required=True)
    args = parser.parse_args()
    if args.action == "measure":
        args.log.parent.mkdir(parents=True, exist_ok=True)
        print(json.dumps(measure(args.distorted, args.reference, args.log)))
        return
    if args.action == "simulate":
        p = json.loads(args.config.read_text())["platforms"][args.platform]
        for key in ("width", "height", "fps"):
            if getattr(args, key) is not None:
                p[key] = getattr(args, key)
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        receipt = simulate(args.source, args.output, p, args.multiplier)
        print(
            json.dumps({"output": args.output, "wall_seconds": receipt["wall_seconds"]})
        )
        return
    p = json.loads(
        (args.profile or HERE / "profiles" / f"{args.platform}.json").read_text()
    )
    for key in (
        "width",
        "height",
        "fps",
        "encoder",
        "quality",
        "conform",
        "scale",
        "prefilter",
        "fit",
        "maxrate_kbps",
    ):
        if getattr(args, key) is not None:
            p[key] = getattr(args, key)
    receipt = export(args.source, args.output, p, args.start, args.duration)
    print(json.dumps({"output": args.output, "wall_seconds": receipt["wall_seconds"]}))


if __name__ == "__main__":
    main()
