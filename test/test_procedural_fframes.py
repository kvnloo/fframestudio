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
            dest.write_text('[workspace]\nmembers = ["hud", "flat", "lens"]\n' if path == "Cargo.toml" else f'[package]\nname = "{dest.parent.name}"\n[[bin]]\nname = "{dest.parent.name}"\n', encoding="utf-8")
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

        hud = self.root / "hud/src/lib.rs"
        hud.write_text(hud.read_text().replace('palette: Palette::', 'cam: cam(0.1, -0.2, 0.0, 2.0, 2.5, 0.0, 0.0, 1.0),\n hero: (320.0, 540.0),\n size: 72.0,\n palette: Palette::'))

    def unmute(self):
        self.write("hud/src/lib.rs", "pub const FPS: usize = 30;\nconst KEYS: [(f32,f32,f32,f32,f32,f32,f32,f32); 2] = [(0.0,600.0,3.0,0.1,0.2,0.0,0.0,1.0), (16.0,560.0,1.1,0.1,0.0,0.0,0.0,0.5)];\n")
        self.write("music/gen_hud.py", "# generate from measurements\n")
        self.write("hud/src/generated.rs", '''pub const BPM: f32 = 120.0;
pub const WAVE: [f32; 4] = [0.1,0.7,0.9,0.3];
pub const LENGTH_FRAMES: usize = 480;
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


    def test_camera_literals_focus_and_source_only(self):
        self.tracking()
        found = inspect(self.root)
        scene = found["shots"][0]["procedural"]
        self.assertEqual(scene["camera"]["zoom"], [2, 2.5])
        self.assertEqual(scene["hero"], [320, 540])
        self.assertFalse(found["metadata"]["render_verified"])
        self.assertEqual(len(found["metadata"]["source_sha256"]), 4)

    def test_detector_checks_executable_not_directory_name(self):
        self.tracking()
        self.write("flat/Cargo.toml", '[package]\nname="flat"\n[[bin]]\nname="wrong"\n')
        with self.assertRaisesRegex(ValueError, "executable"):
            inspect(self.root)

    def test_exact_event_seconds_and_rust_half_frame_rounding(self):
        self.unmute()
        path = self.root / "hud/src/generated.rs"
        path.write_text(path.read_text() + '\npub const TOKENS: [f32; 1] = [11.75];\n')
        found = inspect(self.root)["metadata"]
        self.assertEqual(found["event_seconds"]["token"], [11.75])
        self.assertEqual(found["event_frames"]["token"], [353])
        self.assertEqual(found["event_frames"]["bar"], list(range(0, 480, 60)))
        self.assertEqual(found["bpm"], 120)
        self.assertEqual(found["camera_keyframes"][-1]["frame"], 480)

    def test_actual_importer_source_only_and_saved_project_guard(self):
        import json
        import os
        import subprocess
        from procedural_fixture import make
        sources = make(self.root)
        library = self.root / "library"
        config = self.root / "sources.json"
        config.write_text(json.dumps(dict(library_root=str(library), sources=sources)))
        command = [sys.executable, str(Path(__file__).resolve().parents[1] / "tools/import_projects.py")]
        env = os.environ | {"FFS_SOURCES": str(config)}
        before = {str(p): p.read_bytes() for p in (self.root / "source-fixtures").rglob("*") if p.is_file()}
        subprocess.run(command, env=env, capture_output=True, check=True)
        tracking = json.loads((library / "ff-tracking/project.json").read_text())
        unmute = json.loads((library / "ff-unmute/project.json").read_text())
        self.assertEqual(len(tracking["shots"]), 12)
        self.assertEqual(len(unmute["shots"]), 1)
        self.assertEqual(unmute["renders"], [])
        self.assertEqual(unmute["procedural"]["event_frames"]["token"][-1], 353)
        target = library / "ff-tracking/project.json"
        saved = '{"schema":"fframestudio.project/1","sentinel":"preserve"}'
        target.write_text(saved)
        subprocess.run(command, env=env, capture_output=True, check=True)
        self.assertEqual(target.read_text(), saved)
        self.assertTrue(all(Path(p).read_bytes() == data for p, data in before.items()))


if __name__ == "__main__":
    unittest.main()
