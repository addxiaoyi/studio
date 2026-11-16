from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tarfile
import traceback
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from urllib.parse import urlsplit

from scripts.test_prepare_legacy_lifecycle import bridge_fixture


SENTINEL = "fixture-environment-value-must-not-be-logged"
ACTIVITY_COLUMNS = {
    "background_jobs": ["status", "sync_claimed_at"],
    "agent_runs": ["status"],
    "agent_goals": ["status"],
    "agent_goal_steps": ["state", "lease_token", "lease_until"],
    "video_transcripts": ["state", "lease_token", "lease_until"],
    "video_transcript_exports": ["state", "lease_token", "lease_until"],
    "desktop_agent_tasks": ["status"],
    "media_resource_leases": ["lease_until"],
}


def activity_report():
    tables = {}
    for name, columns in ACTIVITY_COLUMNS.items():
        tables[name] = {"state": "checked", "relationKind": "r", "columns": [
            {"name": column, "type": "timestamp with time zone" if column.endswith(("_at", "_until"))
             else "uuid" if column.endswith("_token") or column == "run_owner" else "text"} for column in columns],
            "unavailableChecks": ["run_owner", "run_lease_until"] if name == "agent_runs" else [],
            "total": 0, "statuses": {}, "metrics": {"active_ownerless": 0} if name == "agent_runs" else {},
            "unknownStatuses": 0}
    return {"readOnly": True, "activity": "none_observed", "blockers": [], "schema": "public", "tables": tables,
            "coverage": {"checked": list(tables), "absent": [], "unsupported": [], "partial": ["agent_runs"]},
            "durableWork": {}}


def load_script(name):
    path = Path(__file__).with_name(name + ".py")
    if not path.is_file():
        raise AssertionError("Missing bootstrap host implementation: " + str(path))
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load bootstrap host test dependency")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_proc(directory, pid, cwd, ticks):
    process = directory / str(pid)
    process.mkdir(parents=True, exist_ok=True)
    (process / "stat").write_text(f"{pid} (node) S " + "0 " * 18 + str(ticks) + " 0\n")
    try:
        (process / "cwd").symlink_to(cwd, target_is_directory=True)
    except OSError as error:
        raise unittest.SkipTest("Directory symlinks are unavailable: " + str(error))
    (process / "environ").write_bytes(("DATABASE_URL=" + SENTINEL + "\0").encode())
    return process


