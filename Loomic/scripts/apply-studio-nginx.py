from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile


def atomic_write(path: Path, content: bytes, mode: int, uid: int, gid: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".studio-nginx-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), mode)
            os.fchown(output.fileno(), uid, gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply(config_path: Path, validator_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("studio_nginx_guard", validator_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load the Nginx configuration validator")
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    target = config_path.resolve(strict=True)
    previous = target.read_bytes()
    metadata = target.stat()
    candidate = guard.prepare_creative_isolation(guard.prepare_assistant_websocket(guard.prepare_studio_config(previous.decode("utf-8")))).encode("utf-8")
    if target.read_bytes() != previous:
        raise RuntimeError("Nginx configuration changed during preparation")
    atomic_write(target, candidate, metadata.st_mode & 0o7777, metadata.st_uid, metadata.st_gid)
    try:
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except Exception:
        if target.read_bytes() != candidate:
            raise RuntimeError("Nginx configuration changed after installation; manual recovery required")
        atomic_write(target, previous, metadata.st_mode & 0o7777, metadata.st_uid, metadata.st_gid)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
        raise


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        raise SystemExit("Usage: apply-studio-nginx.py CONFIG VALIDATOR")
    apply(Path(sys.argv[1]), Path(sys.argv[2]))
