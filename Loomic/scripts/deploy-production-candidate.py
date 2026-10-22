import argparse
import json
import os
import pathlib
import shlex
import sys
import time

import paramiko


DEFAULT_JUMP_HOST = "103.40.14.25"
DEFAULT_JUMP_PORT = 19198
DEFAULT_JUMP_USER = "add"
DEFAULT_TARGET_HOST = "23.251.32.222"
DEFAULT_TARGET_USER = "root"
DEFAULT_ROOT = "/www/helstera"
DEFAULT_HEALTH_URL = "https://studio.0st.top/api/health"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy a validated Helstera candidate to the configured target host.")
    parser.add_argument("archive", type=pathlib.Path)
    parser.add_argument("--password-env", default="HELT_DEPLOY_PASSWORD")
    parser.add_argument(
        "--direct",
        action="store_true",
        help="Connect to the target host directly instead of opening the configured jump-host tunnel.",
    )
    parser.add_argument("--jump-host", default=DEFAULT_JUMP_HOST)
    parser.add_argument("--jump-port", type=int, default=DEFAULT_JUMP_PORT)
    parser.add_argument("--jump-user", default=DEFAULT_JUMP_USER)
    parser.add_argument("--target-host", default=DEFAULT_TARGET_HOST)
    parser.add_argument("--target-user", default=DEFAULT_TARGET_USER)
    parser.add_argument("--root", default=DEFAULT_ROOT)
    parser.add_argument("--health-url", default=DEFAULT_HEALTH_URL)
    return parser.parse_args()


def remote_run(client: paramiko.SSHClient, command: str, timeout: int = 180) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    status = stdout.channel.recv_exit_status()
    if status != 0:
        raise RuntimeError(error[-4000:] or output[-4000:] or f"remote command failed with status {status}")
    return output.strip()


def active_jobs(client: paramiko.SSHClient, root: str) -> list[dict[str, object]]:
    script = """import pg from 'pg';
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const rows = (await db.query("select job_type,status,count(*)::int as count from background_jobs where status in ('queued','running') group by job_type,status")).rows;
console.log(JSON.stringify(rows));
await db.end();"""
    command = f"cd {shlex.quote(root + '/apps/server')} && node --env-file=../../.env.local --input-type=module -e {shlex.quote(script)}"
    raw = remote_run(client, command)
    return json.loads(raw or "[]")


def restore_backup(client: paramiko.SSHClient, root: str, backup: str) -> None:
    command = f"cd {shlex.quote(root)} && tar -xzf {shlex.quote(backup + '/current.tgz')}"
    remote_run(client, command, timeout=300)


