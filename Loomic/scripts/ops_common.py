"""Shared filesystem and process boundaries for production maintenance."""
import json
import os
from pathlib import Path
import subprocess
from typing import Any


def read_config(path: str) -> dict[str, Any]:
    config = json.loads(Path(path).read_text())
    for key in ['root', 'backupRoot', 'envFile', 'server', 'pgBin', 'publicKey', 'storagePrefix']:
        if not config.get(key):
            raise ValueError('Missing operations setting: ' + key)
    return config


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix(path.suffix + '.pending')
    pending.write_text(json.dumps(payload, indent=2))
    pending.chmod(0o600)
    os.replace(pending, path)


def runtime(config_path: str, action: str, *args: str, timeout: int = 60) -> dict[str, Any]:
    script = Path(__file__).with_name('ops-runtime.mjs')
    process = subprocess.run(['node', str(script), config_path, action, *args], capture_output=True, text=True, timeout=timeout)
    if process.returncode:
        # Upstream exceptions may contain credentials; the helper emits only a category.
        raise RuntimeError('Operations runtime failed: ' + action + ' (' + str(process.returncode) + ')')
    return json.loads(process.stdout)


def lock_operation(root: Path, name: str):
    import fcntl
    root.mkdir(parents=True, exist_ok=True)
    lock = (root / (name + '.lock')).open('a+')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return lock