class FixtureHost:
    def __init__(self, folder, adapter):
        self.adapter = adapter
        self.fixture = bridge_fixture(folder)
        self.root = self.fixture.root
        builder = load_script("prepare-legacy-lifecycle")
        builder.prepare_bridge(self.fixture.source, self.fixture.shared, self.fixture.dependencies,
                               self.fixture.receipt, self.fixture.output, self.fixture.server_hash,
                               self.fixture.worker_hash)
        self.manifest = self.fixture.output / "BRIDGE-MANIFEST.json"
        self.bootstrap = self.root / "bootstrap"
        self.bootstrap.mkdir()
        self.backup = self.root / "backup"
        self.backup.mkdir()
        (self.backup / "current.tgz").write_bytes(b"verified fixture backup")
        (self.backup / "database.dump").write_bytes(b"verified fixture database backup")
        self.config = self.root / "nginx.conf"
        galleries = "".join(
            f"    location ^~ /{prefix}fashion-gallery/{kind}/ {{\n"
            f"        proxy_pass http://127.0.0.1:3014{('/api/public-media/fashion-gallery/' + kind + '/') if not prefix else ''};\n"
            "    }\n"
            for prefix in ("", "api/public-media/") for kind in ("img", "thumbs"))
        self.web = self.root / "apps/web/out"
        self.web.mkdir(parents=True)
        self.config.write_text("server {\n    server_name studio.0st.top;\n    root " + str(self.web) + ";\n"
                               + galleries + "    location /api/ { proxy_pass http://127.0.0.1:3003; }\n"
                               "    location / { try_files $uri $uri/ =404; }\n}\n")
        self.env_file = self.root / ".env.local"
        self.env_file.write_text("DATABASE_URL=" + SENTINEL + "\n")
        self.proc = self.root / "proc"
        self.pm2_log = self.root / "pm2.log"
        self.pm2_log.write_text("existing historical PM2 log\n")
        self.commands = []
        self.failure = None
        self.public_failure = False
        self.activity = activity_report()
        self.stop_signal = "SIGINT"
        self.write_exit_log = True
        self.worker_complete = True
        self.leave_proc = False
        self.exit_code = 0
        self.processes = []
        for kind, pid, pmid in (("server", 101, 4), ("worker", 102, 5)):
            log = self.root / (kind + "-out.log")
            log.write_text("old process log\n")
            item = {"name": "helstera-" + kind, "pid": pid, "pm_id": pmid,
                    "pm2_env": {"status": "online", "pm_cwd": str(self.fixture.source), "pm_id": pmid,
                                "pm_out_log_path": str(log), "pm_err_log_path": str(log), "exit_code": 0}}
            self.processes.append(item)
            process = write_proc(self.proc, pid, self.fixture.source, pid * 10)
            (process / "cmdline").write_bytes(("node\0--env-file=" + str(self.env_file) + "\0src/" + kind + ".ts\0").encode())
        self.host = self.new_host()

    def new_host(self, **overrides):
        arguments = {"root": self.root, "config": self.config, "bootstrap_dir": self.bootstrap,
            "bridge": self.fixture.output, "api_name": "helstera-server", "worker_name": "helstera-worker",
            "api_pid": 101, "worker_pid": 102, "manifest_sha256": digest(self.manifest), "backup": self.backup,
            "env_file": self.env_file, "expected_config_sha256": digest(self.config),
            "runner": self.run, "proc_root": self.proc, "pm2_log": self.pm2_log}
        arguments.update(overrides)
        return self.adapter.BootstrapHost(**arguments)

    def full_preflight(self):
        (self.fixture.source / "node_modules").symlink_to(self.fixture.dependencies, target_is_directory=True)
        for item in self.processes:
            (self.proc / str(item["pid"]) / "exe").symlink_to(Path(shutil.which("node")).resolve())
        layout = {"source": str(self.fixture.source.parent.parent), "web": str(self.web),
                  "shared": str(self.fixture.shared)}
        with tarfile.open(self.backup / "current.tgz", "w:gz") as bundle:
            content = json.dumps(layout).encode()
            member = tarfile.TarInfo("SOURCE-LAYOUT.json")
            member.size = len(content)
            bundle.addfile(member, io.BytesIO(content))
            bundle.add(self.fixture.shared / "index.js", arcname="packages/shared/dist/index.js")
        (self.backup / "database.dump.sha256").write_text(digest(self.backup / "database.dump") + "  database.dump\n")
        self.host.http = self.http

    def http(self, url, method="GET", headers=None, body=None, timeout=10):
        address = urlsplit(url)
        path = address.path
        if "/fashion-gallery/" in path:
            ranged = bool(headers and headers.get("Range"))
            return {"status": 206 if ranged else 200,
                    "headers": {"content-type": "image/webp", "etag": '"fixture-media"',
                                "content-range": "bytes 0-31/32" if ranged else None},
                    "body": b"fixture media bytes"}
        maintenance = b"return 503;" in self.config.read_bytes()
        if address.hostname == "127.0.0.1" and address.port is None and maintenance:
            return {"status": 503, "headers": {"retry-after": "30", "cache-control": "no-store"}, "body": b"maintenance"}
        if path == "/api/health/ready":
            failing = self.public_failure and address.hostname == "studio.0st.top" and b":3002" in self.config.read_bytes()
            checks = {name: {"ok": True} for name in ("database", "storage", "accepting")}
            return {"status": 503 if failing else 200, "headers": {"content-type": "application/json"},
                    "body": json.dumps({"ok": not failing, "version": "legacy", "checks": checks}).encode()}
        return {"status": 401, "headers": {"content-type": "application/json"},
                "body": b'{"ok":false,"error":{"code":"unauthorized"}}'}

    def run(self, arguments, timeout=60, cwd=None, env=None):
        self.commands.append(list(arguments))
        if self.failure:
            raise self.failure
        if arguments[:2] == ["pm2", "jlist"]:
            return json.dumps(self.processes)
        if "inspectLegacyReleaseActivity" in arguments[-1]:
            return json.dumps(self.activity)
        if arguments[:2] == ["pm2", "start"]:
            spec = json.loads(Path(arguments[2]).read_bytes())["apps"][0]
            role = "worker" if "-worker-" in spec["name"] else "server"
            pid, pmid = (202, 7) if role == "worker" else (201, 6)
            item = {"name": spec["name"], "pid": pid, "pm_id": pmid,
                    "pm2_env": {**spec["env"], "status": "online", "pm_cwd": spec["cwd"], "exit_code": 0}}
            self.processes.append(item)
            write_proc(self.proc, pid, Path(spec["cwd"]), pid * 10)
            Path(spec["env"]["HELSTERA_PROCESS_RECEIPT"]).write_text(json.dumps(
                {"role": role, "pid": pid, "instanceId": role + "-fixture", "state": "ready"}))
        if arguments[:2] == ["pm2", "stop"]:
            item = next(item for item in self.processes if item["name"] == arguments[2])
            if self.write_exit_log:
                with self.pm2_log.open("a") as output:
                    output.write(f"App [{item['name']}:{item['pm_id']}] exited with code [{self.exit_code}] via signal [{self.stop_signal}]\n")
            if item["name"] == "helstera-worker" and self.worker_complete:
                with Path(item["pm2_env"]["pm_out_log_path"]).open("a") as output:
                    output.write("[worker:fixture] Shutdown complete.\n")
            if not self.leave_proc:
                shutil.rmtree(self.proc / str(item["pid"]))
            item["pm2_env"].update(status="stopped", exit_code=self.exit_code)
            receipt_path = item["pm2_env"].get("HELSTERA_PROCESS_RECEIPT")
            if receipt_path:
                receipt = json.loads(Path(receipt_path).read_bytes())
                receipt["state"] = "drained"
                Path(receipt_path).write_text(json.dumps(receipt))
            item["pid"] = 0
        if arguments[:2] == ["pm2", "restart"]:
            item = next(item for item in self.processes if item["name"] == arguments[2])
            item["pid"] = 1101 if item["name"] == "helstera-server" else 1102
            item["pm2_env"].update(status="online", exit_code=0)
            write_proc(self.proc, item["pid"], self.fixture.source, item["pid"] * 10)
        return ""

    def isolated_stop_context(self):
        identities = {"server": self.host.process_identity(self.processes[0]),
                      "worker": self.host.process_identity(self.processes[1])}
        original = self.config.read_bytes()
        maintenance = self.host.maintenance.prepare(original.decode(), 3003).encode()
        after = original.replace(b":3003", b":3002")
        snapshots = {}
        for name, content in (("before", original), ("maintenance", maintenance), ("after", after)):
            (self.bootstrap / ("nginx." + name)).write_bytes(content)
            snapshots[name] = hashlib.sha256(content).hexdigest()
        self.config.write_bytes(maintenance)
        self.host.context = {"legacy": identities, "stopProofs": {}, "stopAttempts": {}, "snapshots": snapshots,
            "previousState": None, "logs": {role: self.processes[index]["pm2_env"]["pm_out_log_path"]
                                               for index, role in enumerate(("server", "worker"))},
            "restartProcesses": {}, "bridgeProcesses": {}, "proofs": {},
            "envFileSha256": digest(self.env_file),
            "helperHashes": {"legacy-release-activity.mjs": digest(Path(__file__).with_name("legacy-release-activity.mjs"))},
            "launches": {"server": {"env": {"DATABASE_URL": SENTINEL}, "envFile": str(self.env_file), "interpreter": "node"}}}
        return identities

    def add_bridge_process(self, role):
        self.host.context["token"] = "fixture-bootstrap"
        path = self.bootstrap / (role + ".test-config.json")
        path.write_text(json.dumps({"apps": [{"name": self.host.names[role],
            "cwd": str(self.fixture.output / "apps/server"), "env": {"HELSTERA_BOOTSTRAP_ID": "fixture-bootstrap",
            "HELSTERA_PROCESS_RECEIPT": str(self.bootstrap / (role + "-receipt.json"))}}]}))
        self.run(["pm2", "start", str(path)])
        item = next(item for item in self.processes if item["name"] == self.host.names[role])
        self.host.context["bridgeProcesses"][role] = self.host.process_identity(item)
        return item


