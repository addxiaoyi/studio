import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location(
    "inspect_website_release", Path(__file__).with_name("inspect-website-release.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class InspectWebsiteReleaseTests(unittest.TestCase):
    def test_failed_stability_check_cannot_report_success(self):
        calls = []
        client, proxy = Mock(), Mock()

        def run(_client, command, timeout=60):
            calls.append(command)
            if command == "nginx -t":
                raise RuntimeError("invalid configuration")
            return "[]" if command == "pm2 jlist" else "ok"

        output = io.StringIO()
        with patch.object(MODULE, "connect", return_value=(client, proxy)), \
             patch.object(MODULE, "run", side_effect=run), \
             patch.object(sys, "argv", ["inspect-website-release.py", "stability"]), \
             contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, "stability checks failed: nginx"):
                MODULE.main()

        self.assertIn("CHECK_FAILED nginx", output.getvalue())
        self.assertEqual(len(calls), 5)
        client.close.assert_called_once()
        proxy.close.assert_called_once()

    def test_stability_mode_is_read_only_and_does_not_probe_provider_secrets(self):
        calls = []

        def run(_client, command, timeout=60):
            calls.append((command, timeout))
            if command == "pm2 jlist":
                return json.dumps([
                    {"name": "helstera-server", "pid": 12, "pm2_env": {"status": "online", "pm_cwd": "/www/helstera/apps/server"}},
                    {"name": "helstera-worker", "pid": 13, "pm2_env": {"status": "online", "pm_cwd": "/www/helstera/apps/server"}},
                ])
            return "ok"

        output = io.StringIO()
        with patch.object(MODULE, "connect", return_value=(Mock(), Mock())), \
             patch.object(MODULE, "run", side_effect=run), \
             patch.object(sys, "argv", ["inspect-website-release.py", "stability"]), \
             contextlib.redirect_stdout(output):
            MODULE.main()

        text = output.getvalue()
        self.assertIn("DF ok", text)
        self.assertIn('PM2 [{"name": "helstera-server"', text)
        self.assertIn("NGINX ok", text)
        self.assertIn("PYTHON3 ok", text)
        self.assertNotIn("DATABASE", text)
        self.assertNotIn("PROBE", text)
        self.assertEqual([command for command, _ in calls][:3], [
            "df -P / /www /www/helstera /var/lib/postgresql",
            "pm2 jlist",
            "nginx -t",
        ])


if __name__ == "__main__":
    unittest.main()
