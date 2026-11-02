"""Hermetic regressions for studio-spec soundtrack resolution."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "studio_music.py"
spec = importlib.util.spec_from_file_location("studio_music_under_test", MODULE_PATH)
studio_music = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio_music)
resolve_music = studio_music.resolve_music


class StudioMusicTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / "base"
        self.project = self.root / "proj"
        self.project.mkdir()
        self.catalogue = self.base / "music" / "tracks.json"
        self.catalogue.parent.mkdir(parents=True)
        self.catalogue.write_text(
            json.dumps([
                {"id": "t1", "full": "a/T.MP3", "beats": [0.5, 1.0]},
                {"id": "t2"},
                {"id": "t3", "file": "../../outside.mp3"},
            ]),
            encoding="utf-8",
        )
        self.source = self.base / "sub" / "a" / "T.MP3"
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"hi")
        self.outside = self.root / "outside.mp3"
        self.outside.write_bytes(b"outside")

    def test_resolves_relative_to_studio_page(self):
        music = {"id": "t1", "title": "X"}
        result = resolve_music(self.base, music, self.project, "sub/page.html")
        self.assertEqual(result, {
            "id": "t1",
            "title": "X",
            "file": "media/soundtrack.mp3",
            "beats": [0.5, 1.0],
        })
        self.assertEqual(
            (self.project / "media" / "soundtrack.mp3").read_bytes(), b"hi"
        )
        self.assertEqual(self.source.read_bytes(), b"hi")
        self.assertEqual(music, {"id": "t1", "title": "X"})
        self.assertIsNot(result, music)

    def test_root_level_studio_missing_file(self):
        music = {"id": "t1"}
        result = resolve_music(self.base, music, self.project)
        self.assertEqual(result, {"id": "t1"})
        self.assertIsNot(result, music)
        self.assertFalse((self.base / "a" / "T.MP3").exists())
        self.assertEqual(list(self.project.iterdir()), [])

    def test_track_without_file(self):
        music = {"id": "t2"}
        result = resolve_music(self.base, music, self.project, "sub/page.html")
        self.assertEqual(result, {"id": "t2"})
        self.assertIsNot(result, music)
        self.assertEqual(list(self.project.iterdir()), [])

    def test_escape_rejected(self):
        before = {
            path.relative_to(self.root): path.read_bytes()
            for path in self.root.rglob("*") if path.is_file()
        }
        music = {"id": "t3"}
        result = resolve_music(self.base, music, self.project, "sub/page.html")
        self.assertEqual(result, {"id": "t3"})
        self.assertIsNot(result, music)
        self.assertEqual(self.outside.read_bytes(), b"outside")
        self.assertFalse((self.project / "media").exists())
        self.assertEqual(list(self.project.iterdir()), [])
        self.assertEqual(
            {
                path.relative_to(self.root): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()
            },
            before,
        )

    def test_symlink_components_cannot_escape_source_tree(self):
        """A catalogue's file and directory symlinks cannot import external music."""
        outside_dir = self.root / "outside-dir"
        outside_dir.mkdir()
        external_track = outside_dir / "secret.MP3"
        external_track.write_bytes(b"private")

        page_dir = self.base / "sub"
        (page_dir / "linked-file.MP3").symlink_to(external_track)
        (page_dir / "linked-dir").symlink_to(outside_dir, target_is_directory=True)
        tracks = json.loads(self.catalogue.read_text(encoding="utf-8"))
        tracks.extend([
            {"id": "file-link", "full": "linked-file.MP3"},
            {"id": "dir-link", "full": "linked-dir/secret.MP3"},
        ])
        self.catalogue.write_text(json.dumps(tracks), encoding="utf-8")

        for track_id in ("file-link", "dir-link"):
            with self.subTest(track=track_id):
                music = {"id": track_id}
                result = resolve_music(self.base, music, self.project, "sub/page.html")
                self.assertEqual(result, music)
                self.assertIsNot(result, music)
                self.assertEqual(list(self.project.iterdir()), [])
        self.assertEqual(external_track.read_bytes(), b"private")

    def test_unknown_id_and_none(self):
        music = {"id": "zz"}
        result = resolve_music(self.base, music, self.project, "sub/page.html")
        self.assertEqual(result, {"id": "zz"})
        self.assertIsNot(result, music)
        self.assertEqual(
            resolve_music(self.base, None, self.project, "sub/page.html"), {}
        )
        self.assertEqual(list(self.project.iterdir()), [])

    def test_no_catalogue(self):
        self.catalogue.unlink()
        music = {"id": "t1", "title": "X"}
        result = resolve_music(self.base, music, self.project, "sub/page.html")
        self.assertEqual(result, music)
        self.assertIsNot(result, music)
        self.assertEqual(list(self.project.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
