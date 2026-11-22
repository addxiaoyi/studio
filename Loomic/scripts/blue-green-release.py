"""Publish an immutable API/worker release while keeping the old API available."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from os import replace as replace_file
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
from typing import Protocol
from urllib.parse import urlsplit
import urllib.error
import urllib.request


WORKER_DRAIN_SECONDS = 1200
READY_SECONDS = 90
PROCESS_CONTROL_ENV = {"NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE", "NODE_UNIQUE_ID", "NODE_APP_INSTANCE", "PM2_ID"}
RELEASE_PHASES = ("start_api", "verify_api", "drain_worker", "start_worker", "switch_routes", "verify_public", "persist")


def replace_with_retry(source, destination, windows: bool = os.name == "nt") -> None:
    for attempt in range(6):
        try:
            replace_file(source, destination)
            return
        except PermissionError as error:
            if not windows or getattr(error, "winerror", None) not in (5, 32) or attempt == 5:
                raise
            time.sleep(0.02 * (attempt + 1))


def atomic_write(path: Path, content: bytes) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".release-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        replace_with_retry(temporary, path)
        if os.name == "posix":
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def write_json(path: Path, document: dict) -> None:
    atomic_write(path, json.dumps(document, sort_keys=True).encode())


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ReleaseHost(Protocol):
    def preflight(self) -> None: ...
    def start_api(self) -> None: ...
    def verify_api(self) -> None: ...
    def drain_worker(self) -> None: ...
    def start_worker(self) -> None: ...
    def switch_routes(self) -> None: ...
    def verify_public(self) -> None: ...
    def persist(self) -> None: ...
    def retire_api(self) -> None: ...
    def restore_routes(self) -> None: ...
    def stop_candidate_worker(self) -> None: ...
    def restart_worker(self) -> None: ...
    def stop_candidate_api(self) -> None: ...
    def persist_rollback(self) -> None: ...
    def is_committed(self) -> bool: ...
    def verify_committed(self) -> None: ...
    def verify_rollback(self) -> None: ...


def rollback(host: ReleaseHost, attempted: list[str]) -> list[str]:
    errors = []

    def recover(action: str) -> bool:
        try:
            getattr(host, action)()
            return True
        except Exception as error:
            errors.append(f"{action}: {error}")
            return False

    routes_restored = "switch_routes" not in attempted or recover("restore_routes")
    if not routes_restored:
        return errors
    # Existing candidate WebSockets may still produce work after routing is restored.
    # Keep their worker alive until the API confirms those requests have drained.
    if "start_api" in attempted and not recover("stop_candidate_api"):
        return errors
    worker_stopped = "start_worker" not in attempted or recover("stop_candidate_worker")
    if worker_stopped and "drain_worker" in attempted:
        recover("restart_worker")
    if not errors:
        recover("persist_rollback")
    if not errors:
        recover("verify_rollback")
    return errors


def retire(host: ReleaseHost, report: dict, journal: Path) -> dict:
    report.pop("cleanupError", None)
    try:
        host.retire_api()
    except Exception as error:
        report["cleanupError"] = str(error)
    write_json(journal, report)
    return report


def rollout(host: ReleaseHost, journal: Path) -> dict:
    if journal.exists():
        raise RuntimeError("Release transaction already exists; inspect its journal before recovery")
    host.preflight()
    attempted: list[str] = []
    report: dict = {"phase": "prepared", "attempted": attempted}
    write_json(journal, report)
    try:
        for phase in RELEASE_PHASES:
            attempted.append(phase)
            report["phase"] = phase
            write_json(journal, report)
            getattr(host, phase)()
        report["phase"] = "committed"
        write_json(journal, report)
    except Exception as failure:
        errors = rollback(host, attempted)
        report.update(phase="rollback_incomplete" if errors else "rolled_back", error=str(failure), recoveryErrors=errors)
        write_json(journal, report)
        if errors:
            raise RuntimeError("Release failed; rollback incomplete: " + "; ".join(errors)) from failure
        raise
    return retire(host, report, journal)


def recover_release(host: ReleaseHost, journal: Path) -> dict:
    report = json.loads(journal.read_bytes())
    attempted = report.get("attempted") if isinstance(report, dict) else None
    if not isinstance(attempted, list) or attempted != list(RELEASE_PHASES[:len(attempted)]):
        raise ValueError("Release journal does not contain a valid phase sequence")
    if host.is_committed():
        host.verify_committed()
        report.update(phase="committed", recovered=True)
        write_json(journal, report)
        return retire(host, report, journal)
    if report.get("phase") == "committed":
        raise RuntimeError("Committed journal disagrees with the active release; inspect host state")
    if report.get("phase") == "rolled_back":
        host.verify_rollback()
        return report
    report.update(phase="recovering", recovered=True)
    write_json(journal, report)
    errors = rollback(host, attempted)
    report.update(phase="rollback_incomplete" if errors else "rolled_back", recoveryErrors=errors)
    write_json(journal, report)
    if errors:
        raise RuntimeError("Release recovery incomplete: " + "; ".join(errors))
    return report


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), Path(__file__).with_name(name + ".py"))
    if spec is None or spec.loader is None:
        raise RuntimeError("Release helper is unavailable: " + name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def process_receipt(path: Path, pid: int, state: str, instance_id: str | None = None) -> dict:
    receipt = json.loads(path.read_bytes())
    if (receipt.get("pid") != pid or receipt.get("state") != state or
            not isinstance(receipt.get("instanceId"), str) or not receipt["instanceId"] or
            (instance_id is not None and receipt["instanceId"] != instance_id)):
        raise RuntimeError("Process receipt does not match the expected PID and lifecycle state")
    return receipt


def process_launch(pid: int, root: Path, proc: Path = Path("/proc")) -> tuple[dict[str, str], Path]:
    environment = (proc / str(pid) / "environ").read_bytes().decode().split("\0")
    env = {}
    for entry in environment:
        key, separator, value = entry.partition("=")
        if separator and re.fullmatch(r"[A-Z][A-Z0-9_]*", key) and key not in PROCESS_CONTROL_ENV:
            env[key] = value
    arguments = (proc / str(pid) / "cmdline").read_bytes().decode().split("\0")
    files = [argument.split("=", 1)[1] for argument in arguments if argument.startswith("--env-file=")]
    files.extend(arguments[index + 1] for index, argument in enumerate(arguments[:-1]) if argument == "--env-file")
    if len(files) > 1:
        raise RuntimeError("Multiple Node environment files need an explicit release configuration")
    env_file = Path(files[0]) if files else root / ".env.local"
    if not env_file.is_absolute() or not env_file.is_file():
        raise RuntimeError("Active process environment file is not a readable absolute path")
    return env, env_file


def release_paths(root: Path, staging: Path) -> tuple[Path, Path]:
    root, stage = root.resolve(strict=True), staging.resolve(strict=True)
    if stage.parent != root or not re.fullmatch(r"\.helstera-candidate\.[A-Za-z0-9_-]{1,64}", stage.name):
        raise ValueError("Release staging must be a candidate directory directly below the deployment root")
    return root, stage


def prepare_routes(content: bytes, old_port: int, new_port: int, old_web: Path, new_web: Path, guard) -> bytes:
    text = content.decode("utf-8")
    topology = load_script("release-topology")
    upstream = topology.LOCAL_UPSTREAM
    if topology.api_ports(text) != {str(old_port)}:
        raise RuntimeError("Nginx must have exactly one reviewed local API upstream")
    roots = re.findall(r"\broot\s+([^;]+);", text)
    if not roots or set(roots) != {str(old_web)}:
        raise RuntimeError("Nginx static root does not match the active release")
    # Existing guards prepare canonical port 3000 locations; then bind every API location.
    text = upstream.sub(lambda match: "http://127.0.0.1:3000" if match[1] == str(old_port) else match[0], text)
    text = guard.prepare_creative_isolation(guard.prepare_assistant_websocket(guard.prepare_studio_config(text)))
    text = re.sub(r"(\broot\s+)" + re.escape(str(old_web)) + r"(?=;)", lambda match: match[1] + str(new_web), text)
    text = upstream.sub(lambda match: f"http://127.0.0.1:{new_port}" if match[1] == "3000" else match[0], text)
    if topology.api_ports(text) != {str(new_port)}:
        raise RuntimeError("Prepared Nginx routes do not match the candidate API upstream")
    return text.encode("utf-8")


SCHEMA_PROBE = """
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
const db = new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
try {
  const {rows} = await db.query('select version,checksum from schema_migrations');
  const applied = new Map(rows.map(row=>[row.version,row.checksum]));
  for(const name of (await readdir('./src/local-db/migrations')).filter(name=>name.endsWith('.sql'))) {
    const sql = (await readFile('./src/local-db/migrations/'+name,'utf8')).replace(/^\\uFEFF/,'').replace(/\\r\\n/g,'\\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if(applied.get(name.slice(0,-4))!==checksum) throw new Error('Schema compatibility gate failed: '+name);
  }
} finally { await db.end(); }
"""


class LocalHost:
    def __init__(self, root: Path, staging: Path, config: Path, public_url: str):
        self.root, self.stage = release_paths(root, staging)
        self.release = self.stage / "next"
        self.server = self.release / "apps/server"
        self.config = config.resolve(strict=True)
        self.public_url = public_url
        self.switcher = load_script("switch-server-upstream")
        self.guard = load_script("validate-studio-nginx")
        self.state_path = self.root / ".active-release.json"
        self.previous_state = self.state_path.read_bytes() if self.state_path.exists() else None
        self.topology = load_script("release-topology").inspect(self.root, self.config)
        self.previous = self.topology["active"]
        self.port = next(port for port in (3002, 3003, 3000) if port != self.previous["port"])
        token = self.stage.name.removeprefix(".helstera-candidate.")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", token):
            raise ValueError("Invalid candidate directory token")
        self.names = {kind: f"helstera-{kind}-{token}" for kind in ("server", "worker")}
        self.before = self.config.read_bytes()
        self.after: bytes | None = None
        self.old_worker_pid = 0
        self.new_worker_pid = 0
        self.new_worker_instance: str | None = None
        self.new_api_pid = 0
        self.new_api_instance: str | None = None

    def save_context(self) -> None:
        fields = ("previous", "old_version", "old_worker_pid", "old_instance", "old_api_pid", "old_api_instance",
                  "port", "names", "version", "new_worker_pid", "new_worker_instance", "new_api_pid", "new_api_instance")
        context = {name: getattr(self, name) for name in fields}
        context.update(schemaVersion=1, root=str(self.root), staging=str(self.stage), config=str(self.config),
                       publicUrl=self.public_url, oldReceipt=str(self.old_receipt), oldApiReceipt=self.old_api_receipt,
                       previousState=self.previous_state.decode("utf-8") if self.previous_state is not None else None,
                       beforeSha256=hashlib.sha256(self.before).hexdigest(), afterSha256=hashlib.sha256(self.after).hexdigest())
        write_json(self.stage / "transaction-context.json", context)

    @classmethod
    def from_context(cls, root: Path, staging: Path, config: Path, public_url: str):
        root, stage = release_paths(root, staging)
        context = json.loads((stage / "transaction-context.json").read_bytes())
        expected = {"schemaVersion": 1, "root": str(root), "staging": str(stage),
                    "config": str(config.resolve(strict=True)), "publicUrl": public_url}
        if any(context.get(key) != value for key, value in expected.items()):
            raise ValueError("Recovery arguments do not match the saved release context")
        host = cls.__new__(cls)
        host.root, host.stage, host.config, host.public_url = root, stage, config.resolve(strict=True), public_url
        host.release = stage / "next"
        host.server = host.release / "apps/server"
        host.state_path = root / ".active-release.json"
        host.previous_state = context["previousState"].encode("utf-8") if context["previousState"] is not None else None
        for name in ("previous", "old_version", "old_worker_pid", "old_instance", "old_api_pid", "old_api_instance",
                     "port", "names", "version", "new_worker_pid", "new_worker_instance"):
            setattr(host, name, context[name])
        host.new_api_pid = context.get("new_api_pid", 0)
        host.new_api_instance = context.get("new_api_instance")
        host.old_receipt = Path(context["oldReceipt"])
        host.old_api_receipt = context["oldApiReceipt"]
        host.before, host.after = (stage / "nginx.before").read_bytes(), (stage / "nginx.after").read_bytes()
        if (hashlib.sha256(host.before).hexdigest() != context["beforeSha256"] or
                hashlib.sha256(host.after).hexdigest() != context["afterSha256"]):
            raise RuntimeError("Saved Nginx snapshots do not match the release context")
        if host.config.read_bytes() not in host.recovery_route_snapshots():
            raise RuntimeError("Nginx was changed outside this transaction; recovery refused")
        host.switcher, host.guard = load_script("switch-server-upstream"), load_script("validate-studio-nginx")
        processes = host.processes()
        expected_roots = {host.previous["api"]: Path(host.previous["release"]) / "apps/server",
                          host.previous["worker"]: Path(host.previous["release"]) / "apps/server",
                          host.names["server"]: host.server, host.names["worker"]: host.server}
        for item in processes:
            if item.get("name") not in expected_roots:
                continue
            if Path(item["pm2_env"]["pm_cwd"]).resolve(strict=True) != expected_roots[item["name"]].resolve(strict=True):
                raise RuntimeError("A PM2 process no longer belongs to the reviewed release")
            if item["name"] == host.names["server"] and (not host.new_api_pid or not host.new_api_instance):
                raise RuntimeError("Saved context lacks the candidate API identity; automatic recovery refused")
            if item["pm2_env"]["status"] != "online":
                continue
            if item["name"] == host.previous["worker"]:
                receipt = process_receipt(host.old_receipt, item["pid"], "ready")
                host.old_worker_pid, host.old_instance = item["pid"], receipt["instanceId"]
            if item["name"] == host.previous["api"] and host.old_api_receipt:
                receipt = process_receipt(Path(host.old_api_receipt), item["pid"], "ready")
                host.old_api_pid, host.old_api_instance = item["pid"], receipt["instanceId"]
            if item["name"] == host.names["worker"]:
                receipt = process_receipt(stage / "worker-receipt.json", item["pid"], "ready")
                host.new_worker_pid, host.new_worker_instance = item["pid"], receipt["instanceId"]
            if item["name"] == host.names["server"]:
                if item["pid"] != host.new_api_pid:
                    raise RuntimeError("Candidate API restarted outside this transaction; automatic recovery refused")
                process_receipt(stage / "server-receipt.json", host.new_api_pid, "ready", host.new_api_instance)
        host.save_context()
        return host

    def recovery_route_snapshots(self) -> tuple[bytes, ...]:
        return (self.before, self.after)

    def run(self, arguments: list[str], timeout: int = 60, cwd: Path | None = None, env: dict | None = None) -> str:
        try:
            completed = subprocess.run(arguments, cwd=cwd, env=env, check=True, capture_output=True, text=True, timeout=timeout)
        except (subprocess.SubprocessError, OSError) as error:
            # PM2/Node diagnostics may contain the inherited environment or database URL.
            raise RuntimeError(f"Release command failed: {Path(arguments[0]).name}; inspect host logs") from error
        return completed.stdout

    def processes(self) -> list[dict]:
        return json.loads(self.run(["pm2", "jlist"]))

    def process(self, name: str) -> dict:
        matches = [item for item in self.processes() if item.get("name") == name]
        if len(matches) != 1:
            raise RuntimeError("Expected exactly one PM2 process named " + name)
        return matches[0]

    def preflight(self) -> None:
        url = urlsplit(self.public_url)
        if url.scheme not in ("http", "https") or not url.netloc or url.username or url.password:
            raise ValueError("Public health URL must be HTTP(S) without embedded credentials")
        if self.previous["port"] not in (3000, 3002, 3003):
            raise ValueError("Active release must use one of the reviewed API ports")
        self.assert_active_pointer()
        if self.config.read_bytes() != self.before:
            raise RuntimeError("Nginx changed before release preflight")
        prepared = json.loads((self.stage / "prepared-base.json").read_bytes())
        current_hash = hashlib.sha256(self.previous_state).hexdigest() if self.previous_state else None
        if prepared.get("stateSha256") != current_hash or prepared.get("active") != self.previous:
            raise RuntimeError("Active release changed while the candidate was prepared; rebuild from the current release")
        for path in (self.release, self.server, self.release / "apps/web/out"):
            if path.resolve(strict=True) != path:
                raise RuntimeError("Candidate source and static roots must not be symlinks")
        for name in ("server", "worker"):
            source = (self.server / f"src/{name}.ts").read_text(encoding="utf-8")
            if "createProcessReceipt" not in source:
                raise RuntimeError("Candidate is missing process lifecycle receipts")
        api = self.process(self.previous["api"])
        worker = self.process(self.previous["worker"])
        if any(item["pm2_env"]["status"] != "online" for item in (api, worker)):
            raise RuntimeError("Previous API and worker must both be online")
        self.old_worker_pid = worker["pid"]
        self.old_api_pid = api["pid"]
        self.old_api_receipt = api["pm2_env"].get("HELSTERA_PROCESS_RECEIPT")
        if not self.old_api_receipt:
            raise RuntimeError("Existing API has no drain receipt; bootstrap lifecycle support before blue-green deployment")
        self.old_api_instance = process_receipt(Path(self.old_api_receipt), api["pid"], "ready")["instanceId"]
        receipt_file = worker["pm2_env"].get("HELSTERA_PROCESS_RECEIPT")
        if not receipt_file:
            raise RuntimeError("Existing worker has no drain receipt; bootstrap lifecycle support before blue-green deployment")
        self.old_receipt = Path(receipt_file)
        self.old_instance = process_receipt(self.old_receipt, self.old_worker_pid, "ready")["instanceId"]
        self.old_version = self.switcher.ready(self.previous["port"], self.version_at(api))["version"]
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", self.port))
        if any(item.get("name") in self.names.values() for item in self.processes()):
            raise RuntimeError("Candidate PM2 name is already registered")
        self.after = prepare_routes(self.before, self.previous["port"], self.port,
                                    Path(self.previous["web"]), self.release / "apps/web/out", self.guard)
        self.run(["nginx", "-t"])
        launches = {kind: process_launch(item["pid"], self.root) for kind, item in (("server", api), ("worker", worker))}
        api_env, api_env_file = launches["server"]
        self.check_schema_before_start(api_env_file, api_env)
        package_path = self.server / "package.json"
        package = json.loads(package_path.read_bytes())
        digest = file_hash(self.stage / "candidate.zip")[:16]
        self.version = "0.0.0-release." + digest + "." + self.stage.name.split(".")[-1].replace("_", "-")
        package["version"] = self.version
        write_json(package_path, package)
        self.start_specs = {}
        for kind in ("server", "worker"):
            # Shell-exported provider settings are absent from PM2 metadata; read the running process.
            env, env_file = launches[kind]
            env.update(HOST="127.0.0.1", HELSTERA_SERVER_PORT=str(self.port),
                       HELSTERA_PROCESS_RECEIPT=str(self.stage / f"{kind}-receipt.json"))
            self.start_specs[kind] = {"name": self.names[kind], "cwd": str(self.server),
                "script": f"./src/{kind}.ts", "interpreter": "node", "exec_mode": "fork", "instances": 1,
                "node_args": [f"--env-file={env_file}", "--import", "tsx"],
                "wait_ready": True, "listen_timeout": READY_SECONDS * 1000,
                "kill_timeout": WORKER_DRAIN_SECONDS * 1000, "env": env}
        atomic_write(self.stage / "nginx.before", self.before)
        atomic_write(self.stage / "nginx.after", self.after)
        self.stage.chmod(0o711)
        for directory in (self.release, self.release / "apps", self.release / "apps/web"):
            directory.chmod(0o755)
        web = self.release / "apps/web/out"
        web.chmod(0o755)
        for path in web.rglob("*"):
            if path.is_symlink():
                raise RuntimeError("Candidate public assets must not contain symlinks")
            path.chmod(0o755 if path.is_dir() else 0o644)
        self.save_context()

    def check_schema_before_start(self, env_file: Path, env: dict) -> None:
        self.run(["node", f"--env-file={env_file}", "--import", "tsx", "--input-type=module", "-e", SCHEMA_PROBE], cwd=self.server, env=env)

    def version_at(self, api: dict) -> str:
        package = Path(api["pm2_env"]["pm_cwd"]) / "package.json"
        return json.loads(package.read_bytes())["version"]

    def start(self, kind: str) -> None:
        path = self.stage / f"{kind}.config.json"
        write_json(path, {"apps": [self.start_specs[kind]]})
        self.run(["pm2", "start", str(path)], timeout=READY_SECONDS + 30)
        deadline = time.monotonic() + READY_SECONDS
        while True:
            item = self.process(self.names[kind])
            if item["pm2_env"]["status"] == "online":
                try:
                    receipt = process_receipt(self.stage / f"{kind}-receipt.json", item["pid"], "ready")
                    if kind == "worker":
                        self.new_worker_pid = item["pid"]
                        self.new_worker_instance = receipt["instanceId"]
                    else:
                        self.new_api_pid = item["pid"]
                        self.new_api_instance = receipt["instanceId"]
                    self.save_context()
                    return
                except (OSError, ValueError, RuntimeError):
                    pass
            if time.monotonic() >= deadline:
                raise RuntimeError("Candidate " + kind + " did not become ready")
            time.sleep(0.25)

    def start_api(self) -> None:
        self.start("server")

    def verify_api(self) -> None:
        self.switcher.ready(self.port, self.version)

    def stop_worker(self, name: str, receipt: Path, pid: int, instance_id: str | None = None) -> None:
        current = self.process(name)
        if current["pm2_env"]["status"] != "online" or current["pid"] != pid:
            raise RuntimeError("Worker identity changed before draining; automatic stop refused")
        instance = process_receipt(receipt, pid, "ready", instance_id)["instanceId"]
        self.run(["pm2", "stop", name, "--kill-timeout", str(WORKER_DRAIN_SECONDS * 1000)], timeout=WORKER_DRAIN_SECONDS + 60)
        item = self.process(name)
        if item["pm2_env"]["status"] != "stopped" or item["pm2_env"].get("exit_code") != 0:
            raise RuntimeError("Worker did not exit cleanly")
        process_receipt(receipt, pid, "drained", instance)

    def drain_worker(self) -> None:
        self.assert_active_pointer()
        if self.config.read_bytes() != self.before:
            raise RuntimeError("Nginx changed before worker drain; mutation refused")
        self.stop_worker(self.previous["worker"], self.old_receipt, self.old_worker_pid, self.old_instance)

    def start_worker(self) -> None:
        self.start("worker")

    def switch_routes(self) -> None:
        self.assert_active_pointer()
        if self.config.read_bytes() != self.before:
            raise RuntimeError("Nginx changed after release preflight")
        self.verify_worker()
        metadata = self.config.stat()
        self.switcher.replace_config(self.config, self.after, metadata)
        self.run(["nginx", "-t"])
        self.verify_api()
        self.run(["nginx", "-s", "reload"])

    def verify_public(self) -> None:
        self.switcher.wait_public(self.public_url, self.version)
        deadline = time.monotonic() + 10
        while True:
            try:
                self.verify_public_assets()
                return
            except (OSError, urllib.error.URLError, RuntimeError, json.JSONDecodeError) as error:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("Public API and static routes did not converge on the candidate") from error
                time.sleep(min(0.1, remaining))

    def verify_public_assets(self) -> None:
        url = urlsplit(self.public_url)
        base = f"{url.scheme}://{url.netloc}"
        for name in ("goals", "suggestions", "memories", "connectors"):
            try:
                response = urllib.request.urlopen(base + "/api/agent/" + name, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = json.load(response)
                if (response.status != 401 or not isinstance(body, dict) or body.get("ok") is not False or
                        not isinstance(body.get("error"), dict) or body["error"].get("code") != "unauthorized"):
                    raise RuntimeError("Public Agent authentication probe failed: " + name)
        web = self.release / "apps/web/out"
        for relative in ("fashion-gallery/index.html", "video/index.html", "fashion-gallery/img/SPR-0001.webp"):
            route = relative.removesuffix("index.html")
            request = urllib.request.Request(base + "/" + route, headers={"Accept-Encoding": "identity", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=20) as response:
                actual = hashlib.sha256(response.read()).digest()
            if actual != hashlib.sha256((web / relative).read_bytes()).digest():
                raise RuntimeError("Public static content does not match the candidate: " + route)
        try:
            urllib.request.urlopen(base + "/fashion-gallery/img/__helstera_missing__.webp", timeout=15)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise RuntimeError("Missing public asset did not return HTTP 404") from error
        else:
            raise RuntimeError("Missing public asset was served as a successful page")

    def persist(self) -> None:
        self.assert_active_pointer()
        self.verify_api()
        self.verify_worker()
        if self.config.read_bytes() != self.after:
            raise RuntimeError("Nginx changed before release commit")
        self.run(["pm2", "save"])
        write_json(self.state_path, {"api": self.names["server"], "worker": self.names["worker"],
            "port": self.port, "web": str(self.release / "apps/web/out"), "version": self.version,
            "release": str(self.release), "previous": {key: value for key, value in self.previous.items() if key != "previous"}})

    def verify_worker(self) -> None:
        item = self.process(self.names["worker"])
        if item["pm2_env"]["status"] != "online" or item["pid"] != self.new_worker_pid:
            raise RuntimeError("Candidate worker restarted or stopped during release")
        process_receipt(self.stage / "worker-receipt.json", item["pid"], "ready", self.new_worker_instance)

    def retire_api(self) -> None:
        receipt = self.old_api_receipt
        if not receipt:
            raise RuntimeError("Previous API has no verifiable drain receipt; automatic stop refused")
        old = self.process(self.previous["api"])
        if old["pm2_env"]["status"] != "stopped":
            if old["pm2_env"]["status"] != "online" or old["pid"] != self.old_api_pid:
                raise RuntimeError("Previous API identity changed before retirement; automatic stop refused")
            process_receipt(Path(receipt), self.old_api_pid, "ready", self.old_api_instance)
            self.run(["pm2", "stop", self.previous["api"], "--kill-timeout", str(WORKER_DRAIN_SECONDS * 1000)], timeout=WORKER_DRAIN_SECONDS + 60)
            old = self.process(self.previous["api"])
        if old["pm2_env"]["status"] != "stopped" or old["pm2_env"].get("exit_code") != 0:
            raise RuntimeError("Previous API did not exit cleanly")
        process_receipt(Path(receipt), self.old_api_pid, "drained", self.old_api_instance)
        self.run(["pm2", "save"])

    def restore_routes(self) -> None:
        self.assert_active_pointer(allow_candidate=True)
        current = self.config.read_bytes()
        if current not in (self.before, self.after):
            raise RuntimeError("Nginx was edited outside this transaction; manual recovery required")
        self.switcher.ready(self.previous["port"], self.old_version)
        self.switcher.replace_config(self.config, self.before, self.config.stat())
        self.run(["nginx", "-t"])
        self.run(["nginx", "-s", "reload"])
        self.switcher.wait_public(self.public_url, self.old_version)

    def stop_candidate_worker(self) -> None:
        items = [item for item in self.processes() if item.get("name") == self.names["worker"]]
        if not items:
            return
        item = items[0]
        if item["pm2_env"]["status"] == "online":
            if self.new_worker_pid and item["pid"] != self.new_worker_pid:
                raise RuntimeError("Candidate worker identity changed; automatic stop refused")
            self.stop_worker(self.names["worker"], self.stage / "worker-receipt.json", item["pid"], self.new_worker_instance)
        elif item["pm2_env"]["status"] != "stopped" or item["pm2_env"].get("exit_code") != 0:
            raise RuntimeError("Candidate worker state is uncertain; previous worker will remain stopped")
        else:
            if not self.new_worker_pid:
                raise RuntimeError("Candidate worker stopped before a ready receipt was verified")
            process_receipt(self.stage / "worker-receipt.json", self.new_worker_pid, "drained", self.new_worker_instance)

    def restart_worker(self) -> None:
        item = self.process(self.previous["worker"])
        status = item["pm2_env"]["status"]
        if status == "online":
            process_receipt(self.old_receipt, item["pid"], "ready", self.old_instance)
            return
        if status != "stopped" or item["pm2_env"].get("exit_code") != 0:
            raise RuntimeError("Previous worker is not confirmed drained; automatic restart refused")
        process_receipt(self.old_receipt, self.old_worker_pid, "drained", self.old_instance)
        self.run(["pm2", "restart", self.previous["worker"]], timeout=READY_SECONDS + 30)
        deadline = time.monotonic() + READY_SECONDS
        while True:
            item = self.process(self.previous["worker"])
            try:
                receipt = process_receipt(self.old_receipt, item["pid"], "ready")
                if item["pm2_env"]["status"] == "online" and receipt["instanceId"] != self.old_instance:
                    return
            except (OSError, ValueError, RuntimeError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError("Previous worker did not recover readiness")
            time.sleep(0.25)

    def stop_candidate_api(self) -> None:
        matches = [item for item in self.processes() if item.get("name") == self.names["server"]]
        if not matches:
            return
        if len(matches) != 1:
            raise RuntimeError("Candidate API identity is ambiguous; automatic stop refused")
        item = matches[0]
        receipt = self.stage / "server-receipt.json"
        if item["pm2_env"]["status"] == "online":
            if not self.new_api_pid or item["pid"] != self.new_api_pid or not self.new_api_instance:
                raise RuntimeError("Candidate API identity was not verified or changed; automatic stop refused")
            process_receipt(receipt, self.new_api_pid, "ready", self.new_api_instance)
            self.run(["pm2", "stop", self.names["server"], "--kill-timeout", str(WORKER_DRAIN_SECONDS * 1000)], timeout=WORKER_DRAIN_SECONDS + 60)
            item = self.process(self.names["server"])
        if item["pm2_env"]["status"] != "stopped" or item["pm2_env"].get("exit_code") != 0:
            raise RuntimeError("Candidate API did not exit cleanly")
        if not self.new_api_pid or not self.new_api_instance:
            raise RuntimeError("Candidate API stopped without a verified process identity")
        process_receipt(receipt, self.new_api_pid, "drained", self.new_api_instance)

    def persist_rollback(self) -> None:
        self.assert_active_pointer(allow_candidate=True)
        if self.previous_state is None:
            self.state_path.unlink(missing_ok=True)
        else:
            atomic_write(self.state_path, self.previous_state)
        self.run(["pm2", "save"])

    def assert_active_pointer(self, allow_candidate: bool = False) -> None:
        state = self.state_path.read_bytes() if self.state_path.exists() else None
        if state == self.previous_state:
            return
        if allow_candidate and state is not None:
            active = json.loads(state)
            expected = {"api": self.names["server"], "worker": self.names["worker"], "port": self.port,
                        "version": self.version, "release": str(self.release), "web": str(self.release / "apps/web/out")}
            if isinstance(active, dict) and all(active.get(key) == value for key, value in expected.items()):
                return
        raise RuntimeError("Active release pointer changed outside this transaction; mutation refused")

    def is_committed(self) -> bool:
        state = self.state_path.read_bytes() if self.state_path.exists() else None
        if state == self.previous_state:
            return False
        active = json.loads(state) if state is not None else {}
        expected = {"api": self.names["server"], "worker": self.names["worker"], "port": self.port,
                    "version": self.version, "release": str(self.release), "web": str(self.release / "apps/web/out")}
        if any(active.get(key) != value for key, value in expected.items()):
            raise RuntimeError("Active release changed outside this transaction; recovery refused")
        return self.config.read_bytes() == self.after

    def verify_committed(self) -> None:
        self.verify_api()
        self.verify_worker()
        self.verify_public()

    def verify_rollback(self) -> None:
        if self.config.read_bytes() != self.before:
            raise RuntimeError("Nginx is not restored to its previous configuration")
        state = self.state_path.read_bytes() if self.state_path.exists() else None
        if state != self.previous_state:
            raise RuntimeError("Active release pointer is not restored")
        self.switcher.ready(self.previous["port"], self.old_version)
        self.switcher.wait_public(self.public_url, self.old_version)
        old = self.process(self.previous["worker"])
        if old["pm2_env"]["status"] != "online":
            raise RuntimeError("Previous worker is not online")
        process_receipt(self.old_receipt, old["pid"], "ready")
        for item in self.processes():
            if item.get("name") in self.names.values() and item["pm2_env"]["status"] not in ("stopped", "errored"):
                raise RuntimeError("Candidate process is still active after rollback")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--staging", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--public-url", required=True)
    parser.add_argument("--recover", action="store_true", help="Recover the saved transaction without submitting new work")
    args = parser.parse_args()
    import fcntl
    with (args.root / ".release.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with open("/run/lock/helstera-upstream.lock", "a") as upstream_lock:
            fcntl.flock(upstream_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.recover:
                host = LocalHost.from_context(args.root, args.staging, args.config, args.public_url)
                report = recover_release(host, args.staging / "transaction.json")
            else:
                host = LocalHost(args.root, args.staging, args.config, args.public_url)
                report = rollout(host, args.staging / "transaction.json")
            print(json.dumps(report))


if __name__ == "__main__":
    main()
