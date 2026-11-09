"""Read subscription usage. Credentials stay in memory; stdout contains usage only.

Uses existing logins, never refreshes or rewrites credentials. Network requests
go only to the providers' usage endpoints. Scheduled requests honor persisted
rate-limit cooldowns; explicit refreshes can retry early. Caches contain parsed
usage, capture times, cooldowns and one-way credential fingerprints, never tokens.
"""

import argparse
import concurrent.futures
import json
import math
import os
import sqlite3
import time
import urllib.request
from pathlib import Path
from usage_cache import read_json, refresh_lock, write_json
from usage_policy import fetch_usage, timestamp

HOME = Path.home()
APP = Path(os.environ.get("HERDR_APP_HOME", HOME / ".config/herdr-app"))
CACHE = APP / "data/provider-usage.json"


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


def openai_login():
    auth = opencode_login("openai")
    codex = read_json(HOME / ".codex/auth.json").get("tokens", {})
    token = codex.get("access_token") or auth.get("access")
    account = codex.get("account_id") or auth.get("accountId")
    headers = {"ChatGPT-Account-Id": account} if account else {}
    return token, headers


def openai(token, headers):
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


def anthropic_login():
    auth = read_json(HOME / ".claude/.credentials.json").get("claudeAiOauth", {})
    return auth.get("accessToken"), {"anthropic-beta": "oauth-2025-04-20"}


def anthropic(token, headers):
    payload = request("https://api.anthropic.com/api/oauth/usage", token, headers)
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


def provider(name, login, fetch, previous, manual=False, poll=False, cache_seconds=120):
    try:
        token, headers = login()
        if not isinstance(token, str) or not token:
            names = {"openai": "Codex / OpenAI", "anthropic": "Claude Code"}
            return {"provider": name, "state": "unavailable", "message": f"Sign in to {names[name]}"}, {}
        result, state = fetch_usage(token, headers, fetch, previous, manual, poll, cache_seconds)
        return {"provider": name, **result}, state
    except (OSError, ValueError, TypeError):
        return {"provider": name, "state": "unavailable", "message": "Usage temporarily unavailable"}, {}


def collect(previous, manual, poll, cache_seconds):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = {name: pool.submit(provider, name, login, fetch, previous.get(name), manual, poll, cache_seconds)
                for name, login, fetch in [("openai", openai_login, openai),
                                           ("anthropic", anthropic_login, anthropic)]}
        results = {name: job.result() for name, job in jobs.items()}
    rows = [row for row, _state in results.values()]
    states = {name: state for name, (_row, state) in results.items()}
    return rows, states


def refresh_usage(refresh, poll, cache_seconds, started):
    cached = read_json(CACHE)
    completed = cached.get("_completed_ns")
    coalesced = timestamp(completed) and completed >= started
    previous = cached.get("_providers", {})
    rows, states = collect(previous if isinstance(previous, dict) else {},
                           refresh and not coalesced, poll and not coalesced, cache_seconds)
    result = {"version": 3, "updated": time.time(), "providers": rows}
    write_json(CACHE, {**result, "_providers": states, "_completed_ns": time.time_ns()})
    return result


def main(refresh=False, cache_seconds=120, poll=False):
    started = time.time_ns()
    with refresh_lock(CACHE.with_suffix(".lock")):
        print(json.dumps(refresh_usage(refresh, poll, cache_seconds, started)))


def positive_seconds(value):
    seconds = int(value)
    if seconds <= 0:
        raise argparse.ArgumentTypeError("Cache lifetime must be positive whole seconds.")
    return seconds


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Read subscription usage without modifying logins.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--refresh", action="store_true", help="Explicit refresh: bypass usage cache and rate-limit cooldowns.")
    mode.add_argument("--poll", action="store_true", help="Scheduled refresh: bypass usage cache but honor rate-limit cooldowns.")
    parser.add_argument("--cache-seconds", type=positive_seconds, default=120, help="Usage cache lifetime in seconds (default: 120).")
    args = parser.parse_args()
    main(refresh=args.refresh, cache_seconds=args.cache_seconds, poll=args.poll)
