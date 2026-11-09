import contextlib
import io
import json
import multiprocessing
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/provider-usage"))
import usage
from usage_cache import write_json


def refresh_worker(directory, entered, release, results, waiting=False):
    """Separate Python helpers, as launched by separate Herdr panel instances."""
    home = Path(directory)
    usage.CACHE = home / "usage.json"
    usage.openai_login = lambda: ("openai-fixture", {})
    usage.anthropic_login = lambda: ("anthropic-fixture", {})

    def fetch(token, _headers):
        with (home / "requests").open("a") as log:
            log.write(token + "\n")
        entered.set()
        if not release.wait(10):
            raise RuntimeError("Fixture release timed out")
        return {"state": "ready", "windows": [{"label": "5h", "used": 12, "reset": None}]}

    usage.openai = fetch
    usage.anthropic = fetch
    lock = usage.refresh_lock

    @contextlib.contextmanager
    def waiting_lock(path):
        entered.set()
        with lock(path):
            yield

    if waiting:
        usage.refresh_lock = waiting_lock
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        usage.main(poll=True)
    results.put(json.loads(output.getvalue()))


class UsageConcurrencyTests(unittest.TestCase):
    def test_overlapping_helpers_share_one_fetch_per_provider(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as directory:
            entered, waiting, release = context.Event(), context.Event(), context.Event()
            results = context.Queue()
            first = context.Process(target=refresh_worker, args=(directory, entered, release, results))
            second = context.Process(target=refresh_worker, args=(directory, waiting, release, results, True))
            first.start()
            try:
                self.assertTrue(entered.wait(5), "First helper did not start its request")
                second.start()
                self.assertTrue(waiting.wait(5), "Second helper did not reach the cache lock")
                release.set()
                rows = [results.get(timeout=5)["providers"] for _ in range(2)]
                self.assertEqual(rows[0], rows[1])
                self.assertEqual(sorted((Path(directory) / "requests").read_text().splitlines()),
                                 ["anthropic-fixture", "openai-fixture"])
            finally:
                release.set()
                self.stop_worker(first)
                self.stop_worker(second)
                results.close()
                results.join_thread()

    def stop_worker(self, process):
        if process.pid is None:
            return
        process.join(timeout=5)
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
        self.assertEqual(process.exitcode, 0)

    def test_failed_atomic_save_preserves_previous_cache_and_leaves_no_temporary_file(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as directory:
            cache = Path(directory) / "usage.json"
            cache.write_text('{"version": 2}')
            with patch("usage_cache.json.dump", side_effect=OSError("Fixture write failure")):
                with self.assertRaises(OSError):
                    write_json(cache, {"version": 2, "providers": []})
            self.assertEqual(json.loads(cache.read_text()), {"version": 2})
            self.assertEqual(list(Path(directory).iterdir()), [cache])


if __name__ == "__main__":
    unittest.main()
