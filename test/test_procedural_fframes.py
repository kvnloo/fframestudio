"""Source-only regression checks; no GPU or installed fframes required."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from procedural_fframes import inspect  # noqa: E402


class ProceduralFFRamesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for path in ("Cargo.toml", "flat/Cargo.toml", "lens/Cargo.toml"):
            dest = self.root / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text("[workspace]\n", encoding="utf-8")
        (self.root / "hud/src").mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, content):
        dest = self.root / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")

    def tracking(self):
        self.write("hud/src/lib.rs", '''pub const FPS: usize = 30;
pub const SCENES: usize = 3;
pub const SCENE_FRAMES: usize = 15;
pub const SCENE_LIST: [SceneDef; SCENES] = [
 SceneDef {
 kind: Kind::Typing,
 text: "thinking…",
 palette: Palette::Thermal,
 },
 SceneDef {
 kind: Kind::Typing,
 text: "done",
 palette: Palette::Phosphor,
 },
 SceneDef {
 kind: Kind::Done,
 text: "",
 palette: Palette::Neon,
 },
];''')

    def unmute(self):
        self.write("hud/src/lib.rs", "pub const FPS: usize = 30;\n")
        self.write("music/gen_hud.py", "# generate from measurements\n")
        self.write("hud/src/generated.rs", '''pub const LENGTH_FRAMES: usize = 480;
pub const SHOT_FRAMES: [usize; 4] = [0, 120, 240, 480];
pub const KICKS: [f32; 2] = [4.0, 4.5];
pub const CLAPS: [f32; 1] = [8.5];''')

    def test_tracking_source_boundaries_not_scene_detection(self):
        self.tracking()
        before = (self.root / "hud/src/lib.rs").read_bytes()
        found = inspect(self.root, {"fps": 30, "duration_s": 1.5})
        self.assertEqual(len(found["shots"]), 3)
        self.assertEqual([s["t0"] for s in found["shots"]], [0, 0.5, 1])
        self.assertEqual(found["shots"][0]["procedural"]["palette"], "Thermal")
        self.assertFalse(found["metadata"]["editable"])
        self.assertEqual((self.root / "hud/src/lib.rs").read_bytes(), before)

    def test_unmute_is_one_camera_take_with_editorial_markers(self):
        self.unmute()
        found = inspect(self.root, {"fps": 30, "duration_s": 16})
        self.assertEqual(len(found["shots"]), 1)
        self.assertEqual(found["shots"][0]["t1"], 16)
        self.assertEqual(found["metadata"]["editorial_marker_frames"], [0, 120, 240, 480])
        self.assertEqual(found["metadata"]["event_frames"]["kick"], [120, 135])
        self.assertNotIn("beat_times", found["metadata"])

    def test_missing_workspace_and_stale_render_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "two-pass"):
            inspect(self.root, {"fps": 30, "duration_s": 6})
        self.tracking()
        with self.assertRaisesRegex(ValueError, "rebuild"):
            inspect(self.root, {"fps": 30, "duration_s": 6})
        with self.assertRaisesRegex(ValueError, "fps"):
            inspect(self.root, {"fps": 60, "duration_s": 1.5})

    def test_corrupt_metadata_fails_instead_of_fake_timing(self):
        self.unmute()
        path = self.root / "hud/src/generated.rs"
        path.write_text(path.read_text().replace("[0, 120, 240, 480]", "[0, 240, 120, 480]"))
        with self.assertRaisesRegex(ValueError, "SHOT_FRAMES"):
            inspect(self.root, {"fps": 30, "duration_s": 16})


if __name__ == "__main__":
    unittest.main()
