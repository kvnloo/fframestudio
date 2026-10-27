"""Hermetic regression tests for import_projects timeline and film parsers."""

import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class ImportProjectsParsersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._temp = tempfile.TemporaryDirectory()
        cls._root = Path(cls._temp.name)
        cls._lib = cls._root / "lib"
        cls._config = cls._root / "sources.json"
        cls._config.write_text(
            json.dumps({"library_root": str(cls._lib), "sources": []}),
            encoding="utf-8",
        )
        cls._files_before_import = sorted(
            p.relative_to(cls._root).as_posix()
            for p in cls._root.rglob("*") if p.is_file()
        )

        cls._old_sources = os.environ.get("FFS_SOURCES")
        cls._old_argv = sys.argv
        cls._old_path = sys.path[:]
        cls._old_module = sys.modules.pop("import_projects", None)
        try:
            os.environ["FFS_SOURCES"] = str(cls._config)
            sys.argv = ["import_projects.py"]
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
            cls.import_projects = importlib.import_module("import_projects")
            cls._files_after_import = sorted(
                p.relative_to(cls._root).as_posix()
                for p in cls._root.rglob("*") if p.is_file()
            )
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        sys.modules.pop("import_projects", None)
        if cls._old_module is not None:
            sys.modules["import_projects"] = cls._old_module
        if cls._old_sources is None:
            os.environ.pop("FFS_SOURCES", None)
        else:
            os.environ["FFS_SOURCES"] = cls._old_sources
        sys.argv = cls._old_argv
        sys.path[:] = cls._old_path
        cls._temp.cleanup()

    def test_import_safe(self):
        self.assertEqual(self._files_before_import, ["sources.json"])
        self.assertEqual(
            self._files_after_import, ["lib/library.json", "sources.json"]
        )
        library = json.loads((self._lib / "library.json").read_text(encoding="utf-8"))
        self.assertEqual(library["projects"], [])

    def test_from_timeline(self):
        timeline = "#0 OpenTitle frames 0..90\n#1 BigReveal frames 90..150\nnoise"
        self.assertEqual(self.import_projects.from_timeline(timeline, 30), [
            {
                "id": "s01", "name": "Open Title", "t0": 0.0, "t1": 3.0,
                "text": {"title": "Open Title"}, "origin": "timeline.txt",
            },
            {
                "id": "s02", "name": "Big Reveal", "t0": 3.0, "t1": 5.0,
                "text": {"title": "Big Reveal"}, "origin": "timeline.txt",
            },
        ])

    def test_from_timeline_index_and_fps(self):
        self.assertEqual(
            self.import_projects.from_timeline("#3 x frames 1..2", 0.5),
            [{
                "id": "s04", "name": "x", "t0": 2.0, "t1": 4.0,
                "text": {"title": "x"}, "origin": "timeline.txt",
            }],
        )
        self.assertEqual(self.import_projects.from_timeline("", 30), [])

    def test_html_film_shots(self):
        js = (
            "const SHOTS=[{at: 0, head:['Hello','World'], body:['a','b']}, "
            "{at: 2.5, tag:'Intro', head:['X']}, "
            "{at: 4, body:['only']}];"
        )
        self.assertEqual(self.import_projects.html_film_shots(js), [
            {
                "at": 0.0, "name": "Hello World",
                "text": {"head": ["Hello", "World"], "body": ["a", "b"]},
            },
            {
                "at": 2.5, "name": "Intro",
                "text": {"head": ["X"], "body": []},
            },
            {
                "at": 4.0, "name": "",
                "text": {"head": [], "body": ["only"]},
            },
        ])

    def test_flags(self):
        self.assertIs(self.import_projects.FORCE, False)
        self.assertEqual(self.import_projects.args, [])

    def test_cuts_with_fake_ffmpeg(self):
        fake = SimpleNamespace(
            stderr="pts_time:0.1 pts_time:2.0 pts_time:2.1 pts_time:5.0"
        )
        with patch.object(self.import_projects, "sh", return_value=fake) as fake_sh:
            shots = self.import_projects.cuts("x", 8.0)

        self.assertEqual(shots, [
            {
                "id": "s01", "name": "Shot 1", "t0": 0.0, "t1": 2.0,
                "origin": "cut detection (scene>0.32)",
            },
            {
                "id": "s02", "name": "Shot 2", "t0": 2.0, "t1": 5.0,
                "origin": "cut detection (scene>0.32)",
            },
            {
                "id": "s03", "name": "Shot 3", "t0": 5.0, "t1": 8.0,
                "origin": "cut detection (scene>0.32)",
            },
        ])
        fake_sh.assert_called_once_with(
            "ffmpeg", "-i", "x", "-vf",
            "scale=320:-2,select='gt(scene,0.32)',showinfo",
            "-an", "-f", "null", "-",
        )


if __name__ == "__main__":
    unittest.main()
