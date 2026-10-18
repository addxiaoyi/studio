from __future__ import annotations

import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("validate-studio-nginx.py")
SPEC = importlib.util.spec_from_file_location("validate_studio_nginx", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NginxGuardTests(unittest.TestCase):
    def test_accepts_static_storyboard_payload(self) -> None:
        config = """
        location ~* /_next/.*\.txt$ { return 404; }
        location / { try_files $uri $uri/ $uri.html /index.html; }
        """
        self.assertEqual(MODULE.validate_config(config), [])

    def test_rejects_storyboard_payload_redirect(self) -> None:
        config = """
        location = /storyboard/index.txt {
            return 302 /storyboard/;
        }
        """
        self.assertIn("not redirected", MODULE.validate_config(config)[0])

    def test_rejects_broad_txt_block(self) -> None:
        config = r"""location ~* \.txt$ { return 404; }"""
        self.assertIn("broad .txt location", MODULE.validate_config(config)[0])


if __name__ == "__main__":
    unittest.main()
