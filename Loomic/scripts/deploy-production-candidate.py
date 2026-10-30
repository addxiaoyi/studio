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
    parser.add_argument("--resume-staging")
    parser.add_argument("--resume-backup")
    return parser.parse_args()


def remote_run(client: paramiko.SSHClient, command: str, timeout: int = 180) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    status = stdout.channel.recv_exit_status()
    if status != 0:
        raise RuntimeError(error[-4000:] or output[-4000:] or f"remote command failed with status {status}")
    return output.strip()


def configure_ssh(client: paramiko.SSHClient) -> None:
    client.load_system_host_keys()
    pinned_hosts = pathlib.Path(__file__).with_name("production-known-hosts")
    if pinned_hosts.is_file():
        client.load_host_keys(str(pinned_hosts))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())


def validate_remote_temp(path: str, root: str, prefix: str) -> str:
    candidate = pathlib.PurePosixPath(path)
    if candidate.parent != pathlib.PurePosixPath(root) or not candidate.name.startswith(prefix):
        raise RuntimeError("Remote temporary path is outside the deployment root.")
    return str(candidate)


def active_jobs(client: paramiko.SSHClient, root: str) -> list[dict[str, object]]:
    command = (
        f"set -a; . {shlex.quote(root + '/.env.local')}; set +a; "
        f"psql \"$DATABASE_URL\" -At -F '|' -c "
        f"\"select job_type,status,count(*)::int from background_jobs where status in ('queued','running') group by job_type,status\""
    )
    raw = remote_run(client, command)
    rows: list[dict[str, object]] = []
    for line in raw.splitlines():
        job_type, status, count = line.split("|", 2)
        rows.append({"job_type": job_type, "status": status, "count": int(count)})
    return rows


def restore_backup(client: paramiko.SSHClient, root: str, backup: str) -> None:
    command = f"cd {shlex.quote(root)} && tar -xzf {shlex.quote(backup + '/current.tgz')}"
    remote_run(client, command, timeout=300)


def prepare_candidate_command(root: str, staging: str) -> str:
    root_q = shlex.quote(root)
    stage_q = shlex.quote(staging)
    return (
        f"set -eu; cd {root_q}; candidate={stage_q}/candidate; next={stage_q}/next; "
        f"mkdir -p $next/apps/server $next/apps/desktop $next/apps/web $next/packages/shared; "
        f"cp -a {root_q}/apps/server/src $next/apps/server/src; "
        f"cp -a $candidate/apps/server/src/. $next/apps/server/src/; "
        f"cp -a {root_q}/packages/shared/dist $next/packages/shared/dist; "
        f"if test -d $candidate/packages/shared/dist; then cp -a $candidate/packages/shared/dist/. $next/packages/shared/dist/; fi; "
        f"mkdir -p $next/deploy; cp -a $candidate/deploy/server-runtime $next/deploy/server-runtime; "
        f"if test -f $candidate/apps/web/out/index.html; then cp -a $candidate/apps/web/out $next/apps/web/out; else cp -a {root_q}/apps/web/out $next/apps/web/out; fi; "
        f"for path in apps/server/package.json apps/server/tsconfig.json apps/desktop/package.json package.json pnpm-lock.yaml pnpm-workspace.yaml; do "
        f"source=$candidate/$path; test -f $source || source={root_q}/$path; "
        f"mkdir -p $next/$(dirname $path); cp -p $source $next/$path; done"
    )


