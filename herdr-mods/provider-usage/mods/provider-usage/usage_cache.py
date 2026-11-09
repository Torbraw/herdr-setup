"""Private usage persistence and cross-process refresh coalescing; never stores logins."""

import contextlib
import json
import os
import tempfile
from pathlib import Path


def read_json(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".provider-usage-", delete=False) as file:
        temporary = Path(file.name)
        try:
            json.dump(value, file)
            file.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def refresh_lock(path):
    """OS-owned lock: crashes release it; waiting processes reread the completed cache."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "a+b") as file:
        if os.name == "nt":
            import msvcrt
            if os.fstat(file.fileno()).st_size == 0:
                file.write(b"\0")
                file.flush()
            file.seek(0)
            msvcrt.locking(file.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(file, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                file.seek(0)
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(file, fcntl.LOCK_UN)
