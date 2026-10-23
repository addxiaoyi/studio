import importlib.util
import pathlib
import sys
import types
import unittest


class FakeSSHClient:
    def __init__(self):
        self.loaded = False
        self.policy = None

    def load_system_host_keys(self):
        self.loaded = True

    def set_missing_host_key_policy(self, policy):
        self.policy = policy


class DeployCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fake_paramiko = types.ModuleType("paramiko")
        fake_paramiko.SSHClient = FakeSSHClient
        fake_paramiko.RejectPolicy = lambda: "reject"
        sys.modules.setdefault("paramiko", fake_paramiko)
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
        self.assertIn("/candidate/", command)
        self.assertIn("next=/srv/helstera/.helstera-candidate.abc123/next", command)
        self.assertNotIn("rm -rf", command)
        self.assertNotIn("mv ", command)

    def test_live_replacement_is_a_separate_rollback_guarded_phase(self):
        command = self.deploy.replace_live_command(
            "/srv/helstera",
            "/srv/helstera/.helstera-candidate.abc123",
        )
        self.assertIn("rm -rf apps/server/src apps/web/out packages/shared/dist", command)
        self.assertIn("/next/apps/server/src", command)

    def test_production_candidate_requires_both_additive_desktop_migrations(self):
        script = pathlib.Path(__file__).with_name("deploy-production-candidate.py").read_text(encoding="utf-8")
        self.assertIn("20261024000000_cloud_asset_retention_3_days.sql", script)
        self.assertIn("20261023000001_desktop_mcp_tool_calls.sql", script)
        self.assertIn("20261023000002_desktop_agent_canvas_link.sql", script)


if __name__ == "__main__":
    unittest.main()
