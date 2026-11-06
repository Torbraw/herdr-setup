"""Read subscription usage. Credentials stay in memory; stdout contains usage only.

Uses existing logins, never refreshes or rewrites credentials. Network requests
go only to the providers' usage endpoints, cached for five minutes unless the
person explicitly requests fresh usage.
"""

import argparse
import concurrent.futures
import json
import math
import os
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home()
APP = Path(os.environ.get("HERDR_APP_HOME", HOME / ".config/herdr-app"))
CACHE = APP / "data/provider-usage.json"


def read_json(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def window(label, used, reset):
    if not isinstance(used, (int, float)) or not math.isfinite(used):
        return None
    return {"label": label, "used": max(0, min(100, used)), "reset": reset}


def request(url, token, headers):
    headers = {**headers, "Authorization": f"Bearer {token}", "User-Agent": "provider-usage/1"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=12) as response:
        value = json.load(response)
    if not isinstance(value, dict):
        raise ValueError("Invalid usage response")
    return value


def openai():
    auth = opencode_login("openai")
    codex = read_json(HOME / ".codex/auth.json").get("tokens", {})
    token = codex.get("access_token") or auth.get("access")
    account = codex.get("account_id") or auth.get("accountId")
    if not token:
        return {"state": "unavailable", "message": "Sign in to Codex / OpenAI"}
    headers = {"ChatGPT-Account-Id": account} if account else {}
    payload = request("https://chatgpt.com/backend-api/wham/usage", token, headers)
    limits = payload.get("rate_limit", {})
    windows = [openai_window(limits.get(key)) for key in ["primary_window", "secondary_window"]]
    return available(windows)


def opencode_login(integration):
    """V2 owns refreshed logins in SQLite; legacy auth.json may be expired."""
    data = Path(os.environ.get("XDG_DATA_HOME", HOME / ".local/share"))
    database = Path(os.environ.get("OPENCODE_DB", data / "opencode/opencode.db"))
    try:
        with sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=2) as connection:
            row = connection.execute(
                "SELECT value FROM credential WHERE integration_id = ? "
                "ORDER BY active DESC, time_updated DESC LIMIT 1", (integration,)).fetchone()
        if row:
            value = json.loads(row[0])
            return {**value.get("metadata", {}), **value}
    except (sqlite3.Error, ValueError):
        pass
    return read_json(data / "opencode/auth.json").get(integration, {})


def openai_window(raw):
    if not isinstance(raw, dict):
        return None
    seconds = raw.get("limit_window_seconds", 0)
    label = {18000: "5h", 604800: "7d"}.get(seconds, f"{round(seconds / 3600)}h")
    return window(label, raw.get("used_percent"), raw.get("reset_at"))


def anthropic():
    auth = read_json(HOME / ".claude/.credentials.json").get("claudeAiOauth", {})
    token = auth.get("accessToken")
    if not token:
        return {"state": "unavailable", "message": "Sign in to Claude Code"}
    payload = request("https://api.anthropic.com/api/oauth/usage", token,
                      {"anthropic-beta": "oauth-2025-04-20"})
    windows = []
    for key, label in [("five_hour", "5h"), ("seven_day", "7d")]:
        raw = payload.get(key) or {}
        windows.append(window(label, raw.get("utilization"), raw.get("resets_at")))
    return available(windows)


def available(windows):
    valid = [entry for entry in windows if entry is not None]
    if not valid:
        return {"state": "unavailable", "message": "Provider returned no usage windows"}
    return {"state": "ready", "windows": valid}


def provider(name, fetch):
    try:
        return {"provider": name, **fetch()}
    except urllib.error.HTTPError as error:
        messages = {401: "Login expired", 403: "Usage access denied", 429: "Rate limited; retry later"}
        return {"provider": name, "state": "unavailable",
                "message": messages.get(error.code, f"Provider error {error.code}")}
    except (OSError, ValueError, TypeError):
        return {"provider": name, "state": "unavailable", "message": "Usage temporarily unavailable"}


def main(refresh=False):
    cached = read_json(CACHE)
    if not refresh and cached.get("version") == 2 and time.time() - cached.get("updated", 0) < 300:
        print(json.dumps(cached))
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(provider, name, fetch) for name, fetch in
                [("openai", openai), ("anthropic", anthropic)]]
        rows = [job.result() for job in jobs]
    result = {"version": 2, "updated": time.time(), "providers": rows}
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    temporary = CACHE.with_suffix(".tmp")
    temporary.write_text(json.dumps(result))
    temporary.chmod(0o600)
    temporary.replace(CACHE)
    print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Read subscription usage without modifying logins.")
    parser.add_argument("--refresh", action="store_true", help="Bypass the usage cache and reread current logins.")
    main(refresh=parser.parse_args().refresh)
