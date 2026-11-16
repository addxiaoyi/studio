import importlib.util
import http.server
import json
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import Mock, patch


def load_release():
    path = pathlib.Path(__file__).with_name("blue-green-release.py")
    spec = importlib.util.spec_from_file_location("blue_green_release", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeHost:
    def __init__(self, failure=None):
        self.failure = failure
        self.calls = []
        self.routes = "old"
        self.api = {"old": True, "new": False}
        self.worker = {"old": True, "new": False}
        self.persisted = False

    def step(self, name):
        self.calls.append(name)
        if name == self.failure:
            raise RuntimeError(name + " failed")

    def preflight(self):
        self.step("preflight")

    def start_api(self):
        self.api["new"] = True
        self.step("start_api")

    def verify_api(self):
        self.step("verify_api")

    def drain_worker(self):
        self.worker["old"] = False
        self.step("drain_worker")

    def start_worker(self):
        self.worker["new"] = True
        self.step("start_worker")

    def switch_routes(self):
        self.routes = "new"
        self.step("switch_routes")

    def verify_public(self):
        self.step("verify_public")

    def persist(self):
        self.step("persist")
        self.persisted = True

    def retire_api(self):
        self.step("retire_api")
        self.api["old"] = False

    def restore_routes(self):
        self.step("restore_routes")
        self.routes = "old"

    def stop_candidate_worker(self):
        self.step("stop_candidate_worker")
        self.worker["new"] = False

    def restart_worker(self):
        self.step("restart_worker")
        self.worker["old"] = True

    def stop_candidate_api(self):
        self.step("stop_candidate_api")
        self.api["new"] = False

    def persist_rollback(self):
        self.step("persist_rollback")
        self.persisted = False

    def is_committed(self):
        return self.persisted

    def verify_committed(self):
        self.step("verify_committed")

    def verify_rollback(self):
        self.step("verify_rollback")
        if self.routes != "old" or not self.worker["old"] or self.api["new"] or self.worker["new"]:
            raise RuntimeError("Previous service was not restored")


class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = load_release()

    def run_release(self, host, folder):
        return self.release.rollout(host, pathlib.Path(folder) / "transaction.json")

    def preflight_host(self, folder):
        root = pathlib.Path(folder).resolve()
        host = self.release.LocalHost.__new__(self.release.LocalHost)
        host.root = root
        host.stage = root / ".helstera-candidate.test"
        host.release = host.stage / "next"
        host.server = host.release / "apps/server"
        (host.server / "src").mkdir(parents=True)
        (host.release / "apps/web/out").mkdir(parents=True)
        for role in ("server", "worker"):
            (host.server / f"src/{role}.ts").write_text("createProcessReceipt()")
        (host.server / "package.json").write_text('{"version":"candidate"}')
        (host.stage / "candidate.zip").write_bytes(b"candidate")
        host.previous = {"port": 3003, "api": "old-api", "worker": "old-worker", "web": str(root / "web"), "release": str(root / "old")}
        host.previous_state = None
        host.state_path = root / ".active-release.json"
        (host.stage / "prepared-base.json").write_text(json.dumps({"active": host.previous, "stateSha256": None}))
        host.names = {"server": "new-api", "worker": "new-worker"}
        host.public_url = "https://studio.test/api/health"
        host.config = root / "site.conf"
        host.before = b"before"
        host.config.write_bytes(host.before)
        host.after = None
        host.new_worker_pid = 0
        host.new_worker_instance = None
        host.new_api_pid = 0
        host.new_api_instance = None
        host.port = 0
        receipt = root / "worker-ready.json"
        receipt.write_text(json.dumps({"pid": 2, "state": "ready", "instanceId": "worker-instance"}))
        api = {"name": "old-api", "pid": 1, "pm2_env": {"status": "online"}}
        worker = {"name": "old-worker", "pid": 2, "pm2_env": {"status": "online", "HELSTERA_PROCESS_RECEIPT": str(receipt)}}
        host.processes = Mock(return_value=[api, worker])
        host.run = Mock(return_value="")
        host.version_at = Mock(return_value="old-version")
        host.switcher = Mock()
        host.switcher.ready.return_value = {"version": "old-version"}
        host.guard = Mock()
        host.env_file = root / ".env.local"
        host.env_file.write_text("TEST=1")
        return host, api

    def test_preflight_requires_old_api_drain_receipt_before_any_mutation(self):
        with tempfile.TemporaryDirectory() as folder:
            host, _api = self.preflight_host(folder)
            with patch.object(self.release, "prepare_routes", return_value=b"after"), \
                 patch.object(self.release, "process_launch", return_value=({}, host.env_file)):
                with self.assertRaisesRegex(RuntimeError, "Existing API has no drain receipt"):
                    host.preflight()
            host.run.assert_not_called()
            self.assertEqual((host.server / "package.json").read_text(), '{"version":"candidate"}')

    def test_retirement_does_not_stop_a_restarted_old_api(self):
        with tempfile.TemporaryDirectory() as folder:
            receipt = pathlib.Path(folder) / "api-receipt.json"
            receipt.write_text(json.dumps({"pid": 42, "state": "ready", "instanceId": "reviewed-api"}))
            host = self.release.LocalHost.__new__(self.release.LocalHost)
            host.previous = {"api": "old-api"}
            host.old_api_pid, host.old_api_instance, host.old_api_receipt = 42, "reviewed-api", str(receipt)
            host.process = Mock(return_value={"pid": 43, "pm2_env": {"status": "online"}})
            host.run = Mock()
            with self.assertRaisesRegex(RuntimeError, "Previous API identity changed"):
                host.retire_api()
            host.run.assert_not_called()

    def test_worker_stop_checks_current_process_identity_before_stopping(self):
        with tempfile.TemporaryDirectory() as folder:
            receipt = pathlib.Path(folder) / "worker-receipt.json"
            receipt.write_text(json.dumps({"pid": 42, "state": "ready", "instanceId": "reviewed-worker"}))
            host = self.release.LocalHost.__new__(self.release.LocalHost)
            host.process = Mock(return_value={"pid": 43, "pm2_env": {"status": "online"}})
            host.run = Mock()
            with self.assertRaisesRegex(RuntimeError, "Worker identity changed"):
                host.stop_worker("old-worker", receipt, 42)
            host.run.assert_not_called()

    def test_retirement_requires_clean_stop_even_when_receipt_claims_drained(self):
        with tempfile.TemporaryDirectory() as folder:
            receipt = pathlib.Path(folder) / "api-receipt.json"
            receipt.write_text(json.dumps({"pid": 42, "state": "drained", "instanceId": "reviewed-api"}))
            host = self.release.LocalHost.__new__(self.release.LocalHost)
            host.previous = {"api": "old-api"}
            host.old_api_pid, host.old_api_instance, host.old_api_receipt = 42, "reviewed-api", str(receipt)
            host.process = Mock(return_value={"pid": 0, "pm2_env": {"status": "stopped", "exit_code": 1}})
            host.run = Mock()
            with self.assertRaisesRegex(RuntimeError, "Previous API did not exit cleanly"):
                host.retire_api()
            host.run.assert_not_called()

    def test_preflight_rechecks_the_active_pointer_after_host_initialization(self):
        with tempfile.TemporaryDirectory() as folder:
            host, api = self.preflight_host(folder)
            receipt = host.root / "api-ready.json"
            receipt.write_text(json.dumps({"pid": 1, "state": "ready", "instanceId": "old-api"}))
            api["pm2_env"]["HELSTERA_PROCESS_RECEIPT"] = str(receipt)
            changed = b'{"api":"operator-release"}'
            host.state_path.write_bytes(changed)
            with patch.object(self.release, "prepare_routes", return_value=b"after"), \
                 patch.object(self.release, "process_launch", return_value=({}, host.env_file)):
                with self.assertRaisesRegex(RuntimeError, "Active release pointer changed"):
                    host.preflight()
            host.run.assert_not_called()
            self.assertEqual(host.state_path.read_bytes(), changed)

    def test_rollback_does_not_overwrite_an_unrelated_active_pointer(self):
        with tempfile.TemporaryDirectory() as folder:
            host, _api = self.preflight_host(folder)
            host.version = "candidate"
            changed = b'{"api":"operator-release"}'
            host.state_path.write_bytes(changed)
            with self.assertRaisesRegex(RuntimeError, "Active release pointer changed"):
                host.persist_rollback()
            host.run.assert_not_called()
            self.assertEqual(host.state_path.read_bytes(), changed)

    def test_rollback_checks_the_actual_terminal_state_before_reporting_success(self):
        host = FakeHost("verify_public")
        host.stop_candidate_api = lambda: host.step("stop_candidate_api")
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "rollback incomplete.*verify_rollback"):
                self.run_release(host, folder)
            report = json.loads((pathlib.Path(folder) / "transaction.json").read_bytes())
            self.assertEqual(report["phase"], "rollback_incomplete")
            self.assertTrue(host.api["new"])

    def test_worker_is_not_drained_after_nginx_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            host, _api = self.preflight_host(folder)
            host.old_receipt, host.old_worker_pid, host.old_instance = host.root / "worker-ready.json", 2, "worker-instance"
            host.config.write_bytes(b"operator nginx change")
            host.stop_worker = Mock()
            with self.assertRaisesRegex(RuntimeError, "Nginx changed"):
                host.drain_worker()
            host.stop_worker.assert_not_called()

    def test_draining_requires_the_reviewed_worker_instance_when_a_pid_is_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            host, _api = self.preflight_host(folder)
            host.old_receipt, host.old_worker_pid, host.old_instance = host.root / "worker-ready.json", 2, "previous-instance"
            with self.assertRaisesRegex(RuntimeError, "expected PID and lifecycle state"):
                host.drain_worker()
            host.run.assert_not_called()

    def test_recovery_does_not_adopt_an_unrecorded_candidate_api_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            host, api = self.preflight_host(folder)
            receipt = host.root / "api-ready.json"
            receipt.write_text(json.dumps({"pid": 1, "state": "ready", "instanceId": "old-api"}))
            api["pm2_env"]["HELSTERA_PROCESS_RECEIPT"] = str(receipt)
            with patch.object(self.release, "prepare_routes", return_value=b"after"), \
                 patch.object(self.release, "process_launch", return_value=({}, host.env_file)):
                host.preflight()
            context_file = host.stage / "transaction-context.json"
            context = json.loads(context_file.read_bytes())
            del context["new_api_pid"]
            del context["new_api_instance"]
            context_file.write_text(json.dumps(context))
            before = context_file.read_bytes()
            (host.stage / "server-receipt.json").write_text(json.dumps({"pid": 43, "state": "ready", "instanceId": "unrecorded"}))
            candidate = {"name": "new-api", "pid": 43, "pm2_env": {"status": "online", "pm_cwd": str(host.server)}}
            with patch.object(self.release.LocalHost, "processes", return_value=[candidate]):
                with self.assertRaisesRegex(RuntimeError, "Saved context lacks the candidate API identity"):
                    self.release.LocalHost.from_context(host.root, host.stage, host.config, host.public_url)
            self.assertEqual(context_file.read_bytes(), before)

    def test_old_api_stays_online_until_candidate_is_verified_and_persisted(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost()
            report = self.run_release(host, folder)
            self.assertEqual(host.calls, ["preflight", "start_api", "verify_api", "drain_worker",
                                         "start_worker", "switch_routes", "verify_public", "persist", "retire_api"])
            self.assertEqual(report["phase"], "committed")
            self.assertTrue(host.api[host.routes])
            self.assertEqual(host.worker, {"old": False, "new": True})

    def test_failure_in_each_mutating_phase_restores_previous_service(self):
        for failure in ("start_api", "verify_api", "drain_worker", "start_worker", "switch_routes", "verify_public", "persist"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                host = FakeHost(failure)
                with self.assertRaisesRegex(RuntimeError, failure):
                    self.run_release(host, folder)
                self.assertEqual(host.routes, "old")
                self.assertTrue(host.api["old"])
                self.assertTrue(host.worker["old"])
                self.assertFalse(host.api["new"])
                self.assertFalse(host.worker["new"])
                self.assertNotIn("retire_api", host.calls)

    def test_failed_route_recovery_keeps_candidate_serving(self):
        host = FakeHost("verify_public")

        def restore_fails():
            host.step("restore_routes")
            raise RuntimeError("nginx cannot restore")

        host.restore_routes = restore_fails
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "rollback incomplete"):
                self.run_release(host, folder)
        self.assertEqual(host.routes, "new")
        self.assertTrue(host.api["new"])
        self.assertNotIn("stop_candidate_api", host.calls)
        self.assertTrue(host.worker["new"])
        self.assertFalse(host.worker["old"])
        self.assertNotIn("stop_candidate_worker", host.calls)

    def test_failed_candidate_worker_drain_never_restarts_old_worker(self):
        host = FakeHost("verify_public")

        def stop_fails():
            raise RuntimeError("candidate worker still running")

        host.stop_candidate_worker = stop_fails
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "rollback incomplete"):
                self.run_release(host, folder)
        self.assertNotIn("restart_worker", host.calls)
        self.assertTrue(host.worker["new"])

    def test_rollback_drains_candidate_api_before_handing_off_its_worker(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost("verify_public")
            with self.assertRaisesRegex(RuntimeError, "verify_public failed"):
                self.run_release(host, folder)
            self.assertLess(host.calls.index("stop_candidate_api"), host.calls.index("stop_candidate_worker"))
            self.assertLess(host.calls.index("stop_candidate_worker"), host.calls.index("restart_worker"))

    def test_failed_candidate_api_drain_preserves_worker_until_recovery(self):
        host = FakeHost("verify_public")

        def stop_fails():
            host.step("stop_candidate_api")
            raise RuntimeError("candidate API has unfinished requests")

        host.stop_candidate_api = stop_fails
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "rollback incomplete"):
                self.run_release(host, folder)
        self.assertTrue(host.worker["new"])
        self.assertFalse(host.worker["old"])
        self.assertNotIn("stop_candidate_worker", host.calls)
        self.assertNotIn("restart_worker", host.calls)

    def test_candidate_api_stop_requires_matching_ready_and_drained_receipts(self):
        with tempfile.TemporaryDirectory() as folder:
            host, _api = self.preflight_host(folder)
            host.new_api_pid, host.new_api_instance = 42, "candidate-api"
            host.processes = Mock(return_value=[{"name": "new-api", "pid": 42, "pm2_env": {"status": "online"}}])
            with self.assertRaises(FileNotFoundError):
                host.stop_candidate_api()
            host.run.assert_not_called()

    def test_candidate_api_unclean_stop_is_not_a_successful_rollback(self):
        with tempfile.TemporaryDirectory() as folder:
            host, _api = self.preflight_host(folder)
            host.new_api_pid, host.new_api_instance = 42, "candidate-api"
            (host.stage / "server-receipt.json").write_text(json.dumps({"pid": 42, "state": "drained", "instanceId": "candidate-api"}))
            host.processes = Mock(return_value=[{"name": "new-api", "pid": 0, "pm2_env": {"status": "stopped", "exit_code": 1}}])
            with self.assertRaisesRegex(RuntimeError, "Candidate API did not exit cleanly"):
                host.stop_candidate_api()
            host.run.assert_not_called()

    def test_api_drain_completes_with_its_worker_alive_before_rollback_handoff(self):
        with tempfile.TemporaryDirectory() as folder:
            adapter, _api = self.preflight_host(folder)
            adapter.new_api_pid, adapter.new_api_instance = 42, "candidate-api"
            receipt = adapter.stage / "server-receipt.json"
            receipt.write_text(json.dumps({"pid": 42, "state": "ready", "instanceId": "candidate-api"}))
            item = {"name": "new-api", "pid": 42, "pm2_env": {"status": "online"}}
            adapter.processes = Mock(side_effect=lambda: [item])
            host = FakeHost("verify_public")

            def stop_api(_arguments, **_kwargs):
                self.assertTrue(host.worker["new"])
                self.assertFalse(host.worker["old"])
                self.assertNotIn("stop_candidate_worker", host.calls)
                receipt.write_text(json.dumps({"pid": 42, "state": "drained", "instanceId": "candidate-api"}))
                item.update(pid=0, pm2_env={"status": "stopped", "exit_code": 0})

            adapter.run = Mock(side_effect=stop_api)

            def drain_api():
                adapter.stop_candidate_api()
                host.api["new"] = False
                host.step("stop_candidate_api")

            host.stop_candidate_api = drain_api
            with self.assertRaisesRegex(RuntimeError, "verify_public failed"):
                self.run_release(host, folder)
            adapter.run.assert_called_once()
            self.assertEqual(host.worker, {"old": True, "new": False})
            adapter.stop_candidate_api()
            adapter.run.assert_called_once()

    def test_retirement_failure_keeps_successful_release_and_records_cleanup(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost("retire_api")
            report = self.run_release(host, folder)
            self.assertEqual(report["phase"], "committed")
            self.assertIn("retire_api", report["cleanupError"])
            self.assertEqual(host.routes, "new")
            self.assertTrue(host.api["new"])
            self.assertNotIn("restore_routes", host.calls)

    def test_preflight_failure_does_not_start_or_stop_any_process(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost("preflight")
            with self.assertRaisesRegex(RuntimeError, "preflight"):
                self.run_release(host, folder)
            self.assertEqual(host.calls, ["preflight"])
            self.assertFalse((pathlib.Path(folder) / "transaction.json").exists())

    def test_existing_journal_requires_inspection_before_any_actions(self):
        with tempfile.TemporaryDirectory() as folder:
            (pathlib.Path(folder) / "transaction.json").write_text('{"phase":"switch_routes"}')
            host = FakeHost()
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                self.run_release(host, folder)
            self.assertEqual(host.calls, [])

    def test_route_preparation_switches_api_and_static_root_together(self):
        guard = self.release.load_script("validate-studio-nginx")
        old_web = pathlib.Path("/srv/helstera/apps/web/out")
        new_web = pathlib.Path("/srv/helstera/.helstera-candidate.new/next/apps/web/out")
        before = (f"server {{\n    root {old_web};\n"
                  "    location /api/ { proxy_pass http://127.0.0.1:3000; }\n"
                  "    location / { try_files $uri $uri/ $uri.html /index.html; }\n}\n").encode()
        after = self.release.prepare_routes(before, 3000, 3002, old_web, new_web, guard).decode()
        self.assertNotIn("http://127.0.0.1:3000", after)
        self.assertIn(f"root {new_web};", after)
        self.assertIn("/api/website-capture/assistant/ws", after)
        self.assertIn("proxy_request_buffering off", after)
        self.assertNotIn("$uri.html /index.html", after)
        second_web = pathlib.Path("/srv/helstera/.helstera-candidate.second/next/apps/web/out")
        second = self.release.prepare_routes(after.encode(), 3002, 3000, new_web, second_web, guard).decode()
        self.assertNotIn("http://127.0.0.1:3002", second)
        self.assertIn(f"root {second_web};", second)

    def test_ambiguous_upstreams_and_unexpected_static_roots_are_rejected(self):
        guard = self.release.load_script("validate-studio-nginx")
        with self.assertRaisesRegex(RuntimeError, "upstream"):
            self.release.prepare_routes(b"proxy_pass http://127.0.0.1:3000; proxy_pass http://127.0.0.1:3005;",
                                        3000, 3002, pathlib.Path("/a"), pathlib.Path("/b"), guard)
        with self.assertRaisesRegex(RuntimeError, "static root"):
            self.release.prepare_routes(b"root /unexpected; proxy_pass http://127.0.0.1:3000;",
                                        3000, 3002, pathlib.Path("/a"), pathlib.Path("/b"), guard)

    def test_route_switch_preserves_the_verified_public_gallery_sidecar(self):
        guard = self.release.load_script("validate-studio-nginx")
        recovery = self.release.load_script("route-public-media-recovery")
        old_web, new_web = pathlib.Path("/a"), pathlib.Path("/b")
        before = (f"server {{\n    root {old_web};\n"
                  "    location /api/ { proxy_pass http://127.0.0.1:3003; }\n"
                  "    location / { try_files $uri $uri/ $uri.html /index.html; }\n"
                  "    location ^~ /fashion-gallery/img/ {\n"
                  "        proxy_pass http://127.0.0.1:3003/api/public-media/fashion-gallery/img/;\n    }\n"
                  "    location ^~ /fashion-gallery/thumbs/ {\n"
                  "        proxy_pass http://127.0.0.1:3003/api/public-media/fashion-gallery/thumbs/;\n    }\n}\n")
        before = recovery.prepare(before, 3003, 3014)
        after = self.release.prepare_routes(before.encode(), 3003, 3002, old_web, new_web, guard).decode()
        self.assertEqual(after.count("http://127.0.0.1:3014"), 4)
        for kind in ("img", "thumbs"):
            for prefix in ("/fashion-gallery/", "/api/public-media/fashion-gallery/"):
                route = "location ^~ " + prefix + kind + "/"
                start = before.index(route)
                block = before[start:before.index("}", start) + 1]
                self.assertIn(block, after)
        self.assertNotIn("http://127.0.0.1:3003", after)
        self.assertIn("location /api/ { proxy_pass http://127.0.0.1:3002; }", after)
        self.assertIn(f"root {new_web};", after)
        self.assertIn("/api/website-capture/assistant/ws", after)
        self.assertIn("proxy_request_buffering off", after)
        self.assertIn("Cross-Origin-Embedder-Policy", after)
        second = self.release.prepare_routes(after.encode(), 3002, 3000, new_web, old_web, guard).decode()
        self.assertEqual(second.count("http://127.0.0.1:3014"), 4)
        self.assertNotIn("http://127.0.0.1:3002", second)
        self.assertIn("location /api/ { proxy_pass http://127.0.0.1:3000; }", second)

    def test_worker_receipt_rejects_stale_state_and_reused_pid(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "receipt.json"
            path.write_text(json.dumps({"pid": 42, "state": "drained", "instanceId": "previous"}))
            with self.assertRaises(RuntimeError):
                self.release.process_receipt(path, 42, "ready")
            with self.assertRaises(RuntimeError):
                self.release.process_receipt(path, 42, "drained", "new-process")
            self.assertEqual(self.release.process_receipt(path, 42, "drained", "previous")["pid"], 42)

    def test_launch_preserves_shell_exports_and_the_actual_node_env_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder).resolve()
            process = root / "proc/42"
            process.mkdir(parents=True)
            env_file = root / "separate.env"
            env_file.write_text("PUBLIC_SETTING=test")
            (process / "environ").write_bytes(b"PROVIDER_OVERRIDE=test-only\0PATH=/bin\0NODE_CHANNEL_FD=3\0NODE_APP_INSTANCE=0\0")
            (process / "cmdline").write_bytes((f"node\0--env-file={env_file}\0--import\0tsx\0src/server.ts\0").encode())
            env, file = self.release.process_launch(42, root, root / "proc")
            self.assertEqual(env["PROVIDER_OVERRIDE"], "test-only")
            self.assertNotIn("NODE_CHANNEL_FD", env)
            self.assertNotIn("NODE_APP_INSTANCE", env)
            self.assertEqual(file, env_file)

    def test_old_worker_is_not_force_restarted_while_its_drain_is_uncertain(self):
        host = self.release.LocalHost.__new__(self.release.LocalHost)
        host.previous = {"worker": "helstera-worker-blue"}
        host.process = lambda _name: {"pm2_env": {"status": "stopping"}}
        host.run = Mock(side_effect=AssertionError("must not force a restart"))
        with self.assertRaisesRegex(RuntimeError, "not confirmed drained"):
            host.restart_worker()
        host.run.assert_not_called()

    def test_recovery_restores_an_interrupted_route_switch_without_replaying_work(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost()
            host.api["new"], host.worker["new"], host.worker["old"], host.routes = True, True, False, "new"
            journal = pathlib.Path(folder) / "transaction.json"
            self.release.write_json(journal, {"phase": "switch_routes", "attempted": list(self.release.RELEASE_PHASES[:5])})
            report = self.release.recover_release(host, journal)
            self.assertEqual(report["phase"], "rolled_back")
            self.assertTrue(host.worker["old"])
            self.assertFalse(host.worker["new"])
            self.assertNotIn("start_api", host.calls)
            self.assertNotIn("start_worker", host.calls)
            previous = host.calls.copy()
            self.release.recover_release(host, journal)
            self.assertEqual(host.calls[len(previous):], ["verify_rollback"])

    def test_recovery_finishes_retirement_if_pointer_committed_before_journal_write(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost()
            host.persisted, host.routes = True, "new"
            host.api["new"], host.worker["new"], host.worker["old"] = True, True, False
            journal = pathlib.Path(folder) / "transaction.json"
            self.release.write_json(journal, {"phase": "persist", "attempted": list(self.release.RELEASE_PHASES)})
            report = self.release.recover_release(host, journal)
            self.assertEqual(report["phase"], "committed")
            self.assertEqual(host.calls, ["verify_committed", "retire_api"])
            self.assertNotIn("restore_routes", host.calls)

    def test_recovery_rejects_corrupt_phase_order_before_actions(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost()
            journal = pathlib.Path(folder) / "transaction.json"
            self.release.write_json(journal, {"phase": "switch_routes", "attempted": ["switch_routes"]})
            with self.assertRaisesRegex(ValueError, "valid phase sequence"):
                self.release.recover_release(host, journal)
            self.assertEqual(host.calls, [])

    def test_atomic_journal_retries_transient_windows_file_locks(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = pathlib.Path(folder) / "journal.json"
            denied = PermissionError("sharing denied")
            denied.winerror = 5
            with patch.object(self.release, "replace_file", side_effect=[denied, None]) as replacement:
                self.release.replace_with_retry("temporary", str(journal), windows=True)
            self.assertEqual(replacement.call_count, 2)

    def test_atomic_journal_reports_persistent_file_locks(self):
        denied = PermissionError("sharing denied")
        denied.winerror = 5
        with patch.object(self.release, "replace_file", side_effect=denied) as replacement, patch("time.sleep"):
            with self.assertRaises(PermissionError):
                self.release.replace_with_retry("temporary", "journal", windows=True)
        self.assertEqual(replacement.call_count, 6)

    def test_public_acceptance_waits_for_static_routes_to_converge(self):
        host = self.release.LocalHost.__new__(self.release.LocalHost)
        host.public_url, host.version = "https://studio.test/api/health", "candidate"
        host.switcher = Mock()
        host.verify_public_assets = Mock(side_effect=[RuntimeError("previous static page"), None])
        with patch("time.sleep"):
            host.verify_public()
        self.assertEqual(host.verify_public_assets.call_count, 2)
        host.switcher.wait_public.assert_called_once_with(host.public_url, host.version)

    def test_public_acceptance_stops_when_static_routes_do_not_converge(self):
        host = self.release.LocalHost.__new__(self.release.LocalHost)
        host.public_url, host.version = "https://studio.test/api/health", "candidate"
        host.switcher = Mock()
        host.verify_public_assets = Mock(side_effect=RuntimeError("previous static page"))
        with patch("time.monotonic", side_effect=[0, 11]):
            with self.assertRaisesRegex(RuntimeError, "did not converge"):
                host.verify_public()

    def test_real_http_upstreams_remain_available_during_success_and_rollback(self):
        upstream = r'''
import http.server,json,sys,threading
draining=threading.Event()
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        payload=json.dumps({'ok':True,'version':sys.argv[1]}).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers()
        self.wfile.flush()
        if self.path.endswith('/held'):
            if not draining.wait(10):
                raise RuntimeError('Fixture request never received its drain signal')
        self.wfile.write(payload)
    def log_message(self,*args): pass
class Server(http.server.ThreadingHTTPServer):
    daemon_threads=False
server=Server(('127.0.0.1',int(sys.argv[2])),Handler)
serving=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':0.01})
serving.start()
if sys.stdin.readline().strip()!='drain':
    raise RuntimeError('Fixture requires an explicit graceful drain')
draining.set()
server.shutdown()
server.server_close()
serving.join()
'''
        release = self.release

        class HttpHost(FakeHost):
            def __init__(self, failure):
                super().__init__(failure)
                self.children = {}
                self.ports = {}
                self.samples = []
                self.finished = threading.Event()
                self.route_lock = threading.Lock()
                self.held_started = threading.Event()
                self.held_reply = []
                self.held_request = None
                self.launch("old")
                host = self

                class Proxy(http.server.BaseHTTPRequestHandler):
                    def do_GET(self):
                        try:
                            # A routed request must connect before that upstream begins draining.
                            with host.route_lock:
                                response = urllib.request.urlopen(f"http://127.0.0.1:{host.ports[host.routes]}{self.path}", timeout=5)
                            with response:
                                if self.path.endswith("/held"):
                                    host.held_started.set()
                                payload = response.read()
                            self.send_response(200)
                            self.end_headers()
                            self.wfile.write(payload)
                        except (OSError, KeyError):
                            self.send_error(502)

                    def log_message(self, *_args):
                        pass

                self.proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
                self.url = f"http://127.0.0.1:{self.proxy.server_port}/api/health"
                self.serving = threading.Thread(target=self.proxy.serve_forever, daemon=True)
                self.serving.start()

                def observe():
                    while not self.finished.is_set():
                        try:
                            with urllib.request.urlopen(self.url, timeout=2) as response:
                                self.samples.append(response.status)
                        except Exception:
                            self.samples.append(502)
                        self.finished.wait(0.005)

                self.observer = threading.Thread(target=observe, daemon=True)
                self.observer.start()

            def launch(self, name):
                with socket.socket() as listener:
                    listener.bind(("127.0.0.1", 0))
                    self.ports[name] = listener.getsockname()[1]
                self.children[name] = subprocess.Popen([sys.executable, "-c", upstream, name, str(self.ports[name])],
                                                       stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    try:
                        release.load_script("switch-server-upstream").public_ready(
                            f"http://127.0.0.1:{self.ports[name]}/api/health", name)
                        return
                    except OSError:
                        time.sleep(0.01)
                raise RuntimeError("Fixture upstream did not start")

            def step(self, name):
                time.sleep(0.025)
                super().step(name)

            def start_api(self):
                self.launch("new")
                super().start_api()

            def start_held_request(self):
                def request():
                    try:
                        with urllib.request.urlopen(self.url + "/held", timeout=5) as response:
                            self.held_reply.append((response.status, json.load(response)["version"]))
                    except Exception as error:
                        self.held_reply.append(error)

                self.held_request = threading.Thread(target=request)
                self.held_request.start()
                if not self.held_started.wait(5):
                    raise RuntimeError("Fixture request was not accepted before the route switch")

            def switch_routes(self):
                if self.failure is None:
                    self.start_held_request()
                with self.route_lock:
                    super().switch_routes()

            def restore_routes(self):
                with self.route_lock:
                    super().restore_routes()

            def verify_public(self):
                release.load_script("switch-server-upstream").public_ready(self.url, "new")
                if self.failure:
                    self.start_held_request()
                super().verify_public()

            def drain_api(self, name):
                child = self.children[name]
                with self.route_lock:
                    child.stdin.write(b"drain\n")
                    child.stdin.flush()
                    child.stdin.close()
                if child.wait(timeout=5) != 0:
                    raise RuntimeError("Fixture API did not exit cleanly after draining")

            def stop_candidate_api(self):
                self.drain_api("new")
                super().stop_candidate_api()

            def retire_api(self):
                self.drain_api("old")
                super().retire_api()

            def close(self):
                self.finished.set()
                self.observer.join(timeout=5)
                self.proxy.shutdown()
                self.serving.join(timeout=5)
                self.proxy.server_close()
                for child in self.children.values():
                    if child.poll() is None:
                        child.terminate()
                    child.wait(timeout=5)
                    if child.stdin and not child.stdin.closed:
                        child.stdin.close()
                if self.held_request:
                    self.held_request.join(timeout=5)

        for failure in (None, "verify_public"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                host = HttpHost(failure)
                try:
                    if failure:
                        with self.assertRaisesRegex(RuntimeError, failure):
                            self.run_release(host, folder)
                    else:
                        self.run_release(host, folder)
                    expected = "old" if failure else "new"
                    self.release.load_script("switch-server-upstream").public_ready(host.url, expected)
                    self.assertGreaterEqual(len(host.samples), 10)
                    self.assertEqual(set(host.samples), {200})
                    host.held_request.join(timeout=5)
                    self.assertFalse(host.held_request.is_alive())
                    self.assertEqual(host.held_reply, [(200, "new" if failure else "old")])
                finally:
                    host.close()


if __name__ == "__main__":
    unittest.main()
