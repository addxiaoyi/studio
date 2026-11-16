"""Create a loopback-only disposable PostgreSQL cluster for local integration tests."""
import argparse
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import tempfile


def postgres(*arguments):
    return subprocess.run(["runuser", "-u", "postgres", "--", *map(str, arguments)],
                          check=True, capture_output=True, text=True, timeout=60)


def create(bin_dir: Path) -> dict:
    account = pwd.getpwnam("postgres")
    base = Path(tempfile.mkdtemp(prefix="helstera-integration-pg-"))
    os.chown(base, account.pw_uid, account.pw_gid)
    data = base / "data"
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    try:
        postgres(bin_dir / "initdb", "-D", data, "--auth-local=trust", "--auth-host=trust", "--no-instructions")
        options = f"-c listen_addresses=127.0.0.1 -c port={port} -c unix_socket_directories={base}"
        postgres(bin_dir / "pg_ctl", "-D", data, "-l", base / "postgres.log", "-o", options, "-w", "start")
        return {"base": str(base), "port": port, "url": f"postgresql://postgres@127.0.0.1:{port}/postgres"}
    except Exception:
        if (data / "postmaster.pid").exists():
            postgres(bin_dir / "pg_ctl", "-D", data, "-m", "fast", "-w", "stop")
        shutil.rmtree(base)
        raise


def remove(base: Path, bin_dir: Path) -> None:
    base = base.resolve(strict=True)
    if base.parent != Path(tempfile.gettempdir()).resolve() or not base.name.startswith("helstera-integration-pg-"):
        raise ValueError("Refusing to remove an unrecognized test cluster")
    data = base / "data"
    if (data / "postmaster.pid").exists():
        postgres(bin_dir / "pg_ctl", "-D", data, "-m", "fast", "-w", "stop")
    if (data / "postmaster.pid").exists():
        raise RuntimeError("Test PostgreSQL is still running; retained its files")
    shutil.rmtree(base)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("create", "remove"))
    parser.add_argument("--bin-dir", type=Path, default=Path("/usr/lib/postgresql/16/bin"))
    parser.add_argument("--base", type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("The test cluster requires the isolated postgres user")
    if args.action == "create":
        print(json.dumps(create(args.bin_dir)))
    else:
        if args.base is None:
            raise ValueError("A specific test cluster path is required")
        remove(args.base, args.bin_dir)
        print("test cluster removed")
