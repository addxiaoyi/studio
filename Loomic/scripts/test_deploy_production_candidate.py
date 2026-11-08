import importlib.util
import hashlib
import http.server
import json
import pathlib
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import types
import unittest
import zipfile
from unittest.mock import MagicMock, patch


class FakeSSHClient:
    def __init__(self):
        self.loaded = False
        self.policy = None

    def load_system_host_keys(self):
        self.loaded = True

    def load_host_keys(self, _path):
        self.loaded = True

    def set_missing_host_key_policy(self, policy):
        self.policy = policy


class DeployCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fake_paramiko = types.ModuleType("paramiko")
        fake_paramiko.SSHClient = FakeSSHClient
        fake_paramiko.RejectPolicy = lambda: "reject"
        sys.modules["paramiko"] = fake_paramiko
        path = pathlib.Path(__file__).with_name("deploy-production-candidate.py")
        spec = importlib.util.spec_from_file_location("deploy_candidate", path)
        cls.deploy = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(cls.deploy)

    def test_ssh_uses_system_host_keys_and_rejects_unknown_hosts(self):
        client = FakeSSHClient()
        self.deploy.configure_ssh(client)
        self.assertTrue(client.loaded)
        self.assertEqual(client.policy, "reject")

    def test_nginx_scripts_require_verified_uploads_before_execution(self):
        target = MagicMock()
        staging = "/srv/helstera/.helstera-candidate.test"
        with patch.object(self.deploy, "remote_run", return_value="wrong") as remote:
            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                self.deploy.apply_studio_nginx(target, staging)
        self.assertEqual(remote.call_count, 1)
        self.assertNotIn("python3", remote.call_args.args[1])

        scripts = pathlib.Path(__file__).parent
        hashes = [hashlib.sha256((scripts / name).read_bytes()).hexdigest() for name in
                  ("validate-studio-nginx.py", "apply-studio-nginx.py")]
        with patch.object(self.deploy, "remote_run", side_effect=[*hashes, "ok"]) as remote:
            self.deploy.apply_studio_nginx(target, staging)
        self.assertEqual(remote.call_count, 3)
        self.assertIn("/etc/nginx/sites-enabled/studio.0st.top.conf", remote.call_args.args[1])

    def test_candidate_upload_hash_is_checked_before_extraction(self):
        staging = "/srv/helstera/.helstera-candidate.test"
        with patch.object(self.deploy, "remote_run", return_value="ab" * 32) as remote:
            self.deploy.verify_candidate_upload(FakeSSHClient(), staging, "AB" * 32)
            self.assertIn(staging + "/candidate.zip", remote.call_args.args[1])
        with patch.object(self.deploy, "remote_run", return_value="cd" * 32):
            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                self.deploy.verify_candidate_upload(FakeSSHClient(), staging, "ab" * 32)
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertLess(script.index("verify_candidate_upload(target, staging, local_hash)"), script.index("unzip -q"))

    def test_candidate_archive_rejects_tampering_and_unexpected_files(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / "candidate.zip"
            data = b"candidate contents"
            manifest = {"files": {"apps/server/src/app.ts": {"sha256": hashlib.sha256(data).hexdigest()}}}

            def create(content, extra=None):
                with zipfile.ZipFile(archive, "w") as bundle:
                    bundle.writestr("RELEASE-MANIFEST.json", json.dumps(manifest))
                    bundle.writestr("apps/server/src/app.ts", content)
                    if extra:
                        bundle.writestr(extra, "unexpected")

            create(data)
            self.deploy.validate_candidate_archive(archive)
            create(b"tampered")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                self.deploy.validate_candidate_archive(archive)
            create(data, "unlisted.txt")
            with self.assertRaisesRegex(ValueError, "manifest does not match"):
                self.deploy.validate_candidate_archive(archive)
            create(data, "../escape")
            with self.assertRaisesRegex(ValueError, "unsafe path"):
                self.deploy.validate_candidate_archive(archive)

    def test_candidate_archive_rejects_symlinks_and_duplicate_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / "candidate.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                link = zipfile.ZipInfo("link")
                link.create_system = 3
                link.external_attr = 0o120777 << 16
                bundle.writestr(link, "target")
            with self.assertRaisesRegex(ValueError, "symbolic link"):
                self.deploy.validate_candidate_archive(archive)
            with self.assertWarns(UserWarning):
                with zipfile.ZipFile(archive, "w") as bundle:
                    bundle.writestr("duplicate", "first")
                    bundle.writestr("duplicate", "second")
            with self.assertRaisesRegex(ValueError, "duplicate entry"):
                self.deploy.validate_candidate_archive(archive)

    def test_remote_staging_path_must_be_an_expected_child(self):
        self.assertEqual(
            self.deploy.validate_remote_temp(
                "/srv/helstera/.helstera-candidate.abc123",
                "/srv/helstera",
                ".helstera-candidate.",
            ),
            "/srv/helstera/.helstera-candidate.abc123",
        )
        for value in (
            "/tmp/.helstera-candidate.abc123",
            "/srv/helstera/apps/.helstera-candidate.abc123",
            "/srv/helstera/.helstera-backup.abc123",
        ):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                self.deploy.validate_remote_temp(
                    value,
                    "/srv/helstera",
                    ".helstera-candidate.",
                )

    def test_candidate_preparation_never_mutates_live_paths(self):
        command = self.deploy.prepare_candidate_command(
            "/srv/helstera",
            "/srv/helstera/.helstera-candidate.abc123",
        )
        self.assertIn("candidate=/srv/helstera/.helstera-candidate.abc123/candidate", command)
        self.assertIn("next=/srv/helstera/.helstera-candidate.abc123/next", command)
        self.assertNotIn("rm -rf", command)
        self.assertNotIn("mv ", command)

    def test_database_restore_is_checked_before_live_replacement(self):
        command = self.deploy.verify_database_restore_command(
            "/srv/helstera", "/srv/helstera/.helstera-backup.abc123"
        )
        self.assertIn("helstera_restorecheck_", command)
        self.assertIn("createdb --maintenance-db=", command)
        self.assertIn("pg_restore --exit-on-error", command)
        self.assertIn("trap cleanup_restorecheck EXIT", command)
        self.assertIn("public.app_users", command)
        with self.assertRaises(RuntimeError):
            self.deploy.verify_database_restore_command("/srv/helstera", "/tmp/backup")
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertLess(script.index('print("DATABASE_RESTORE"'), script.index("replacement_started = True"))

    def test_database_restore_checks_local_database_capacity_before_backup(self):
        command = self.deploy.database_restore_space_command("/www/helstera")
        self.assertIn("u.hostname in", command)
        for host in ("127.0.0.1", "localhost", "::1"):
            self.assertIn(host, command)
        for override in ("hostaddr", "PGHOSTADDR", "PGOPTIONS", "app_identity", "local_identity"):
            self.assertIn(override, command)
        self.assertIn("show data_directory", command)
        self.assertIn("required=size*2+1024**3", command)
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertLess(script.index('print("DATABASE_SPACE"'), script.index("pg_dump --format=custom"))

    def test_isolated_restore_checks_both_filesystems_and_local_cluster(self):
        root = "/www/helstera"
        command = self.deploy.database_restore_space_command(root, isolated=True)
        self.assertIn('"$data_dir"', command)
        self.assertIn("production disk available=", command)
        self.assertIn("required=1024**3", command)
        self.assertIn("required=size*2+1024**3", command)
        self.assertIn(root, command)

        backup = root + "/.helstera-backup.test"
        staging = root + "/.helstera-candidate.test"
        restore = self.deploy.isolated_database_restore_command(root, backup, staging)
        self.assertIn("server_version_num", restore)
        self.assertIn("runuser -u postgres -- test -x", restore)
        self.assertIn(staging + "/isolated-pg-rehearsal.py", restore)
        self.assertIn(backup + "/database.dump", restore)
        self.assertNotIn("--env-file", restore)
        with self.assertRaises(RuntimeError):
            self.deploy.isolated_database_restore_command(root, "/tmp/backup", staging)

    def test_isolated_rehearsal_failure_stops_before_live_swap(self):
        root = "/srv/helstera"
        staging = root + "/.helstera-candidate.test"
        backup = root + "/.helstera-backup.test"
        calls = []
        target = MagicMock()
        script = pathlib.Path(__file__).with_name("isolated-pg-rehearsal.py")
        script_hash = __import__("hashlib").sha256(script.read_bytes()).hexdigest()

        def remote(_target, command, timeout=180):
            calls.append(command)
            if "mktemp -d" in command:
                return staging if ".helstera-candidate." in command else backup
            if "sha256sum" in command and "candidate.zip" in command:
                return digest
            if "sha256sum" in command and "isolated-pg-rehearsal.py" in command:
                return script_hash
            if "server_version_num" in command:
                raise RuntimeError("isolated rehearsal failed")
            return ""

        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / "candidate.zip"
            archive.write_bytes(b"candidate")
            digest = __import__("hashlib").sha256(archive.read_bytes()).hexdigest().upper()
            args = types.SimpleNamespace(
                archive=archive, password_env="TEST_DEPLOY_PASSWORD", direct=True,
                resume_staging=None, resume_backup=None, root=root, isolated_restore=True,
                target_host="example.test", target_user="test", health_url="https://example.test/api/health",
            )
            with patch.dict("os.environ", {"TEST_DEPLOY_PASSWORD": "test"}), \
                 patch.object(self.deploy.paramiko, "SSHClient", return_value=target), \
                 patch.object(self.deploy, "configure_ssh"), \
                 patch.object(self.deploy, "validate_candidate_archive"), \
                 patch.object(self.deploy, "active_jobs", return_value=[]), \
                 patch.object(self.deploy, "remote_run", side_effect=remote):
                with self.assertRaisesRegex(RuntimeError, "isolated rehearsal failed"):
                    self.deploy.deploy(args)

        self.assertTrue(any("isolated-pg-rehearsal.py" in command and "sha256sum" in command for command in calls))
        self.assertFalse(any("renameat2" in command for command in calls))
        self.assertFalse(any("pm2 restart" in command for command in calls))

    def test_new_job_after_rehearsal_stops_before_live_swap(self):
        root = "/srv/helstera"
        staging = root + "/.helstera-candidate.test"
        backup = root + "/.helstera-backup.test"
        calls = []
        target = MagicMock()

        def remote(_target, command, timeout=180):
            calls.append(command)
            if "mktemp -d" in command:
                return staging if ".helstera-candidate." in command else backup
            if "sha256sum" in command and "candidate.zip" in command:
                return digest
            return ""

        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / "candidate.zip"
            archive.write_bytes(b"candidate")
            digest = __import__("hashlib").sha256(archive.read_bytes()).hexdigest().upper()
            args = types.SimpleNamespace(
                archive=archive, password_env="TEST_DEPLOY_PASSWORD", direct=True,
                resume_staging=None, resume_backup=None, root=root,
                target_host="example.test", target_user="test", health_url="https://example.test/api/health",
            )
            with patch.dict("os.environ", {"TEST_DEPLOY_PASSWORD": "test"}), \
                 patch.object(self.deploy.paramiko, "SSHClient", return_value=target), \
                 patch.object(self.deploy, "configure_ssh"), \
                 patch.object(self.deploy, "validate_candidate_archive"), \
                 patch.object(self.deploy, "active_jobs", side_effect=[[], [{"status": "running"}]]), \
                 patch.object(self.deploy, "remote_run", side_effect=remote):
                with self.assertRaisesRegex(RuntimeError, "after rehearsal"):
                    self.deploy.deploy(args)

        self.assertTrue(any("pg_restore --exit-on-error" in command for command in calls))
        self.assertFalse(any("renameat2" in command for command in calls))
        self.assertFalse(any("pm2 restart" in command for command in calls))

    def test_candidate_migration_failure_stops_before_live_swap(self):
        root = "/srv/helstera"
        staging = root + "/.helstera-candidate.test"
        backup = root + "/.helstera-backup.test"
        calls = []
        target = MagicMock()
        target.get_transport.return_value.is_active.return_value = True

        def remote(_target, command, timeout=180):
            calls.append(command)
            if "mktemp -d" in command:
                return staging if ".helstera-candidate." in command else backup
            if "sha256sum" in command and "candidate.zip" in command:
                return digest
            if "pg_restore --exit-on-error" in command:
                raise RuntimeError("candidate migration failed")
            return ""

        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / "candidate.zip"
            archive.write_bytes(b"candidate")
            digest = __import__("hashlib").sha256(archive.read_bytes()).hexdigest().upper()
            args = types.SimpleNamespace(
                archive=archive, password_env="TEST_DEPLOY_PASSWORD", direct=True,
                resume_staging=None, resume_backup=None, root=root,
                target_host="example.test", target_user="test", health_url="https://example.test/api/health",
            )
            with patch.dict("os.environ", {"TEST_DEPLOY_PASSWORD": "test"}), \
                 patch.object(self.deploy.paramiko, "SSHClient", return_value=target), \
                 patch.object(self.deploy, "configure_ssh"), \
                 patch.object(self.deploy, "validate_candidate_archive"), \
                 patch.object(self.deploy, "active_jobs", return_value=[]), \
                 patch.object(self.deploy, "remote_run", side_effect=remote):
                with self.assertRaisesRegex(RuntimeError, "candidate migration failed"):
                    self.deploy.deploy(args)

        rehearsal = next(command for command in calls if "pg_restore --exit-on-error" in command)
        self.assertIn('DATABASE_URL="$verify_url"', rehearsal)
        self.assertIn(staging + "/next/apps/server", rehearsal)
        self.assertFalse(any("renameat2" in command for command in calls))
        self.assertFalse(any("pm2 restart" in command for command in calls))

    def test_candidate_runtime_is_prepared_before_rehearsal(self):
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        runtime = script.index("remote_run(target, prepare_candidate_runtime_command(staging)")
        rehearsal = script.index('print("DATABASE_RESTORE"')
        swap = script.index("replacement_started = True")
        self.assertLess(runtime, rehearsal)
        self.assertLess(rehearsal, swap)
        command = self.deploy.prepare_candidate_runtime_command("/srv/helstera/.helstera-candidate.test")
        self.assertIn("packages/shared/dist", command)
        self.assertIn("--frozen-lockfile", command)
        self.assertIn("Candidate runtime contains preinstalled dependencies", command)
        self.assertLess(command.index("-name node_modules"), command.index("pnpm install"))
        self.assertIn("cd deploy/server-runtime && CI=true pnpm install", command)

    def test_runtime_gate_rejects_shared_without_workflow_exports(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not installed")
        command = self.deploy.prepare_candidate_runtime_command("/srv/candidate")
        probe = command.split('node --import tsx --input-type=module -e "', 1)[1][:-1]
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ("pg", "@helstera/shared"):
                package = root / "node_modules" / name
                package.mkdir(parents=True)
                (package / "package.json").write_text(json.dumps({"type": "module", "exports": "./index.js"}), encoding="utf-8")
                (package / "index.js").write_text("export {};", encoding="utf-8")
            shared = root / "node_modules/@helstera/shared/index.js"
            legacy = "export function validateVideoEditorPlan(){}; export function createTranscriptEdit(){};"
            shared.write_text(legacy, encoding="utf-8")
            stale = subprocess.run([node, "--input-type=module", "-e", probe], cwd=root, capture_output=True, text=True)
            self.assertNotEqual(stale.returncode, 0, "A stale shared runtime must block deployment")
            shared.write_text(legacy + "export function compileWorkflow(){}; export const workflowGraphSchema={parse(){}};", encoding="utf-8")
            current = subprocess.run([node, "--input-type=module", "-e", probe], cwd=root, capture_output=True, text=True)
            self.assertEqual(current.returncode, 0, current.stderr)

    def test_candidate_shared_overwrites_existing_runtime_without_nesting_dist(self):
        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe") if sys.platform == "win32" else pathlib.Path("/bin/bash")
        if not bash.is_file():
            self.skipTest("bash is not installed")
        with tempfile.TemporaryDirectory() as directory:
            staging = pathlib.Path(directory) / ".helstera-candidate.test"
            source = staging / "next/packages/shared/dist"
            runtime = staging / "next/deploy/server-runtime/packages/shared/dist"
            source.mkdir(parents=True)
            runtime.mkdir(parents=True)
            (source / "index.js").write_text("export const createTranscriptEdit = () => {};", encoding="utf-8")
            (runtime / "index.js").write_text("export const old = true;", encoding="utf-8")
            path = staging.as_posix() if sys.platform != "win32" else "/" + staging.drive[0].lower() + staging.as_posix()[2:]
            command = self.deploy.prepare_candidate_runtime_command(path).split("(cd deploy/server-runtime && CI=true pnpm install", 1)[0]
            subprocess.run([str(bash), "-c", command], check=True)
            self.assertEqual((runtime / "index.js").read_bytes(), (source / "index.js").read_bytes())
            self.assertFalse((runtime / "dist").exists())

    def test_sparse_candidate_starts_from_live_server_source_and_applies_only_overlays(self):
        command = self.deploy.prepare_candidate_command(
            "/srv/helstera",
            "/srv/helstera/.helstera-candidate.abc123",
        )
        self.assertIn("cp -a /srv/helstera/apps/server/src", command)
        self.assertIn("$candidate/apps/server/src/.", command)
        self.assertIn("$candidate/packages/shared/dist/.", command)
        self.assertIn("if test -f $candidate/apps/web/out/index.html", command)

    def test_deploy_requires_all_candidate_migrations_before_replacing_live_paths(self):
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertIn("20261026000000_agent_marketplace_catalog.sql", script)
        self.assertIn("20261026000001_desktop_agent_recovery.sql", script)
        self.assertIn("20261026000002_desktop_agent_chat_recovery.sql", script)
        self.assertIn("20261027000000_agent_marketplace_installs.sql", script)
        self.assertIn("20261031000000_agent_muse_workspace.sql", script)
        self.assertIn("20261031000001_agent_suggestion_context.sql", script)
        self.assertIn("20261101000009_desktop_chat_outbox.sql", script)
        self.assertIn("apps/server/src/http/agent-memory.ts", script)
        self.assertIn("apps/server/src/http/agent-connectors.ts", script)
        self.assertIn("apps/server/src/agent/workspace-skills.ts", script)
        self.assertIn("deploy/server-runtime/pnpm-lock.yaml", script)
        self.assertNotIn("tsc -p {stage}/next/apps/server/tsconfig.json", script)
        self.assertIn("cd deploy/server-runtime && CI=true pnpm install --frozen-lockfile --ignore-scripts --no-prod", script)
        self.assertIn("apps/server/node_modules", script)

    def test_runtime_switch_and_restore_keep_both_versions(self):
        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe") if sys.platform == "win32" else pathlib.Path("/bin/bash")
        if not bash.is_file():
            self.skipTest("bash is not installed")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            staging = root / ".helstera-candidate.test"
            old_runtime = root / ".server-runtime"
            new_runtime = staging / "next/deploy/server-runtime"
            old_runtime.mkdir(parents=True)
            new_runtime.mkdir(parents=True)
            (old_runtime / "version").write_text("old", encoding="utf-8")
            (new_runtime / "version").write_text("new", encoding="utf-8")

            def shell_path(path):
                if sys.platform != "win32":
                    return path.as_posix()
                return "/" + path.drive[0].lower() + path.as_posix()[2:]

            root_posix, staging_posix = shell_path(root), shell_path(staging)
            subprocess.run([str(bash), "-c", self.deploy.switch_runtime_command(root_posix, staging_posix)], check=True)
            self.assertEqual((old_runtime / "version").read_text(encoding="utf-8"), "new")
            self.assertEqual((staging / "previous-runtime/version").read_text(encoding="utf-8"), "old")
            subprocess.run([str(bash), "-c", self.deploy.restore_runtime_command(root_posix, staging_posix)], check=True)
            self.assertEqual((old_runtime / "version").read_text(encoding="utf-8"), "old")
            self.assertEqual((staging / "failed-runtime/version").read_text(encoding="utf-8"), "new")
            old_runtime.rename(staging / "previous-runtime")
            subprocess.run([str(bash), "-c", self.deploy.restore_runtime_command(root_posix, staging_posix)], check=True)
            self.assertEqual((old_runtime / "version").read_text(encoding="utf-8"), "old")

    @unittest.skipUnless(sys.platform.startswith("linux"), "requires Linux renameat2")
    def test_restore_backup_replaces_directories_without_leaving_new_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            backup = root / ".helstera-backup.test"
            backup.mkdir()
            dirs = ("apps/server/src", "apps/web/out", "packages/shared/dist")
            files = ("apps/server/package.json", "apps/server/tsconfig.json", "apps/desktop/package.json",
                     "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")
            for relative in dirs:
                path = root / relative
                path.mkdir(parents=True)
                (path / "old.txt").write_text("old", encoding="utf-8")
            for relative in files:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("old", encoding="utf-8")
            with tarfile.open(backup / "current.tgz", "w:gz") as archive:
                for relative in (*dirs, *files):
                    archive.add(root / relative, arcname=relative)
            for relative in dirs:
                (root / relative / "old.txt").write_text("new", encoding="utf-8")
                (root / relative / "new.txt").write_text("new", encoding="utf-8")
            (root / "package.json").write_text("new", encoding="utf-8")

            def run_remote(_client, command, timeout=180):
                subprocess.run(["bash", "-c", command], check=True, timeout=timeout)
                return ""

            with patch.object(self.deploy, "remote_run", side_effect=run_remote):
                self.deploy.restore_backup(FakeSSHClient(), str(root), str(backup))
            for relative in dirs:
                self.assertEqual((root / relative / "old.txt").read_text(encoding="utf-8"), "old")
                self.assertFalse((root / relative / "new.txt").exists())
                self.assertTrue((backup / "rollback-tree" / relative / "new.txt").exists())
            self.assertEqual((root / "package.json").read_text(encoding="utf-8"), "old")

    @unittest.skipUnless(sys.platform.startswith("linux"), "requires Linux renameat2")
    def test_directory_exchange_rolls_back_if_a_later_exchange_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory) / "live"
            candidate = pathlib.Path(directory) / "next"
            for relative in ("apps/server/src", "apps/web/out", "packages/shared/dist"):
                (root / relative).mkdir(parents=True)
                (root / relative / "version").write_text("old", encoding="utf-8")
            for relative in ("apps/server/src", "apps/web/out"):
                (candidate / relative).mkdir(parents=True)
                (candidate / relative / "version").write_text("new", encoding="utf-8")
            command = self.deploy.exchange_directories_command(str(root), str(candidate))
            completed = subprocess.run(["bash", "-c", command], capture_output=True, text=True)
            self.assertNotEqual(completed.returncode, 0)
            for relative in ("apps/server/src", "apps/web/out"):
                self.assertEqual((root / relative / "version").read_text(encoding="utf-8"), "old")
                self.assertEqual((candidate / relative / "version").read_text(encoding="utf-8"), "new")

    def test_candidate_requires_try_on_video_and_recording_files(self):
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        required_start = script.index("required_candidate_files = (")
        required_end = script.index("candidate_checks =", required_start)
        required = script[required_start:required_end]
        for path in (
            "apps/web/out/fashion-gallery/index.html",
            "apps/web/out/fashion-gallery/img/SPR-0001.webp",
            "apps/web/out/video/index.html",
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
            "packages/shared/dist/contracts.js",
        ):
            with self.subTest(path=path):
                self.assertIn(path, required)

    def test_static_probe_rejects_html_fallback_and_wrong_files(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            fallback = False
            changed = False

            def do_GET(self):
                files = {
                    "/fashion-gallery/": ("text/html", b"gallery"),
                    "/video/": ("text/html", b"video"),
                    "/fashion-gallery/img/SPR-0001.webp": ("image/webp", b"image"),
                }
                if self.path not in files:
                    if not self.fallback:
                        self.send_error(404)
                        return
                    content_type, body = "text/html", b"home"
                else:
                    content_type, body = files[self.path]
                    if self.changed and self.path.endswith(".webp"):
                        content_type, body = "text/html", b"home"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for path, content in (("fashion-gallery/index.html", b"gallery"), ("video/index.html", b"video"), ("fashion-gallery/img/SPR-0001.webp", b"image")):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                args = [sys.executable, "-c", self.deploy.STATIC_PROBE, f"http://127.0.0.1:{server.server_port}", str(root)]
                self.assertEqual(subprocess.run(args, capture_output=True).returncode, 0)
                Handler.fallback = True
                self.assertNotEqual(subprocess.run(args, capture_output=True).returncode, 0)
                Handler.fallback = False
                Handler.changed = True
                self.assertNotEqual(subprocess.run(args, capture_output=True).returncode, 0)
            finally:
                server.shutdown()
                thread.join()
                server.server_close()

    def test_live_replacement_atomically_exchanges_runtime_directories(self):
        command = self.deploy.replace_live_command(
            "/srv/helstera",
            "/srv/helstera/.helstera-candidate.abc123",
        )
        self.assertIn("renameat2", command)
        self.assertIn("rollback_errors", command)
        self.assertNotIn("rm -rf apps/server/src apps/web/out packages/shared/dist", command)
        self.assertIn("/next/apps/server/src", command)
        command_parts = list(shlex.shlex(command, posix=True, punctuation_chars=";"))
        script_index = command_parts.index("python3") + 2
        compile(command_parts[script_index], "atomic-directory-exchange", "exec")

    def test_deploy_restores_public_permissions_for_static_web_files(self):
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertIn("find apps/web/out -type d -exec chmod 755", script)
        self.assertIn("find apps/web/out -type f -exec chmod 644", script)

    def test_deploy_configures_the_assistant_websocket_proxy(self):
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        guard = pathlib.Path(__file__).with_name("validate-studio-nginx.py").read_text(encoding="utf-8")
        self.assertIn("apply_studio_nginx(target, staging)", script)
        self.assertIn("/api/website-capture/assistant/ws", guard)
        self.assertIn("proxy_set_header Upgrade", guard)

    def test_agent_auth_probe_requires_each_route_to_reject_anonymous_requests(self):
        for status, body, expected_success in (
            (401, {"ok": False, "error": {"code": "unauthorized"}}, True),
            (404, {"message": "Route not found"}, False),
            (200, {"ok": True, "data": []}, False),
            (401, {"error": "unauthorized"}, False),
        ):
            with self.subTest(status=status, body=body):
                seen = []

                class Handler(http.server.BaseHTTPRequestHandler):
                    def do_GET(self):
                        seen.append(self.path)
                        self.send_response(status)
                        self.end_headers()
                        self.wfile.write(json.dumps(body).encode())

                    def log_message(self, *_args):
                        pass

                server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    probe = subprocess.run(
                        [sys.executable, "-c", self.deploy.AGENT_AUTH_PROBE, f"http://127.0.0.1:{server.server_port}"],
                        capture_output=True, text=True, timeout=15,
                    )
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()
                self.assertEqual(probe.returncode == 0, expected_success, probe.stderr)
                if expected_success:
                    self.assertEqual(seen, [f"/api/agent/{name}" for name in ("goals", "suggestions", "memories", "connectors")])

    def test_health_origin_ignores_health_path_and_rejects_credentials(self):
        self.assertEqual(self.deploy.health_origin("https://example.test/api/health"), "https://example.test")
        with self.assertRaises(ValueError):
            self.deploy.health_origin("https://user:password@example.test/api/health")

    def test_production_candidate_requires_the_marketplace_migration(self):
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertIn("20261026000000_agent_marketplace_catalog.sql", script)
        self.assertIn("20261026000001_desktop_agent_recovery.sql", script)
        self.assertIn("20261026000002_desktop_agent_chat_recovery.sql", script)
        self.assertIn("src/local-db/migrate.ts", script)
        self.assertIn("20261026000000_agent_marketplace_catalog.sql", script)


if __name__ == "__main__":
    unittest.main()
