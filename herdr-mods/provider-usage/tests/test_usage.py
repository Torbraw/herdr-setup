import contextlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/provider-usage"))
import usage


class UsageTests(unittest.TestCase):
    def test_cache_expiry_follows_default_and_configured_intervals(self):
        cases = [(59, {}, False), (60, {}, True),
                 (90, {"cache_seconds": 120}, False), (120, {"cache_seconds": 120}, True),
                 (45, {"cache_seconds": 30}, True)]
        for age, options, expired in cases:
            with self.subTest(age=age, options=options), \
                    tempfile.TemporaryDirectory(dir="/tmp/opencode") as directory:
                cache = Path(directory) / "usage.json"
                cached = {"version": 2, "updated": 1000 - age, "providers": []}
                cache.write_text(json.dumps(cached))
                output = io.StringIO()
                unavailable = {"state": "unavailable", "message": "Not signed in"}
                with patch.object(usage, "CACHE", cache), patch.object(usage.time, "time", return_value=1000), \
                        patch.object(usage, "openai", return_value=unavailable) as openai, \
                        patch.object(usage, "anthropic", return_value=unavailable) as anthropic, \
                        contextlib.redirect_stdout(output):
                    usage.main(**options)
                result = json.loads(output.getvalue())
                if expired:
                    openai.assert_called_once_with()
                    anthropic.assert_called_once_with()
                    self.assertEqual(result["updated"], 1000)
                    self.assertEqual(len(result["providers"]), 2)
                else:
                    openai.assert_not_called()
                    anthropic.assert_not_called()
                    self.assertEqual(result, cached)
                self.assertEqual(json.loads(cache.read_text()), result)

    def test_manual_refresh_bypasses_cached_login_error_and_reads_new_credentials(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as directory:
            home = Path(directory)
            cache = home / "usage.json"
            cached = {"version": 2, "updated": time.time(), "providers": [
                {"provider": "anthropic", "state": "unavailable", "message": "Login expired"}]}
            cache.write_text(json.dumps(cached))
            credentials = home / ".claude/.credentials.json"
            credentials.parent.mkdir()
            credentials.write_text(json.dumps({"claudeAiOauth": {"accessToken": "new-login-fixture"}}))
            payload = {"five_hour": {"utilization": 12, "resets_at": None}}
            output = io.StringIO()
            with patch.object(usage, "HOME", home), patch.object(usage, "CACHE", cache), \
                    patch.object(usage, "openai", return_value={"state": "unavailable", "message": "Not signed in"}), \
                    patch.object(usage, "request", return_value=payload) as request:
                with contextlib.redirect_stdout(output):
                    usage.main()
                self.assertEqual(json.loads(output.getvalue()), cached)
                request.assert_not_called()
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    usage.main(refresh=True)
                request.assert_called_once_with("https://api.anthropic.com/api/oauth/usage", "new-login-fixture",
                                                {"anthropic-beta": "oauth-2025-04-20"})
            result = json.loads(output.getvalue())
            claude = next(row for row in result["providers"] if row["provider"] == "anthropic")
            self.assertEqual(claude["state"], "ready")
            self.assertEqual(claude["windows"][0]["used"], 12)
            self.assertEqual(json.loads(cache.read_text()), result)
            self.assertEqual(credentials.read_text(), json.dumps({"claudeAiOauth": {"accessToken": "new-login-fixture"}}))
            self.assertNotIn("new-login-fixture", cache.read_text())

    def test_v2_default_connection_with_null_active_uses_refreshed_credentials(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as directory:
            database = Path(directory) / "login.db"
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE credential (integration_id, active, time_updated, value)")
                value = {"type": "oauth", "access": "fixture", "metadata": {"accountId": "fixture-account"}}
                connection.execute("INSERT INTO credential VALUES (?, ?, ?, ?)",
                                   ("openai", None, 100, json.dumps(value)))
            with patch.dict(os.environ, {"OPENCODE_DB": str(database)}):
                resolved = usage.opencode_login("openai")
            self.assertEqual(resolved["accountId"], "fixture-account")
            self.assertEqual(resolved["access"], "fixture")

    def test_openai_reports_actual_windows_without_fabricating_a_five_hour_limit(self):
        payload = {"rate_limit": {"primary_window": {
            "limit_window_seconds": 604800, "used_percent": 11, "reset_at": 1234}}}
        with patch.object(usage, "opencode_login", return_value={"access": "fixture"}), \
                patch.object(usage, "read_json", return_value={}), \
                patch.object(usage, "request", return_value=payload):
            result = usage.openai()
        self.assertEqual(result, {"state": "ready", "windows": [
            {"label": "7d", "used": 11, "reset": 1234}]})

    def test_provider_errors_never_echo_credentials_or_response_bodies(self):
        def unavailable():
            raise urllib.error.HTTPError("https://example.test", 401, "private-response", {}, None)
        result = usage.provider("openai", unavailable)
        self.assertEqual(result, {"provider": "openai", "state": "unavailable", "message": "Login expired"})


if __name__ == "__main__":
    unittest.main()
