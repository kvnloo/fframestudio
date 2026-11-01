"""Tests for the 120 fps showcase export profile and platform choice discovery."""

import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from delivery import deliver


HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profiles" / "showcase-120.json"
HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


class Showcase120Test(unittest.TestCase):
    def test_profile_fields_and_sixty_frame_gop(self):
        p = json.loads(PROFILE.read_text())
        youtube = json.loads((HERE / "profiles" / "youtube.json").read_text())
        self.assertEqual(p["platform"], "showcase-120")
        self.assertEqual((p["width"], p["height"], p["fps"]), (1920, 1080, 120))
        self.assertTrue(all(d > 0 and d % 2 == 0 for d in (p["width"], p["height"])))
        self.assertEqual(p["conform"], "decimate")
        self.assertEqual(p["scale"], "lanczos")
        self.assertEqual(p["fit"], "pad")
        self.assertEqual(p["prefilter"], "none")
        self.assertEqual(p["encoder"], "libx264")
        self.assertEqual(p["quality"], 14)
        self.assertEqual(p["maxrate_kbps"], 4 * youtube["maxrate_kbps"])
        self.assertEqual(p["gop_seconds"], 0.5)
        self.assertEqual(round(p["fps"] * p["gop_seconds"]), 60)
        for key in ("audio_lufs", "audio_true_peak", "audio_kbps"):
            self.assertEqual(p[key], youtube[key])
        self.assertIn("UNVERIFIED", p["qualification"])

    def test_cli_export_accepts_all_profile_stems_without_profile_flag(self):
        profiles = sorted((HERE / "profiles").glob("*.json"))
        self.assertIn(PROFILE, profiles)
        for path in profiles:
            with self.subTest(platform=path.stem):
                argv = [
                    "deliver.py", "export", "source.mkv", "output.mp4",
                    "--platform", path.stem,
                ]
                with (
                    mock.patch.object(sys, "argv", argv),
                    mock.patch.object(
                        deliver, "export", return_value={"wall_seconds": 0.0}
                    ) as do_export,
                    contextlib.redirect_stdout(io.StringIO()),
                ):
                    deliver.main()
                do_export.assert_called_once()
                self.assertEqual(
                    do_export.call_args.args[2], json.loads(path.read_text())
                )

    def test_cli_export_rejects_unknown_platform(self):
        argv = [
            "deliver.py", "export", "source.mkv", "output.mp4",
            "--platform", "not-a-profile",
        ]
        with (
            mock.patch.object(sys, "argv", argv),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as raised,
        ):
            deliver.main()
        self.assertEqual(raised.exception.code, 2)

    def test_simulate_choices_remain_platforms_json_keys(self):
        platforms = json.loads((HERE / "platforms.json").read_text())["platforms"]
        for platform, expected in platforms.items():
            with self.subTest(platform=platform):
                argv = [
                    "deliver.py", "simulate", "source.mkv", "output.mp4",
                    "--platform", platform,
                ]
                with (
                    mock.patch.object(sys, "argv", argv),
                    mock.patch.object(
                        deliver, "simulate", return_value={"wall_seconds": 0.0}
                    ) as do_simulate,
                    contextlib.redirect_stdout(io.StringIO()),
                ):
                    deliver.main()
                do_simulate.assert_called_once()
                self.assertEqual(do_simulate.call_args.args[2], expected)
        if "showcase-120" not in platforms:
            with (
                mock.patch.object(
                    sys, "argv",
                    [
                        "deliver.py", "simulate", "source.mkv", "output.mp4",
                        "--platform", "showcase-120",
                    ],
                ),
                contextlib.redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit) as raised,
            ):
                deliver.main()
            self.assertEqual(raised.exception.code, 2)

    @staticmethod
    def make_source(directory, fps, seconds):
        source = directory / f"source-{fps}.mkv"
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                f"testsrc2=s=160x90:r={fps}:d={seconds}",
                "-c:v", "ffv1", "-threads", "2", str(source),
            ],
            check=True,
        )
        return source

    def assert_120fps(self, output, expected_frames):
        stream = next(
            s for s in deliver.probe(output, True)["streams"]
            if s["codec_type"] == "video"
        )
        self.assertEqual(stream["avg_frame_rate"], "120/1")
        self.assertEqual(int(stream["nb_read_frames"]), expected_frames)
        self.assertEqual((stream["width"], stream["height"]), (160, 90))

    @unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are required")
    def test_blend_240_to_120_exact_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_source(root, 240, 1)
            output = root / "blend.mp4"
            profile = json.loads(PROFILE.read_text())
            profile.update(width=160, height=90, conform="blend")
            deliver.export(source, output, profile, duration=1)
            self.assert_120fps(output, 120)

    @unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are required")
    def test_decimate_120_to_120_through_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_source(root, 120, 1)
            output = root / "decimate.mp4"
            result = subprocess.run(
                [
                    sys.executable, str(HERE / "deliver.py"), "export",
                    str(source), str(output), "--platform", "showcase-120",
                    "--width", "160", "--height", "90", "--duration", "1",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(json.loads(result.stdout)["output"], str(output))
            self.assert_120fps(output, 120)

    @unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are required")
    def test_interpolate_60_to_120_quarter_second(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_source(root, 60, 0.25)
            output = root / "interpolate.mp4"
            profile = json.loads(PROFILE.read_text())
            profile.update(width=160, height=90, conform="interpolate")
            deliver.export(source, output, profile, duration=0.25)
            self.assert_120fps(output, 30)


if __name__ == "__main__":
    unittest.main()
