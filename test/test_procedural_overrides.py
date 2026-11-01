"""Working-copy camera overrides: round trip, isolation and fail-closed checks.

Synthetic Rust literals only; no cargo, GPU or upstream film is required.
"""
import contextlib
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from procedural_fframes import inspect  # noqa: E402
import procedural_overrides as po  # noqa: E402

FIELDS = po.FIELDS
LIB = """pub const FPS: usize = 30;
/// (time s, look_y, zoom, tilt_x, tilt_y, roll, x offset, blur)
const KEYS: [(f32, f32, f32, f32, f32, f32, f32, f32); 3] = [
    (0.0, 600.0, 3.0, 0.1, 0.2, 0.0, 0.0, 1.0),
    (8.0, 400.0, 2.0, 0.2, -0.2, 0.1, 10.0, 1.2),
    (16.0, 560.0, 1.1, 0.1, 0.0, 0.0, 0.0, 0.5),
];
pub fn untouched() -> f32 { 1.0 }
"""


class OverridesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.src, self.work = base / "ff-unmute", base / "work"
        files = {
            "Cargo.toml": '[workspace]\nmembers = ["hud", "flat", "lens"]\n',
            "flat/Cargo.toml": '[package]\nname = "flat"\n[[bin]]\nname = "flat"\n',
            "lens/Cargo.toml": '[package]\nname = "lens"\n[[bin]]\nname = "lens"\n',
            "hud/src/lib.rs": LIB,
            "music/gen_hud.py": "# synthetic fixture\n",
            "hud/src/generated.rs": "pub const BPM: f32 = 120.0;\npub const LENGTH_FRAMES: usize = 480;\n"
                                    "pub const SHOT_FRAMES: [usize; 3] = [0,240,480];\npub const KICKS: [f32; 3] = [4.0,4.5,5.0213];\n"
                                    "pub const WAVE: [f32; 4] = [0.1,0.7,0.9,0.3];\n",
        }
        for rel, text in files.items():
            (self.src / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.src / rel).write_text(text)
        git = ["git", "-C", str(self.src), "-c", "user.name=t", "-c", "user.email=t@example.invalid"]
        subprocess.run(git + ["init", "-q"], check=True)
        subprocess.run(git + ["add", "."], check=True)
        subprocess.run(git + ["commit", "-qm", "fixture"], check=True)
        (self.src / "target").mkdir()
        (self.src / "target/ignored.bin").write_bytes(b"untracked build output")
        self.procedural = inspect(self.src)["metadata"]

    def tearDown(self):
        self.temp.cleanup()

    def project(self, edit=None):
        keys = [{f: k[f] for f in FIELDS} for k in self.procedural["camera_keyframes"]]
        (edit or (lambda ks: ks[1].update(time_s=5.0213, zoom=2.25)))(keys)
        overrides = {"schema": po.SCHEMA, "family": "ff-unmute", "camera_keyframes": keys, "stages": ["rust", "flat", "lens"],
                     "base": {"source_revision": self.procedural["source_revision"], "lib_sha256": self.procedural["source_sha256"]["hud/src/lib.rs"]}}
        path = Path(self.temp.name) / "project.json"
        path.write_text(json.dumps({"schema": "fframestudio.project/1", "metadata": {"procedural": self.procedural, "proceduralOverrides": overrides}}))
        return path

    def tracked_hashes(self):
        return {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(self.src.rglob("*")) if p.is_file()}

    def test_export_round_trips_only_keys_and_leaves_source_untouched(self):
        before = self.tracked_hashes()
        receipt = po.export(self.src, self.project(), self.work)
        self.assertEqual(self.tracked_hashes(), before)
        self.assertEqual(subprocess.run(["git", "-C", str(self.src), "status", "--porcelain", "--untracked-files=no"], capture_output=True, text=True).stdout, "")
        self.assertTrue(receipt["round_trip"] and receipt["source_unchanged"])
        self.assertFalse(receipt["rendered"])
        self.assertEqual(receipt["source_revision"], self.procedural["source_revision"])
        self.assertEqual([(c["key"], c["field"], c["after"]) for c in receipt["changed"]], [(2, "time_s", 5.0213), (2, "zoom", 2.25)])
        self.assertEqual(receipt["stages_skipped"], ["music/synth.py", "music/analyze.py", "music/gen_hud.py"])
        self.assertFalse((self.work / "target").exists(), "build outputs are not copied")
        self.assertFalse((self.work / ".git").exists())
        copied = (self.work / "hud/src/lib.rs").read_text()
        self.assertIn("    (5.0213, 400.0, 2.25, 0.2, -0.2, 0.1, 10.0, 1.2),\n", copied)
        self.assertTrue(copied.endswith("];\npub fn untouched() -> f32 { 1.0 }\n"))
        reread = inspect(self.work)["metadata"]
        self.assertIsNone(reread["source_revision"], "copy must not claim the source revision")
        self.assertEqual(reread["camera_keyframes"][1]["frame"], 151)
        self.assertEqual(reread["event_seconds"], self.procedural["event_seconds"])
        saved = json.loads((self.work / "fframestudio-remix.json").read_text())
        self.assertEqual(saved["remix_lib_sha256"], hashlib.sha256((self.work / "hud/src/lib.rs").read_bytes()).hexdigest())
        self.assertNotIn(str(self.src), json.dumps(saved), "receipt carries no machine paths")

    def test_diff_cli_touches_only_the_keys_literal(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(po.main(["diff", "--source", str(self.src), "--project", str(self.project())]), 0)
        changed = [line for line in out.getvalue().splitlines() if line[:1] in "+-" and line[:3] not in ("+++", "---")]
        self.assertEqual(changed, ["-    (8.0, 400.0, 2.0, 0.2, -0.2, 0.1, 10.0, 1.2),", "+    (5.0213, 400.0, 2.25, 0.2, -0.2, 0.1, 10.0, 1.2),"])

    def test_fail_closed(self):
        cases = [
            (lambda ks: ks[1].update(time_s=16.0), "must come after"),
            (lambda ks: ks[0].update(time_s=0.5), "pinned"),
            (lambda ks: ks[2].update(zoom=0.5), "zoom must be"),
            (lambda ks: ks[2].update(blur=float("nan")), "finite"),
            (lambda ks: ks.pop(), "keep the source's 3 keys"),
            (lambda ks: ks[1].update(shader=1), "unexpected fields"),
        ]
        for edit, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(po.OverrideError, message):
                po.export(self.src, self.project(edit), self.work)
        project = self.project()
        with self.assertRaisesRegex(po.OverrideError, "outside the source"):
            po.export(self.src, project, self.src / "remix")
        self.work.mkdir()
        (self.work / "keep.txt").write_text("someone else's file")
        with self.assertRaisesRegex(po.OverrideError, "new or empty"):
            po.export(self.src, project, self.work)
        (self.work / "keep.txt").unlink()
        (self.src / "hud/src/generated.rs").write_text((self.src / "hud/src/generated.rs").read_text() + "\n")
        with self.assertRaisesRegex(po.OverrideError, "Source changed since import: hud/src/generated.rs"):
            po.export(self.src, project, self.work)
        self.assertEqual(list(self.work.iterdir()), [], "nothing written on failure")

    def test_rust_half_up_frames(self):
        # 0.75 s * 30 = 22.5 frames: Rust rounds half away from zero (23); Python round() gives 22.
        po.export(self.src, self.project(lambda ks: ks[1].update(time_s=0.75)), self.work)
        self.assertEqual(inspect(self.work)["metadata"]["camera_keyframes"][1]["frame"], 23)

    def test_rust_float_literals(self):
        self.assertEqual([po.fmt(v) for v in (600, -0.48, 1e-05, 2.0)], ["600.0", "-0.48", "1e-05", "2.0"])


if __name__ == "__main__":
    unittest.main()
