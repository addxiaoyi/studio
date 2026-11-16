"""Real PM2/PostgreSQL/Nginx checks with production receipts and queue draining."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import urllib.request
from uuid import uuid4

from scripts.test_blue_green_release import load_release


REPO = Path(__file__).resolve().parents[1]
TOOLS = os.environ.get("HELT_RELEASE_TEST_NODE_MODULES")
DATABASE = os.environ.get("HELT_RELEASE_TEST_DATABASE_URL")
AVAILABLE = (sys.platform.startswith("linux") and TOOLS and DATABASE and
             all(shutil.which(name) for name in ("node", "pm2", "psql", "nginx")))
REQUIRED = os.environ.get("HELT_RELEASE_TEST_REQUIRED") == "1"
FULL_WORKER = os.environ.get("HELT_RELEASE_TEST_FULL_WORKER") == "1"


def wait_until(probe, timeout=20):
    deadline = time.monotonic() + timeout
    while True:
        try:
            answer = probe()
            if answer:
                return answer
        except (OSError, ValueError, RuntimeError, KeyError):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError("Isolated release fixture did not reach its expected state")
        time.sleep(0.05)


@unittest.skipUnless(AVAILABLE or REQUIRED, "requires explicit local PostgreSQL, Linux PM2, Node modules and Nginx")
class Pm2ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not AVAILABLE:
            raise RuntimeError("Required release integration tools or the explicit test database are missing")

    def setUp(self):
        url = urlsplit(DATABASE)
        if url.hostname != "127.0.0.1" or url.scheme not in ("postgres", "postgresql"):
            raise RuntimeError("Release tests require an explicit loopback PostgreSQL URL")
        query = dict(parse_qsl(url.query))
        if any(key in query for key in ("host", "hostaddr", "dbname", "port", "options", "service")):
            raise RuntimeError("Release tests require a URL without routing overrides")
        if any(os.environ.get(key) for key in ("PGHOSTADDR", "PGSERVICE", "PGOPTIONS")):
            raise RuntimeError("Release tests reject inherited PostgreSQL routing overrides")
        self.folder = tempfile.TemporaryDirectory(prefix="helstera-pm2-release-")
        self.root = Path(self.folder.name)
        self.root.chmod(0o711)
        self.schema = "release_fixture_" + uuid4().hex
        self.command(["psql", DATABASE, "-X", "-v", "ON_ERROR_STOP=1", "-c", "create schema " + self.schema])
        query["options"] = "-csearch_path=" + self.schema
        self.database = urlunsplit((url.scheme, url.netloc, url.path, urlencode(query), ""))
        self.environment = patch.dict(os.environ, {"PM2_HOME": str(self.root / ".pm2"), "PM2_DISABLE_INTERNAL_AGENT": "true"})
        self.environment.start()
        self.addCleanup(self.cleanup)
        self.master = None
        self.observer_stop = threading.Event()
        self.samples = []
        self.observer = None
        self.command(["psql", self.database, "-X", "-v", "ON_ERROR_STOP=1", "-c", """
            create table schema_migrations(version text primary key,checksum text not null);
            create table release_work(id text primary key,state text not null default 'queued',duration_ms int not null,
                                      progress int not null default 0,owner_pid int);
            create table release_events(task_id text not null,phase text not null,pid int not null);
        """])
        self.prepare_work_schema()
        self.release = load_release()
        self.stage = self.root / ".helstera-candidate.new"
        self.stage.mkdir()
        (self.stage / "candidate.zip").write_bytes(b"isolated candidate fixture")
        self.old = self.root / ".releases/old"
        self.new = self.stage / "next"
        self.old_web = self.root / "apps/web/out"
        self.write_server(self.old, "0.0.0-old")
        self.write_server(self.new, "0.0.0-new")
        self.write_web(self.old_web, "old")
        self.write_web(self.new / "apps/web/out", "new")
        self.env_file = self.root / ".env.local"
        self.env_file.write_text("DATABASE_URL=" + self.database + "\n")
        self.env_file.chmod(0o600)
        self.old_port = 3003
        self.new_port = 3002
        for port in (self.old_port, self.new_port):
            with socket.socket() as listener:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(("127.0.0.1", port))
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.public_port = listener.getsockname()[1]
        self.public_url = f"http://127.0.0.1:{self.public_port}/api/health"
        specs = [self.old_spec(kind) for kind in ("server", "worker")]
        self.release.write_json(self.root / "old.config.json", {"apps": specs})
        self.command(["pm2", "start", str(self.root / "old.config.json")], timeout=60)
        for kind in ("server", "worker"):
            wait_until(lambda kind=kind: self.ready_process("helstera-" + kind + "-old", self.root / (kind + "-old.json")))
        self.config = self.root / "nginx.conf"
        self.config.write_text(f"pid {self.root}/nginx.pid;\nerror_log {self.root}/nginx.log;\n"
            "events { worker_connections 128; }\nhttp { access_log off;\nserver {\n"
            f"    listen 127.0.0.1:{self.public_port};\n    root {self.old_web};\n"
            f"    location /api/ {{ proxy_pass http://127.0.0.1:{self.old_port}; }}\n"
            "    location / { try_files $uri $uri/ /index.html; }\n}\n}\n")
        self.before = self.config.read_bytes()
        self.nginx(["-t"])
        self.master = subprocess.Popen(["nginx", "-p", str(self.root) + "/", "-c", str(self.config), "-g", "daemon off;"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait_until(lambda: self.release.load_script("switch-server-upstream").public_ready(self.public_url, "0.0.0-old"))
        topology = self.release.load_script("release-topology").inspect(self.root, self.config)
        self.release.write_json(self.stage / "prepared-base.json", topology)
        case = self

        class IsolatedHost(case.release.LocalHost):
            def run(self, arguments, **kwargs):
                if arguments[0] == "nginx":
                    return case.nginx(arguments[1:])
                return super().run(arguments, **kwargs)

        self.host = IsolatedHost(self.root, self.stage, self.config, self.public_url)

    def command(self, arguments, timeout=30):
        return subprocess.run(arguments, check=True, capture_output=True, text=True, timeout=timeout).stdout

    def nginx(self, arguments):
        return self.command(["nginx", "-p", str(self.root) + "/", "-c", str(self.config), *arguments])

    def sql(self, sql):
        return self.command(["psql", self.database, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]).strip()

    def wait_for_work(self, work_id):
        try:
            return wait_until(lambda: self.sql(
                "select state from release_work where id='" + work_id + "'"
            ) == "running")
        except Exception:
            print("Release work state:", self.sql(
                "select id,state,progress,owner_pid from release_work order by id"
            ))
            print("Release events:", self.sql(
                "select task_id,phase,pid from release_events order by task_id,phase"
            ))
            try:
                print(self.command(["pm2", "logs", "helstera-worker-old", "--nostream", "--lines", "120"], timeout=20))
            except Exception as diagnostic_error:
                print("Worker diagnostics unavailable:", diagnostic_error)
            raise

    def processes(self):
        return json.loads(self.command(["pm2", "jlist"]))

    def ready_process(self, name, receipt):
        matches = [item for item in self.processes() if item.get("name") == name and item["pm2_env"]["status"] == "online"]
        if not matches:
            return False
        return self.release.process_receipt(receipt, matches[0]["pid"], "ready")

    def write_server(self, target, version):
        server = target / "apps/server"
        (server / "src/local-db/migrations").mkdir(parents=True)
        (target / "packages/shared/dist").mkdir(parents=True)
        (server / "node_modules").symlink_to(Path(TOOLS).resolve(), target_is_directory=True)
        for kind in ("server", "worker"):
            shutil.copyfile(REPO / "scripts/fixtures/release-runtime.ts", server / f"src/{kind}.ts")
        (server / "package.json").write_text(json.dumps({"type": "module", "version": version}))

    def prepare_work_schema(self):
        pass

    def write_web(self, web, label):
        for name in ("fashion-gallery/index.html", "video/index.html", "fashion-gallery/img/SPR-0001.webp"):
            path = web / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((label + name).encode())

    def old_spec(self, kind):
        return {"name": "helstera-" + kind + "-old", "cwd": str(self.old / "apps/server"),
                "script": "./src/" + kind + ".ts", "interpreter": "node", "exec_mode": "fork", "instances": 1,
                "node_args": ["--env-file=" + str(self.env_file), "--import", "tsx"],
                "wait_ready": True, "listen_timeout": 15000, "kill_timeout": 10000,
                "env": {"DATABASE_URL": self.database, "HELSTERA_SERVER_PORT": str(self.old_port), "HELSTERA_PROCESS_RECEIPT": str(self.root / (kind + "-old.json")),
                        "RELEASE_TEST_RECEIPT_MODULE": str(REPO / "apps/server/src/runtime/process-receipt.ts"),
                        "RELEASE_TEST_QUEUE_MODULE": str(REPO / "apps/server/src/runtime/queue-runner.ts")}}

    def observe(self):
        def sample():
            while not self.observer_stop.is_set():
                try:
                    with urllib.request.urlopen(self.public_url, timeout=2) as response:
                        self.samples.append(response.status)
                except OSError:
                    self.samples.append(502)
                self.observer_stop.wait(0.02)

        self.observer = threading.Thread(target=sample, daemon=True)
        self.observer.start()

    def cleanup(self):
        self.observer_stop.set()
        if self.observer is not None:
            self.observer.join(timeout=5)
        errors = []
        if self.master is not None:
            try:
                self.nginx(["-s", "quit"])
                self.master.wait(timeout=15)
            except Exception as error:
                errors.append(error)
        try:
            self.command(["pm2", "kill"], timeout=40)
        except Exception as error:
            errors.append(error)
        self.environment.stop()
        self.command(["psql", DATABASE, "-X", "-v", "ON_ERROR_STOP=1", "-c", "drop schema " + self.schema + " cascade"])
        if errors:
            raise RuntimeError("Isolated process cleanup failed; retained " + str(self.root)) from errors[0]
        self.folder.cleanup()

    def test_commits_in_flight_work_and_restores_only_current_processes(self):
        self.sql("insert into release_work(id,duration_ms) values('before-switch',2500)")
        self.wait_for_work("before-switch")
        old_worker = next(item for item in self.processes() if item["name"] == "helstera-worker-old")
        self.observe()
        report = self.release.rollout(self.host, self.stage / "transaction.json")
        self.assertEqual(report["phase"], "committed")
        self.assertNotIn("cleanupError", report)
        self.assertEqual(self.sql("select state||':'||progress from release_work where id='before-switch'"), "completed:100")
        self.assertEqual(self.sql("select count(*) from release_events where task_id='before-switch' and phase='started'"), "1")
        self.assertEqual(self.sql("select pid from release_events where task_id='before-switch' and phase='completed'"), str(old_worker["pid"]))
        self.observer_stop.set()
        self.observer.join(timeout=5)
        self.assertGreater(len(self.samples), 10)
        self.assertEqual(set(self.samples), {200})
        self.command(["pm2", "kill"], timeout=40)
        self.command(["pm2", "resurrect"], timeout=60)
        wait_until(lambda: self.ready_process(self.host.names["server"], self.stage / "server-receipt.json"))
        wait_until(lambda: self.ready_process(self.host.names["worker"], self.stage / "worker-receipt.json"))
        online = {item["name"] for item in self.processes() if item["pm2_env"]["status"] == "online"}
        self.assertEqual(online, set(self.host.names.values()))
        self.host.verify_public()
        print(f"PM2 commit/resurrect: samples={len(self.samples)}, all=200, task starts=1")

    def test_public_failure_drains_candidate_work_before_restoring_old_worker(self):
        original_verify = self.host.verify_public
        candidate_pid = []

        def fail_after_real_checks():
            original_verify()
            self.sql("insert into release_work(id,duration_ms) values('candidate-work',1500)")
            self.wait_for_work("candidate-work")
            candidate_pid.append(self.sql("select owner_pid from release_work where id='candidate-work'"))
            raise RuntimeError("injected public verification failure")

        self.host.verify_public = fail_after_real_checks
        self.observe()
        with self.assertRaisesRegex(RuntimeError, "injected public verification failure"):
            self.release.rollout(self.host, self.stage / "transaction.json")
        self.assertEqual(self.config.read_bytes(), self.before)
        self.assertEqual(self.sql("select state||':'||progress from release_work where id='candidate-work'"), "completed:100")
        self.assertEqual(self.sql("select count(*) from release_events where task_id='candidate-work' and phase='started'"), "1")
        self.assertEqual(self.sql("select pid from release_events where task_id='candidate-work' and phase='completed'"), candidate_pid[0])
        wait_until(lambda: self.ready_process("helstera-worker-old", self.root / "worker-old.json"))
        self.observer_stop.set()
        self.observer.join(timeout=5)
        self.assertGreater(len(self.samples), 10)
        self.assertEqual(set(self.samples), {200})
        print(f"PM2 rollback: samples={len(self.samples)}, all=200, task starts=1")

    def test_forced_worker_timeout_does_not_claim_safe_drain_or_restart_it(self):
        self.sql("insert into release_work(id,duration_ms) values('long-work',15000)")
        self.wait_for_work("long-work")
        with patch.object(self.release, "WORKER_DRAIN_SECONDS", 1):
            with self.assertRaisesRegex(RuntimeError, "rollback incomplete"):
                self.release.rollout(self.host, self.stage / "transaction.json")
        journal = json.loads((self.stage / "transaction.json").read_bytes())
        self.assertEqual(journal["phase"], "rollback_incomplete")
        self.assertEqual(self.sql("select state from release_work where id='long-work'"), "running")
        self.assertEqual(self.sql("select count(*) from release_events where task_id='long-work' and phase='started'"), "1")
        self.assertEqual(self.release.load_script("switch-server-upstream").public_ready(self.public_url, "0.0.0-old")["ok"], True)

    def interrupt_release(self, phase):
        pid = os.fork()
        if pid == 0:
            try:
                original = getattr(self.host, phase)

                def terminate_after_phase():
                    original()
                    os._exit(73)

                setattr(self.host, phase, terminate_after_phase)
                self.release.rollout(self.host, self.stage / "transaction.json")
            except BaseException as error:
                (self.stage / "interrupt-error.txt").write_text(str(error))
                os._exit(74)
            os._exit(75)
        _, status = os.waitpid(pid, 0)
        diagnostic = self.stage / "interrupt-error.txt"
        self.assertEqual(os.waitstatus_to_exitcode(status), 73, diagnostic.read_text() if diagnostic.exists() else "")

    def test_killed_release_is_recovered_after_route_change_without_duplicate_work(self):
        self.interrupt_release("switch_routes")
        self.sql("insert into release_work(id,duration_ms) values('interrupted-work',1200)")
        self.wait_for_work("interrupted-work")
        restored = type(self.host).from_context(self.root, self.stage, self.config, self.public_url)
        report = self.release.recover_release(restored, self.stage / "transaction.json")
        self.assertEqual(report["phase"], "rolled_back")
        self.assertEqual(self.sql("select state||':'||progress from release_work where id='interrupted-work'"), "completed:100")
        self.assertEqual(self.sql("select count(*) from release_events where task_id='interrupted-work' and phase='started'"), "1")
        old = self.ready_process("helstera-worker-old", self.root / "worker-old.json")
        again = type(self.host).from_context(self.root, self.stage, self.config, self.public_url)
        self.release.recover_release(again, self.stage / "transaction.json")
        self.assertEqual(self.ready_process("helstera-worker-old", self.root / "worker-old.json")["instanceId"], old["instanceId"])

    def test_killed_release_finishes_commit_when_active_pointer_was_saved(self):
        self.interrupt_release("persist")
        recovered = type(self.host).from_context(self.root, self.stage, self.config, self.public_url)
        report = self.release.recover_release(recovered, self.stage / "transaction.json")
        self.assertEqual(report["phase"], "committed")
        self.assertNotIn("cleanupError", report)
        online = {item["name"] for item in self.processes() if item["pm2_env"]["status"] == "online"}
        self.assertEqual(online, set(recovered.names.values()))
        again = type(self.host).from_context(self.root, self.stage, self.config, self.public_url)
        report = self.release.recover_release(again, self.stage / "transaction.json")
        self.assertEqual(report["phase"], "committed")
        self.assertNotIn("cleanupError", report)


@unittest.skipUnless(FULL_WORKER and (AVAILABLE or REQUIRED), "requires explicitly enabled production Worker runtime")
class FullWorkerReleaseTests(Pm2ReleaseTests):
    def setUp(self):
        try:
            super().setUp()
        except Exception:
            # PM2 keeps the useful bootstrap error in its per-test log files;
            # include it before cleanup removes the isolated PM2_HOME.
            try:
                print("PM2 failure state:", self.command(["pm2", "jlist"]))
                print(self.command(["pm2", "logs", "--nostream", "--lines", "80"], timeout=20))
            except Exception as diagnostic_error:
                print("PM2 diagnostics unavailable:", diagnostic_error)
            raise

    def prepare_work_schema(self):
        self.worker_root = Path(os.environ.get("HELT_RELEASE_TEST_WORKER_ROOT", str(REPO))).resolve(strict=True)
        source_server = self.worker_root / "apps/server"
        source_worker = source_server / "src/worker.ts"
        if not source_worker.is_file():
            raise RuntimeError("The reviewed production Worker source is missing")
        # Keep the reviewed entry outside the release fixture. The fixture has
        # a same-named wrapper so it can register a deterministic executor;
        # reusing that path for the direct PM2 check turns the wrapper into a
        # self-importing worker and hides failures in the production bootstrap.
        direct_server = self.root / "direct-worker/apps/server"
        shutil.copytree(source_server / "src", direct_server / "src")
        shutil.copyfile(source_server / "package.json", direct_server / "package.json")
        (direct_server / "node_modules").symlink_to(Path(TOOLS).resolve(), target_is_directory=True)
        self.worker_source = direct_server / "src/worker.ts"
        self.command(["psql", self.database, "-X", "-v", "ON_ERROR_STOP=1", "-f",
                      str(self.worker_root / "apps/server/src/local-db/schema.sql")])
        self.storage = self.root / "media"
        self.storage.mkdir()
        user, workspace = str(uuid4()), str(uuid4())
        self.sql(f"""
            insert into app_users(id,email) values('{user}','release-worker@test.invalid');
            insert into workspaces(id,owner_user_id,name) values('{workspace}','{user}','Release worker');
            alter table release_work add column job_id uuid not null default gen_random_uuid();
            create function enqueue_release_work() returns trigger language plpgsql as $$
            begin
              insert into background_jobs(id,workspace_id,created_by,queue_name,job_type)
              values(new.job_id,'{workspace}','{user}','website_capture_jobs','website_capture');
              return new;
            end $$;
            create trigger enqueue_release_work after insert on release_work
              for each row execute function enqueue_release_work();
        """)

    def write_server(self, target, version):
        super().write_server(target, version)
        shutil.copyfile(REPO / "scripts/fixtures/release-worker.ts", target / "apps/server/src/worker.ts")

    def worker_environment(self):
        return {
            "RELEASE_TEST_WORKER_MODULE": str(self.worker_source),
            # The fixture must register against the same module graph that
            # the copied production Worker imports; otherwise each graph has
            # its own executor Map and the real capture executor wins.
            "RELEASE_TEST_EXECUTOR_MODULE": str(self.worker_source.parent / "features/jobs/job-executor.ts"),
            "STORAGE_ROOT": str(self.storage),
            "WORKER_POLL_INTERVAL_MS": "1000",
            "WORKER_IMAGE_CONCURRENCY": "1",
            "WORKER_VIDEO_CONCURRENCY": "1",
        }

    def production_worker_environment(self):
        environment = self.worker_environment()
        for key in ("RELEASE_TEST_WORKER_MODULE", "RELEASE_TEST_EXECUTOR_MODULE"):
            environment.pop(key, None)
        return environment

    def old_spec(self, kind):
        spec = super().old_spec(kind)
        if kind == "worker":
            spec["env"].update(self.worker_environment())
        return spec

    def test_actual_worker_entry_starts_under_pm2(self):
        name = "helstera-worker-direct-entry"
        receipt = self.root / "worker-direct-entry.json"
        spec = self.old_spec("worker")
        spec["env"] = self.production_worker_environment()
        spec.update(name=name, cwd=str(self.worker_source.parent.parent), script=str(self.worker_source))
        spec["env"]["HELSTERA_PROCESS_RECEIPT"] = str(receipt)
        spec["autorestart"] = False
        self.release.write_json(self.root / "direct-worker.config.json", {"apps": [spec]})
        self.command(["pm2", "start", str(self.root / "direct-worker.config.json")], timeout=60)
        try:
            wait_until(lambda: self.ready_process(name, receipt))
        except Exception:
            try:
                print("Direct Worker PM2 state:", self.command(["pm2", "jlist"]))
                print(self.command(["pm2", "logs", name, "--nostream", "--lines", "80"], timeout=20))
            except Exception as diagnostic_error:
                print("Direct Worker diagnostics unavailable:", diagnostic_error)
            raise
        self.host.stop_worker(name, receipt, self.ready_process(name, receipt)["pid"])

    def test_commits_in_flight_work_and_restores_only_current_processes(self):
        super().test_commits_in_flight_work_and_restores_only_current_processes()
        self.assertEqual(self.sql("select status from background_jobs"), "succeeded")
        job = self.sql("select job_id from release_work where id='before-switch'")
        self.assertEqual((self.storage / (job + ".txt")).read_text(), "completed:before-switch")

    def test_public_failure_drains_candidate_work_before_restoring_old_worker(self):
        super().test_public_failure_drains_candidate_work_before_restoring_old_worker()
        self.assertEqual(self.sql("select status from background_jobs"), "succeeded")
        job = self.sql("select job_id from release_work where id='candidate-work'")
        self.assertEqual((self.storage / (job + ".txt")).read_text(), "completed:candidate-work")


if __name__ == "__main__":
    unittest.main()
