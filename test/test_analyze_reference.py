"""Unit tests for reference-video palette extraction and probe limits."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "bridge" / "analyze-reference.py"
SPEC = importlib.util.spec_from_file_location("analyze_reference", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise ImportError(f"Cannot load {SCRIPT}")
analyze_reference = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(analyze_reference)


class AnalyzeReferenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.reference = Path(temporary.name) / "reference.mp4"

    @staticmethod
    def _probe_data(
        rate="30/1",
        duration="2.5",
        container="mov,mp4,m4a,3gp,3g2,mj2",
        audio=True,
    ):
        streams = [
            {
                "codec_type": "video",
                "avg_frame_rate": rate,
                "width": 640,
                "height": 360,
            }
        ]
        if audio:
            streams.append({"codec_type": "audio"})
        return {
            "streams": streams,
            "format": {"format_name": container, "duration": duration},
        }

    def _probe(self, data):
        # Deliberately never launch ffprobe or read the placeholder video.
        def fake_run(args):
            self.assertEqual(args[0], "ffprobe")
            self.assertEqual(args[-1], str(self.reference))
            return SimpleNamespace(stdout=json.dumps(data).encode())

        with patch.object(analyze_reference, "run", new=fake_run):
            return analyze_reference.probe(self.reference)

    def test_kmeans_edge_cases(self):
        self.assertEqual(analyze_reference.kmeans([]), [])
        self.assertEqual(
            analyze_reference.kmeans([1, 2, 3, 4]),
            [{"color": "#010203", "coverage": 1.0}],
        )
        self.assertEqual(
            analyze_reference.kmeans([10, 20, 30] * 5),
            [{"color": "#0a141e", "coverage": 1.0}],
        )

    def test_kmeans_two_clusters(self):
        self.assertEqual(
            analyze_reference.kmeans([0, 0, 0] * 3 + [255, 255, 255]),
            [
                {"color": "#000000", "coverage": 0.75},
                {"color": "#ffffff", "coverage": 0.25},
            ],
        )
        pixels = [255, 0, 0] * 6 + [0, 0, 255] * 2
        expected = [
            {"color": "#ff0000", "coverage": 0.75},
            {"color": "#0000ff", "coverage": 0.25},
        ]
        self.assertEqual(analyze_reference.kmeans(pixels, k=2), expected)
        self.assertEqual(analyze_reference.kmeans(bytes(pixels), k=2), expected)

    def test_probe_ok(self):
        self.assertEqual(
            self._probe(self._probe_data()),
            {
                "fps": {"num": 30, "den": 1},
                "duration": 2.5,
                "frames": 75,
                "width": 640,
                "height": 360,
                "audio": True,
            },
        )
        self.assertEqual(
            self._probe(
                self._probe_data(
                    rate="30000/1001",
                    duration="10",
                    container="matroska,webm",
                    audio=False,
                )
            ),
            {
                "fps": {"num": 30000, "den": 1001},
                "duration": 10.0,
                "frames": 300,
                "width": 640,
                "height": 360,
                "audio": False,
            },
        )

    def test_probe_rejects_container(self):
        no_video = self._probe_data()
        no_video["streams"] = [{"codec_type": "audio"}]
        with self.assertRaisesRegex(
            ValueError, "Use a direct MP4, WebM, MOV or AVI"
        ):
            self._probe(no_video)
        with self.assertRaisesRegex(
            ValueError, "Use a direct MP4, WebM, MOV or AVI"
        ):
            self._probe(self._probe_data(container="hls"))

    def test_probe_rejects_limits(self):
        cases = [
            ("0/0", "2.5"),
            ("30/1", "601"),
            ("30/1", "0"),
            ("240/1", "2.5"),
        ]
        for rate, duration in cases:
            with self.subTest(rate=rate, duration=duration):
                with self.assertRaisesRegex(ValueError, "Reference limit"):
                    self._probe(self._probe_data(rate=rate, duration=duration))

    def test_probe_limit_boundaries(self):
        # Exactly ten minutes at exactly 120 fps is the largest accepted reference.
        info = self._probe(self._probe_data(rate="120/1", duration="600"))
        self.assertEqual(info["fps"], {"num": 120, "den": 1})
        self.assertEqual(info["frames"], 72000)
        # Just past either limit, or with ffprobe omitting rate/duration, is rejected.
        missing_rate = self._probe_data()
        del missing_rate["streams"][0]["avg_frame_rate"]
        missing_duration = self._probe_data()
        del missing_duration["format"]["duration"]
        cases = {
            "121/1": self._probe_data(rate="121/1"),
            "600.01s": self._probe_data(duration="600.01"),
            "no avg_frame_rate": missing_rate,
            "no duration": missing_duration,
        }
        for name, data in cases.items():
            with self.subTest(name):
                with self.assertRaisesRegex(ValueError, "Reference limit"):
                    self._probe(data)

    def test_probe_rejects_zero_frame_reference(self):
        # A positive duration can still round to zero timeline frames. Such a
        # reference cannot produce a non-empty shot or editable source clip.
        for duration in ("0.001", "0.016666666666666666"):
            with self.subTest(duration=duration):
                with self.assertRaisesRegex(ValueError, "at least one frame"):
                    self._probe(self._probe_data(rate="30/1", duration=duration))
        self.assertEqual(
            self._probe(self._probe_data(rate="30/1", duration="0.03333333333333333"))["frames"],
            1,
        )

    def test_invalid_probe_stops_analysis_before_output_or_decode(self):
        # Rejection must happen before creating artifacts or starting ffmpeg.
        for rate, duration in (("-30/1", "2.5"), ("30/-1", "2.5"),
                               ("30/1", "-1"), ("30/1", "NaN"),
                               ("30/1", "Infinity"), ("30/1", "-Infinity")):
            with self.subTest(rate=rate, duration=duration):
                data = self._probe_data(rate=rate, duration=duration)
                out = self.reference.parent / "analysis"
                with patch.object(analyze_reference, "run", return_value=SimpleNamespace(
                    stdout=json.dumps(data).encode()
                )) as probe_run, patch.object(analyze_reference, "ffmpeg") as decode:
                    with self.assertRaisesRegex(ValueError, "Reference limit"):
                        analyze_reference.analyze(self.reference, out)
                    probe_run.assert_called_once()
                    self.assertEqual(probe_run.call_args.args[0][0], "ffprobe")
                    decode.assert_not_called()
                self.assertFalse(out.exists(), "rejected reference must leave no output directory")

    def test_run_raises_on_failure(self):
        with self.assertRaises(ValueError) as failure:
            analyze_reference.run(
                ["python3", "-c", 'import sys; sys.stderr.write("bad"); sys.exit(3)']
            )
        self.assertEqual(str(failure.exception)[-3:], "bad")


if __name__ == "__main__":
    unittest.main()