def replace_live_command(root: str, staging: str) -> str:
    root_q = shlex.quote(root)
    stage_q = shlex.quote(staging)
    swaps = json.dumps([
        [root + "/apps/server/src", staging + "/next/apps/server/src"],
        [root + "/apps/web/out", staging + "/next/apps/web/out"],
        [root + "/packages/shared/dist", staging + "/next/packages/shared/dist"],
    ])
    swap_script = f"""import ctypes, json, os
pairs = json.loads({swaps!r})
renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
def exchange(left, right):
    if renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), left, right)
done = []
try:
    for live, candidate in pairs:
        exchange(live, candidate)
        done.append((live, candidate))
except Exception as error:
    rollback_errors = []
    for live, candidate in reversed(done):
        try:
            exchange(live, candidate)
        except Exception as rollback_error:
            rollback_errors.append(rollback_error)
    if rollback_errors:
        raise RuntimeError(f"Atomic directory exchange failed and rollback was incomplete: {{rollback_errors}}") from error
    raise
"""
    return (
        f"set -eu; cd {root_q}; python3 -c {shlex.quote(swap_script)}; "
        f"cp {stage_q}/next/apps/server/package.json apps/server/package.json; "
        f"cp {stage_q}/next/apps/server/tsconfig.json apps/server/tsconfig.json; "
        f"cp {stage_q}/next/apps/desktop/package.json apps/desktop/package.json; "
        f"cp {stage_q}/next/package.json package.json; "
        f"cp {stage_q}/next/pnpm-lock.yaml pnpm-lock.yaml; "
        f"cp {stage_q}/next/pnpm-workspace.yaml pnpm-workspace.yaml"
    )


def ensure_studio_assistant_websocket_command() -> str:
    nginx_path = "/etc/nginx/sites-enabled/studio.0st.top.conf"
    patch = (
        "from pathlib import Path; "
        f"p=Path({nginx_path!r}); s=p.read_text(); "
        "marker='    location /api/ {'; "
        "insert='    location /api/website-capture/assistant/ws {\\n"
        "        proxy_pass http://127.0.0.1:3000;\\n"
        "        proxy_http_version 1.1;\\n"
        "        proxy_set_header Upgrade $http_upgrade;\\n"
        "        proxy_set_header Connection \\\"upgrade\\\";\\n"
        "        proxy_set_header Host $host;\\n"
        "        proxy_set_header X-Real-IP $remote_addr;\\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\\n"
        "        proxy_read_timeout 3600s;\\n"
        "        proxy_send_timeout 3600s;\\n"
        "    }\\n\\n'; "
        "p.write_text(s.replace(marker, insert + marker, 1)) if 'location /api/website-capture/assistant/ws' not in s else None"
    )
    return (
        f"if ! grep -q 'location /api/website-capture/assistant/ws' {shlex.quote(nginx_path)}; then "
        f"cp {shlex.quote(nginx_path)} {shlex.quote(nginx_path + '.bak-helstera')}; "
        f"python3 -c {shlex.quote(patch)}; fi; nginx -t && systemctl reload nginx"
    )


