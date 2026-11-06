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
    def test_video_isolation_is_scoped_idempotent_and_rejects_conflicts(self) -> None:
        original = "server {\n    location / { try_files $uri $uri/ =404; }\n}"
        updated = MODULE.prepare_creative_isolation(original)
        self.assertEqual(MODULE.prepare_creative_isolation(updated), updated)
        self.assertEqual(updated.count('Cross-Origin-Embedder-Policy "credentialless" always;'), 3)
        self.assertIn("application/wasm wasm", updated)
        self.assertIn("location / { try_files $uri $uri/ =404; }", updated)
        with self.assertRaisesRegex(ValueError, "manual isolation"):
            MODULE.prepare_creative_isolation(original.replace("server {", "server {\nlocation /video/ { return 200; }"))

    def test_accepts_static_storyboard_payload(self) -> None:
        config = """
        location ~* /_next/.*\.txt$ { return 404; }
        location / { try_files $uri $uri/ $uri.html =404; }
        """
        self.assertEqual(MODULE.validate_config(config), [])

    def test_rejects_homepage_fallback_for_missing_routes(self) -> None:
        config = "location / { try_files $uri $uri/ $uri.html /index.html; }"
        self.assertIn("HTTP 200 for missing routes", MODULE.validate_config(config)[0])

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

    def test_private_video_requires_streaming_and_multipart_headroom(self) -> None:
        config = """
        location = /api/assets/private-video {
            client_max_body_size 251m;
            proxy_request_buffering off;
            proxy_http_version 1.1;
            proxy_pass http://127.0.0.1:3000;
        }
        """
        self.assertEqual(MODULE.validate_private_video_upload(config), [])
        self.assertTrue(MODULE.validate_private_video_upload(config.replace("251m", "60m")))
        self.assertTrue(MODULE.validate_private_video_upload(config.replace("buffering off", "buffering on")))
        self.assertTrue(MODULE.validate_private_video_upload(config.replace("3000;", "3000/;")))
        self.assertTrue(MODULE.validate_private_video_upload(config + config))
        self.assertTrue(MODULE.validate_private_video_upload("location /api/ { proxy_pass http://127.0.0.1:3000; }"))

    def test_prepare_config_is_scoped_and_idempotent(self) -> None:
        config = """
        server {
            location /api/ { proxy_pass http://127.0.0.1:3000; }
            location / { try_files $uri $uri/ $uri.html /index.html; }
            location /downloads/ { try_files $uri =404; }
        }
        """
        updated = MODULE.prepare_studio_config(config)
        self.assertEqual(MODULE.validate_config(updated), [])
        self.assertEqual(MODULE.validate_private_video_upload(updated), [])
        self.assertIn("location /downloads/ { try_files $uri =404; }", updated)
        self.assertEqual(MODULE.prepare_studio_config(updated), updated)

    def test_prepare_config_rejects_ambiguous_or_unsafe_locations(self) -> None:
        root = "location / { try_files $uri $uri/ /index.html; }"
        api = "location /api/ { proxy_pass http://127.0.0.1:3000; }"
        with self.assertRaisesRegex(ValueError, "root location"):
            MODULE.prepare_studio_config(root + root + api)
        with self.assertRaisesRegex(ValueError, "API proxy"):
            MODULE.prepare_studio_config(root + api + api)
        with self.assertRaisesRegex(ValueError, "upload"):
            MODULE.prepare_studio_config(root + api + "location = /api/assets/private-video { client_max_body_size 60m; }")


if __name__ == "__main__":
    unittest.main()
