#!/usr/bin/env python3
"""Small real-source qualification, not platform calibration or a universal quality claim."""

import argparse
import hashlib
import json
from pathlib import Path
from deliver import HERE, export, measure, probe, run, simulate

# The four benchmark clips are local media, not part of the repo. Put their paths in
# delivery/sources.local.json (gitignored), same keys as below: {"ui": {"path": ..., "start": 8}, ...}.
# Kinds used in REPORT.md: ui = screen-recording film master, gradient = themed UI film with gradients,
# satellite = JPEG sequence of a 3D globe fly-through, motion = 540 fps 4K render.
_LOCAL = HERE / "sources.local.json"
SOURCES = json.loads(_LOCAL.read_text()) if _LOCAL.exists() else {
    "ui": {"path": "ui-master.mkv", "start": 8},
    "gradient": {"path": "gradient-master.mkv", "start": 14},
    "satellite": {"path": "satellite/%04d.jpg", "start": 0, "sequence": True},
    "motion": {"path": "motion-540fps-4k.mp4", "start": 8},
}
VARIANTS = {
    "naive": {"encoder": "libx264", "quality": 23, "scale": "bicubic"},
    "fast": {"encoder": "h264_nvenc", "quality": 14},
    "fast_unfiltered": {"encoder": "h264_nvenc", "quality": 14, "prefilter": "none"},
    "software_unfiltered": {"encoder": "libx264", "quality": 14, "prefilter": "none"},
    "software": {"encoder": "libx264", "quality": 14},
    "hevc10": {"encoder": "hevc_nvenc", "quality": 14},
    "cas": {"encoder": "h264_nvenc", "quality": 14, "prefilter": "cas"},
    "denoise": {"encoder": "h264_nvenc", "quality": 14, "prefilter": "denoise"},
    "chroma": {"encoder": "h264_nvenc", "quality": 14, "prefilter": "chroma"},
    "linear": {
        "encoder": "h264_nvenc",
        "quality": 14,
        "scale": "linear",
        "prefilter": "cas",
    },
    "up1440": {"encoder": "h264_nvenc", "quality": 14, "width": 2560, "height": 1440},
    "up2160": {"encoder": "h264_nvenc", "quality": 14, "width": 3840, "height": 2160},
    "x265": {"encoder": "libx265", "quality": 14},
}


def preparation(source, width, height, duration):
    return {
        "version": 2,
        "source": source,
        "width": width,
        "height": height,
        "duration": duration,
    }


