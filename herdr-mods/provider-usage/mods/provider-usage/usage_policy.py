"""Credential-scoped usage cooldowns and last-good readings, not authentication repair."""

import hashlib
import json
import math
import time
import urllib.error
from email.utils import parsedate_to_datetime

DEFAULT_COOLDOWN = 5 * 60


def timestamp(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def retry_after(value, now):
    """Retry-After supports delta seconds and HTTP dates; invalid/past values use five minutes."""
    try:
        seconds = float(value)
        until = now + seconds
    except (TypeError, ValueError):
        try:
            until = parsedate_to_datetime(value).timestamp()
        except (TypeError, ValueError, OverflowError):
            return now + DEFAULT_COOLDOWN
    return until if timestamp(until) and until > now else now + DEFAULT_COOLDOWN


def scoped_state(previous, token, headers):
    identity = json.dumps([token, headers], sort_keys=True).encode()
    fingerprint = hashlib.sha256(identity).hexdigest()
    if isinstance(previous, dict) and previous.get("credential") == fingerprint:
        return dict(previous)
    return {"credential": fingerprint}


def retained(state, message):
    good = state.get("last_good", {})
    if isinstance(good, dict) and isinstance(good.get("windows"), list) and timestamp(good.get("updated")):
        return {"state": "stale", "windows": good["windows"], "updated": good["updated"], "message": message}
    return {"state": "unavailable", "message": message}


def http_failure(error, state):
    if error.code == 429:
        now = time.time()
        candidate = retry_after((error.headers or {}).get("Retry-After"), now)
        existing = state.get("retry_at", 0)
        state["retry_at"] = max(existing if timestamp(existing) else 0, candidate)
        return retained(state, "Rate limited; retry later")
    if error.code >= 500:
        return retained(state, f"Provider error {error.code}")
    state.pop("last_good", None)
    state.pop("retry_at", None)
    messages = {401: "Login expired", 403: "Usage access denied"}
    return {"state": "unavailable", "message": messages.get(error.code, f"Provider error {error.code}")}


def attempt(token, headers, fetch, state):
    try:
        result = fetch(token, headers)
    except urllib.error.HTTPError as error:
        return http_failure(error, state)
    except (OSError, ValueError, TypeError):
        return retained(state, "Usage temporarily unavailable")
    state.pop("retry_at", None)
    if result["state"] == "ready":
        state["last_good"] = {"windows": result["windows"], "updated": time.time()}
    else:
        state.pop("last_good", None)
    return result


def recent_result(state, cache_seconds):
    checked = state.get("checked")
    return timestamp(checked) and 0 <= time.time() - checked < cache_seconds and isinstance(state.get("result"), dict)


def fetch_usage(token, headers, fetch, previous, manual=False, poll=False, cache_seconds=120):
    state = scoped_state(previous, token, headers)
    if not (manual or poll) and recent_result(state, cache_seconds):
        return state["result"], state
    until = state.get("retry_at", 0)
    if not manual and timestamp(until) and until > time.time():
        return retained(state, "Rate limited; retry later"), state
    result = attempt(token, headers, fetch, state)
    state.update(result=result, checked=time.time())
    return result, state