def deploy(args: argparse.Namespace) -> None:
    if args.resume_staging and not args.resume_backup:
        raise ValueError("--resume-staging requires --resume-backup.")
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
        configure_ssh(jump)
    target = paramiko.SSHClient()
    configure_ssh(target)
    backup = None
    staging = None
    replacement_started = False
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
        if args.resume_staging:
            staging = validate_remote_temp(args.resume_staging, args.root, ".helstera-candidate.")
            backup = validate_remote_temp(args.resume_backup, args.root, ".helstera-backup.")
            remote_run(target, f"test -f {shlex.quote(staging + '/candidate.zip')} && test -f {shlex.quote(backup + '/current.tgz')}")
        else:
            staging = validate_remote_temp(
                remote_run(target, f"mktemp -d {root_path}/.helstera-candidate.XXXXXX"),
                args.root,
                ".helstera-candidate.",
            )
            backup = validate_remote_temp(args.resume_backup, args.root, ".helstera-backup.") if args.resume_backup else validate_remote_temp(
                remote_run(target, f"mktemp -d {root_path}/.helstera-backup.XXXXXX"),
                args.root,
                ".helstera-backup.",
            )
        print("BACKUP", backup, flush=True)
        print("LOCAL_SHA256", local_hash, flush=True)

        if not args.resume_staging:
            with target.open_sftp() as sftp:
                sftp.put(str(archive), staging + "/candidate.zip")
        else:
            remote_hash = remote_run(target, f"sha256sum {shlex.quote(staging + '/candidate.zip')} | cut -d' ' -f1").upper()
            if remote_hash != local_hash:
                raise RuntimeError("Resumed candidate archive SHA-256 does not match the local patch.")

        root = shlex.quote(args.root)
        stage = shlex.quote(staging)
        backup_q = shlex.quote(backup)
        if not args.resume_staging:
            remote_run(target, f"mkdir -p {stage}/candidate && unzip -q {stage}/candidate.zip -d {stage}/candidate")
        remote_run(
            target,
            f"mkdir -p {stage}/candidate/apps/web/out/downloads; "
            f"if test -d {root}/apps/web/out/downloads; then "
            f"cp -an {root}/apps/web/out/downloads/. {stage}/candidate/apps/web/out/downloads/; fi",
        )
        required_candidate_files = (
            "apps/server/src/app.ts",
            "apps/server/src/http/website-capture.ts",
            "apps/server/src/http/agent-marketplace.ts",
            "apps/server/src/agent/workspace-skills.ts",
            "apps/server/src/features/website-capture/assistant-hub.ts",
            "apps/server/src/features/website-capture/assistant-hub-integration.test.ts",
            "packages/shared/dist/website-capture.js",
            "packages/shared/dist/website-capture.d.ts",
            "apps/server/src/local-db/migrations/20261026000000_agent_marketplace_catalog.sql",
            "apps/server/src/local-db/migrations/20261026000001_desktop_agent_recovery.sql",
            "apps/server/src/local-db/migrations/20261026000002_desktop_agent_chat_recovery.sql",
            "apps/server/src/local-db/migrations/20261030000000_agent_goals.sql",
            "apps/server/src/local-db/migrations/20261030000001_agent_goal_retry.sql",
            "apps/server/src/local-db/migrations/20261030000002_agent_goal_background.sql",
            "apps/server/src/features/agent-goals/agent-goal-background.ts",
            "apps/server/src/features/agent-goals/agent-goal-events.ts",
            "apps/server/src/features/agent-goals/agent-goal-service.ts",
            "apps/server/src/features/agent-goals/agent-goal-worker.ts",
            "apps/server/src/http/agent-goals.ts",
            "deploy/server-runtime/pnpm-lock.yaml",
            "deploy/server-runtime/pnpm-workspace.yaml",
            "RELEASE-MANIFEST.json",
        )
        candidate_checks = " && ".join(
            f"test -f {shlex.quote(staging + '/candidate/' + path)}"
            for path in required_candidate_files
        )
        remote_run(
            target,
            f"test -d {root}/apps/web/out/_next/static && "
            f"test -f {root}/apps/web/out/desktop-app/index.html && "
            f"test -f {root}/apps/server/src/local-db/migrate.ts && "
            f"test -f {root}/apps/server/src/local-db/migrations/20261027000000_agent_marketplace_installs.sql && "
            f"{candidate_checks}",
        )
        database_dump = backup + "/database.dump"
        database_dump_q = shlex.quote(database_dump)
        if not args.resume_backup or not remote_run(target, f"test -f {backup_q}/current.tgz && test -f {database_dump_q} && test -f {shlex.quote(database_dump + '.sha256')} && sha256sum -c {shlex.quote(database_dump + '.sha256')} >/dev/null && pg_restore --list {database_dump_q} >/dev/null && echo valid", timeout=300).endswith("valid"):
            remote_run(
                target,
                f"cd {root} && tar -czf {backup_q}/current.tgz apps/server/src apps/server/package.json apps/server/tsconfig.json apps/desktop/package.json apps/web/out packages/shared/dist package.json pnpm-lock.yaml pnpm-workspace.yaml",
                timeout=300,
            )
            remote_run(
                target,
                f"set -eu; cd {root}; set -a; . ./.env.local; set +a; "
                f"test -n \"${{DATABASE_URL:-}}\"; "
                f"pg_dump --format=custom --no-owner --no-acl --file={database_dump_q} \"$DATABASE_URL\"; "
                f"pg_restore --list {database_dump_q} >/dev/null; "
                f"sha256sum {database_dump_q} > {shlex.quote(database_dump + '.sha256')}; "
                f"cat {shlex.quote(database_dump + '.sha256')}",
                timeout=3600,
            )

        remote_run(target, prepare_candidate_command(args.root, staging), timeout=300)
        replacement_started = True
        remote_run(target, replace_live_command(args.root, staging), timeout=300)
        remote_run(
            target,
            f"cd {root} && rm -rf .server-runtime && cp -a {stage}/next/deploy/server-runtime .server-runtime",
            timeout=300,
        )
        remote_run(
            target,
            f"cd {root} && find apps/web/out -type d -exec chmod 755 {{}} + && find apps/web/out -type f -exec chmod 644 {{}} +",
            timeout=300,
        )
        remote_run(target, f"cd {root} && CI=true pnpm --dir .server-runtime install --frozen-lockfile --ignore-scripts --no-prod", timeout=600)
        remote_run(
            target,
            f"cd {root} && pnpm --dir .server-runtime --filter @helstera/server exec playwright install chromium",
            timeout=1200,
        )
        remote_run(
            target,
            f"test -d \"$HOME/.cache/ms-playwright\" && "
            f"find \"$HOME/.cache/ms-playwright\" -type f \( -name chrome -o -name headless_shell \) -perm -u+x -print -quit | grep -q .",
            timeout=60,
        )
        remote_run(
            target,
            f"cd {root} && rm -rf node_modules apps/server/node_modules && ln -s .server-runtime/node_modules node_modules && ln -s ../../.server-runtime/apps/server/node_modules apps/server/node_modules",
            timeout=120,
        )
        remote_run(target, f"cd {root}/apps/server && node --env-file=../../.env.local --import tsx ./src/local-db/migrate.ts", timeout=300)
        remote_run(target, f"pm2 restart helstera-worker --kill-timeout 1200000 && pm2 restart helstera-server --kill-timeout 30000 && pm2 save", timeout=300)
        remote_run(target, ensure_studio_assistant_websocket_command(), timeout=60)
        health = remote_run(target, "for i in $(seq 1 30); do curl -fsS --max-time 3 http://127.0.0.1:3000/api/health && exit 0; sleep 1; done; exit 1", timeout=120)
        public_health = remote_run(target, f"curl -fsS --max-time 20 {shlex.quote(args.health_url)}", timeout=60)
        public_html_hash = remote_run(target, "curl -fsS --max-time 20 https://studio.0st.top/canvas/ | sha256sum | cut -d' ' -f1", timeout=60)
        print("HEALTH", health, flush=True)
        print("PUBLIC_HEALTH", public_health, flush=True)
        print("PUBLIC_CANVAS_HTML_SHA256", public_html_hash, flush=True)
        print("DEPLOYED", json.dumps({"target": args.target_host, "root": args.root, "backup": backup, "databaseBackup": database_dump, "sha256": local_hash}), flush=True)
    except Exception:
        if backup and replacement_started:
            try:
                print("ROLLBACK", restore_backup(target, args.root, backup), flush=True)
                remote_run(target, "pm2 restart helstera-worker --kill-timeout 1200000 && pm2 restart helstera-server --kill-timeout 30000", timeout=300)
            except Exception as rollback_error:
                print("ROLLBACK_FAILED", str(rollback_error), file=sys.stderr, flush=True)
        raise
    finally:
        if target.get_transport() and target.get_transport().is_active():
            if staging:
                try:
                    remote_run(target, f"rm -rf {shlex.quote(staging)}", timeout=120)
                except Exception as cleanup_error:
                    print("STAGING_CLEANUP_FAILED", str(cleanup_error), file=sys.stderr, flush=True)
            target.close()
        if jump is not None and jump.get_transport() and jump.get_transport().is_active():
            jump.close()


if __name__ == "__main__":
    deploy(parse_args())