def deploy(args: argparse.Namespace) -> None:
    archive = args.archive.resolve()
    if not archive.is_file():
        raise FileNotFoundError(archive)
    password = os.environ.get(args.password_env)
    if not password:
        raise RuntimeError(f"Missing deployment password environment variable: {args.password_env}")

    local_hash = __import__("hashlib").sha256(archive.read_bytes()).hexdigest().upper()
    jump = None
    if not args.direct:
        jump = paramiko.SSHClient()
        jump.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    target = paramiko.SSHClient()
    target.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    backup = None
    staging = None
    try:
        if args.direct:
            target.connect(args.target_host, username=args.target_user, password=password, timeout=20)
        else:
            assert jump is not None
            jump.connect(args.jump_host, port=args.jump_port, username=args.jump_user, allow_agent=True, look_for_keys=True, timeout=20)
            channel = jump.get_transport().open_channel(
                "direct-tcpip",
                (args.target_host, 22),
                ("127.0.0.1", 0),
                timeout=20,
            )
            target.connect(args.target_host, sock=channel, username=args.target_user, password=password, timeout=20)

        remote_run(target, f"test -d {shlex.quote(args.root)} && test -f {shlex.quote(args.root + '/.env.local')}")
        jobs = active_jobs(target, args.root)
        print("ACTIVE_JOBS", json.dumps(jobs, ensure_ascii=False), flush=True)
        if jobs:
            raise RuntimeError("Active queued/running jobs detected; deployment stopped before upload")

        root_path = shlex.quote(args.root)
        staging = remote_run(target, f"mktemp -d {root_path}/.helstera-candidate.XXXXXX")
        backup = remote_run(target, f"mktemp -d {root_path}/.helstera-backup.XXXXXX")
        print("BACKUP", backup, flush=True)
        print("LOCAL_SHA256", local_hash, flush=True)

        with target.open_sftp() as sftp:
            sftp.put(str(archive), staging + "/candidate.zip")

        root = shlex.quote(args.root)
        stage = shlex.quote(staging)
        backup_q = shlex.quote(backup)
        remote_run(target, f"mkdir -p {stage}/candidate && unzip -q {stage}/candidate.zip -d {stage}/candidate")
        remote_run(
            target,
            f"mkdir -p {stage}/candidate/apps/web/out/downloads; "
            f"if test -d {root}/apps/web/out/downloads; then "
            f"cp -an {root}/apps/web/out/downloads/. {stage}/candidate/apps/web/out/downloads/; fi",
        )
        remote_run(target, f"test -f {stage}/candidate/apps/web/out/index.html && test -f {stage}/candidate/apps/web/out/download/index.html && test -f {stage}/candidate/apps/web/out/downloads/Helstera-0.1.0.AppImage && test -f {stage}/candidate/apps/desktop/package.json && test -d {stage}/candidate/apps/web/out/_next/static && test -f {stage}/candidate/RELEASE-MANIFEST.json")
        remote_run(
            target,
            f"cd {root} && tar -czf {backup_q}/current.tgz apps/server/src apps/server/package.json apps/server/tsconfig.json apps/desktop/package.json apps/web/out packages/shared/dist package.json pnpm-lock.yaml pnpm-workspace.yaml",
            timeout=300,
        )

        remote_run(
            target,
            f"set -eu; cd {root}; "
            f"rm -rf .codex-next; mkdir -p .codex-next/apps/server .codex-next/apps/desktop .codex-next/apps/web .codex-next/packages/shared; "
            f"cp -a {stage}/candidate/apps/server/src .codex-next/apps/server/src; "
            f"cp -a {stage}/candidate/apps/server/package.json .codex-next/apps/server/package.json; "
            f"cp -a {stage}/candidate/apps/server/tsconfig.json .codex-next/apps/server/tsconfig.json; "
            f"cp -a {stage}/candidate/apps/desktop/package.json .codex-next/apps/desktop/package.json; "
            f"cp -a {stage}/candidate/apps/web/out .codex-next/apps/web/out; "
            f"cp -a {stage}/candidate/packages/shared/dist .codex-next/packages/shared/dist; "
            f"cp -a {stage}/candidate/package.json .codex-next/package.json; "
            f"cp -a {stage}/candidate/pnpm-lock.yaml .codex-next/pnpm-lock.yaml; "
            f"cp -a {stage}/candidate/pnpm-workspace.yaml .codex-next/pnpm-workspace.yaml; "
            f"rm -rf apps/server/src apps/web/out packages/shared/dist; "
            f"mv .codex-next/apps/server/src apps/server/src; "
            f"mv .codex-next/apps/web/out apps/web/out; "
            f"mv .codex-next/packages/shared/dist packages/shared/dist; "
            f"cp .codex-next/apps/server/package.json apps/server/package.json; "
            f"cp .codex-next/apps/server/tsconfig.json apps/server/tsconfig.json; "
            f"cp .codex-next/apps/desktop/package.json apps/desktop/package.json; "
            f"cp .codex-next/package.json package.json; cp .codex-next/pnpm-lock.yaml pnpm-lock.yaml; cp .codex-next/pnpm-workspace.yaml pnpm-workspace.yaml; "
            f"rm -rf .codex-next",
            timeout=300,
        )
        remote_run(target, f"cd {root} && pnpm install --no-frozen-lockfile", timeout=600)
        remote_run(target, f"cd {root}/apps/server && node --env-file=../../.env.local --import tsx ./src/local-db/migrate.ts", timeout=300)
        remote_run(target, f"pm2 restart helstera-worker --kill-timeout 1200000 && pm2 restart helstera-server --kill-timeout 30000 && pm2 save", timeout=300)
        remote_run(target, "nginx -t && systemctl reload nginx", timeout=60)
        health = remote_run(target, "for i in $(seq 1 30); do curl -fsS --max-time 3 http://127.0.0.1:3000/api/health && exit 0; sleep 1; done; exit 1", timeout=120)
        public_health = remote_run(target, f"curl -fsS --max-time 20 {shlex.quote(args.health_url)}", timeout=60)
        public_html_hash = remote_run(target, "curl -fsS --max-time 20 https://studio.0st.top/canvas/ | sha256sum | cut -d' ' -f1", timeout=60)
        print("HEALTH", health, flush=True)
        print("PUBLIC_HEALTH", public_health, flush=True)
        print("PUBLIC_CANVAS_HTML_SHA256", public_html_hash, flush=True)
        print("DEPLOYED", json.dumps({"target": args.target_host, "root": args.root, "backup": backup, "sha256": local_hash}), flush=True)
    except Exception:
        if backup:
            try:
                print("ROLLBACK", restore_backup(target, args.root, backup), flush=True)
                remote_run(target, "pm2 restart helstera-worker --kill-timeout 1200000 && pm2 restart helstera-server --kill-timeout 30000", timeout=300)
            except Exception as rollback_error:
                print("ROLLBACK_FAILED", str(rollback_error), file=sys.stderr, flush=True)
        raise
    finally:
        if target.get_transport() and target.get_transport().is_active():
            for temporary_path in (staging, backup):
                if temporary_path:
                    try:
                        remote_run(target, f"rm -rf {shlex.quote(temporary_path)}", timeout=120)
                    except Exception as cleanup_error:
                        print("CLEANUP_FAILED", str(cleanup_error), file=sys.stderr, flush=True)
            target.close()
        if jump is not None and jump.get_transport() and jump.get_transport().is_active():
            jump.close()


if __name__ == "__main__":
    deploy(parse_args())
