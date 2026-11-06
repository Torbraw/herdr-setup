import json
import os
import sqlite3
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/provider-usage"))
import usage


class UsageTests(unittest.TestCase):
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
