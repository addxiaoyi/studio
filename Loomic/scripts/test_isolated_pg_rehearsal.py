import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("rehearsal", Path(__file__).with_name("isolated-pg-rehearsal.py"))
rehearsal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearsal)


class RehearsalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pgtest-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.dump = self.base / "dump"
        self.dump.touch()
        self.server = self.base / "server"
        (self.server / "src/local-db").mkdir(parents=True)
        (self.server / "src/local-db/migrate.ts").touch()
        self.bins = self.base / "bin"
        self.bins.mkdir()

    def test_rejects_mismatched_database_before_restore(self):
        commands = []
        with patch.object(rehearsal.os, "geteuid", return_value=0), \
             patch.object(rehearsal.os, "chown"), \
             patch.object(rehearsal.pwd, "getpwnam", return_value=types.SimpleNamespace(pw_uid=1, pw_gid=1)), \
             patch.object(rehearsal, "run", side_effect=lambda cmd, **kwargs: commands.append(cmd)), \
             patch.object(rehearsal.subprocess, "check_output", return_value="/production/data\n"):
            with self.assertRaisesRegex(RuntimeError, "identity"):
                rehearsal.rehearse(self.base, self.dump, self.server, self.bins)
        self.assertFalse(any("pg_restore" in " ".join(cmd) for cmd in commands))
        self.assertFalse(list(self.base.glob(".loomic-pg-rehearsal-*")))

    def test_failed_start_with_pid_retains_data_if_stop_fails(self):
        def run(cmd, **kwargs):
            if "start" in cmd:
                data = Path(cmd[cmd.index("-D") + 1])
                data.mkdir()
                (data / "postmaster.pid").touch()
                raise RuntimeError("start failed")
            if "stop" in cmd:
                raise RuntimeError("stop failed")

        with patch.object(rehearsal.os, "geteuid", return_value=0), \
             patch.object(rehearsal.os, "chown"), \
             patch.object(rehearsal.pwd, "getpwnam", return_value=types.SimpleNamespace(pw_uid=1, pw_gid=1)), \
             patch.object(rehearsal, "run", side_effect=run):
            with self.assertRaisesRegex(RuntimeError, "stop failed"):
                rehearsal.rehearse(self.base, self.dump, self.server, self.bins)
        self.assertEqual(len(list(self.base.glob(".loomic-pg-rehearsal-*"))), 1)

    def test_migration_receives_only_isolated_database_environment(self):
        commands = []

        def run(cmd, **kwargs):
            commands.append((cmd, dict(kwargs.get("env", {}))))

        def output(cmd, **kwargs):
            if "show data_directory" in cmd[-1]:
                return str(next(self.base.glob(".loomic-pg-rehearsal-*")) / "data") + "\n"
            return "t\n"

        with patch.object(rehearsal.os, "geteuid", return_value=0), \
             patch.object(rehearsal.os, "chown"), \
             patch.object(rehearsal.os, "environ", {"PATH": "/usr/bin", "PGHOSTADDR": "192.0.2.1", "SECRET": "private"}), \
             patch.object(rehearsal.pwd, "getpwnam", return_value=types.SimpleNamespace(pw_uid=1, pw_gid=1)), \
             patch.object(rehearsal, "run", side_effect=run), \
             patch.object(rehearsal.subprocess, "check_output", side_effect=output):
            rehearsal.rehearse(self.base, self.dump, self.server, self.bins)

        cmd, env = next((cmd, env) for cmd, env in commands if cmd[0] == "node")
        self.assertFalse(any(arg.startswith("--env-file") for arg in cmd))
        self.assertNotIn("PGHOSTADDR", env)
        self.assertNotIn("SECRET", env)
        self.assertIn("host=%2F", env["DATABASE_URL"])


if __name__ == "__main__":
    unittest.main()
