import importlib.util
import pathlib
import shlex
import sys
import types
import unittest


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
        self.assertIn("apps/server/src/agent/workspace-skills.ts", script)
        self.assertIn("deploy/server-runtime/pnpm-lock.yaml", script)
        self.assertNotIn("tsc -p {stage}/next/apps/server/tsconfig.json", script)
        self.assertIn("CI=true pnpm --dir .server-runtime install --frozen-lockfile --ignore-scripts --no-prod", script)
        self.assertIn("apps/server/node_modules", script)

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
        self.assertIn("/api/website-capture/assistant/ws", script)
        self.assertIn("proxy_set_header Upgrade", script)

    def test_production_candidate_requires_the_marketplace_migration(self):
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertIn("20261026000000_agent_marketplace_catalog.sql", script)
        self.assertIn("20261026000001_desktop_agent_recovery.sql", script)
        self.assertIn("20261026000002_desktop_agent_chat_recovery.sql", script)
        self.assertIn("src/local-db/migrate.ts", script)
        self.assertIn("20261026000000_agent_marketplace_catalog.sql", script)


if __name__ == "__main__":
    unittest.main()
