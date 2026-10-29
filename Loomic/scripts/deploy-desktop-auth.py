#!/usr/bin/env python3
"""Safely publish only the desktop login routes and restart the API process."""

from __future__ import annotations

import getpass
import hashlib
import pathlib
import shlex
import sys
import time

import paramiko


ROOT = "/www/helstera"
JUMP_HOST = "103.40.14.25"
JUMP_PORT = 19198
JUMP_USER = "add"
TARGET_HOST = "23.251.32.222"
TARGET_USER = "root"
HEALTH_URL = "https://studio.0st.top/api/health"
AUTH_URL = "https://studio.0st.top/api/local-auth/desktop-confirm"


def remote(client: paramiko.SSHClient, command: str, timeout: int = 60) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    status = stdout.channel.recv_exit_status()
    if status:
        raise RuntimeError(error[-2000:] or output[-2000:] or f"remote command exited {status}")
    return output.strip()


def connect() -> tuple[paramiko.SSHClient, paramiko.SSHClient]:
    jump = paramiko.SSHClient()
    target = paramiko.SSHClient()
    jump.load_system_host_keys()
    target.load_system_host_keys()
    jump.set_missing_host_key_policy(paramiko.RejectPolicy())
    target.set_missing_host_key_policy(paramiko.RejectPolicy())
    jump.connect(
        JUMP_HOST,
        port=JUMP_PORT,
        username=JUMP_USER,
        allow_agent=True,
        look_for_keys=True,
        timeout=20,
    )
    channel = jump.get_transport().open_channel(
        "direct-tcpip", (TARGET_HOST, 22), ("127.0.0.1", 0), timeout=20
    )
    target.connect(
        TARGET_HOST,
        username=TARGET_USER,
        password=getpass.getpass("Production server password (input hidden): "),
        sock=channel,
        timeout=20,
    )
    return jump, target


def deploy() -> None:
    source = pathlib.Path(__file__).resolve().parents[1] / "apps/server/src/http/local-auth.ts"
    payload = source.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    target_file = f"{ROOT}/apps/server/src/http/local-auth.ts"
    backup_file = f"{target_file}.backup-{stamp}"
    staged_file = f"{target_file}.stage-{stamp}"
    jump, target = connect()
    replaced = False
    try:
        root = shlex.quote(ROOT)
        live = shlex.quote(target_file)
        backup = shlex.quote(backup_file)
        staged = shlex.quote(staged_file)
        remote(target, f"test -f {live} && test -f {root}/.env.local")
        with target.open_sftp() as sftp:
            sftp.putfo(__import__("io").BytesIO(payload), staged_file)
        remote(target, f"test \"$(sha256sum {staged} | cut -d' ' -f1)\" = {shlex.quote(digest)}")
        remote(target, f"cp -p {live} {backup} && chmod --reference={live} {staged} && mv -f {staged} {live}")
        replaced = True
        remote(target, "pm2 restart helstera-server --kill-timeout 30000", timeout=120)
        health = remote(
            target,
            "for i in $(seq 1 30); do curl -fsS --max-time 3 http://127.0.0.1:3000/api/health && exit 0; sleep 1; done; exit 1",
            timeout=60,
        )
        probe = remote(
            target,
            "curl -sS --max-time 15 -o /tmp/helstera-desktop-auth-probe.json -w '%{http_code}' "
            f"-H 'content-type: application/json' -d '{{\"state\":\"{'A' * 43}\"}}' {shlex.quote(AUTH_URL)}",
            timeout=30,
        )
        if probe != "401":
            raise RuntimeError(f"desktop-confirm should reject unauthenticated requests with 401, got {probe}")
        print(f"DEPLOYED_SHA256 {digest}")
        print(f"BACKUP {backup_file}")
        print(f"HEALTH {health}")
        print("DESKTOP_CONFIRM_STATUS 401 (route registered; browser session required)")
    except Exception:
        if replaced:
            remote(target, f"cp -p {backup} {live} && pm2 restart helstera-server --kill-timeout 30000", timeout=120)
            print(f"ROLLED_BACK {backup_file}", file=sys.stderr)
        raise
    finally:
        try:
            remote(target, f"rm -f {staged}")
        except Exception as cleanup_error:
            print(f"STAGING_CLEANUP_FAILED {cleanup_error}", file=sys.stderr)
        target.close()
        jump.close()


if __name__ == "__main__":
    try:
        deploy()
    except Exception as error:
        print(f"DEPLOY_FAILED {error}", file=sys.stderr)
        raise SystemExit(1) from error
