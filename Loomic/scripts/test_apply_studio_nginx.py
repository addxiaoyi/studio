import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("apply_studio_nginx", HERE / "apply-studio-nginx.py")
assert SPEC and SPEC.loader
APPLY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APPLY)

ORIGINAL = """server {
    location /api/ { proxy_pass http://127.0.0.1:3000; }
    location / { try_files $uri $uri/ $uri.html /index.html; }
}
"""


class ApplyStudioNginxTests(unittest.TestCase):
    def test_apply_and_restore_on_reload_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "studio.conf"
            config.write_text(ORIGINAL, encoding="utf-8")

            def write(path, content, mode, uid, gid):
                path.write_bytes(content)

            with patch.object(APPLY, "atomic_write", side_effect=write), \
                 patch.object(APPLY.subprocess, "run") as run:
                APPLY.apply(config, HERE / "validate-studio-nginx.py")
            updated = config.read_text(encoding="utf-8")
            self.assertIn("location = /api/assets/private-video", updated)
            self.assertIn("location /api/website-capture/assistant/ws", updated)
            self.assertIn("=404;", updated)
            self.assertEqual(run.call_count, 2)

            config.write_text(ORIGINAL, encoding="utf-8")
            with patch.object(APPLY, "atomic_write", side_effect=write), \
                 patch.object(APPLY.subprocess, "run", side_effect=[None, subprocess.CalledProcessError(1, "reload"), None, None]):
                with self.assertRaises(subprocess.CalledProcessError):
                    APPLY.apply(config, HERE / "validate-studio-nginx.py")
            self.assertEqual(config.read_text(encoding="utf-8"), ORIGINAL)

    def test_invalid_config_is_not_written(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "studio.conf"
            config.write_text("server {}", encoding="utf-8")
            with patch.object(APPLY, "atomic_write") as write:
                with self.assertRaises(ValueError):
                    APPLY.apply(config, HERE / "validate-studio-nginx.py")
            write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