def reference(source, output, width, height, duration):
    args = ["ffmpeg", "-y", "-v", "error", "-threads", "4", "-filter_threads", "2"]
    if source.get("sequence"):
        args += ["-framerate", "30", "-start_number", "0"]
    else:
        args += ["-ss", str(source["start"])]
    args += ["-i", source["path"], "-t", str(duration), "-an"]
    probe_source = source["path"] % 0 if source.get("sequence") else source["path"]
    matrix = probe(probe_source)["streams"][0].get("color_space", "bt709")
    # All source references are identical in both arms: same center crop, transfer, time sampling.
    args += [
        "-vf",
        f"fps=30,scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos:in_color_matrix={matrix}:out_color_matrix=bt709:out_range=tv,crop={width}:{height},setsar=1,format=yuv420p",
        "-c:v",
        "ffv1",
        "-level",
        "3",
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
    receipt = run(args)
    with open(output, "rb") as stream:
        receipt["sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
    receipt["probe"] = probe(output, True)
    receipt["preparation"] = preparation(source, width, height, duration)
    Path(str(output) + ".receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--platforms", default="youtube,shorts,tiktok,reels,x")
    parser.add_argument("--contents", default=",".join(SOURCES))
    parser.add_argument("--variants", default="naive,fast")
    parser.add_argument("--duration", type=float, default=3)
    parser.add_argument("--multiplier", type=float, default=1)
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    platforms = json.loads((HERE / "platforms.json").read_text())["platforms"]
    sources = dict(SOURCES)
    if args.smoke:
        src = out / "fixture.mkv"
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
                str(src),
            ]
        )
        sources = {"fixture": {"path": str(src), "start": 0}}
        args.contents = "fixture"
        args.platforms = "x"
        args.variants = "naive,software"
        args.duration = 1
        platforms["x"].update(width=320, height=240)
    results_path = out / "results.json"
    results = json.loads(results_path.read_text()) if results_path.exists() else []
    for name in args.platforms.split(","):
        sim = platforms[name]
        for content in args.contents.split(","):
            ref = out / f"ref-{content}-{sim['width']}x{sim['height']}.mkv"
            if not ref.exists() or not Path(str(ref) + ".receipt.json").exists():
                reference(
                    sources[content], ref, sim["width"], sim["height"], args.duration
                )
            cached = json.loads(Path(str(ref) + ".receipt.json").read_text())
            if cached.get("preparation") != preparation(
                sources[content], sim["width"], sim["height"], args.duration
            ):
                raise ValueError(
                    "Stale reference preparation; use a fresh --out directory"
                )
            with ref.open("rb") as stream:
                if (
                    hashlib.file_digest(stream, "sha256").hexdigest()
                    != cached["sha256"]
                ):
                    raise ValueError(
                        "Stale reference hash; use a fresh --out directory"
                    )
            for variant in args.variants.split(","):
                profile = json.loads((HERE / "profiles" / f"{name}.json").read_text())
                profile.update(width=sim["width"], height=sim["height"], fit="crop")
                profile.update(VARIANTS[variant])
                if variant == "naive":
                    # Freeze the NLE baseline independently of winning recipe edits.
                    profile.update(
                        prefilter="none",
                        maxrate_kbps=8000 if name == "x" else 25000,
                        bufsize_kbits=16000 if name == "x" else 50000,
                        max_upload_bitrate_kbps=None,
                    )
                identity = {
                    "platform": name,
                    "content": content,
                    "variant": variant,
                    "profile": profile,
                    "simulator": sim,
                    "multiplier": args.multiplier,
                    "duration": args.duration,
                    "reference_sha256": json.loads(
                        Path(str(ref) + ".receipt.json").read_text()
                    )["sha256"],
                }
                signature = hashlib.sha256(
                    json.dumps(identity, sort_keys=True).encode()
                ).hexdigest()
                if any(r["signature"] == signature for r in results):
                    continue
                stem = (
                    f"{name}-{content}-{variant}-{args.multiplier:g}-{signature[:12]}"
                )
                upload = out / f"{stem}-upload.mp4"
                playback = out / f"{stem}-playback.mp4"
                enc = export(ref, upload, profile, duration=args.duration)
                trans = simulate(upload, playback, sim, args.multiplier)
                metric = measure(playback, ref, out / f"{stem}-metrics.json")
                row = {
                    **identity,
                    "signature": signature,
                    "metrics": metric,
                    "export_wall_seconds": enc["wall_seconds"],
                    "export_seconds_per_minute": enc["wall_seconds"]
                    / args.duration
                    * 60,
                    "sim_wall_seconds": trans["wall_seconds"],
                    "upload_bytes": upload.stat().st_size,
                    "playback_bytes": playback.stat().st_size,
                    "upload": str(upload),
                    "playback": str(playback),
                    "reference": str(ref),
                }
                results.append(row)
                results_path.write_text(json.dumps(results, indent=2) + "\n")
                print(
                    json.dumps(
                        {
                            "platform": name,
                            "content": content,
                            "variant": variant,
                            "vmaf": metric["vmaf"],
                            "neg": metric["vmaf_neg"],
                            "sec_per_min": row["export_seconds_per_minute"],
                        }
                    ),
                    flush=True,
                )
    print(f"{len(results)} verified rows in {results_path}", flush=True)


if __name__ == "__main__":
    main()
