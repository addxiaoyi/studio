"""Rehearse a dump and candidate migrations in a private PostgreSQL cluster."""

import argparse
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import tempfile
from urllib.parse import quote


def run(command, *, env=None, cwd=None):
    subprocess.run(command, check=True, env=env, cwd=cwd)


def postgres_command(*args):
    return ["runuser", "-u", "postgres", "--", *args]


def rehearse(base, dump, server, bin_dir):
    if os.geteuid() != 0:
        raise RuntimeError("The rehearsal must run as root to isolate the postgres account.")
    base, dump, server, bin_dir = (Path(p).resolve(strict=True) for p in (base, dump, server, bin_dir))
    if not base.is_dir() or not dump.is_file() or not server.is_dir():
        raise ValueError("Invalid rehearsal inputs.")
    if any(char.isspace() for char in str(base)):
        raise ValueError("The rehearsal base path cannot contain whitespace.")
    if not (server / "src/local-db/migrate.ts").is_file():
        raise ValueError("Candidate migration entry point is missing.")
    account = pwd.getpwnam("postgres")
    cluster = Path(tempfile.mkdtemp(prefix=".loomic-pg-rehearsal-", dir=base))
    os.chown(cluster, account.pw_uid, account.pw_gid)
    socket = cluster / "socket"
    socket.mkdir(mode=0o700)
    os.chown(socket, account.pw_uid, account.pw_gid)
    data = cluster / "data"
    env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR") if k in os.environ}
    env["PGHOST"] = str(socket)
    env["PGPORT"] = "5432"
    env["PGUSER"] = "postgres"
    try:
        run(postgres_command(str(bin_dir / "initdb"), "-D", str(data), "--auth-local=trust", "--auth-host=reject", "--no-instructions"), env=env)
        options = f"-c listen_addresses='' -c unix_socket_directories={socket} -c unix_socket_permissions=0700 -c port=5432"
        run(postgres_command(str(bin_dir / "pg_ctl"), "-D", str(data), "-l", str(cluster / "postgres.log"), "-o", options, "-w", "start"), env=env)
        identity = subprocess.check_output([str(bin_dir / "psql"), "-X", "-d", "postgres", "-At", "-c", "show data_directory"], env=env, text=True).strip()
        if Path(identity).resolve() != data:
            raise RuntimeError("Refusing to restore: database identity does not match the isolated cluster.")
        run([str(bin_dir / "pg_restore"), "--exit-on-error", "--no-owner", "--no-acl", "--dbname=postgres", str(dump)], env=env)
        check = subprocess.check_output([str(bin_dir / "psql"), "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-At", "-c", "select to_regclass('public.app_users') is not null and to_regclass('public.workspaces') is not null"], env=env, text=True).strip()
        if check != "t":
            raise RuntimeError("The restored database is missing required tables.")
        env["DATABASE_URL"] = "postgresql://postgres@localhost/postgres?host=" + quote(str(socket), safe="") + "&port=5432"
        run(["node", "--import", "tsx", "./src/local-db/migrate.ts"], env=env, cwd=server)
    finally:
        if (data / "postmaster.pid").exists():
            run(postgres_command(str(bin_dir / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"), env=env)
        if (data / "postmaster.pid").exists():
            raise RuntimeError(f"Temporary PostgreSQL might still be running; retained {cluster}")
        shutil.rmtree(cluster)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "dump", "server", "bin-dir"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    rehearse(args.base, args.dump, args.server, args.bin_dir)


if __name__ == "__main__":
    main()
