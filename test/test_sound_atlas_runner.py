"""Offline runner exit-status regressions: no browser, model, or sandbox calls."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SoundAtlasRunnerTests(unittest.TestCase):
    def run_army(self, lane_status=0, serve_status=0):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            shutil.copyfile(ROOT / 'e2e/sound-atlas/run.sh', work / 'run.sh')
            (work / 'serve.sh').write_text(f'return {serve_status}\n')
            (work / 'goals.tsv').write_text('a\tbrowser\tfirst\nb\tbrowser\tsecond\n')
            (work / 'findings.py').write_text("from pathlib import Path\nPath('reported').touch()\n")
            bin_dir = work / 'bin'
            bin_dir.mkdir()
            # Never invoke the real npx or start an external service.
            npx = bin_dir / 'npx'
            npx.write_text(f'#!/bin/sh\nexit {lane_status}\n')
            npx.chmod(0o755)
            env = dict(os.environ, PATH=f'{bin_dir}:{os.environ["PATH"]}', PAR='2')
            result = subprocess.run(['bash', 'run.sh'], cwd=work, env=env,
                                    capture_output=True, text=True, timeout=10)
            exits = work / 'runs/exits.txt'
            return result.returncode, exits.read_text() if exits.exists() else '', (work / 'reported').exists()

    def test_successful_lanes_succeed_and_report(self):
        status, exits, reported = self.run_army()
        self.assertEqual(status, 0)
        self.assertEqual(sorted(exits.splitlines()), ['a exit=0', 'b exit=0'])
        self.assertTrue(reported)

    def test_failed_lanes_fail_but_still_report(self):
        status, exits, reported = self.run_army(lane_status=7)
        self.assertNotEqual(status, 0)
        self.assertEqual(sorted(exits.splitlines()), ['a exit=7', 'b exit=7'])
        self.assertTrue(reported)

    def test_failed_server_prevents_lane_execution(self):
        status, exits, reported = self.run_army(serve_status=9)
        self.assertEqual(status, 9)
        self.assertEqual(exits, '')
        self.assertFalse(reported)
