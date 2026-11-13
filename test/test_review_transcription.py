"""Duration-bound regressions. Does not load Whisper or download models."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'bridge' / 'analyze-reference.py'


class ReviewTranscriptionBounds(unittest.TestCase):
    def invoke(self, seconds, limit):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'speech.wav'
            with wave.open(str(source), 'wb') as audio:
                audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                audio.writeframes(b'\0\0' * 16000 * seconds)
            result = subprocess.run(
                [sys.executable, str(HELPER), str(source), '--transcribe', '--max-seconds', str(limit)],
                text=True, capture_output=True, timeout=30,
            )
            return result

    def test_short_route_rejects_long_audio_instead_of_returning_partial_text(self):
        result = self.invoke(32, 30)
        self.assertNotEqual(result.returncode, 0)
        body = json.loads(result.stdout)
        self.assertIn('30-second', body['error'])
        self.assertNotIn('text', body)

    def test_review_limit_rejects_overlong_audio_before_loading_a_model(self):
        result = self.invoke(122, 120)
        self.assertNotEqual(result.returncode, 0)
        body = json.loads(result.stdout)
        self.assertIn('120-second', body['error'])
        self.assertNotIn('text', body)

    def test_caller_cannot_raise_the_decoder_limit(self):
        result = self.invoke(1, 600)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('invalid choice', result.stderr)


if __name__ == '__main__':
    unittest.main()
