"""Law: distinct scenes of an fframes film must render distinct frames, and all must be reached."""
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
from check_scene_frames import identical_pairs, sample_frames, tiling_errors  # noqa: E402

PAGE = [10] * 200 + [240] * 200


def shifted(page, n):
    return page[n:] + page[:n]


class SceneFrames(unittest.TestCase):
    def test_identical_pages_fail(self):
        thumbs = {f"S0{i}": [PAGE, PAGE] for i in range(1, 9)}
        self.assertEqual(len(identical_pairs(thumbs, 0.02)), 28)

    def test_distinct_pages_pass(self):
        thumbs = {f"S0{i}": [shifted(PAGE, i * 40), shifted(PAGE, i * 40 + 3)] for i in range(1, 9)}
        self.assertEqual(identical_pairs(thumbs, 0.02), [])

    def test_one_repeated_scene_is_named(self):
        thumbs = {"S01": [PAGE, PAGE], "S02": [shifted(PAGE, 100)] * 2, "S03": [PAGE, shifted(PAGE, 7)]}
        self.assertEqual([p[:2] for p in identical_pairs(thumbs, 0.02)], [("S01", "S03")])

    def test_samples_stay_inside_their_scene(self):
        for a, b in ((0, 360), (360, 361), (100, 103)):
            fs = sample_frames({"start_frame": a, "end_frame": b}, 2)
            self.assertTrue(all(a <= f < b for f in fs), fs)

    def test_every_scene_reached_without_gaps(self):
        ok = {"duration_frames": 20, "scenes": [{"name": "A", "start_frame": 0, "end_frame": 10}, {"name": "B", "start_frame": 10, "end_frame": 20}]}
        self.assertEqual(tiling_errors(ok), [])
        gap = {"duration_frames": 30, "scenes": ok["scenes"] + [{"name": "C", "start_frame": 25, "end_frame": 25}]}
        self.assertEqual(len(tiling_errors(gap)), 3)


if __name__ == "__main__":
    unittest.main()
