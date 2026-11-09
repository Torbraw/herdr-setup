import contextlib
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/provider-usage"))
import usage
import usage_policy


def reading(percent=12):
    return {"state": "ready", "windows": [{"label": "5h", "used": percent, "reset": None}]}


def limited(retry=None):
    headers = {} if retry is None else {"Retry-After": retry}
    return urllib.error.HTTPError("https://example.test", 429, "private-body", headers, None)


class RetryAfterTests(unittest.TestCase):
    def test_delta_seconds_and_http_dates(self):
        self.assertEqual(usage_policy.retry_after(" 600 ", 1000), 1600)
        self.assertEqual(usage_policy.retry_after("Thu, 01 Jan 1970 00:30:00 GMT", 1000), 1800)

    def test_missing_invalid_and_past_values_fall_back_to_five_minutes(self):
        for value in [None, "", "bad", "-1", "0", "nan", "inf", "Thu, 01 Jan 1970 00:00:00 GMT"]:
            with self.subTest(value=value):
                self.assertEqual(usage_policy.retry_after(value, 1000), 1300)


class RateLimitTests(unittest.TestCase):
    def setUp(self):
        self.directory = self.enterContext(tempfile.TemporaryDirectory(dir="/tmp/opencode"))
        self.home = Path(self.directory)
        self.cache = self.home / "usage.json"
        self.credentials = self.home / ".claude/.credentials.json"
        self.credentials.parent.mkdir()
        self.set_token("private-fixture")
        self.enterContext(patch.object(usage, "HOME", self.home))
        self.enterContext(patch.object(usage, "CACHE", self.cache))
        self.enterContext(patch.object(usage, "openai_login", return_value=("codex-fixture", {})))
        self.codex = self.enterContext(patch.object(usage, "openai", return_value=reading(50)))
        self.clock = self.enterContext(patch.object(usage.time, "time", return_value=1000))
        self.request = self.enterContext(patch.object(usage, "request", return_value={"five_hour": {"utilization": 12}}))

    def set_token(self, token):
        self.credentials.write_text(json.dumps({"claudeAiOauth": {"accessToken": token}}))

    def run_usage(self, **options):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            usage.main(**options)
        result = json.loads(output.getvalue())
        self.assertNotIn("_providers", result)
        return next(row for row in result["providers"] if row["provider"] == "anthropic")

    def test_persisted_cooldown_skips_claude_not_codex_and_recovers_at_deadline(self):
        self.run_usage()
        self.clock.return_value = 1020
        self.request.side_effect = limited("600")
        stale = self.run_usage(poll=True)
        self.assertEqual(stale["state"], "stale")
        self.assertEqual(stale["windows"][0]["used"], 12)
        self.assertEqual(stale["updated"], 1000)
        self.assertEqual(json.loads(self.cache.read_text())["_providers"]["anthropic"]["retry_at"], 1620)
        self.request.reset_mock()
        self.codex.reset_mock()
        self.clock.return_value = 1619
        self.assertEqual(self.run_usage(poll=True), stale)
        self.request.assert_not_called()
        self.codex.assert_called_once()
        self.clock.return_value = 1620
        self.request.side_effect = None
        self.request.return_value = {"five_hour": {"utilization": 25}}
        recovered = self.run_usage(poll=True)
        self.request.assert_called_once()
        self.assertEqual(recovered["state"], "ready")
        self.assertEqual(recovered["windows"][0]["used"], 25)
        self.assertNotIn("retry_at", json.loads(self.cache.read_text())["_providers"]["anthropic"])

    def test_first_rate_limit_without_history_uses_default_cooldown(self):
        self.request.side_effect = limited()
        result = self.run_usage(poll=True)
        self.assertEqual(result["state"], "unavailable")
        self.assertEqual(result["message"], "Rate limited; retry later")
        self.request.reset_mock()
        self.clock.return_value = 1299
        self.run_usage(poll=True)
        self.request.assert_not_called()
        self.assertEqual(json.loads(self.cache.read_text())["_providers"]["anthropic"]["retry_at"], 1300)

    def test_explicit_refresh_can_retry_during_cooldown(self):
        self.request.side_effect = limited()
        self.run_usage(poll=True)
        self.request.reset_mock()
        self.request.side_effect = None
        self.clock.return_value = 1020
        self.assertEqual(self.run_usage(refresh=True)["state"], "ready")
        self.request.assert_called_once()

    def test_manual_rate_limit_does_not_shorten_existing_retry_after(self):
        self.request.side_effect = limited("900")
        self.run_usage(poll=True)
        self.clock.return_value = 1010
        self.request.side_effect = limited("10")
        self.run_usage(refresh=True)
        self.assertEqual(json.loads(self.cache.read_text())["_providers"]["anthropic"]["retry_at"], 1900)

    def test_changed_credentials_do_not_inherit_cooldown_or_last_good_data(self):
        self.run_usage()
        self.request.side_effect = limited()
        self.run_usage(poll=True)
        self.set_token("different-private-fixture")
        self.request.reset_mock()
        self.run_usage()
        self.request.assert_called_once()
        self.assertEqual(self.run_usage(poll=True)["state"], "unavailable")
        contents = self.cache.read_text()
        self.assertNotIn("private-fixture", contents)
        self.assertNotIn("private-body", contents)
        self.assertEqual(self.cache.stat().st_mode & 0o777, 0o600)

    def test_login_rejection_invalidates_history(self):
        self.run_usage()
        self.request.side_effect = urllib.error.HTTPError("https://example.test", 401, "private-body", {}, None)
        self.assertEqual(self.run_usage(poll=True)["state"], "unavailable")
        self.request.side_effect = limited()
        self.assertEqual(self.run_usage(poll=True)["state"], "unavailable")
        self.assertNotIn("last_good", json.loads(self.cache.read_text())["_providers"]["anthropic"])

    def test_network_failure_retains_timestamp_but_does_not_create_rate_limit_cooldown(self):
        self.run_usage()
        self.clock.return_value = 1100
        self.request.side_effect = OSError("private-network-message")
        result = self.run_usage(poll=True)
        self.assertEqual(result["state"], "stale")
        self.assertEqual(result["updated"], 1000)
        self.assertEqual(result["message"], "Usage temporarily unavailable")
        self.assertNotIn("retry_at", json.loads(self.cache.read_text())["_providers"]["anthropic"])

    def test_server_failure_retains_history_but_forbidden_access_drops_it(self):
        self.run_usage()
        self.request.side_effect = urllib.error.HTTPError("https://example.test", 503, "private-body", {}, None)
        self.assertEqual(self.run_usage(poll=True)["state"], "stale")
        self.request.side_effect = urllib.error.HTTPError("https://example.test", 403, "private-body", {}, None)
        self.assertEqual(self.run_usage(poll=True)["state"], "unavailable")
        self.assertNotIn("last_good", json.loads(self.cache.read_text())["_providers"]["anthropic"])

    def test_fresh_cache_cannot_leak_usage_across_a_credential_change(self):
        self.run_usage()
        self.set_token("different-private-fixture")
        self.request.reset_mock()
        self.request.return_value = {"five_hour": {"utilization": 88}}
        self.assertEqual(self.run_usage()["windows"][0]["used"], 88)
        self.request.assert_called_once()

    def test_missing_login_drops_retained_data(self):
        self.run_usage()
        self.credentials.unlink()
        result = self.run_usage()
        self.assertEqual(result["state"], "unavailable")
        self.assertEqual(json.loads(self.cache.read_text())["_providers"]["anthropic"], {})


if __name__ == "__main__":
    unittest.main()