class BootstrapHostTests(unittest.TestCase):
    def setUp(self):
        self.adapter = load_script("legacy-bootstrap-host")

    def barrier_fixture(self, folder):
        fixture = FixtureHost(folder, self.adapter)
        fixture.isolated_stop_context()
        fixture.host.http = fixture.http
        fixture.host.context['media'] = fixture.host._media(fixture.host.public_url)
        return fixture

    def test_barrier_waits_for_all_get_post_and_websocket_proofs_after_reload(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = self.barrier_fixture(folder)
            attempts = {}
            original = fixture.http

            def delayed(url, method='GET', headers=None, body=None, timeout=10):
                address = urlsplit(url)
                if address.hostname == '127.0.0.1' and address.port is None:
                    websocket = bool(headers and headers.get('Upgrade'))
                    key = (address.path, method, websocket)
                    attempts[key] = attempts.get(key, 0) + 1
                    if attempts[key] == 1:
                        return {'status': 200 if websocket else 401, 'headers': {}, 'body': SENTINEL.encode()}
                return original(url, method, headers, body, timeout)

            fixture.host.http = delayed
            fixture.host.block_ingress()
            self.assertTrue(attempts)
            self.assertTrue(all(count >= 2 for count in attempts.values()))
            self.assertIn(('/api/ws', 'GET', True), attempts)
            self.assertIn(('/api/website-capture/assistant/ws', 'GET', True), attempts)
            self.assertIn(('/api/', 'POST', False), attempts)
            self.assertIs(fixture.host.context['proofs']['barrier'], True)
            self.assertFalse(any(command[:2] == ['pm2', 'stop'] for command in fixture.commands))

    def test_barrier_permanent_failure_is_bounded_and_never_stops_legacy_processes(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = self.barrier_fixture(folder)
            original = fixture.http
            clock = [0.0]
            timeouts = []

            def refused(url, method='GET', headers=None, body=None, timeout=10):
                address = urlsplit(url)
                if address.hostname == '127.0.0.1' and address.port is None:
                    timeouts.append(timeout)
                    return {'status': 401, 'headers': {}, 'body': SENTINEL.encode()}
                return original(url, method, headers, body, timeout)

            def advance(delay):
                clock[0] += delay

            fixture.host.http = refused
            with patch.object(self.adapter, 'BARRIER_TIMEOUT_SECONDS', 0.3), \
                 patch.object(self.adapter.time, 'monotonic', side_effect=lambda: clock[0]), \
                 patch.object(self.adapter, '_pause_barrier', side_effect=advance):
                with self.assertRaisesRegex(RuntimeError, r'GET /api status=401') as caught:
                    fixture.host.block_ingress()
            self.assertLessEqual(clock[0], 0.3)
            self.assertTrue(timeouts)
            self.assertTrue(all(0 < timeout <= 0.3 for timeout in timeouts))
            self.assertNotIn(SENTINEL, str(caught.exception))
            self.assertFalse(any(command[:2] == ['pm2', 'stop'] for command in fixture.commands))
            self.assertNotIn('barrier', fixture.host.context['proofs'])

    def test_barrier_does_not_accept_websocket_503_without_cache_and_retry_headers(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = self.barrier_fixture(folder)
            original = fixture.http
            clock = [0.0]

            def missing_headers(url, method='GET', headers=None, body=None, timeout=10):
                response = original(url, method, headers, body, timeout)
                if headers and headers.get('Upgrade'):
                    return {**response, 'headers': {}}
                return response

            fixture.host.http = missing_headers
            with patch.object(self.adapter, 'BARRIER_TIMEOUT_SECONDS', 0.2), \
                 patch.object(self.adapter.time, 'monotonic', side_effect=lambda: clock[0]), \
                 patch.object(self.adapter, '_pause_barrier', side_effect=lambda delay: clock.__setitem__(0, clock[0] + delay)):
                with self.assertRaisesRegex(RuntimeError, 'websocket.*status=503'):
                    fixture.host.block_ingress()

    def test_barrier_keeps_gallery_integrity_assertion_after_ingress_converges(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = self.barrier_fixture(folder)
            original = fixture.http

            def changed_media(url, method='GET', headers=None, body=None, timeout=10):
                response = original(url, method, headers, body, timeout)
                if '/fashion-gallery/' in urlsplit(url).path:
                    return {**response, 'body': b'changed media'}
                return response

            fixture.host.http = changed_media
            with self.assertRaisesRegex(RuntimeError, 'public gallery media'):
                fixture.host.block_ingress()
            self.assertFalse(any(command[:2] == ['pm2', 'stop'] for command in fixture.commands))

    def test_runner_failure_cannot_expose_environment_in_error_or_traceback(self):
        for failure in (OSError(SENTINEL), subprocess.CalledProcessError(1, ["node", SENTINEL],
                           output=SENTINEL, stderr=SENTINEL), subprocess.TimeoutExpired(["node", SENTINEL], 1,
                           output=SENTINEL, stderr=SENTINEL)):
            with self.subTest(kind=type(failure).__name__), tempfile.TemporaryDirectory() as folder:
                fixture = FixtureHost(folder, self.adapter)
                fixture.failure = failure
                stdout = io.StringIO()
                with redirect_stdout(stdout):
                    with self.assertRaises(RuntimeError) as caught:
                        fixture.host.run(["node", SENTINEL], env={"DATABASE_URL": SENTINEL})
                formatted = "".join(traceback.format_exception(caught.exception))
                self.assertNotIn(SENTINEL, str(caught.exception))
                self.assertNotIn(SENTINEL, formatted)
                self.assertNotIn(SENTINEL, stdout.getvalue())

    def test_manifest_hash_and_tree_changes_are_rejected(self):
        for change in ("manifest", "file", "missing", "link"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as folder:
                fixture = FixtureHost(folder, self.adapter)
                fixture.host.validate_bridge()
                if change == "manifest":
                    fixture.manifest.write_bytes(fixture.manifest.read_bytes() + b" ")
                elif change == "file":
                    (fixture.fixture.output / "apps/server/src/app.ts").write_bytes(b"changed after review")
                elif change == "missing":
                    (fixture.fixture.output / "packages/shared/dist/index.js").unlink()
                else:
                    link = fixture.fixture.output / "apps/server/node_modules/@helstera/shared"
                    link.unlink()
                    link.symlink_to(fixture.fixture.shared.parent, target_is_directory=True)
                with self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
                    fixture.host.validate_bridge()
                self.assertEqual(fixture.commands, [])

    def test_process_environment_stays_in_the_private_context(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                fixture.host.save_context()
            context = fixture.host.context_path
            self.assertEqual(context, fixture.bootstrap / "context.json")
            self.assertEqual(json.loads(context.read_text())["launches"]["server"]["env"]["DATABASE_URL"], SENTINEL)
            self.assertNotIn(SENTINEL, stdout.getvalue())
            if os.name == "posix":
                self.assertEqual(context.stat().st_mode & 0o777, 0o600)

    def test_process_identity_detects_pid_reuse(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            identity = fixture.host.process_identity(fixture.processes[0])
            self.assertFalse(fixture.host._proc_gone(identity))
            stat = fixture.proc / "101/stat"
            stat.write_text(stat.read_text().replace("1010 ", "9999 "))
            self.assertTrue(fixture.host._proc_gone(identity))

    def test_worker_cannot_stop_before_api_clean_stop_proof(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            with self.assertRaises((ValueError, RuntimeError)):
                fixture.host.stop_legacy_worker()
            self.assertFalse(any(command[:2] == ["pm2", "stop"] for command in fixture.commands))

    def test_clean_stops_require_fresh_logs_process_exit_and_api_first(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            self.assertIs(fixture.host.stop_legacy_api(), True)
            self.assertIs(fixture.host.stop_legacy_worker(), True)
            stops = [command[2] for command in fixture.commands if command[:2] == ["pm2", "stop"]]
            self.assertEqual(stops, ["helstera-server", "helstera-worker"])
            self.assertIn("server", fixture.host.context["stopProofs"])
            self.assertIn("worker", fixture.host.context["stopProofs"])
            self.assertNotIn("drained", json.dumps(fixture.host.context["stopProofs"]))

    def test_old_log_cannot_prove_a_fresh_stop(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.pm2_log.write_text("App [helstera-server:4] exited with code [0] via signal [SIGINT]\n")
            fixture.isolated_stop_context()
            fixture.write_exit_log = False
            with self.assertRaises((ValueError, RuntimeError)):
                fixture.host.stop_legacy_api()
            self.assertNotIn("server", fixture.host.context["stopProofs"])

    def test_unclean_exit_signal_code_or_live_process_never_proves_stop(self):
        for change in ("SIGKILL", "exit code", "still alive"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as folder:
                fixture = FixtureHost(folder, self.adapter)
                fixture.isolated_stop_context()
                if change == "SIGKILL":
                    fixture.stop_signal = "SIGKILL"
                elif change == "exit code":
                    fixture.exit_code = 1
                else:
                    fixture.leave_proc = True
                with self.assertRaises((ValueError, RuntimeError)):
                    fixture.host.stop_legacy_api()
                self.assertNotIn("server", fixture.host.context["stopProofs"])

    def test_worker_requires_a_new_shutdown_complete_line(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            self.assertIs(fixture.host.stop_legacy_api(), True)
            fixture.worker_complete = False
            with self.assertRaises((ValueError, RuntimeError)):
                fixture.host.stop_legacy_worker()
            self.assertNotIn("worker", fixture.host.context["stopProofs"])

    def test_outside_configuration_edits_refuse_stop_and_route_restore(self):
        for snapshot in ("before", "maintenance", "after"):
            with self.subTest(snapshot=snapshot), tempfile.TemporaryDirectory() as folder:
                fixture = FixtureHost(folder, self.adapter)
                fixture.isolated_stop_context()
                content = (fixture.bootstrap / ("nginx." + snapshot)).read_bytes() + b"# outside operator edit\n"
                fixture.config.write_bytes(content)
                with self.assertRaises(RuntimeError):
                    fixture.host.stop_legacy_api()
                with self.assertRaises(RuntimeError):
                    fixture.host.restore_routes()
                self.assertEqual(fixture.config.read_bytes(), content)
                self.assertEqual(fixture.commands, [])

    def test_recovery_restarts_a_stopped_legacy_pair_only_once(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            fixture.host.stop_legacy_api()
            fixture.host.stop_legacy_worker()
            fixture.host.restart_legacy_worker()
            fixture.host.restart_legacy_api()
            fixture.host.restart_legacy_worker()
            fixture.host.restart_legacy_api()
            restarts = [command[2] for command in fixture.commands if command[:2] == ["pm2", "restart"]]
            self.assertEqual(restarts, ["helstera-worker", "helstera-server"])

    def test_failed_command_journal_contains_no_environment_value(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.failure = OSError(SENTINEL)
            fixture.host.preflight = lambda: fixture.host.run(["node", SENTINEL], env={"DATABASE_URL": SENTINEL})
            journal = fixture.bootstrap / "transaction.json"
            with self.assertRaises(RuntimeError):
                load_script("legacy-bootstrap").rollout(fixture.host, journal)
            self.assertNotIn(SENTINEL, journal.read_text())
            if os.name == "posix":
                self.assertEqual(journal.stat().st_mode & 0o777, 0o600)

    def test_activity_requires_all_eight_tables_and_the_exact_legacy_partial_schema(self):
        for change in ("no coverage", "absent", "unsupported", "unexpected partial", "one owner column", "ownerless run"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as folder:
                fixture = FixtureHost(folder, self.adapter)
                fixture.isolated_stop_context()
                if change == "no coverage":
                    fixture.activity = {"readOnly": True, "activity": "none_observed", "blockers": []}
                elif change in ("absent", "unsupported"):
                    table = "agent_goals"
                    fixture.activity["tables"][table]["state"] = change
                    fixture.activity["coverage"]["checked"].remove(table)
                    fixture.activity["coverage"][change].append(table)
                elif change == "unexpected partial":
                    fixture.activity["tables"]["video_transcripts"]["unavailableChecks"] = ["lease_until"]
                    fixture.activity["coverage"]["partial"].append("video_transcripts")
                elif change == "one owner column":
                    fixture.activity["tables"]["agent_runs"]["unavailableChecks"] = ["run_owner"]
                else:
                    fixture.activity["tables"]["agent_runs"]["metrics"]["active_ownerless"] = 1
                with self.assertRaises((ValueError, RuntimeError)):
                    fixture.host._activity()
                self.assertNotIn("activitySchema", fixture.host.context)

    def test_activity_schema_is_pinned_and_any_later_coverage_change_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            fixture.host._activity()
            self.assertIn("activitySchema", fixture.host.context)
            pinned = json.loads(json.dumps(fixture.host.context["activitySchema"]))
            fixture.activity["tables"]["background_jobs"]["columns"].append({"name": "new_unreviewed_column", "type": "text"})
            with self.assertRaises((ValueError, RuntimeError)):
                fixture.host._activity()
            self.assertEqual(fixture.host.context["activitySchema"], pinned)

    def test_activity_accepts_a_fully_supported_schema_without_legacy_ownership_gaps(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            fixture.activity["coverage"]["partial"] = []
            runs = fixture.activity["tables"]["agent_runs"]
            runs["unavailableChecks"] = []
            runs["columns"] += [{"name": "run_owner", "type": "uuid"},
                                {"name": "run_lease_until", "type": "timestamp with time zone"}]
            self.assertEqual(fixture.host._activity(), fixture.activity)
            self.assertIn("activitySchema", fixture.host.context)

    def test_constructor_accepts_a_canonical_immutable_release_bridge(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            release = fixture.root / ".releases/legacy-lifecycle-reviewed-1"
            release.mkdir(parents=True)
            host = fixture.new_host(bridge=release)
            self.assertEqual(host.bridge, release)
            self.assertEqual(fixture.commands, [])

    def test_constructor_refuses_symlinked_stage_and_a_foreign_bridge(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as foreign:
            fixture = FixtureHost(folder, self.adapter)
            link = fixture.root / "bootstrap-alias"
            link.symlink_to(fixture.bootstrap, target_is_directory=True)
            with self.assertRaises((ValueError, RuntimeError)):
                fixture.new_host(bootstrap_dir=link)
            with self.assertRaises((ValueError, RuntimeError)):
                fixture.new_host(bridge=Path(foreign).resolve())
            self.assertEqual(fixture.commands, [])

    def test_fresh_preflight_cannot_reuse_an_existing_context(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.host.context_path.write_bytes(b"existing private context must survive")
            with self.assertRaises(FileExistsError):
                fixture.host.preflight()
            self.assertEqual(fixture.host.context_path.read_bytes(), b"existing private context must survive")
            self.assertEqual(fixture.commands, [])

    def test_missing_pm2_entry_cannot_hide_a_known_bridge_process(self):
        for action in ("drain_bridge_api", "stopped proof", "restart_legacy_worker"):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as folder:
                fixture = FixtureHost(folder, self.adapter)
                fixture.isolated_stop_context()
                fixture.host.stop_legacy_api()
                fixture.host.stop_legacy_worker()
                bridge = fixture.add_bridge_process("server")
                fixture.host._verify_bridge("server")
                fixture.processes.remove(bridge)
                self.assertTrue((fixture.proc / str(bridge["pid"])).exists())
                with self.assertRaises(RuntimeError):
                    if action == "stopped proof":
                        fixture.host._bridge_absent_or_stopped("server")
                    else:
                        getattr(fixture.host, action)()
                self.assertFalse(any(command[:2] == ["pm2", "restart"] for command in fixture.commands))

    def test_changed_environment_file_refuses_activity_and_legacy_recovery(self):
        for action in ("activity", "restart"):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as folder:
                fixture = FixtureHost(folder, self.adapter)
                fixture.isolated_stop_context()
                if action == "restart":
                    fixture.host.stop_legacy_api()
                    fixture.host.stop_legacy_worker()
                fixture.env_file.write_text("DATABASE_URL=unreviewed-new-value\n")
                commands = list(fixture.commands)
                with self.assertRaises(RuntimeError):
                    if action == "activity":
                        fixture.host._activity()
                    else:
                        fixture.host.restart_legacy_worker()
                self.assertEqual(fixture.commands, commands)

    def test_release_locks_are_acquired_in_order_and_closed_after_body_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            upstream = root / "upstream.lock"

            class LockApi:
                LOCK_EX, LOCK_NB = 1, 2

                def __init__(self):
                    self.streams = []

                def flock(self, stream, flags):
                    self.streams.append(stream)
                    self.assert_flags = flags

            locks = LockApi()
            entered = False
            with self.assertRaisesRegex(ValueError, "fixture body failure"):
                with self.adapter.release_locks(root, upstream, lock_api=locks):
                    entered = True
                    self.assertEqual([Path(stream.name) for stream in locks.streams], [root / ".release.lock", upstream])
                    self.assertTrue(all(not stream.closed for stream in locks.streams))
                    self.assertEqual(locks.assert_flags, locks.LOCK_EX | locks.LOCK_NB)
                    raise ValueError("fixture body failure")
            self.assertTrue(entered)
            self.assertTrue(all(stream.closed for stream in locks.streams))

    def test_release_lock_contention_never_enters_body_or_leaks_acquired_streams(self):
        for busy in (1, 2):
            with self.subTest(busy=busy), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()

                class LockApi:
                    LOCK_EX, LOCK_NB = 1, 2

                    def __init__(self):
                        self.streams = []

                    def flock(self, stream, flags):
                        self.streams.append(stream)
                        if len(self.streams) == busy:
                            raise BlockingIOError("fixture lock already held")

                locks = LockApi()
                entered = False
                with self.assertRaises((BlockingIOError, RuntimeError)):
                    with self.adapter.release_locks(root, root / "upstream.lock", lock_api=locks):
                        entered = True
                self.assertFalse(entered)
                self.assertEqual(len(locks.streams), busy)
                self.assertTrue(all(stream.closed for stream in locks.streams))

    def test_verified_bridge_instance_cannot_be_replaced_by_another_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            fixture.add_bridge_process("server")
            self.assertIs(fixture.host._verify_bridge("server"), True)
            receipt = fixture.bootstrap / "server-receipt.json"
            document = json.loads(receipt.read_text())
            document["instanceId"] = "unreviewed-replacement-instance"
            receipt.write_text(json.dumps(document))
            with self.assertRaises(RuntimeError):
                fixture.host._verify_bridge("server")
            self.assertEqual(fixture.host.context["instances"]["server"], "server-fixture")

    def test_stale_drained_receipt_or_reused_bridge_pid_cannot_prove_readiness(self):
        for change in ("drained", "reused pid"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as folder:
                fixture = FixtureHost(folder, self.adapter)
                fixture.isolated_stop_context()
                item = fixture.add_bridge_process("server")
                self.assertIs(fixture.host._verify_bridge("server"), True)
                if change == "drained":
                    receipt = fixture.bootstrap / "server-receipt.json"
                    document = json.loads(receipt.read_text())
                    document["state"] = "drained"
                    receipt.write_text(json.dumps(document))
                else:
                    stat = fixture.proc / str(item["pid"]) / "stat"
                    stat.write_text(stat.read_text().replace(str(item["pid"] * 10) + " ", "98765 "))
                with self.assertRaises(RuntimeError):
                    fixture.host._verify_bridge("server")

    def test_unverified_stopped_bridge_blocks_a_legacy_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.isolated_stop_context()
            fixture.host.stop_legacy_api()
            fixture.host.stop_legacy_worker()
            item = fixture.add_bridge_process("server")
            fixture.run(["pm2", "stop", item["name"]])
            fixture.host.context["instances"] = {}
            with self.assertRaises(RuntimeError):
                fixture.host.restart_legacy_worker()
            self.assertFalse(any(command[:2] == ["pm2", "restart"] for command in fixture.commands))

    @unittest.skipUnless(shutil.which("node"), "Node.js is not installed")
    def test_fake_host_rollout_commits_only_after_clean_legacy_exits_and_bridge_proofs(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.full_preflight()
            stdout = io.StringIO()
            with patch.object(self.adapter.socket, "socket"), patch.object(self.adapter, "READY_SECONDS", 0), redirect_stdout(stdout):
                report = load_script("legacy-bootstrap").rollout(fixture.host, fixture.bootstrap / "transaction.json")
            self.assertEqual(report["phase"], "committed")
            pointer = json.loads(fixture.host.state_path.read_bytes())
            self.assertEqual(pointer["port"], 3002)
            self.assertEqual(pointer["release"], str(fixture.fixture.output))
            self.assertEqual([item["pm2_env"]["status"] for item in fixture.processes],
                             ["stopped", "stopped", "online", "online"])
            stops = [command[2] for command in fixture.commands if command[:2] == ["pm2", "stop"]]
            self.assertEqual(stops, ["helstera-server", "helstera-worker"])
            self.assertNotIn(SENTINEL, stdout.getvalue())
            self.assertNotIn(SENTINEL, (fixture.bootstrap / "transaction.json").read_text())

    @unittest.skipUnless(shutil.which("node"), "Node.js is not installed")
    def test_fake_host_failure_drains_bridge_before_recovery_and_does_not_replay_restarts(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = FixtureHost(folder, self.adapter)
            fixture.full_preflight()
            before = fixture.config.read_bytes()
            fixture.public_failure = True
            orchestrator = load_script("legacy-bootstrap")
            journal = fixture.bootstrap / "transaction.json"
            with patch.object(self.adapter.socket, "socket"), patch.object(self.adapter, "READY_SECONDS", 0), self.assertRaises(RuntimeError):
                orchestrator.rollout(fixture.host, journal)
            self.assertEqual(json.loads(journal.read_bytes())["phase"], "rolled_back")
            self.assertEqual(fixture.config.read_bytes(), before)
            self.assertFalse(fixture.host.state_path.exists())
            transitions = [command[:3] for command in fixture.commands if command[:2] in (["pm2", "stop"], ["pm2", "restart"])]
            self.assertEqual(transitions, [["pm2", "stop", "helstera-server"], ["pm2", "stop", "helstera-worker"],
                ["pm2", "stop", fixture.host.names["server"]], ["pm2", "stop", fixture.host.names["worker"]],
                ["pm2", "restart", "helstera-worker"], ["pm2", "restart", "helstera-server"]])
            commands = list(fixture.commands)
            self.assertEqual(orchestrator.recover(fixture.host, journal)["phase"], "rolled_back")
            self.assertEqual(fixture.commands, commands)


if __name__ == "__main__":
    unittest.main()
