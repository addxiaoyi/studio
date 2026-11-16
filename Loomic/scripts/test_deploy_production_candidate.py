import importlib.util
from contextlib import ExitStack, contextmanager
import hashlib
import http.server
import io
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
from scripts.test_prepare_production_candidate import write_creative_runtime


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
    @contextmanager
    def staged_deploy(self, folder, **options):
        root = "/srv/helstera"
        archive = pathlib.Path(folder) / "candidate.zip"
        archive.write_bytes(b"candidate")
        stage = root + "/.helstera-candidate.test"
        backup = root + "/.helstera-backup.test"
        source = root + "/.releases/stability-20261110-1"
        web = root + "/apps/web/out"
        args = types.SimpleNamespace(archive=archive, password_env="TEST_DEPLOY_PASSWORD", direct=True,
            resume_staging=None, resume_backup=None, root=root, target_host="example.test",
            target_user="test", health_url="https://example.test/api/health", **options)
        attempt = types.SimpleNamespace(args=args, stage=stage, backup=backup, source=source,
            shared=root + "/.server-runtime/packages/shared/dist",
            client=MagicMock(), commands=[], stdout=io.StringIO(), failure=None, backup_valid=False,
            parity_checks=0, parity_fail_after=None)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest().upper()
        rehearsal = pathlib.Path(__file__).with_name("isolated-pg-rehearsal.py")
        rehearsal_hash = hashlib.sha256(rehearsal.read_bytes()).hexdigest()

        def remote(_client, command, timeout=180):
            attempt.commands.append(command)
            if "prepared-code-verified" in command:
                attempt.parity_checks += 1
                if attempt.parity_checks == attempt.parity_fail_after:
                    raise RuntimeError("prepared code parity failed")
            if attempt.failure and attempt.failure in command:
                raise RuntimeError("fixture deployment command failed")
            if command == self.deploy.active_source_command(root):
                return json.dumps({"source": source, "web": web, "shared": attempt.shared, "stateSha256": None,
                    "active": {"api": "helstera-server-blue", "worker": "helstera-worker-blue",
                               "port": 3003, "web": web, "release": source}})
            if "mktemp -d" in command:
                return stage if ".helstera-candidate." in command else backup
            if "sha256sum" in command and "candidate.zip" in command:
                return digest
            if "sha256sum" in command and "isolated-pg-rehearsal.py" in command:
                return rehearsal_hash
            if "echo valid" in command and attempt.backup_valid:
                return "valid"
            return ""

        with ExitStack() as patches:
            patches.enter_context(patch.dict("os.environ", {"TEST_DEPLOY_PASSWORD": "test"}))
            patches.enter_context(patch.object(self.deploy.paramiko, "SSHClient", return_value=attempt.client))
            patches.enter_context(patch.object(self.deploy, "configure_ssh"))
            patches.enter_context(patch.object(self.deploy, "validate_candidate_archive"))
            attempt.jobs = patches.enter_context(patch.object(self.deploy, "active_jobs", return_value=[]))
            patches.enter_context(patch.object(self.deploy, "remote_run", side_effect=remote))
            attempt.restore = patches.enter_context(patch.object(self.deploy, "restore_backup"))
            attempt.nginx = patches.enter_context(patch.object(self.deploy, "apply_studio_nginx"))
            attempt.rollout = patches.enter_context(patch.object(self.deploy, "deploy_blue_green",
                return_value='{"phase":"committed"}'))
            patches.enter_context(patch("sys.stdout", attempt.stdout))
            yield attempt

    def test_prepare_only_cli_option_is_available(self):
        with patch.object(sys, "argv", ["deploy", "candidate.zip", "--prepare-only"]):
            args = self.deploy.parse_args()
        self.assertTrue(args.prepare_only)

    def test_prepare_only_finishes_isolated_rehearsal_and_preserves_the_candidate(self):
        with tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder, prepare_only=True) as attempt:
            self.deploy.deploy(attempt.args)
            lines = attempt.stdout.getvalue().splitlines()
            prepared = [json.loads(line.removeprefix("PREPARED ")) for line in lines if line.startswith("PREPARED ")]
            self.assertEqual(len(prepared), 1)
            self.assertEqual(prepared[0]["phase"], "prepared")
            self.assertEqual(prepared[0]["staging"], attempt.stage)
            self.assertEqual(prepared[0]["release"], attempt.stage + "/next")
            self.assertEqual(prepared[0]["backup"], attempt.backup)
            self.assertEqual(prepared[0]["databaseBackup"], attempt.backup + "/database.dump")
            self.assertEqual(prepared[0]["sha256"], hashlib.sha256(attempt.args.archive.read_bytes()).hexdigest().upper())
            self.assertTrue(prepared[0]["isolatedRestore"])
            self.assertIn("STAGING_PRESERVED " + attempt.stage, lines)
            self.assertFalse(any(line.startswith(("DEPLOYED ", "BLUE_GREEN ")) for line in lines))
            attempt.rollout.assert_not_called()
            attempt.restore.assert_not_called()
            attempt.nginx.assert_not_called()
            self.assertEqual(attempt.jobs.call_count, 2)
            sftp = attempt.client.open_sftp.return_value.__enter__.return_value
            sftp.put.assert_any_call(str(attempt.args.archive), attempt.stage + "/candidate.zip")
            sftp.put.assert_any_call(str(pathlib.Path(__file__).with_name("isolated-pg-rehearsal.py")),
                                     attempt.stage + "/isolated-pg-rehearsal.py")
            self.assertIn(self.deploy.active_source_command(attempt.args.root), attempt.commands)
            self.assertTrue(any("pg_dump --format=custom" in command for command in attempt.commands))
            backup = next(command for command in attempt.commands if "SOURCE-LAYOUT.json" in command)
            self.assertEqual(shlex.split(backup)[-4], attempt.source)
            self.assertTrue(any("prepared-base.json" in command for command in attempt.commands))
            runtime = next(index for index, command in enumerate(attempt.commands) if "CI=true pnpm install" in command)
            rehearsal = next(index for index, command in enumerate(attempt.commands) if "--bin-dir" in command)
            self.assertLess(runtime, rehearsal)
            self.assertIn(attempt.stage + "/next/apps/server", attempt.commands[rehearsal])
            for command in attempt.commands:
                self.assertFalse(any(action in command for action in (
                    "playwright install", "pm2 start", "pm2 stop", "pm2 restart", "nginx -s", "renameat2", "rm -rf")))

    def test_prepare_only_rejects_destructive_flags_before_connecting(self):
        for options in ({"allow_single_instance_outage": True}, {"superseded_backup": "/srv/helstera/.helstera-backup.old"}):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as folder, \
                 self.staged_deploy(folder, prepare_only=True, **options) as attempt:
                with self.assertRaisesRegex(ValueError, "--prepare-only"):
                    self.deploy.deploy(attempt.args)
                attempt.client.connect.assert_not_called()
                self.assertEqual(attempt.commands, [])

    def test_prepare_only_never_reports_success_after_a_failed_isolated_rehearsal(self):
        with tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder, prepare_only=True) as attempt:
            attempt.failure = "--bin-dir"
            with self.assertRaisesRegex(RuntimeError, "fixture deployment command failed"):
                self.deploy.deploy(attempt.args)
            attempt.rollout.assert_not_called()
            attempt.restore.assert_not_called()
            self.assertFalse(any(line.startswith(("PREPARED ", "DEPLOYED ")) for line in attempt.stdout.getvalue().splitlines()))
            self.assertFalse(any("playwright install" in command for command in attempt.commands))

    def test_prepare_only_respects_a_topology_refusal_before_upload(self):
        with tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder, prepare_only=True) as attempt:
            attempt.failure = self.deploy.active_source_command(attempt.args.root)
            with self.assertRaisesRegex(RuntimeError, "fixture deployment command failed"):
                self.deploy.deploy(attempt.args)
            attempt.client.open_sftp.assert_not_called()
            attempt.rollout.assert_not_called()
            self.assertFalse(any("mktemp -d" in command for command in attempt.commands))

    def test_production_uses_complete_trees_and_checks_parity_before_install_and_success(self):
        with tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder, prepare_only=True) as attempt, \
             patch.object(self.deploy, "prepare_candidate_command", wraps=self.deploy.prepare_candidate_command) as prepare:
            self.deploy.deploy(attempt.args)
            prepare.assert_called_once_with(attempt.args.root, attempt.stage, attempt.source,
                                            attempt.args.root + "/apps/web/out", attempt.shared, complete=True)
            checks = [index for index, command in enumerate(attempt.commands) if "prepared-code-verified" in command]
            self.assertEqual(len(checks), 2)
            install = next(index for index, command in enumerate(attempt.commands) if "CI=true pnpm install" in command)
            rehearsal = next(index for index, command in enumerate(attempt.commands) if "--bin-dir" in command)
            self.assertLess(checks[0], install)
            self.assertLess(rehearsal, checks[1])

    def test_initial_prepared_parity_failure_blocks_dependency_install(self):
        with tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder, prepare_only=True) as attempt:
            attempt.parity_fail_after = 1
            with self.assertRaisesRegex(RuntimeError, "prepared code parity failed"):
                self.deploy.deploy(attempt.args)
            self.assertFalse(any("CI=true pnpm install" in command for command in attempt.commands))
            self.assertFalse(any(line.startswith(("PREPARED ", "DEPLOYED ")) for line in attempt.stdout.getvalue().splitlines()))
            attempt.rollout.assert_not_called()

    def test_final_prepared_parity_failure_blocks_prepared_and_rollout(self):
        for prepare_only in (False, True):
            with self.subTest(prepare_only=prepare_only), tempfile.TemporaryDirectory() as folder, \
                 self.staged_deploy(folder, prepare_only=prepare_only) as attempt:
                attempt.parity_fail_after = 2
                with self.assertRaisesRegex(RuntimeError, "prepared code parity failed"):
                    self.deploy.deploy(attempt.args)
                self.assertTrue(any("CI=true pnpm install" in command for command in attempt.commands))
                self.assertFalse(any("playwright install" in command for command in attempt.commands))
                self.assertFalse(any(line.startswith(("PREPARED ", "DEPLOYED ")) for line in attempt.stdout.getvalue().splitlines()))
                attempt.rollout.assert_not_called()

    def test_resumed_occupied_candidate_is_preserved_when_complete_copy_is_refused(self):
        with tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder, prepare_only=True) as attempt:
            attempt.args.resume_staging = attempt.stage
            attempt.args.resume_backup = attempt.backup
            attempt.backup_valid = True
            attempt.failure = "complete-candidate-prepared"
            with self.assertRaisesRegex(RuntimeError, "fixture deployment command failed"):
                self.deploy.deploy(attempt.args)
            self.assertIn("STAGING_PRESERVED " + attempt.stage, attempt.stdout.getvalue().splitlines())
            self.assertFalse(any("rm -rf" in command for command in attempt.commands))
            attempt.rollout.assert_not_called()

    def test_prepare_only_backs_up_actual_shared_and_prepares_only_candidate_trees(self):
        with tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder, prepare_only=True) as attempt:
            self.deploy.deploy(attempt.args)
            backup = next(command for command in attempt.commands if "SOURCE-LAYOUT.json" in command)
            self.assertEqual(shlex.split(backup)[-1], attempt.shared)
            preparation = next(command for command in attempt.commands if "complete-candidate-prepared" in command)
            self.assertNotIn(attempt.shared, preparation)
            self.assertNotIn(attempt.source, preparation)
            self.assertIn("prepare_complete_candidate", preparation)

    def test_resumed_backup_with_unverified_shared_is_refused_without_replacing_it(self):
        with tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder, prepare_only=True) as attempt:
            attempt.args.resume_backup = attempt.backup
            attempt.backup_valid = True
            attempt.failure = "Resumed backup provenance"
            with self.assertRaisesRegex(RuntimeError, "fixture deployment command failed"):
                self.deploy.deploy(attempt.args)
            self.assertFalse(any("pg_dump --format=custom" in command or "'w:gz'" in command for command in attempt.commands))
            self.assertFalse(any(line.startswith("PREPARED ") for line in attempt.stdout.getvalue().splitlines()))
            attempt.rollout.assert_not_called()

    def test_committed_release_with_incomplete_retirement_is_not_reported_as_deployed(self):
        for cleanup_error in ("previous API has unfinished requests", ""):
            with self.subTest(cleanup_error=cleanup_error), tempfile.TemporaryDirectory() as folder, self.staged_deploy(folder) as attempt:
                attempt.rollout.return_value = json.dumps({"phase": "committed", "cleanupError": cleanup_error})
                with self.assertRaisesRegex(RuntimeError, "committed.*retirement.*incomplete"):
                    self.deploy.deploy(attempt.args)
                lines = attempt.stdout.getvalue().splitlines()
                incomplete = [json.loads(line.removeprefix("RETIREMENT_INCOMPLETE "))
                              for line in lines if line.startswith("RETIREMENT_INCOMPLETE ")]
                self.assertEqual(len(incomplete), 1)
                self.assertEqual(incomplete[0]["phase"], "committed")
                self.assertEqual(incomplete[0]["cleanupError"], cleanup_error)
                self.assertEqual(incomplete[0]["staging"], attempt.stage)
                self.assertFalse(any(line.startswith("DEPLOYED ") for line in lines))
                self.assertIn("STAGING_PRESERVED " + attempt.stage, lines)
                attempt.restore.assert_not_called()
                self.assertFalse(any("pm2 restart" in command or "rm -rf" in command for command in attempt.commands))

    def test_valid_manifest_does_not_hide_a_missing_or_unreviewed_web_runtime(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source, build = root / "source", root / "build"
            write_creative_runtime(source, build)
            output = build / "apps/web/out"
            for relative in ("index.html", "video/index.html", "fashion-gallery/index.html"):
                path = output / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("page shell", encoding="utf-8")
            files = {"apps/web/out/" + path.relative_to(output).as_posix(): path.read_bytes()
                     for path in output.rglob("*") if path.is_file()}
            archive = root / "candidate.zip"

            def package(contents):
                manifest = {"files": {name: {"sha256": hashlib.sha256(body).hexdigest()} for name, body in contents.items()}}
                with zipfile.ZipFile(archive, "w") as bundle:
                    for name, body in contents.items():
                        bundle.writestr(name, body)
                    bundle.writestr("RELEASE-MANIFEST.json", json.dumps(manifest))

            with patch.object(self.deploy, "PROJECT_ROOT", source):
                package({"apps/web/out/index.html": b"page shell"})
                with self.assertRaisesRegex(ValueError, "Archived creative runtime is missing"):
                    self.deploy.validate_candidate_archive(archive)
                package(files)
                self.deploy.validate_candidate_archive(archive)
                del files["apps/web/out/creative/visualforge/browser-studio-worker.mjs"]
                package(files)
                with self.assertRaisesRegex(ValueError, "Archived creative runtime is missing"):
                    self.deploy.validate_candidate_archive(archive)
                files["apps/web/out/creative/visualforge/browser-studio-worker.mjs"] = b"worker"
                files["apps/web/out/creative/visualforge/source.json"] = b'{"repository":"wrong","commit":"wrong"}'
                package(files)
                with self.assertRaisesRegex(ValueError, "does not match the pinned source"):
                    self.deploy.validate_candidate_archive(archive)

    def test_resumed_files_are_checked_against_the_original_archive_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            archive = root / "candidate.zip"
            target = root / "candidate/apps/server/src/app.ts"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"reviewed source")
            manifest = {"files": {"apps/server/src/app.ts": {"sha256": hashlib.sha256(target.read_bytes()).hexdigest()}}}
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("apps/server/src/app.ts", target.read_bytes())
                bundle.writestr("RELEASE-MANIFEST.json", json.dumps(manifest))
            (root / "candidate/RELEASE-MANIFEST.json").write_text(json.dumps(manifest), encoding="utf-8")
            command = shlex.split(self.deploy.verify_candidate_tree_command(str(root)))
            checked = subprocess.run([sys.executable, *command[1:]], capture_output=True, text=True)
            self.assertEqual(checked.returncode, 0, checked.stderr)
            self.assertIn("candidate-files-verified", checked.stdout)
            target.write_bytes(b"stale extracted source")
            checked = subprocess.run([sys.executable, *command[1:]], capture_output=True, text=True)
            self.assertNotEqual(checked.returncode, 0)
            self.assertIn("Candidate staging SHA-256 mismatch", checked.stderr)

    def test_resume_checks_downloads_and_rejects_extra_source_modules(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            archive, stage = root / "candidate.zip", root / "candidate"
            name = "apps/web/out/downloads/desktop-release-windows-x64.json"
            target = stage / name
            target.parent.mkdir(parents=True)
            target.write_bytes(b"reviewed manifest")
            manifest = {"files": {name: {"sha256": hashlib.sha256(target.read_bytes()).hexdigest()}}}
            manifest_bytes = json.dumps(manifest).encode()
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr(name, target.read_bytes())
                bundle.writestr("RELEASE-MANIFEST.json", manifest_bytes)
            (stage / "RELEASE-MANIFEST.json").write_bytes(manifest_bytes)
            target.write_bytes(b"different manifest")
            with self.assertRaisesRegex(ValueError, "Candidate staging SHA-256 mismatch"):
                self.deploy.verify_candidate_tree(archive, stage)
            target.write_bytes(b"reviewed manifest")
            (stage / "unreviewed.js").write_bytes(b"module")
            with self.assertRaisesRegex(ValueError, "Unreviewed file"):
                self.deploy.verify_candidate_tree(archive, stage)

    def test_resume_allows_only_matching_live_download_additions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            archive, stage, live = root / "candidate.zip", root / "candidate", root / "live"
            stage.mkdir()
            manifest = b'{"files": {}}'
            (stage / "RELEASE-MANIFEST.json").write_bytes(manifest)
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("RELEASE-MANIFEST.json", manifest)
            target = stage / "apps/web/out/downloads/Helstera.exe"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"live installer")
            (live / "downloads").mkdir(parents=True)
            (live / "downloads/Helstera.exe").write_bytes(b"live installer")
            self.deploy.verify_candidate_tree(archive, stage, live)
            target.write_bytes(b"tampered installer")
            with self.assertRaisesRegex(ValueError, "Inherited download differs"):
                self.deploy.verify_candidate_tree(archive, stage, live)

    def test_default_health_gate_uses_dependency_readiness(self):
        self.assertEqual(self.deploy.DEFAULT_HEALTH_URL, "https://studio.0st.top/api/health/ready")

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

    def test_blue_green_helpers_are_verified_before_remote_execution(self):
        target = MagicMock()
        staging = "/srv/helstera/.helstera-candidate.test"
        with patch.object(self.deploy, "remote_run", return_value="wrong") as remote:
            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                self.deploy.deploy_blue_green(target, "/srv/helstera", staging, "https://studio.test/api/health")
        self.assertEqual(remote.call_count, 1)
        scripts = pathlib.Path(__file__).parent
        hashes = [hashlib.sha256((scripts / name).read_bytes()).hexdigest() for name in
                  ("blue-green-release.py", "switch-server-upstream.py", "validate-studio-nginx.py", "release-topology.py")]
        with patch.object(self.deploy, "remote_run", side_effect=[*hashes, '{"phase":"committed"}']) as remote:
            self.deploy.deploy_blue_green(target, "/srv/helstera", staging, "https://studio.test/api/health")
        self.assertIn("blue-green-release.py", remote.call_args.args[1])
        self.assertEqual(remote.call_args.kwargs["timeout"], 5400)

    def test_default_rollout_uses_host_transaction_and_never_stops_legacy_api(self):
        for failure in (False, True):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                archive = pathlib.Path(folder) / "candidate.zip"
                archive.write_bytes(b"candidate")
                digest = hashlib.sha256(archive.read_bytes()).hexdigest().upper()
                root = "/srv/helstera"
                stage = root + "/.helstera-candidate.test"
                backup = root + "/.helstera-backup.test"
                calls = []
                target = MagicMock()
                args = types.SimpleNamespace(archive=archive, password_env="TEST_DEPLOY_PASSWORD", direct=True,
                    resume_staging=None, resume_backup=None, root=root, target_host="example.test",
                    target_user="test", health_url="https://example.test/api/health")

                def remote(_client, command, timeout=180):
                    calls.append(command)
                    if "stateSha256" in command and "python3 -c" in command:
                        return json.dumps({"source": root, "web": root + "/apps/web/out",
                                           "shared": root + "/packages/shared/dist", "stateSha256": None})
                    if "mktemp -d" in command:
                        return stage if ".helstera-candidate." in command else backup
                    if "sha256sum" in command and "candidate.zip" in command:
                        return digest
                    return ""

                with patch.dict("os.environ", {"TEST_DEPLOY_PASSWORD": "test"}), \
                     patch.object(self.deploy.paramiko, "SSHClient", return_value=target), \
                     patch.object(self.deploy, "configure_ssh"), \
                     patch.object(self.deploy, "validate_candidate_archive"), \
                     patch.object(self.deploy, "active_jobs", return_value=[]), \
                     patch.object(self.deploy, "remote_run", side_effect=remote), \
                     patch.object(self.deploy, "restore_backup") as restore, \
                     patch.object(self.deploy, "deploy_blue_green", side_effect=RuntimeError("host transaction failed") if failure else None,
                                  return_value='{"phase":"committed"}') as rollout:
                    if failure:
                        with self.assertRaisesRegex(RuntimeError, "host transaction failed"):
                            self.deploy.deploy(args)
                    else:
                        self.deploy.deploy(args)
                rollout.assert_called_once_with(target, root, stage, args.health_url)
                restore.assert_not_called()
                self.assertFalse(any("pm2 stop" in command or "pm2 restart" in command for command in calls))
                self.assertFalse(any("renameat2" in command or "rm -rf" in command for command in calls))

    def test_candidate_can_overlay_the_active_version_instead_of_the_legacy_tree(self):
        active = "/srv/helstera/.helstera-candidate.previous/next"
        command = self.deploy.prepare_candidate_command("/srv/helstera", "/srv/helstera/.helstera-candidate.next", active)
        self.assertIn(active + "/apps/server/src", command)
        self.assertNotIn("cp -a /srv/helstera/apps/server/src", command)

    def test_versioned_backup_uses_actual_code_and_separate_web_roots(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source, web, backup = root / "active", root / "public", root / "backup"
            for relative in ("apps/server/src", "packages/shared/dist"):
                path = source / relative
                path.mkdir(parents=True)
                (path / "version").write_text("active-version")
            for relative in ("apps/server/package.json", "apps/server/tsconfig.json"):
                (source / relative).write_text("{}")
            web.mkdir()
            (web / "index.html").write_text("actual-online-web")
            backup.mkdir()
            command = self.deploy.versioned_backup_command(str(source), str(web), str(backup))
            script = shlex.split(command)[2]
            subprocess.run([sys.executable, "-c", script, str(source), str(web), str(backup)], check=True)
            with tarfile.open(backup / "current.tgz") as archive:
                self.assertEqual(archive.extractfile("apps/web/out/index.html").read(), b"actual-online-web")
                self.assertEqual(archive.extractfile("apps/server/src/version").read(), b"active-version")
                self.assertEqual(json.load(archive.extractfile("SOURCE-LAYOUT.json"))["source"], str(source))

    def test_versioned_backup_archives_the_resolved_runtime_shared_not_stale_root_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source, web, backup = root / ".releases/active", root / "public", root / "backup"
            (source / "apps/server/src").mkdir(parents=True)
            (source / "apps/server/src/server.ts").write_bytes(b"active-server")
            for name in ("package.json", "tsconfig.json"):
                (source / "apps/server" / name).write_text("{}")
            shared = root / ".server-runtime/packages/shared/dist"
            shared.mkdir(parents=True)
            (shared / "index.js").write_bytes(b"actually-loaded-shared")
            stale = root / "packages/shared/dist"
            stale.mkdir(parents=True)
            (stale / "index.js").write_bytes(b"stale-root-shared")
            web.mkdir()
            (web / "index.html").write_bytes(b"online-web")
            backup.mkdir()
            command = self.deploy.versioned_backup_command(str(source), str(web), str(backup), shared_root=str(shared))
            subprocess.run([sys.executable, *shlex.split(command)[1:]], check=True)
            with tarfile.open(backup / "current.tgz") as archive:
                self.assertEqual(archive.extractfile("packages/shared/dist/index.js").read(), b"actually-loaded-shared")
                self.assertEqual(archive.getnames().count("packages/shared/dist/index.js"), 1)
                self.assertEqual(json.load(archive.extractfile("SOURCE-LAYOUT.json"))["shared"], str(shared))

    def test_resumed_backup_requires_matching_provenance_and_a_shared_entry(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source, web, backup = root / ".releases/active", root / "public", root / "backup"
            shared = root / ".server-runtime/packages/shared/dist"
            backup.mkdir()
            layout = {"source": str(source), "web": str(web), "shared": str(shared)}
            cases = [
                (layout, True, True),
                ({key: value for key, value in layout.items() if key != "shared"}, True, False),
                ({**layout, "shared": str(root / "packages/shared/dist")}, True, False),
                ({**layout, "source": str(root / "other-release")}, True, False),
                ({**layout, "web": str(root / "other-web")}, True, False),
                (layout, False, False),
            ]
            command = self.deploy.verify_versioned_backup_command(str(source), str(web), str(backup), str(shared))
            for provenance, has_shared, accepted in cases:
                with self.subTest(provenance=provenance, has_shared=has_shared):
                    with tarfile.open(backup / "current.tgz", "w:gz") as archive:
                        entries = {"SOURCE-LAYOUT.json": json.dumps(provenance).encode()}
                        if has_shared:
                            entries["packages/shared/dist/index.js"] = b"actual-runtime"
                        for name, content in entries.items():
                            member = tarfile.TarInfo(name)
                            member.size = len(content)
                            archive.addfile(member, io.BytesIO(content))
                    checked = subprocess.run([sys.executable, *shlex.split(command)[1:]], capture_output=True, text=True)
                    self.assertEqual(checked.returncode == 0, accepted, checked.stderr)
                    if not accepted:
                        self.assertIn("Resumed backup", checked.stderr)

    def test_candidate_preparation_uses_actual_shared_before_overlays_without_nesting_dist(self):
        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe") if sys.platform == "win32" else pathlib.Path("/bin/bash")
        if not bash.is_file():
            self.skipTest("bash is not installed")
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source, stage = root / ".releases/active", root / ".helstera-candidate.test"
            shared = root / ".server-runtime/packages/shared/dist"
            candidate_shared = stage / "candidate/packages/shared/dist"
            for directory in (source / "apps/server/src", stage / "candidate/apps/server/src", shared, candidate_shared):
                directory.mkdir(parents=True)
            (shared / "index.js").write_bytes(b"actually-loaded-shared")
            (shared / "legacy.js").write_bytes(b"actual-runtime-only")
            (candidate_shared / "index.js").write_bytes(b"candidate-overlay")
            stale = root / "packages/shared/dist"
            stale.mkdir(parents=True)
            (stale / "stale.js").write_bytes(b"must-not-be-copied")

            def posix(path):
                return "/" + path.drive[0].lower() + path.as_posix()[2:] if sys.platform == "win32" else path.as_posix()

            command = self.deploy.prepare_candidate_command(posix(root), posix(stage), posix(source),
                                                            shared_root=posix(shared)).split("mkdir -p $next/deploy", 1)[0]
            for _ in range(2):
                subprocess.run([str(bash), "-c", command], check=True)
            prepared = stage / "next/packages/shared/dist"
            self.assertEqual((prepared / "index.js").read_bytes(), b"candidate-overlay")
            self.assertEqual((prepared / "legacy.js").read_bytes(), b"actual-runtime-only")
            self.assertFalse((prepared / "stale.js").exists())
            self.assertFalse((prepared / "dist").exists())

    def test_public_asset_preservation_does_not_duplicate_installer_bytes_or_overwrite_candidate(self):
        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe") if sys.platform == "win32" else pathlib.Path("/bin/bash")
        if not bash.is_file():
            self.skipTest("bash is not installed")
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            web, candidate = root / "live", root / "candidate"
            (web / "downloads").mkdir(parents=True)
            (candidate / "downloads").mkdir(parents=True)
            installer = web / "downloads/Helstera.exe"
            installer.write_bytes(b"immutable installer")
            (web / "downloads/channel.json").write_bytes(b"previous")
            (candidate / "downloads/channel.json").write_bytes(b"candidate")

            def posix(path):
                return "/" + path.drive[0].lower() + path.as_posix()[2:] if sys.platform == "win32" else path.as_posix()

            command = self.deploy.preserve_public_assets_command(posix(web), posix(candidate), "downloads")
            subprocess.run([str(bash), "-c", command], check=True)
            self.assertTrue(installer.samefile(candidate / "downloads/Helstera.exe"))
            self.assertEqual((candidate / "downloads/channel.json").read_bytes(), b"candidate")

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

    def test_release_preflight_accounts_for_candidate_and_database_copies(self):
        command = self.deploy.release_space_preflight_command("/www/helstera", 128 * 1024 * 1024)
        self.assertIn("statvfs", command)
        remote_check = shlex.split(command.rsplit("python3 -c ", 1)[1])[0]
        compile(remote_check, "<release-space-preflight>", "exec")
        self.assertIn('("business", root, candidate * 2 + db_size * 1, 536870912)', command)
        self.assertIn("pg_database_size(current_database())", command)
        self.assertIn("show data_directory", command)
        self.assertIn("storage_root=${STORAGE_ROOT:-$PWD/uploads}", command)
        self.assertIn("media_root=\"$storage_root/.media-tmp\"", command)
        self.assertIn('("system", system, 0, 2147483648)', command)
        self.assertIn('("media", media, 0, 2147483648)', command)
        isolated = self.deploy.release_space_preflight_command("/www/helstera", 128 * 1024 * 1024, isolated=True)
        self.assertIn('("business", root, candidate * 2 + db_size * 2, 1073741824)', isolated)
        with self.assertRaises(ValueError):
            self.deploy.release_space_preflight_command("/www/helstera", 0)
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertLess(script.index('print("RELEASE_SPACE"'), script.index('mktemp -d'))
        self.assertLess(script.index('print("RELEASE_SPACE_PRE_SWAP"'), script.index("replacement_started = True"))

    def test_release_preflight_sums_allocations_and_keeps_the_largest_reserve_per_device(self):
        from types import SimpleNamespace

        devices = {"root": 1, "database": 1, "media": 2}
        available = {"root": 18, "database": 19, "media": 12}
        stat_fn = lambda path: SimpleNamespace(st_dev=devices[path])
        statvfs_fn = lambda path: SimpleNamespace(f_bavail=available[path], f_frsize=1)

        reports = self.deploy.aggregate_release_space(
            [("business", "root", 7, 3), ("database", "database", 5, 8), ("media", "media", 4, 10)],
            stat_fn,
            statvfs_fn,
        )

        self.assertEqual(reports, [
            {"labels": ["business", "database"], "path": "root", "available": 18, "required": 20, "allocated": 12, "reserve": 8},
            {"labels": ["media"], "path": "media", "available": 12, "required": 14, "allocated": 4, "reserve": 10},
        ])

    def test_release_capacity_reads_data_directory_as_verified_local_admin(self):
        command = self.deploy.release_space_preflight_command('/www/helstera', 1024, isolated=True)
        self.assertNotIn('data_dir=$(psql "$DATABASE_URL"', command)
        self.assertIn('data_dir=$(runuser -u postgres -- psql', command)
        for guard in ('app_identity', 'local_identity', 'PGHOSTADDR', 'hostaddr'):
            self.assertIn(guard, command)

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
                allow_single_instance_outage=True,
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
                allow_single_instance_outage=True,
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
                allow_single_instance_outage=True,
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
        self.assertIn("--filter @helstera/server...", command)

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

    def test_candidate_runtime_keeps_the_pnpm_store_on_the_candidate_filesystem(self):
        for staging in ("/srv/helstera/.helstera-candidate.test",
                        "/business disk/helstera/.helstera-candidate.release's $build;candidate"):
            with self.subTest(staging=staging):
                command = self.deploy.prepare_candidate_runtime_command(staging)
                install = command.split("CI=true pnpm install ", 1)[1].split("); ", 1)[0]
                arguments = shlex.split(install)
                self.assertIn("--store-dir", arguments)
                self.assertEqual(arguments[arguments.index("--store-dir") + 1], staging + "/next/.pnpm-store")
                self.assertIn("--frozen-lockfile", arguments)
                self.assertIn("--ignore-scripts", arguments)

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
        for module in (
            "20261114000006_approval_context_scope.sql", "20261114000007_reservation_approval.sql",
            "features/generation/confirmed-generation.ts", "features/jobs/generation-replay.ts", "runtime/canceled-refund-recovery.ts",
        ):
            self.assertIn(module, script)
        self.assertIn("apps/server/src/http/agent-memory.ts", script)
        self.assertIn("apps/server/src/http/agent-connectors.ts", script)
        self.assertIn("apps/server/src/agent/workspace-skills.ts", script)
        self.assertIn("deploy/server-runtime/pnpm-lock.yaml", script)
        self.assertNotIn("tsc -p {stage}/next/apps/server/tsconfig.json", script)
        self.assertIn("cd deploy/server-runtime && CI=true pnpm install --frozen-lockfile --ignore-scripts --no-prod --filter @helstera/server...", script)
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
            "apps/server/src/local-db/migrations/20261112000000_agent_run_leases.sql",
            "apps/server/src/local-db/migrations/20261114000000_job_cancel_requests.sql",
            "apps/server/src/local-db/migrations/20261114000001_generation_settlements.sql",
            "apps/server/src/local-db/migrations/20261114000002_approval_pricing.sql",
            "apps/server/src/local-db/migrations/20261114000003_settlement_review.sql",
            "apps/server/src/local-db/migrations/20261114000004_reservation_pricing.sql",
            "apps/server/src/local-db/migrations/20261114000005_paid_job_admission.sql",
            "apps/server/src/local-db/generation-reservation.ts",
            "apps/server/src/features/jobs/settlement-review.ts",
            "apps/server/src/features/generation/pricing-snapshot.ts",
            "apps/server/src/local-db/generation-settlement.ts",
            "apps/server/src/runtime/billing-reconciliation.ts",
            "apps/server/src/local-db/agent-run-service.ts",
            "apps/server/src/runtime/drain-gate.ts",
            "apps/server/src/runtime/process-receipt.ts",
            "apps/server/src/runtime/queue-runner.ts",
            "apps/server/src/ws/handler.ts",
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
