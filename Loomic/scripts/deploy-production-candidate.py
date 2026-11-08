import argparse
import hashlib
import json
import os
import pathlib
import re
import shlex
import stat
import sys
import time
import zipfile
from urllib.parse import urlsplit

import paramiko


DEFAULT_JUMP_HOST = "103.40.14.25"
DEFAULT_JUMP_PORT = 19198
DEFAULT_JUMP_USER = "add"
DEFAULT_TARGET_HOST = "23.251.32.222"
DEFAULT_TARGET_USER = "root"
DEFAULT_ROOT = "/www/helstera"
DEFAULT_HEALTH_URL = "https://studio.0st.top/api/health"
AGENT_AUTH_PROBE = r'''import json, sys, urllib.error, urllib.request
base = sys.argv[1].rstrip('/')
for name in ('goals', 'suggestions', 'memories', 'connectors'):
    url = base + '/api/agent/' + name
    try:
        response = urllib.request.urlopen(url, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status = response.status
        try:
            body = json.load(response)
        except (ValueError, UnicodeDecodeError):
            raise SystemExit(name + ': response is not JSON')
    if status != 401 or not isinstance(body, dict) or body.get('ok') is not False or not isinstance(body.get('error'), dict) or body['error'].get('code') != 'unauthorized':
        raise SystemExit(name + ': expected a JSON unauthorized response, got HTTP ' + str(status))
    print(name + ': HTTP 401 unauthorized')
'''


def agent_auth_probe_command(base_url: str) -> str:
    return f"python3 -c {shlex.quote(AGENT_AUTH_PROBE)} {shlex.quote(base_url)}"


STATIC_PROBE = r'''import hashlib, pathlib, sys, urllib.error, urllib.request
base = sys.argv[1].rstrip('/')
root = pathlib.Path(sys.argv[2])
for route, relative, content_type in (
    ('/fashion-gallery/', 'fashion-gallery/index.html', 'text/html'),
    ('/video/', 'video/index.html', 'text/html'),
    ('/fashion-gallery/img/SPR-0001.webp', 'fashion-gallery/img/SPR-0001.webp', 'image/webp'),
):
    request = urllib.request.Request(base + route, headers={'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200 or response.headers.get_content_type() != content_type:
            raise RuntimeError(f'Unexpected response for {route}: {response.status} {response.headers.get_content_type()}')
        actual = hashlib.sha256(response.read()).digest()
    expected = hashlib.sha256((root / relative).read_bytes()).digest()
    if actual != expected:
        raise RuntimeError(f'Candidate content mismatch for {route}')
try:
    urllib.request.urlopen(base + '/fashion-gallery/img/__loomic_missing_probe__.webp', timeout=20)
except urllib.error.HTTPError as error:
    if error.code != 404:
        raise RuntimeError(f'Missing static asset returned {error.code}, expected 404') from error
else:
    raise RuntimeError('Missing static asset did not return 404')
print('static routes, content hashes and missing asset verified')
'''


def static_probe_command(base_url: str, candidate_web_root: str) -> str:
    return f"python3 -c {shlex.quote(STATIC_PROBE)} {shlex.quote(base_url)} {shlex.quote(candidate_web_root)}"


