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

    def test_run_raises_on_failure(self):
        with self.assertRaises(ValueError) as failure:
            analyze_reference.run(
                ["python3", "-c", 'import sys; sys.stderr.write("bad"); sys.exit(3)']
            )
        self.assertEqual(str(failure.exception)[-3:], "bad")


if __name__ == "__main__":
    unittest.main()
