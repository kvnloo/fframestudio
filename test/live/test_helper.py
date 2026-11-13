"""Focused auth-boundary tests; no credential access and no provider calls."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('live_helper', Path(__file__).parents[2] / 'bridge/live-helper.py')
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class Protocol:
    CODEX_BASE_URL = 'https://chatgpt.com/backend-api'

    @staticmethod
    def account_id(token):
        return token == 'subscription-test-only'


class AccessTests(unittest.TestCase):
    def test_native_codex_route_and_base_are_accepted_read_only(self):
        for suffix in ['', '/codex', '/codex/']:
            calls = []

            def resolve(**kwargs):
                calls.append(kwargs)
                return {'api_key': 'subscription-test-only', 'base_url': Protocol.CODEX_BASE_URL + suffix}

            self.assertEqual(helper.access(resolve, lambda *_: False, Protocol), 'subscription-test-only')
            self.assertEqual(calls, [{'read_only': True, 'refresh_if_expiring': False}])

    def test_never_adopts_gateway_or_paid_api_key(self):
        for url in ['http://127.0.0.1:8888', 'https://api.openai.com/v1', 'https://chatgpt.com/backend-api.evil']:
            with self.assertRaisesRegex(RuntimeError, '^subscription-route-unavailable$'):
                helper.access(lambda **_: {'api_key': 'subscription-test-only', 'base_url': url}, lambda *_: False, Protocol)

    def test_expired_subscription_does_not_refresh(self):
        with self.assertRaisesRegex(RuntimeError, '^subscription-login-unavailable-or-expiring$'):
            helper.access(lambda **_: {'api_key': 'subscription-test-only', 'base_url': Protocol.CODEX_BASE_URL}, lambda *_: True, Protocol)

    def test_non_subscription_credential_does_not_fall_back(self):
        with self.assertRaisesRegex(RuntimeError, '^subscription-login-unavailable-or-expiring$'):
            helper.access(lambda **_: {'api_key': 'not-a-subscription', 'base_url': Protocol.CODEX_BASE_URL}, lambda *_: False, Protocol)


if __name__ == '__main__':
    unittest.main()