def health_origin(health_url: str) -> str:
    parsed = urlsplit(health_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("Health URL must be an HTTP(S) URL without credentials.")
    return f"{parsed.scheme}://{parsed.netloc}"


def validate_candidate_archive(archive: pathlib.Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        files: dict[str, zipfile.ZipInfo] = {}
        seen: set[str] = set()
        for entry in bundle.infolist():
            name = entry.filename
            parts = name.rstrip("/").split("/")
            if (not name or "\\" in name or name.startswith("/") or
                    any(part in ("", ".", "..") or ":" in part for part in parts)):
                raise ValueError("Candidate archive contains an unsafe path.")
            if name in seen:
                raise ValueError(f"Candidate archive contains a duplicate entry: {name}")
            seen.add(name)
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError(f"Candidate archive contains a symbolic link: {name}")
            if entry.flag_bits & 1:
                raise ValueError("Encrypted candidate archives are not supported.")
            if not entry.is_dir():
                files[name] = entry

        if "RELEASE-MANIFEST.json" not in files:
            raise ValueError("Candidate archive is missing its release manifest.")
        manifest = json.loads(bundle.read(files["RELEASE-MANIFEST.json"]))
        entries = manifest.get("files") if isinstance(manifest, dict) else None
        if not isinstance(entries, dict) or set(entries) != set(files) - {"RELEASE-MANIFEST.json"}:
            raise ValueError("Candidate manifest does not match the archive files.")
        for name, details in entries.items():
            digest = details.get("sha256") if isinstance(details, dict) else None
            if not isinstance(digest, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", digest):
                raise ValueError(f"Candidate manifest has an invalid SHA-256 for {name}.")
            hasher = hashlib.sha256()
            with bundle.open(files[name]) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    hasher.update(chunk)
            if hasher.hexdigest() != digest.lower():
                raise ValueError(f"Candidate file SHA-256 mismatch: {name}")


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
    parser.add_argument("--superseded-backup", help="Remove this inspected old backup only after the new dump and archive have been verified.")
    parser.add_argument("--isolated-restore", action="store_true", help="Rehearse the database restore in a private PostgreSQL cluster under the deployment root.")
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


def verify_candidate_upload(client: paramiko.SSHClient, staging: str, local_hash: str) -> None:
    archive = shlex.quote(staging + "/candidate.zip")
    remote_hash = remote_run(client, f"sha256sum {archive} | cut -d' ' -f1").upper()
    if remote_hash != local_hash.upper():
        raise RuntimeError("Remote candidate archive SHA-256 does not match the local archive.")


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


def database_restore_space_command(root: str, isolated: bool = False) -> str:
    url_check = (
        "import os,urllib.parse; u=urllib.parse.urlsplit(os.environ['DATABASE_URL']); "
        "assert u.scheme in ('postgres','postgresql') and u.hostname in ('127.0.0.1','localhost','::1'); "
        "q=urllib.parse.parse_qs(u.query,keep_blank_values=True); "
        "assert not set(q).intersection(('host','hostaddr','port','dbname','service','options')); "
        "assert not any(os.environ.get(k) for k in ('PGHOST','PGHOSTADDR','PGPORT','PGSERVICE','PGOPTIONS')); "
        "print(u.port or 5432)"
    )
    capacity_check = (
        "import os,sys; path=sys.argv[1]; size=int(sys.argv[2]); s=os.statvfs(path); "
        "available=s.f_bavail*s.f_frsize; required=size*2+1024**3; "
        "print(f'restore disk available={available} required={required}'); "
        "sys.exit(0 if size>0 and available>=required else 1)"
    )
    checks = (
        f"python3 -c {shlex.quote(capacity_check)} \"$data_dir\" \"$db_size\""
    )
    if isolated:
        reserve_check = (
            "import os,sys; s=os.statvfs(sys.argv[1]); available=s.f_bavail*s.f_frsize; "
            "required=1024**3; print(f'production disk available={available} required={required}'); "
            "sys.exit(0 if available>=required else 1)"
        )
        checks = (
            f"python3 -c {shlex.quote(reserve_check)} \"$data_dir\"; "
            f"python3 -c {shlex.quote(capacity_check)} {shlex.quote(root)} \"$db_size\""
        )
    return (
        f"set -eu; cd {shlex.quote(root)}; set -a; . ./.env.local; set +a; "
        "test -n \"${DATABASE_URL:-}\"; "
        f"port=$(python3 -c {shlex.quote(url_check)}); "
        "identity_sql=\"select pg_postmaster_start_time()::text || ':' || current_setting('port')\"; "
        "app_identity=$(psql \"$DATABASE_URL\" -X -v ON_ERROR_STOP=1 -At -c \"$identity_sql\"); "
        "local_identity=$(runuser -u postgres -- psql -X -h /var/run/postgresql -p \"$port\" -d postgres -v ON_ERROR_STOP=1 -At -c \"$identity_sql\"); "
        "test -n \"$app_identity\" && test \"$app_identity\" = \"$local_identity\"; "
        "db_size=$(psql \"$DATABASE_URL\" -X -v ON_ERROR_STOP=1 -At -c 'select pg_database_size(current_database())'); "
        "data_dir=$(runuser -u postgres -- psql -X -h /var/run/postgresql -p \"$port\" -d postgres -v ON_ERROR_STOP=1 -At -c 'show data_directory'); "
        + checks
    )


def isolated_database_restore_command(root: str, backup: str, staging: str) -> str:
    backup = validate_remote_temp(backup, root, ".helstera-backup.")
    staging = validate_remote_temp(staging, root, ".helstera-candidate.")
    root_q = shlex.quote(root)
    return (
        f"set -eu; cd {root_q}; set -a; . ./.env.local; set +a; "
        "major=$(psql \"$DATABASE_URL\" -X -v ON_ERROR_STOP=1 -At -c "
        "\"select current_setting('server_version_num')::int / 10000\"); "
        "case \"$major\" in ''|*[!0-9]*) exit 1;; esac; "
        "bin_dir=/usr/lib/postgresql/$major/bin; test -x \"$bin_dir/initdb\"; "
        f"runuser -u postgres -- test -x {root_q}; "
        f"python3 {shlex.quote(staging + '/isolated-pg-rehearsal.py')} "
        f"--base {root_q} --dump {shlex.quote(backup + '/database.dump')} "
        f"--server {shlex.quote(staging + '/next/apps/server')} --bin-dir \"$bin_dir\""
    )


def verify_database_restore_command(root: str, backup: str, staging: str | None = None) -> str:
    dump = validate_remote_temp(backup, root, ".helstera-backup.") + "/database.dump"
    restore_url = (
        "import os,sys,urllib.parse; "
        "u=urllib.parse.urlsplit(os.environ['DATABASE_URL']); "
        "assert u.scheme in ('postgres','postgresql') and u.netloc; "
        "sys.stdout.write(urllib.parse.urlunsplit((u.scheme,u.netloc,'/'+sys.argv[1],u.query,u.fragment)))"
    )
    migration_check = ""
    if staging is not None:
        staging = validate_remote_temp(staging, root, ".helstera-candidate.")
        server = shlex.quote(staging + "/next/apps/server")
        env_file = shlex.quote(root + "/.env.local")
        migration_check = (
            f"(cd {server} && DATABASE_URL=\"$verify_url\" "
            f"node --env-file={env_file} --import tsx ./src/local-db/migrate.ts); "
        )
    return (
        f"set -eu; cd {shlex.quote(root)}; set -a; . ./.env.local; set +a; "
        "test -n \"${DATABASE_URL:-}\"; "
        "verify_name=helstera_restorecheck_$(python3 -c 'import uuid; print(uuid.uuid4().hex)'); "
        f"verify_url=$(python3 -c {shlex.quote(restore_url)} \"$verify_name\"); "
        "createdb --maintenance-db=\"$DATABASE_URL\" \"$verify_name\"; "
        "cleanup_restorecheck() { dropdb --maintenance-db=\"$DATABASE_URL\" \"$verify_name\"; }; "
        "trap cleanup_restorecheck EXIT; "
        f"pg_restore --exit-on-error --no-owner --no-acl --dbname=\"$verify_url\" {shlex.quote(dump)}; "
        "psql \"$verify_url\" -v ON_ERROR_STOP=1 -At -c \"select to_regclass('public.app_users') is not null and to_regclass('public.workspaces') is not null\" | grep -qx t; "
        + migration_check +
        "cleanup_restorecheck; trap - EXIT; printf 'database restore verified'"
    )


def restore_backup(client: paramiko.SSHClient, root: str, backup: str) -> None:
    restore_tree = backup + "/rollback-tree"
    restore_q = shlex.quote(restore_tree)
    command = (
        f"set -eu; test ! -e {restore_q}; mkdir {restore_q}; "
        f"tar -xzf {shlex.quote(backup + '/current.tgz')} -C {restore_q}; "
        f"{exchange_directories_command(root, restore_tree)}; "
        f"cd {shlex.quote(root)}; "
        f"cp {restore_q}/apps/server/package.json apps/server/package.json; "
        f"cp {restore_q}/apps/server/tsconfig.json apps/server/tsconfig.json; "
        f"cp {restore_q}/apps/desktop/package.json apps/desktop/package.json; "
        f"cp {restore_q}/package.json package.json; "
        f"cp {restore_q}/pnpm-lock.yaml pnpm-lock.yaml; "
        f"cp {restore_q}/pnpm-workspace.yaml pnpm-workspace.yaml"
    )
    remote_run(client, command, timeout=300)


def runtime_layout_check_command(root: str) -> str:
    root_q = shlex.quote(root)
    return (
        f"set -eu; cd {root_q}; "
        "test -d .server-runtime && test ! -L .server-runtime; "
        "test -L node_modules && test \"$(readlink node_modules)\" = .server-runtime/node_modules; "
        "test -L apps/server/node_modules && "
        "test \"$(readlink apps/server/node_modules)\" = ../../.server-runtime/apps/server/node_modules"
    )


def switch_runtime_command(root: str, staging: str) -> str:
    root_q, stage_q = shlex.quote(root), shlex.quote(staging)
    return (
        f"set -eu; cd {root_q}; test ! -e {stage_q}/previous-runtime; "
        f"test -d {stage_q}/next/deploy/server-runtime; "
        f"mv .server-runtime {stage_q}/previous-runtime; "
        f"mv {stage_q}/next/deploy/server-runtime .server-runtime"
    )


def restore_runtime_command(root: str, staging: str) -> str:
    root_q, stage_q = shlex.quote(root), shlex.quote(staging)
    return (
        f"set -eu; cd {root_q}; if test -d {stage_q}/previous-runtime; then "
        f"if test -e .server-runtime; then test ! -e {stage_q}/failed-runtime; "
        f"mv .server-runtime {stage_q}/failed-runtime; fi; "
        f"mv {stage_q}/previous-runtime .server-runtime; fi; "
        "test -d .server-runtime"
    )


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


def prepare_candidate_runtime_command(staging: str) -> str:
    next_path = shlex.quote(staging + "/next")
    return (
        f"set -eu; cd {next_path}; "
        "test -z \"$(find deploy/server-runtime -name node_modules -print -quit)\" || "
        "{ echo 'Candidate runtime contains preinstalled dependencies' >&2; exit 1; }; "
        "mkdir -p deploy/server-runtime/packages/shared/dist; "
        "cp -a packages/shared/dist/. deploy/server-runtime/packages/shared/dist/; "
        "(cd deploy/server-runtime && CI=true pnpm install --frozen-lockfile --ignore-scripts --no-prod); "
        "ln -s deploy/server-runtime/node_modules node_modules; "
        "ln -s ../../deploy/server-runtime/apps/server/node_modules apps/server/node_modules; "
        "test -f deploy/server-runtime/packages/shared/dist/index.js; "
        "cd apps/server; node --import tsx --input-type=module -e \""
        "import 'pg'; import { validateVideoEditorPlan, createTranscriptEdit, compileWorkflow, workflowGraphSchema } from '@helstera/shared'; "
        "if (typeof validateVideoEditorPlan !== 'function' || typeof createTranscriptEdit !== 'function') "
        "throw new Error('Candidate video contracts are missing'); "
        "if (typeof compileWorkflow !== 'function' || typeof workflowGraphSchema?.parse !== 'function') "
        "throw new Error('Candidate workflow contracts are missing'); "
        "console.log('candidate runtime ready')\""
    )


def exchange_directories_command(root: str, candidate: str) -> str:
    swaps = json.dumps([
        [root + "/apps/server/src", candidate + "/apps/server/src"],
        [root + "/apps/web/out", candidate + "/apps/web/out"],
        [root + "/packages/shared/dist", candidate + "/packages/shared/dist"],
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
    return f"python3 -c {shlex.quote(swap_script)}"


def replace_live_command(root: str, staging: str) -> str:
    root_q = shlex.quote(root)
    stage_q = shlex.quote(staging)
    return (
        f"set -eu; cd {root_q}; {exchange_directories_command(root, staging + '/next')}; "
        f"cp {stage_q}/next/apps/server/package.json apps/server/package.json; "
        f"cp {stage_q}/next/apps/server/tsconfig.json apps/server/tsconfig.json; "
        f"cp {stage_q}/next/apps/desktop/package.json apps/desktop/package.json; "
        f"cp {stage_q}/next/package.json package.json; "
        f"cp {stage_q}/next/pnpm-lock.yaml pnpm-lock.yaml; "
        f"cp {stage_q}/next/pnpm-workspace.yaml pnpm-workspace.yaml"
    )


def apply_studio_nginx(client: paramiko.SSHClient, staging: str) -> None:
    scripts = ("validate-studio-nginx.py", "apply-studio-nginx.py")
    with client.open_sftp() as sftp:
        for name in scripts:
            source = pathlib.Path(__file__).with_name(name)
            destination = staging + "/" + name
            expected = hashlib.sha256(source.read_bytes()).hexdigest()
            sftp.put(str(source), destination)
            actual = remote_run(client, f"sha256sum {shlex.quote(destination)} | cut -d' ' -f1")
            if actual != expected:
                raise RuntimeError(f"Remote {name} SHA-256 does not match the local script")
    remote_run(
        client,
        "python3 " + shlex.quote(staging + "/apply-studio-nginx.py") + " "
        + shlex.quote("/etc/nginx/sites-enabled/studio.0st.top.conf") + " "
        + shlex.quote(staging + "/validate-studio-nginx.py"),
        timeout=60,
    )


def deploy(args: argparse.Namespace) -> None:
    if args.resume_staging and not args.resume_backup:
        raise ValueError("--resume-staging requires --resume-backup.")
    archive = args.archive.resolve()
    if not archive.is_file():
        raise FileNotFoundError(archive)
    validate_candidate_archive(archive)
    password = os.environ.get(args.password_env)
    if not password:
        raise RuntimeError(f"Missing deployment password environment variable: {args.password_env}")

    with archive.open("rb") as source:
        hasher = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
        local_hash = hasher.hexdigest().upper()
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
            jump.get_transport().set_keepalive(20)
            channel = jump.get_transport().open_channel(
                "direct-tcpip",
                (args.target_host, 22),
                ("127.0.0.1", 0),
                timeout=20,
            )
            target.connect(args.target_host, sock=channel, username=args.target_user, password=password, timeout=20)

        target.get_transport().set_keepalive(20)

        remote_run(target, f"test -d {shlex.quote(args.root)} && test -f {shlex.quote(args.root + '/.env.local')}")
        isolated_restore = getattr(args, "isolated_restore", False)
        print("DATABASE_SPACE", remote_run(target, database_restore_space_command(args.root, isolated_restore), timeout=60), flush=True)
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
        print("STAGING", staging, flush=True)

        if not args.resume_staging:
            with target.open_sftp() as sftp:
                sftp.put(str(archive), staging + "/candidate.zip")
        if isolated_restore:
            rehearsal_script = pathlib.Path(__file__).with_name("isolated-pg-rehearsal.py")
            rehearsal_hash = hashlib.sha256(rehearsal_script.read_bytes()).hexdigest()
            with target.open_sftp() as sftp:
                sftp.put(str(rehearsal_script), staging + "/isolated-pg-rehearsal.py")
            uploaded_hash = remote_run(target, f"sha256sum {shlex.quote(staging + '/isolated-pg-rehearsal.py')} | cut -d' ' -f1")
            if uploaded_hash != rehearsal_hash:
                raise RuntimeError("Remote isolated rehearsal script SHA-256 does not match the local script.")
        verify_candidate_upload(target, staging, local_hash)

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
            "apps/server/src/http/private-video.ts",
            "apps/server/src/http/uploads.ts",
            "apps/server/src/http/storage.ts",
            "apps/server/src/http/local-assets.ts",
            "apps/server/src/http/generation-approvals.ts",
            "apps/server/src/http/local-auth.ts",
            "apps/server/src/local-db/auth.ts",
            "apps/server/src/features/website-capture/recording-approval.ts",
            "apps/server/src/features/assets/private-video.ts",
            "apps/server/src/local-db/job-billing-gate.ts",
            "apps/server/src/local-db/migrations/20261103000000_website_recording_approvals.sql",
            "apps/server/src/local-db/migrations/20261103000001_project_creation_requests.sql",
            "apps/server/src/local-db/migrations/20261104000000_email_code_attempts.sql",
            "apps/web/out/fashion-gallery/index.html",
            "apps/web/out/fashion-gallery/img/SPR-0001.webp",
            "apps/web/out/video/index.html",
            "packages/shared/dist/contracts.js",
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
            "apps/server/src/local-db/migrations/20261031000000_agent_muse_workspace.sql",
            "apps/server/src/local-db/migrations/20261031000001_agent_suggestion_context.sql",
            "apps/server/src/local-db/migrations/20261101000000_desktop_agent_plan_rounds.sql",
            "apps/server/src/local-db/migrations/20261101000009_desktop_chat_outbox.sql",
            "apps/server/src/features/agent-goals/agent-goal-background.ts",
            "apps/server/src/features/agent-goals/agent-goal-events.ts",
            "apps/server/src/features/agent-goals/agent-goal-service.ts",
            "apps/server/src/features/agent-goals/agent-goal-worker.ts",
            "apps/server/src/http/agent-goals.ts",
            "apps/server/src/http/agent-memory.ts",
            "apps/server/src/http/agent-connectors.ts",
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

        old_backup = getattr(args, "superseded_backup", None)
        if old_backup:
            old_backup = validate_remote_temp(old_backup, args.root, ".helstera-backup.")
            if old_backup == backup:
                raise ValueError("The active backup cannot be superseded.")
            retire = r'''import pathlib, shutil, sys
root, old, new = map(pathlib.Path, sys.argv[1:])
assert old.resolve().parent == root.resolve() and new.resolve().parent == root.resolve()
assert old.name.startswith('.helstera-backup.') and old != new
assert (old/'current.tgz').is_file() and (old/'database.dump').is_file()
assert (new/'current.tgz').is_file() and (new/'database.dump.sha256').is_file()
shutil.rmtree(old)
print('removed superseded backup', old)
'''
            remote_run(target, f"sha256sum -c {shlex.quote(database_dump + '.sha256')} >/dev/null && pg_restore --list {database_dump_q} >/dev/null && tar -tzf {backup_q}/current.tgz >/dev/null", timeout=300)
            print("OLD_BACKUP_REMOVED", remote_run(target, "python3 -c " + shlex.quote(retire) + " " + root + " " + shlex.quote(old_backup) + " " + backup_q, timeout=180), flush=True)
        remote_run(target, prepare_candidate_command(args.root, staging), timeout=300)
        remote_run(target, prepare_candidate_runtime_command(staging), timeout=1200)
        restore_command = (isolated_database_restore_command(args.root, backup, staging) if isolated_restore
                           else verify_database_restore_command(args.root, backup, staging))
        print("DATABASE_RESTORE", remote_run(target, restore_command, timeout=3600), flush=True)
        remote_run(target, runtime_layout_check_command(args.root), timeout=60)
        print("DATABASE_SPACE_PRE_SWAP", remote_run(target, database_restore_space_command(args.root, isolated_restore), timeout=60), flush=True)
        jobs = active_jobs(target, args.root)
        print("ACTIVE_JOBS_PRE_SWAP", json.dumps(jobs, ensure_ascii=False), flush=True)
        if jobs:
            raise RuntimeError("Active queued/running jobs detected after rehearsal; deployment stopped before live replacement")
        remote_run(target, f"cd {stage}/next/deploy/server-runtime && pnpm --filter @helstera/server exec playwright install chromium", timeout=1200)
        remote_run(target, "pm2 stop helstera-worker --kill-timeout 1200000 && pm2 stop helstera-server --kill-timeout 30000", timeout=300)
        replacement_started = True
        remote_run(target, replace_live_command(args.root, staging), timeout=300)
        remote_run(target, switch_runtime_command(args.root, staging), timeout=300)
        remote_run(
            target,
            f"cd {root} && find apps/web/out -type d -exec chmod 755 {{}} + && find apps/web/out -type f -exec chmod 644 {{}} +",
            timeout=300,
        )
        remote_run(
            target,
            f"cd {root}/.server-runtime && pnpm --filter @helstera/server exec playwright install chromium",
            timeout=1200,
        )
        remote_run(
            target,
            f"test -d \"$HOME/.cache/ms-playwright\" && "
            f"find \"$HOME/.cache/ms-playwright\" -type f \( -name chrome -o -name headless_shell \) -perm -u+x -print -quit | grep -q .",
            timeout=60,
        )
        remote_run(target, f"cd {root}/apps/server && node --env-file=../../.env.local --import tsx ./src/local-db/migrate.ts", timeout=300)
        remote_run(target, f"pm2 restart helstera-worker --kill-timeout 1200000 && pm2 restart helstera-server --kill-timeout 30000 && pm2 save", timeout=300)
        apply_studio_nginx(target, staging)
        health = remote_run(target, "for i in $(seq 1 30); do curl -fsS --max-time 3 http://127.0.0.1:3000/api/health && exit 0; sleep 1; done; exit 1", timeout=120)
        public_health = remote_run(target, f"curl -fsS --max-time 20 {shlex.quote(args.health_url)}", timeout=60)
        local_agent_auth = remote_run(target, agent_auth_probe_command("http://127.0.0.1:3000"), timeout=60)
        public_agent_auth = remote_run(target, agent_auth_probe_command(health_origin(args.health_url)), timeout=60)
        public_static = remote_run(target, static_probe_command(health_origin(args.health_url), staging + "/candidate/apps/web/out"), timeout=120)
        public_html_hash = remote_run(target, "curl -fsS --max-time 20 https://studio.0st.top/canvas/ | sha256sum | cut -d' ' -f1", timeout=60)
        print("HEALTH", health, flush=True)
        print("PUBLIC_HEALTH", public_health, flush=True)
        print("LOCAL_AGENT_AUTH", local_agent_auth, flush=True)
        print("PUBLIC_AGENT_AUTH", public_agent_auth, flush=True)
        print("PUBLIC_STATIC", public_static, flush=True)
        print("PUBLIC_CANVAS_HTML_SHA256", public_html_hash, flush=True)
        print("DEPLOYED", json.dumps({"target": args.target_host, "root": args.root, "backup": backup, "databaseBackup": database_dump, "sha256": local_hash}), flush=True)
    except Exception:
        if backup and replacement_started:
            try:
                remote_run(target, restore_runtime_command(args.root, staging), timeout=300)
                print("ROLLBACK", restore_backup(target, args.root, backup), flush=True)
                remote_run(target, "pm2 restart helstera-worker --kill-timeout 1200000 && pm2 restart helstera-server --kill-timeout 30000", timeout=300)
            except Exception as rollback_error:
                print("ROLLBACK_FAILED", str(rollback_error), file=sys.stderr, flush=True)
        raise
    finally:
        if target.get_transport() and target.get_transport().is_active():
            if staging:
                try:
                    if replacement_started:
                        print("STAGING_PRESERVED", staging, flush=True)
                    else:
                        remote_run(target, f"rm -rf {shlex.quote(staging)}", timeout=120)
                except Exception as cleanup_error:
                    print("STAGING_CLEANUP_FAILED", str(cleanup_error), file=sys.stderr, flush=True)
            target.close()
        if jump is not None and jump.get_transport() and jump.get_transport().is_active():
            jump.close()


if __name__ == "__main__":
    deploy(parse_args())
