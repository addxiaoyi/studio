import argparse
import hashlib
import inspect
import importlib.util
import json
import os
import pathlib
import re
import shlex
import shutil
import stat
import sys
import time
import zipfile
from urllib.parse import urlsplit

import paramiko


PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_JUMP_HOST = "103.40.14.25"
DEFAULT_JUMP_PORT = 19198
DEFAULT_JUMP_USER = "add"
DEFAULT_TARGET_HOST = "23.251.32.222"
DEFAULT_TARGET_USER = "root"
DEFAULT_ROOT = "/www/helstera"
DEFAULT_HEALTH_URL = "https://studio.0st.top/api/health/ready"
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
        validator_path = pathlib.Path(__file__).with_name("prepare-production-candidate.py")
        spec = importlib.util.spec_from_file_location("production_candidate", validator_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot load the production creative runtime validator.")
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        validator.verify_archived_creative_runtime(PROJECT_ROOT, bundle, files)


def verify_candidate_tree(archive: pathlib.Path, directory: pathlib.Path, live_web: pathlib.Path | None = None) -> None:
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Candidate staging must be a regular directory.")
    with zipfile.ZipFile(archive) as bundle:
        manifest = json.loads(bundle.read("RELEASE-MANIFEST.json"))
        for name, details in manifest["files"].items():
            parts = name.split("/")
            if "\\" in name or any(part in ("", ".", "..") or ":" in part for part in parts):
                raise ValueError("Unsafe candidate manifest path: " + name)
            target = directory
            for part in parts:
                target = target / part
                if target.is_symlink():
                    raise ValueError("Candidate staging contains a symbolic link: " + name)
            if not target.is_file():
                raise FileNotFoundError("Candidate staging is missing: " + name)
            hasher = hashlib.sha256()
            with target.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    hasher.update(chunk)
            if hasher.hexdigest() != details["sha256"].lower():
                raise ValueError("Candidate staging SHA-256 mismatch: " + name)
        staged_manifest = directory / "RELEASE-MANIFEST.json"
        if (staged_manifest.is_symlink() or not staged_manifest.is_file() or
                staged_manifest.read_bytes() != bundle.read("RELEASE-MANIFEST.json")):
            raise ValueError("Candidate staging manifest differs from verified archive")
        for target in directory.rglob("*"):
            name = target.relative_to(directory).as_posix()
            if target.is_symlink():
                raise ValueError("Candidate staging contains a symbolic link: " + name)
            if not target.is_file() or name in manifest["files"] or name == "RELEASE-MANIFEST.json":
                continue
            if live_web is None or not name.startswith("apps/web/out/downloads/"):
                raise ValueError("Unreviewed file in candidate staging: " + name)
            original = live_web
            for part in pathlib.PurePosixPath(name.removeprefix("apps/web/out/")).parts:
                original = original / part
                if original.is_symlink():
                    raise ValueError("Inherited download uses a symbolic link: " + name)
            if not original.is_file():
                raise FileNotFoundError("Inherited download is missing from the active site: " + name)
            digests = []
            for path in (original, target):
                hasher = hashlib.sha256()
                with path.open("rb") as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        hasher.update(chunk)
                digests.append(hasher.digest())
            if digests[0] != digests[1]:
                raise ValueError("Inherited download differs from the active site: " + name)


def verify_candidate_tree_command(staging: str, live_web: str | None = None) -> str:
    script = "import hashlib, json, pathlib, sys, zipfile\n" + inspect.getsource(verify_candidate_tree)
    script += "\nroot = pathlib.Path(sys.argv[1])\nlive = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None\nverify_candidate_tree(root / 'candidate.zip', root / 'candidate', live)\n"
    script += "print('candidate-files-verified')\n"
    return "python3 -c " + shlex.quote(script) + " " + shlex.quote(staging) + (" " + shlex.quote(live_web) if live_web else "")


def verify_prepared_code(archive: pathlib.Path, directory: pathlib.Path) -> None:
    prefixes = ("apps/server/src", "packages/shared/dist", "deploy/server-runtime/packages/shared/dist")
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Prepared code root must be a regular directory")
    with zipfile.ZipFile(archive) as bundle:
        manifest = json.loads(bundle.read("RELEASE-MANIFEST.json"))
    files = manifest.get("files") if isinstance(manifest, dict) else None
    if not isinstance(files, dict):
        raise ValueError("Prepared code requires a valid archive manifest")
    expected = {}
    for name, details in files.items():
        if not isinstance(name, str) or not any(name.startswith(prefix + "/") for prefix in prefixes):
            continue
        if "\\" in name or any(part in ("", ".", "..") or ":" in part for part in name.split("/")):
            raise ValueError("Unsafe prepared code manifest path: " + name)
        digest = details.get("sha256") if isinstance(details, dict) else None
        if not isinstance(digest, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", digest):
            raise ValueError("Invalid prepared code SHA-256: " + name)
        expected[name] = digest.lower()
    actual = set()
    for prefix in prefixes:
        if not any(name.startswith(prefix + "/") for name in expected):
            raise ValueError("Archive has no prepared code entries for " + prefix)
        tree = directory
        for part in pathlib.PurePosixPath(prefix).parts:
            tree = tree / part
            if tree.is_symlink():
                raise ValueError("Prepared code contains a symbolic link: " + prefix)
        if not tree.is_dir():
            raise FileNotFoundError("Prepared code tree is missing: " + prefix)
        for target in tree.rglob("*"):
            name = target.relative_to(directory).as_posix()
            if target.is_symlink():
                raise ValueError("Prepared code contains a symbolic link: " + name)
            if target.is_dir():
                continue
            if not target.is_file():
                raise ValueError("Prepared code contains a non-file entry: " + name)
            actual.add(name)
    if actual != set(expected):
        missing = sorted(set(expected) - actual)
        unexpected = sorted(actual - set(expected))
        raise ValueError(f"Prepared code differs from archive: missing={missing[:5]}, unexpected={unexpected[:5]}")
    for name, digest in expected.items():
        hasher = hashlib.sha256()
        with (directory / name).open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                hasher.update(chunk)
        if hasher.hexdigest() != digest:
            raise ValueError("Prepared code SHA-256 mismatch: " + name)


def verify_prepared_code_command(staging: str) -> str:
    script = "import hashlib, json, pathlib, re, sys, zipfile\n" + inspect.getsource(verify_prepared_code)
    script += "\nroot = pathlib.Path(sys.argv[1])\nverify_prepared_code(root / 'candidate.zip', root / 'next')\n"
    script += "print('prepared-code-verified')\n"
    return "python3 -c " + shlex.quote(script) + " " + shlex.quote(staging)


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
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Prepare and preserve a candidate after isolated restore rehearsal without changing live processes or routes.",
    )
    parser.add_argument(
        "--allow-single-instance-outage",
        action="store_true",
        help="Explicitly permit the legacy stop-before-start rollout that causes API downtime.",
    )
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


def database_probe_command(root: str) -> str:
    url_check = (
        "import os,urllib.parse; u=urllib.parse.urlsplit(os.environ['DATABASE_URL']); "
        "assert u.scheme in ('postgres','postgresql') and u.hostname in ('127.0.0.1','localhost','::1'); "
        "q=urllib.parse.parse_qs(u.query,keep_blank_values=True); "
        "assert not set(q).intersection(('host','hostaddr','port','dbname','service','options')); "
        "assert not any(os.environ.get(k) for k in ('PGHOST','PGHOSTADDR','PGPORT','PGSERVICE','PGOPTIONS')); "
        "print(u.port or 5432)"
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
    )


def database_restore_space_command(root: str, isolated: bool = False) -> str:
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
    return database_probe_command(root) + checks


def aggregate_release_space(requirements, stat_fn=os.stat, statvfs_fn=None):
    statvfs_fn = statvfs_fn or getattr(os, "statvfs", None)
    if statvfs_fn is None:
        raise RuntimeError("Filesystem capacity probes require statvfs")
    devices = {}
    for label, path, allocated, reserve in requirements:
        device = stat_fn(path).st_dev
        space = statvfs_fn(path)
        available = space.f_bavail * space.f_frsize
        current = devices.get(device)
        if current is None:
            devices[device] = {
                "labels": [label],
                "path": path,
                "available": available,
                "allocated": allocated,
                "reserve": reserve,
            }
            continue
        current["labels"].append(label)
        current["available"] = min(current["available"], available)
        current["allocated"] += allocated
        current["reserve"] = max(current["reserve"], reserve)
    return [
        {
            "labels": item["labels"],
            "path": item["path"],
            "available": item["available"],
            "required": item["allocated"] + item["reserve"],
            "allocated": item["allocated"],
            "reserve": item["reserve"],
        }
        for item in devices.values()
    ]


def release_space_preflight_command(root: str, candidate_bytes: int, isolated: bool = False) -> str:
    if not isinstance(candidate_bytes, int) or candidate_bytes <= 0:
        raise ValueError("Candidate archive size must be a positive integer")
    root_q = shlex.quote(root)
    database_copies = 2 if isolated else 1
    fixed_reserve = 1024 ** 3 if isolated else 512 * 1024 ** 2
    aggregate_source = inspect.getsource(aggregate_release_space)
    capacity_check = f'''import json, os, sys
root, system, database, media = sys.argv[1:5]
db_size = int(sys.argv[5])
candidate = int(sys.argv[6])
{aggregate_source}
requirements = [
    ("business", root, candidate * 2 + db_size * {database_copies}, {fixed_reserve}),
    ("system", system, 0, {2 * 1024 ** 3}),
    ("database", database, db_size * 2, {1024 ** 3}),
    ("media", media, 0, {2 * 1024 ** 3}),
]
reports = aggregate_release_space(requirements)
print("release disks " + json.dumps(reports, sort_keys=True))
sys.exit(0 if all(item["available"] >= item["required"] for item in reports) else 1)
'''
    return (
        database_probe_command(root)
        + "storage_root=${STORAGE_ROOT:-$PWD/uploads}; "
        "case \"$storage_root\" in /*) ;; *) echo 'STORAGE_ROOT must be absolute' >&2; exit 1;; esac; "
        "media_root=\"$storage_root/.media-tmp\"; mkdir -p \"$media_root\"; "
        f"python3 -c {shlex.quote(capacity_check)} {root_q} / \"$data_dir\" \"$media_root\" \"$db_size\" {candidate_bytes}"
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


def prepare_complete_candidate(root: pathlib.Path, staging: pathlib.Path) -> None:
    root = root.resolve(strict=True)
    if (not staging.is_absolute() or staging.is_symlink() or staging.resolve(strict=True) != staging or
            staging.parent != root or not re.fullmatch(r"\.helstera-candidate\.[A-Za-z0-9_-]{1,64}", staging.name)):
        raise ValueError("Complete candidate staging must be a regular candidate directory directly below the deployment root")
    candidate = staging / "candidate"
    next_tree = staging / "next"
    if next_tree.exists() or next_tree.is_symlink():
        raise FileExistsError("Complete candidate target is occupied; use a fresh staging directory")
    if candidate.is_symlink() or not candidate.is_dir():
        raise ValueError("Complete candidate input must be a regular directory")
    trees = ("apps/server/src", "packages/shared/dist", "deploy/server-runtime", "apps/web/out")
    metadata = ("apps/server/package.json", "apps/server/tsconfig.json", "apps/desktop/package.json",
                "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json")
    for relative in trees + metadata:
        source = candidate
        for part in pathlib.PurePosixPath(relative).parts:
            source = source / part
            if source.is_symlink():
                raise ValueError("Complete candidate input contains a symbolic link: " + relative)
        if relative in trees and not source.is_dir():
            raise FileNotFoundError("Complete candidate tree is missing: " + relative)
        if relative in metadata and not source.is_file():
            raise FileNotFoundError("Complete candidate metadata is missing: " + relative)
    next_tree.mkdir()
    for relative in trees:
        target = next_tree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        copier = os.link if relative == "apps/web/out" else shutil.copy2
        shutil.copytree(candidate / relative, target, symlinks=True, copy_function=copier)
    for relative in metadata:
        target = next_tree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidate / relative, target)


def prepare_candidate_command(root: str, staging: str, source_root: str | None = None, web_root: str | None = None,
                              shared_root: str | None = None, *, complete: bool = False) -> str:
    if complete:
        script = "import os, pathlib, re, shutil, sys\n" + inspect.getsource(prepare_complete_candidate)
        script += "\nprepare_complete_candidate(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))\n"
        script += "print('complete-candidate-prepared')\n"
        return "python3 -c " + shlex.quote(script) + " " + shlex.quote(root) + " " + shlex.quote(staging)
    root_q = shlex.quote(root)
    source_q = shlex.quote(source_root or root)
    web_q = shlex.quote(web_root or (source_root or root) + "/apps/web/out")
    shared_q = shlex.quote(shared_root or (source_root or root) + "/packages/shared/dist")
    stage_q = shlex.quote(staging)
    return (
        f"set -eu; cd {root_q}; candidate={stage_q}/candidate; next={stage_q}/next; "
        f"mkdir -p $next/apps/server $next/apps/desktop $next/apps/web $next/packages/shared/dist; "
        f"cp -a {source_q}/apps/server/src $next/apps/server/src; "
        f"cp -a $candidate/apps/server/src/. $next/apps/server/src/; "
        f"cp -a {shared_q}/. $next/packages/shared/dist/; "
        f"if test -d $candidate/packages/shared/dist; then cp -a $candidate/packages/shared/dist/. $next/packages/shared/dist/; fi; "
        f"mkdir -p $next/deploy; cp -a $candidate/deploy/server-runtime $next/deploy/server-runtime; "
        f"if test -f $candidate/apps/web/out/index.html; then cp -al $candidate/apps/web/out $next/apps/web/out; else cp -al {web_q} $next/apps/web/out; fi; "
        f"for path in apps/server/package.json apps/server/tsconfig.json apps/desktop/package.json package.json pnpm-lock.yaml pnpm-workspace.yaml; do "
        f"source=$candidate/$path; test -f $source || source={source_q}/$path; test -f $source || source={root_q}/$path; "
        f"mkdir -p $next/$(dirname $path); cp -p $source $next/$path; done"
    )


def active_source_command(root: str) -> str:
    probe = pathlib.Path(__file__).with_name("release-topology.py").read_text(encoding="utf-8")
    return "python3 -c " + shlex.quote(probe) + " " + shlex.quote(root) + " /etc/nginx/sites-enabled/studio.0st.top.conf"


def preserve_public_assets_command(web: str, candidate_web: str, relative: str) -> str:
    if relative not in ("downloads", "_next/static"):
        raise ValueError("Only immutable public release assets may be shared")
    source = shlex.quote(web + "/" + relative)
    destination = shlex.quote(candidate_web + "/" + relative)
    return (f"set -eu; source={source}; destination={destination}; mkdir -p \"$destination\"; "
            'if test -d "$source"; then cp -aln "$source"/. "$destination"/; fi')


def versioned_backup_command(source: str, web: str, backup: str, shared_root: str | None = None) -> str:
    script = r'''import io,json,pathlib,sys,tarfile
source,web,backup=map(pathlib.Path,sys.argv[1:4])
shared=pathlib.Path(sys.argv[4]) if len(sys.argv)>4 else source/'packages/shared/dist'
required=('apps/server/src','apps/server/package.json','apps/server/tsconfig.json')
optional=('apps/desktop/package.json','package.json','pnpm-lock.yaml','pnpm-workspace.yaml')
for relative in required:
    if not (source/relative).exists(): raise RuntimeError('Active release backup input is missing: '+relative)
if not web.is_dir(): raise RuntimeError('Active web root is missing')
if not shared.is_dir(): raise RuntimeError('Active shared runtime is missing')
with tarfile.open(backup/'current.tgz','w:gz') as archive:
    for relative in required+optional:
        if (source/relative).exists(): archive.add(source/relative,arcname=relative)
    archive.add(web,arcname='apps/web/out')
    archive.add(shared,arcname='packages/shared/dist')
    layout=json.dumps({'source':str(source),'web':str(web),'shared':str(shared)}).encode()
    entry=tarfile.TarInfo('SOURCE-LAYOUT.json');entry.size=len(layout);entry.mode=0o600
    archive.addfile(entry,io.BytesIO(layout))
'''
    shared = shared_root or source + "/packages/shared/dist"
    return "python3 -c " + shlex.quote(script) + " " + " ".join(map(shlex.quote, (source, web, backup, shared)))


def verify_versioned_backup_command(source: str, web: str, backup: str, shared_root: str) -> str:
    script = r'''import json,pathlib,sys,tarfile
source,web,backup,shared=sys.argv[1:]
with tarfile.open(pathlib.Path(backup)/'current.tgz','r:gz') as archive:
    try:
        manifest=archive.extractfile('SOURCE-LAYOUT.json')
        layout=json.load(manifest) if manifest is not None else None
        entry=archive.getmember('packages/shared/dist/index.js')
    except (KeyError,ValueError) as error:
        raise RuntimeError('Resumed backup provenance or shared entry is missing') from error
    expected={'source':source,'web':web,'shared':shared}
    if not isinstance(layout,dict) or any(layout.get(key)!=value for key,value in expected.items()):
        raise RuntimeError('Resumed backup provenance does not match the active source, web, and shared runtime')
    if not entry.isfile(): raise RuntimeError('Resumed backup shared entry is not a regular file')
print('versioned backup provenance verified')
'''
    return "python3 -c " + shlex.quote(script) + " " + " ".join(map(shlex.quote, (source, web, backup, shared_root)))


def prepare_candidate_runtime_command(staging: str) -> str:
    next_path = shlex.quote(staging + "/next")
    store_path = shlex.quote(staging + "/next/.pnpm-store")
    return (
        f"set -eu; cd {next_path}; "
        "test -z \"$(find deploy/server-runtime -name node_modules -print -quit)\" || "
        "{ echo 'Candidate runtime contains preinstalled dependencies' >&2; exit 1; }; "
        "mkdir -p deploy/server-runtime/packages/shared/dist; "
        "cp -a packages/shared/dist/. deploy/server-runtime/packages/shared/dist/; "
        f"(cd deploy/server-runtime && CI=true pnpm install --frozen-lockfile --ignore-scripts --no-prod --filter @helstera/server... --store-dir {store_path}); "
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


def deploy_blue_green(client: paramiko.SSHClient, root: str, staging: str, health_url: str) -> str:
    scripts = ("blue-green-release.py", "switch-server-upstream.py", "validate-studio-nginx.py", "release-topology.py")
    with client.open_sftp() as sftp:
        for name in scripts:
            source = pathlib.Path(__file__).with_name(name)
            destination = staging + "/" + name
            sftp.put(str(source), destination)
            expected = hashlib.sha256(source.read_bytes()).hexdigest()
            actual = remote_run(client, f"sha256sum {shlex.quote(destination)} | cut -d' ' -f1")
            if actual != expected:
                raise RuntimeError(f"Remote {name} SHA-256 does not match the local script")
    command = (
        f"python3 {shlex.quote(staging + '/blue-green-release.py')} "
        f"--root {shlex.quote(root)} --staging {shlex.quote(staging)} "
        f"--config /etc/nginx/sites-enabled/studio.0st.top.conf --public-url {shlex.quote(health_url)}"
    )
    output = remote_run(client, command, timeout=5400)
    report = json.loads(output)
    if not isinstance(report, dict) or report.get("phase") != "committed":
        raise RuntimeError("Host release transaction did not commit")
    return output


def deploy(args: argparse.Namespace) -> None:
    blue_green = not getattr(args, "allow_single_instance_outage", False)
    prepare_only = getattr(args, "prepare_only", False)
    if prepare_only and not blue_green:
        raise ValueError("--prepare-only cannot be combined with --allow-single-instance-outage.")
    if prepare_only and getattr(args, "superseded_backup", None) is not None:
        raise ValueError("--prepare-only cannot be combined with --superseded-backup.")
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
    blue_green_started = False
    prepared = False
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
        source_root = args.root
        web_root = args.root + "/apps/web/out"
        shared_root = args.root + "/packages/shared/dist"
        base_state = None
        if blue_green:
            base_state = json.loads(remote_run(target, active_source_command(args.root)))
            source_root = base_state["source"]
            web_root = base_state["web"]
            shared_root = base_state["shared"]
        isolated_restore = prepare_only or getattr(args, "isolated_restore", False)
        print("DATABASE_SPACE", remote_run(target, database_restore_space_command(args.root, isolated_restore), timeout=60), flush=True)
        print("RELEASE_SPACE", remote_run(target, release_space_preflight_command(args.root, archive.stat().st_size, isolated_restore), timeout=60), flush=True)
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
        source = shlex.quote(source_root)
        stage = shlex.quote(staging)
        backup_q = shlex.quote(backup)
        if not args.resume_staging:
            remote_run(target, f"mkdir -p {stage}/candidate && unzip -q {stage}/candidate.zip -d {stage}/candidate")
        remote_run(target, verify_candidate_tree_command(staging, web_root), timeout=300)
        remote_run(
            target,
            preserve_public_assets_command(web_root, staging + "/candidate/apps/web/out", "downloads"),
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
            "apps/server/src/local-db/migrations/20261112000000_agent_run_leases.sql",
            "apps/server/src/local-db/migrations/20261113000000_project_fitting_view.sql",
            "apps/server/src/local-db/migrations/20261114000000_job_cancel_requests.sql",
            "apps/server/src/local-db/migrations/20261114000001_generation_settlements.sql",
            "apps/server/src/local-db/migrations/20261114000002_approval_pricing.sql",
            "apps/server/src/local-db/migrations/20261114000003_settlement_review.sql",
            "apps/server/src/local-db/migrations/20261114000004_reservation_pricing.sql",
            "apps/server/src/local-db/migrations/20261114000005_paid_job_admission.sql",
            "apps/server/src/local-db/migrations/20261114000006_approval_context_scope.sql",
            "apps/server/src/local-db/migrations/20261114000007_reservation_approval.sql",
            "apps/server/src/local-db/generation-reservation.ts",
            "apps/server/src/features/jobs/settlement-review.ts",
            "apps/server/src/features/generation/pricing-snapshot.ts",
            "apps/server/src/features/generation/confirmed-generation.ts",
            "apps/server/src/local-db/generation-settlement.ts",
            "apps/server/src/runtime/billing-reconciliation.ts",
            "apps/server/src/runtime/canceled-refund-recovery.ts",
            "apps/server/src/features/jobs/generation-replay.ts",
            "apps/server/src/features/agent-goals/agent-goal-background.ts",
            "apps/server/src/features/agent-goals/agent-goal-events.ts",
            "apps/server/src/features/agent-goals/agent-goal-service.ts",
            "apps/server/src/features/agent-goals/agent-goal-worker.ts",
            "apps/server/src/http/agent-goals.ts",
            "apps/server/src/http/agent-memory.ts",
            "apps/server/src/http/agent-connectors.ts",
            "deploy/server-runtime/pnpm-lock.yaml",
            "deploy/server-runtime/pnpm-workspace.yaml",
            "apps/server/src/features/agent-runs/agent-run-service.ts",
            "apps/server/src/local-db/agent-run-service.ts",
            "apps/server/src/runtime/drain-gate.ts",
            "apps/server/src/runtime/process-receipt.ts",
            "apps/server/src/runtime/queue-runner.ts",
            "apps/server/src/ws/handler.ts",
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
        reuse_backup = bool(args.resume_backup and remote_run(target, f"test -f {backup_q}/current.tgz && test -f {database_dump_q} && test -f {shlex.quote(database_dump + '.sha256')} && sha256sum -c {shlex.quote(database_dump + '.sha256')} >/dev/null && pg_restore --list {database_dump_q} >/dev/null && echo valid", timeout=300).endswith("valid"))
        if reuse_backup and blue_green:
            remote_run(target, verify_versioned_backup_command(source_root, web_root, backup, shared_root), timeout=300)
        if not reuse_backup:
            backup_command = (versioned_backup_command(source_root, web_root, backup, shared_root) if blue_green else
                f"cd {source} && tar -czf {backup_q}/current.tgz apps/server/src apps/server/package.json apps/server/tsconfig.json apps/desktop/package.json apps/web/out packages/shared/dist package.json pnpm-lock.yaml pnpm-workspace.yaml")
            remote_run(
                target,
                backup_command,
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
        remote_run(target, prepare_candidate_command(args.root, staging, source_root, web_root, shared_root, complete=True), timeout=300)
        remote_run(target, verify_prepared_code_command(staging), timeout=300)
        if blue_green:
            base_json = shlex.quote(json.dumps(base_state))
            remote_run(target, f"printf '%s' {base_json} > {stage}/prepared-base.json", timeout=60)
            remote_run(target, preserve_public_assets_command(web_root, staging + "/next/apps/web/out", "_next/static"), timeout=300)
        remote_run(target, prepare_candidate_runtime_command(staging), timeout=1200)
        restore_command = (isolated_database_restore_command(args.root, backup, staging) if isolated_restore
                           else verify_database_restore_command(args.root, backup, staging))
        print("DATABASE_RESTORE", remote_run(target, restore_command, timeout=3600), flush=True)
        if not blue_green:
            remote_run(target, runtime_layout_check_command(args.root), timeout=60)
        print("DATABASE_SPACE_PRE_SWAP", remote_run(target, database_restore_space_command(args.root, isolated_restore), timeout=60), flush=True)
        print("RELEASE_SPACE_PRE_SWAP", remote_run(target, release_space_preflight_command(args.root, archive.stat().st_size, isolated_restore), timeout=60), flush=True)
        jobs = active_jobs(target, args.root)
        print("ACTIVE_JOBS_PRE_SWAP", json.dumps(jobs, ensure_ascii=False), flush=True)
        if jobs:
            raise RuntimeError("Active queued/running jobs detected after rehearsal; deployment stopped before live replacement")
        remote_run(target, verify_prepared_code_command(staging), timeout=300)
        release_summary = {"target": args.target_host, "root": args.root, "staging": staging, "backup": backup,
                           "databaseBackup": database_dump, "sha256": local_hash, "release": staging + "/next"}
        if prepare_only:
            prepared = True
            print("PREPARED", json.dumps({**release_summary, "phase": "prepared", "isolatedRestore": True}), flush=True)
            return
        remote_run(target, f"cd {stage}/next/deploy/server-runtime && pnpm --filter @helstera/server exec playwright install chromium", timeout=1200)
        if blue_green:
            # The host transaction owns rollback; keep its immutable release and journal even if SSH drops.
            blue_green_started = True
            replacement_started = True
            transaction = deploy_blue_green(target, args.root, staging, args.health_url)
            print("BLUE_GREEN", transaction, flush=True)
            report = json.loads(transaction)
            if "cleanupError" in report:
                print("RETIREMENT_INCOMPLETE", json.dumps({**release_summary, "phase": "committed",
                      "cleanupError": report["cleanupError"]}), flush=True)
                raise RuntimeError("Release committed but previous API retirement is incomplete; inspect the saved host transaction")
            print("DEPLOYED", json.dumps(release_summary), flush=True)
            return
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
            f"find \"$HOME/.cache/ms-playwright\" -type f \\( -name chrome -o -name headless_shell \\) -perm -u+x -print -quit | grep -q .",
            timeout=60,
        )
        remote_run(target, f"cd {root}/apps/server && node --env-file=../../.env.local --import tsx ./src/local-db/migrate.ts", timeout=300)
        remote_run(target, f"pm2 restart helstera-worker --kill-timeout 1200000 && pm2 restart helstera-server --kill-timeout 30000 && pm2 save", timeout=300)
        apply_studio_nginx(target, staging)
        health = remote_run(target, "for i in $(seq 1 30); do curl -fsS --max-time 3 http://127.0.0.1:3000/api/health/ready && exit 0; sleep 1; done; exit 1", timeout=120)
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
        if backup and replacement_started and not blue_green_started:
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
                    if replacement_started or prepared or args.resume_staging:
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
