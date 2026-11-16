"""Switch only public gallery routes to a verified loopback recovery service."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Callable


GALLERY = re.compile(r"(?m)^(?P<indent>[ \t]*)location\s+\^~\s+/fashion-gallery/(?P<kind>img|thumbs)/\s*\{(?P<body>[^{}]*)\}")


def prepare(config: str, source_port: int, target_port: int) -> str:
    if not all(1024 <= port <= 65535 for port in (source_port, target_port)) or source_port == target_port:
        raise ValueError("Expected distinct unprivileged loopback ports")
    if re.search(r"location\s+[^{};]*?/api/public-media/fashion-gallery/", config):
        raise ValueError("Public media API locations already exist")
    blocks = list(GALLERY.finditer(config))
    if sorted(match['kind'] for match in blocks) != ['img', 'thumbs']:
        raise ValueError("Expected exactly one image and thumbnail proxy block")

    def replace(match: re.Match) -> str:
        kind = match['kind']
        proxy = re.compile(r"proxy_pass\s+http://127\.0\.0\.1:" + str(source_port) + r"/api/public-media/fashion-gallery/" + kind + r"/\s*;")
        body, count = proxy.subn(f"proxy_pass http://127.0.0.1:{target_port}/api/public-media/fashion-gallery/{kind}/;", match['body'])
        if count != 1:
            raise ValueError("Unexpected public gallery upstream")
        return match['indent'] + f"location ^~ /fashion-gallery/{kind}/ {{" + body + "}"

    updated = GALLERY.sub(replace, config)
    marker = GALLERY.search(updated)
    if marker is None:
        raise ValueError("Missing gallery marker after transformation")
    indent = marker['indent']
    aliases = ''.join(
        f"{indent}location ^~ /api/public-media/fashion-gallery/{kind}/ {{\n"
        f"{indent}    proxy_pass http://127.0.0.1:{target_port};\n"
        f"{indent}    proxy_http_version 1.1;\n"
        f"{indent}    proxy_set_header Host $host;\n"
        f"{indent}    proxy_read_timeout 180s;\n"
        f"{indent}}}\n" for kind in ('img', 'thumbs')
    )
    return updated[:marker.start()] + aliases + updated[marker.start():]


def atomic_write(path: Path, content: bytes) -> None:
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    descriptor, name = tempfile.mkstemp(prefix='.public-media-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, capture_output=True, text=True, timeout=30)


def apply(config: Path, backup: Path, receipt: Path, source_port: int, target_port: int,
          runner: Callable[[list[str]], None] = run) -> dict:
    config = config.resolve(strict=True)
    if backup.exists() or receipt.exists():
        raise FileExistsError("Recovery snapshot already exists; inspect before retrying")
    before = config.read_bytes()
    after = prepare(before.decode(), source_port, target_port).encode()
    descriptor = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(before)
        stream.flush()
        os.fsync(stream.fileno())
    if config.read_bytes() != before:
        raise RuntimeError("Nginx changed during preparation")
    report = {'config': str(config), 'backup': str(backup),
              'beforeSha256': hashlib.sha256(before).hexdigest(),
              'afterSha256': hashlib.sha256(after).hexdigest(),
              'sourcePort': source_port, 'targetPort': target_port, 'phase': 'routed'}
    atomic_write(config, after)
    try:
        runner(['nginx', '-t'])
        runner(['nginx', '-s', 'reload'])
        if config.read_bytes() != after:
            raise RuntimeError("Nginx changed during recovery; receipt not written")
        atomic_write(receipt, (json.dumps(report, indent=2) + '\n').encode())
    except Exception as recovery_error:
        if config.read_bytes() != after:
            raise RuntimeError("Nginx changed during recovery; snapshot restoration refused") from recovery_error
        atomic_write(config, before)
        runner(['nginx', '-t'])
        runner(['nginx', '-s', 'reload'])
        raise
    return report


def rollback(receipt: Path, runner: Callable[[list[str]], None] = run) -> dict:
    report = json.loads(receipt.read_bytes())
    config, backup = Path(report['config']), Path(report['backup'])
    routed = config.read_bytes()
    if hashlib.sha256(routed).hexdigest() != report['afterSha256']:
        raise RuntimeError("Nginx changed after recovery; rollback refused")
    before = backup.read_bytes()
    if hashlib.sha256(before).hexdigest() != report['beforeSha256']:
        raise RuntimeError("Nginx backup differs from its receipt")
    if config.read_bytes() != routed or backup.read_bytes() != before:
        raise RuntimeError("Nginx config or backup changed during rollback preparation")
    atomic_write(config, before)
    try:
        runner(['nginx', '-t'])
        runner(['nginx', '-s', 'reload'])
        if config.read_bytes() != before:
            raise RuntimeError("Nginx changed during rollback; receipt not written")
        report['phase'] = 'rolled_back'
        atomic_write(receipt, (json.dumps(report, indent=2) + '\n').encode())
    except Exception as rollback_error:
        if config.read_bytes() != before:
            raise RuntimeError("Nginx changed during rollback; recovery restoration refused") from rollback_error
        try:
            atomic_write(config, routed)
            runner(['nginx', '-t'])
            runner(['nginx', '-s', 'reload'])
        except Exception as restore_error:
            raise RuntimeError("Rollback failed; recovery routing could not be restored") from restore_error
        raise
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--source-port', type=int, default=3003)
    parser.add_argument('--target-port', type=int, default=3014)
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    if args.rollback:
        print(json.dumps(rollback(args.receipt)))
    else:
        if args.config is None or args.backup is None:
            parser.error('--config and --backup are required for route recovery')
        print(json.dumps(apply(args.config, args.backup, args.receipt, args.source_port, args.target_port)))
