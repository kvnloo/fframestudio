"""Behavioral tests; run: python -m unittest discover -s delivery -v."""

import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
import json

HERE = pathlib.Path(__file__).parent


class DeliveryTest(unittest.TestCase):
    def test_export_real_video(self):
        cli = HERE / "deliver.py"
        self.assertTrue(cli.exists(), "delivery CLI has not been implemented")
        with tempfile.TemporaryDirectory() as tmp:
            source, output = (
                pathlib.Path(tmp) / "source.mkv",
                pathlib.Path(tmp) / "output.mp4",
            )
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=160x90:r=60:d=1",
                    "-c:v",
                    "ffv1",
                    str(source),
                ],
                check=True,
            )
            subprocess.run(
                [
                    "python",
                    str(cli),
                    "export",
                    str(source),
                    str(output),
                    "--platform",
                    "x",
                    "--encoder",
                    "libx264",
                    "--width",
                    "160",
                    "--height",
                    "90",
                    "--fps",
                    "30",
                ],
                check=True,
            )
            data = json.loads(
                subprocess.check_output(
                    [
                        "ffprobe",
                        "-v",
                        "error",
                        "-count_frames",
                        "-show_streams",
                        "-of",
                        "json",
                        str(output),
                    ]
                )
            )["streams"][0]
            self.assertEqual(data["nb_read_frames"], "30")
            self.assertEqual(data["color_space"], "bt709")
            self.assertEqual(data["pix_fmt"], "yuv420p")
            self.assertTrue(output.with_suffix(".mp4.receipt.json").exists())

    def test_simulator_metrics_real_frames(self):
        import deliver

        self.assertTrue(hasattr(deliver, "simulate"), "simulator not implemented")
        with tempfile.TemporaryDirectory() as tmp:
            source, output = (
                pathlib.Path(tmp) / "source.mkv",
                pathlib.Path(tmp) / "sim.mp4",
            )
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=320x240:r=30:d=1",
                    "-c:v",
                    "ffv1",
                    str(source),
                ],
                check=True,
            )
            p = {
                "width": 320,
                "height": 240,
                "fps": 30,
                "codec": "libx264",
                "bitrate_kbps": 300,
                "crf": 26,
                "gop_seconds": 2,
            }
            deliver.simulate(source, output, p)
            metrics = deliver.measure(
                output, source, pathlib.Path(tmp) / "metrics.json"
            )
            self.assertEqual(metrics["frames"], 30)
            self.assertGreater(metrics["vmaf"]["mean"], 30)
            self.assertLess(metrics["vmaf"]["mean"], 100)
            self.assertIn("vmaf_neg", metrics)
            self.assertIn("cambi", metrics)
            self.assertIn("psnr_y", metrics)
            self.assertIn("float_ssim", metrics)

    def test_treatments_and_temporal_conform(self):
        import deliver

        self.assertTrue(hasattr(deliver, "video_filters"), "treatments not implemented")
        with tempfile.TemporaryDirectory() as tmp:
            source = pathlib.Path(tmp) / "source.mkv"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=320x240:r=60:d=1",
                    "-c:v",
                    "ffv1",
                    str(source),
                ],
                check=True,
            )
            p = json.loads((HERE / "profiles/x.json").read_text())
            p.update(width=160, height=120, fps=30, encoder="libx264")
            for conform, scale, filt, encoder in [
                ("blend", "lanczos", "cas", "libx264"),
                ("decimate", "linear", "chroma", "libx264"),
                ("interpolate", "lanczos", "denoise", "libx264"),
                ("decimate", "lanczos", "none", "libx265"),
            ]:
                p.update(conform=conform, scale=scale, prefilter=filt, encoder=encoder)
                output = pathlib.Path(tmp) / f"{conform}-{scale}-{encoder}.mp4"
                deliver.export(source, output, p, duration=1)
                stream = deliver.probe(output, True)["streams"][0]
                self.assertEqual(stream["nb_read_frames"], "30")
                self.assertEqual(stream["width"], 160)
            p.update(fps=24, conform="blend")
            with self.assertRaises(ValueError):
                deliver.export(source, pathlib.Path(tmp) / "bad.mp4", p)

    def test_benchmark_smoke(self):
        script = HERE / "benchmark.py"
        self.assertTrue(script.exists(), "reproducible benchmark not implemented")
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["python", str(script), "--out", tmp, "--smoke"], check=True)
            rows = json.loads((pathlib.Path(tmp) / "results.json").read_text())
            self.assertEqual(len(rows), 2)
            self.assertEqual({r["variant"] for r in rows}, {"naive", "software"})
            self.assertTrue(all(r["metrics"]["frames"] == 30 for r in rows))
            naive = next(r for r in rows if r["variant"] == "naive")
            self.assertEqual(naive["profile"]["prefilter"], "none")
            self.assertEqual(naive["profile"]["bufsize_kbits"], 16000)
            receipt_path = pathlib.Path(rows[0]["reference"] + ".receipt.json")
            receipt = json.loads(receipt_path.read_text())
            receipt["preparation"] = {}
            receipt_path.write_text(json.dumps(receipt))
            stale = subprocess.run(
                ["python", str(script), "--out", tmp, "--smoke"],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(
                stale.returncode,
                0,
                "must not reuse references from a stale preparation recipe",
            )
            self.assertIn("stale", stale.stderr.lower())

    def test_public_cli_simulate_measure_and_invalid_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, playback, log = [
                pathlib.Path(tmp) / n for n in ("src.mkv", "sim.mp4", "metric.json")
            ]
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=320x240:r=30:d=1",
                    "-c:v",
                    "ffv1",
                    str(source),
                ],
                check=True,
            )
            result = subprocess.run(
                [
                    "python",
                    str(HERE / "deliver.py"),
                    "simulate",
                    str(source),
                    str(playback),
                    "--platform",
                    "x",
                    "--width",
                    "320",
                    "--height",
                    "240",
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            subprocess.run(
                [
                    "python",
                    str(HERE / "deliver.py"),
                    "measure",
                    str(playback),
                    str(source),
                    "--log",
                    str(log),
                ],
                check=True,
            )
            self.assertEqual(len(json.loads(log.read_text())["frames"]), 30)
            result = subprocess.run(
                [
                    "python",
                    str(HERE / "deliver.py"),
                    "export",
                    str(source),
                    str(pathlib.Path(tmp) / "bad.mp4"),
                    "--platform",
                    "x",
                    "--width",
                    "321",
                ],
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((pathlib.Path(tmp) / "bad.mp4").exists())

    def test_audio_two_pass(self):
        import deliver

        self.assertTrue(
            hasattr(deliver, "normalize_audio"),
            "two-pass normalization not implemented",
        )
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / "tone.mkv"
            dst = pathlib.Path(tmp) / "normalized.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=160x120:r=30:d=4",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=1000:duration=4",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=500:duration=4,volume=0.1",
                    "-map",
                    "0:v",
                    "-map",
                    "1:a",
                    "-map",
                    "2:a",
                    "-disposition:a:0",
                    "0",
                    "-disposition:a:1",
                    "default",
                    "-c:v",
                    "ffv1",
                    "-c:a",
                    "pcm_s16le",
                    str(src),
                ],
                check=True,
            )
            p = json.loads((HERE / "profiles/x.json").read_text())
            p.update(width=160, height=120, encoder="libx264")
            receipt = deliver.export(src, dst, p)
            self.assertIn("audio_analysis", receipt)
            self.assertGreater(
                float(receipt["audio_analysis"]["input_i"]),
                -30,
                "measure the first exported track, not the quieter default track",
            )
            analysis = deliver.normalize_audio(dst, 0, 4, p)[1]
            self.assertAlmostEqual(float(analysis["input_i"]), -14, delta=0.5)
            self.assertLessEqual(float(analysis["input_tp"]), -1.0)

    def test_experiments_smoke(self):
        script = HERE / "experiments.py"
        self.assertTrue(script.exists(), "ablation harness not implemented")
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(
                ["python", str(script), "temporal", "--out", tmp, "--smoke"], check=True
            )
            rows = json.loads((pathlib.Path(tmp) / "temporal.json").read_text())
            self.assertEqual(len(rows), 3)
            self.assertTrue(all(r["box_metrics"]["frames"] == 30 for r in rows))
            hashes = []
            for name in ("reference-decimate-30.mkv", "sparse-30.mkv"):
                hashes.append(
                    subprocess.check_output(
                        [
                            "ffmpeg",
                            "-v",
                            "error",
                            "-i",
                            str(pathlib.Path(tmp) / name),
                            "-frames:v",
                            "1",
                            "-f",
                            "hash",
                            "-hash",
                            "sha256",
                            "-",
                        ]
                    )
                )
            self.assertEqual(
                hashes[0],
                hashes[1],
                "interpolation and its reference need the same sampling phase",
            )

    def test_low_resolution_smoke(self):
        import experiments

        self.assertTrue(
            hasattr(experiments, "lowres"), "low resolution ablation not implemented"
        )
        with tempfile.TemporaryDirectory() as tmp:
            rows = experiments.lowres(pathlib.Path(tmp), pathlib.Path(tmp), smoke=True)
            self.assertEqual(len(rows), 4)
            self.assertTrue(all(r["metrics"]["frames"] == 30 for r in rows))
            self.assertTrue(
                all(
                    r["profile"]["prefilter"] == "none"
                    for r in rows
                    if r["variant"] in ("naive", "matched_bicubic")
                )
            )

    def test_metric_path_and_alignment(self):
        import deliver

        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / "src.mkv"
            short = pathlib.Path(tmp) / "short.mkv"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=320x240:r=30:d=1",
                    "-c:v",
                    "ffv1",
                    str(src),
                ],
                check=True,
            )
            metrics = deliver.measure(
                src, src, pathlib.Path(tmp) / "odd: ' [name].json"
            )
            self.assertEqual(metrics["frames"], 30)
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(src),
                    "-t",
                    "0.5",
                    "-c:v",
                    "ffv1",
                    str(short),
                ],
                check=True,
            )
            with self.assertRaises(ValueError):
                deliver.measure(short, src, pathlib.Path(tmp) / "bad.json")

    def test_aggregation_rejects_incomplete_cohort(self):
        spec = importlib.util.find_spec("summarize")
        self.assertIsNotNone(spec, "cohort aggregator not implemented")
        import summarize

        with self.assertRaises(ValueError):
            summarize.aggregate([], ["youtube"], ["ui"])
        self.assertEqual(summarize.stats([1, 2, 3])["mean"], 2)
        self.assertAlmostEqual(summarize.stats([1, 2, 3])["p5"], 1.1)

    def test_nvenc_fixed_gop_real_gradient(self):
        import os
        import deliver

        source = pathlib.Path(os.environ.get("DELIVERY_GRADIENT_REF", "ref-gradient-1920x1080.mkv"))
        if os.environ.get("DELIVERY_TEST_NVENC") != "1" or not source.exists():
            self.skipTest(
                "opt-in NVENC integration requires the real gradient reference"
            )
        with tempfile.TemporaryDirectory() as tmp:
            output = pathlib.Path(tmp) / "fixed.mp4"
            p = json.loads((HERE / "profiles/youtube.json").read_text())
            deliver.export(source, output, p, duration=3)
            frames = json.loads(
                subprocess.check_output(
                    [
                        "ffprobe",
                        "-v",
                        "error",
                        "-select_streams",
                        "v:0",
                        "-show_frames",
                        "-show_entries",
                        "frame=key_frame",
                        "-of",
                        "json",
                        str(output),
                    ]
                )
            )["frames"]
            self.assertEqual(
                [i for i, f in enumerate(frames) if f["key_frame"]],
                list(range(0, 90, 15)),
            )

    def test_temporal_pan_fixture(self):
        import inspect
        import experiments

        self.assertIn("pan_stress", inspect.signature(experiments.temporal).parameters)
        with tempfile.TemporaryDirectory() as tmp:
            rows = experiments.temporal(pathlib.Path(tmp), smoke=True, pan_stress=True)
            self.assertEqual(len(rows), 3)
            self.assertTrue(all(r["pan_stress"] for r in rows))

    def test_custom_high_output_rate(self):
        import deliver

        with tempfile.TemporaryDirectory() as tmp:
            source = pathlib.Path(tmp) / "src.mkv"
            output = pathlib.Path(tmp) / "high.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=160x120:r=30:d=1",
                    "-c:v",
                    "ffv1",
                    str(source),
                ],
                check=True,
            )
            p = json.loads((HERE / "profiles/x.json").read_text())
            p.update(width=160, height=120, fps=300, encoder="libx264")
            deliver.export(source, output, p, duration=0.1)
            self.assertEqual(
                deliver.probe(output, True)["streams"][0]["nb_read_frames"], "30"
            )

    def test_measured_upload_limit_rejects_overshoot(self):
        import deliver

        with tempfile.TemporaryDirectory() as tmp:
            source = pathlib.Path(tmp) / "src.mkv"
            output = pathlib.Path(tmp) / "limited.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=160x120:r=30:d=1",
                    "-c:v",
                    "ffv1",
                    str(source),
                ],
                check=True,
            )
            p = json.loads((HERE / "profiles/x.json").read_text())
            p.update(width=160, height=120, encoder="libx264")
            deliver.export(source, output, p)
            p["max_upload_bitrate_kbps"] = 1
            with self.assertRaises(ValueError):
                deliver.export(source, output, p)
            self.assertFalse(pathlib.Path(str(output) + ".receipt.json").exists())

    def test_jpeg_reference_converts_601_to_709(self):
        import benchmark

        with tempfile.TemporaryDirectory() as tmp:
            frame = pathlib.Path(tmp) / "0000.jpg"
            output = pathlib.Path(tmp) / "ref.mkv"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=red:s=320x240:d=0.1",
                    "-frames:v",
                    "1",
                    str(frame),
                ],
                check=True,
            )
            benchmark.reference(
                {
                    "path": str(pathlib.Path(tmp) / "%04d.jpg"),
                    "start": 0,
                    "sequence": True,
                },
                output,
                320,
                240,
                1 / 30,
            )
            rgb = subprocess.check_output(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(output),
                    "-frames:v",
                    "1",
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "-",
                ]
            )
            self.assertLess(
                rgb[1], 5, "red JPEG acquires green when its BT.601 matrix is ignored"
            )

    def test_av1_simulator(self):
        import deliver

        with tempfile.TemporaryDirectory() as tmp:
            source = pathlib.Path(tmp) / "src.mkv"
            output = pathlib.Path(tmp) / "av1.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=320x240:r=30:d=1",
                    "-c:v",
                    "ffv1",
                    str(source),
                ],
                check=True,
            )
            p = {
                "width": 320,
                "height": 240,
                "fps": 30,
                "codec": "libsvtav1",
                "bitrate_kbps": 500,
                "crf": 30,
                "gop_seconds": 2,
            }
            deliver.simulate(source, output, p)
            stream = deliver.probe(output, True)["streams"][0]
            self.assertEqual(stream["codec_name"], "av1")
            self.assertEqual(stream["nb_read_frames"], "30")

    def test_performance_real_export(self):
        import performance

        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            source = root / "source.mkv"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=320x240:r=30:d=1",
                    "-c:v",
                    "ffv1",
                    str(source),
                ],
                check=True,
            )
            p = json.loads((HERE / "profiles/x.json").read_text())
            p.update(width=320, height=240)
            (root / "results.json").write_text(
                json.dumps(
                    [
                        {
                            "platform": "x",
                            "content": "ui",
                            "variant": "fast",
                            "reference": str(source),
                            "profile": p,
                        }
                    ]
                )
            )
            rows = performance.benchmark(
                root, root / "perf", duration=1, platforms=["x"], encoders=["libx264"]
            )
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["frames"], 30)
            self.assertGreater(rows[0]["end_to_end_seconds_per_minute"], 0)

    def test_benchmark_preserves_prior_recipe_artifacts(self):
        import sys
        import benchmark
        import hashlib
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as tmp:
            args = ["benchmark.py", "--out", tmp, "--smoke"]
            with patch.object(sys, "argv", args):
                benchmark.main()
            path = pathlib.Path(tmp) / "results.json"
            original = next(
                r for r in json.loads(path.read_text()) if r["variant"] == "software"
            )
            before = hashlib.sha256(
                pathlib.Path(original["upload"]).read_bytes()
            ).hexdigest()
            with (
                patch.dict(
                    benchmark.VARIANTS,
                    {"software": {"encoder": "libx264", "quality": 15}},
                ),
                patch.object(sys, "argv", args),
            ):
                benchmark.main()
            rows = [
                r for r in json.loads(path.read_text()) if r["variant"] == "software"
            ]
            self.assertEqual(len(rows), 2)
            self.assertEqual(
                len({r["upload"] for r in rows}),
                2,
                "a recipe change must not overwrite earlier evidence",
            )
            self.assertEqual(
                before,
                hashlib.sha256(
                    pathlib.Path(original["upload"]).read_bytes()
                ).hexdigest(),
            )


if __name__ == "__main__":
    unittest.main()
