import importlib.util
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from pathlib import Path, PurePosixPath

DEPLOY_SCRIPT = Path(__file__).with_name("deploy-web-static.py")
SPEC = importlib.util.spec_from_file_location("helstera_deploy_web_static", DEPLOY_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load deploy script: {DEPLOY_SCRIPT}")
DEPLOY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DEPLOY
SPEC.loader.exec_module(DEPLOY)
create_archive = DEPLOY.create_archive
preserve_managed_downloads = DEPLOY.preserve_managed_downloads
validate_local_desktop_bundle = DEPLOY.validate_local_desktop_bundle
validate_local_web_marketplace_bundle = DEPLOY.validate_local_web_marketplace_bundle
validate_source = DEPLOY.validate_source
validate_stage_path = DEPLOY.validate_stage_path
desktop_markers = DEPLOY.DESKTOP_MARKERS


class WebStaticCandidateTests(unittest.TestCase):
    def test_public_verification_checks_the_desktop_marketplace_bundle(self):
        class Response:
            status = 200

            def __init__(self, url, body):
                self.url = url
                self.body = body.encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit=None):
                return self.body

        responses = [
            Response(
                "https://studio.0st.top/desktop-app/?release_check=abc",
                '<script src="/_next/static/desktop.js"></script>',
            ),
            Response("https://studio.0st.top/_next/static/desktop.js", " ".join(desktop_markers)),
            Response(
                "https://studio.0st.top/desktop-app/marketplace/?release_check=abc",
                '<script src="/_next/static/marketplace.js"></script>',
            ),
            Response("https://studio.0st.top/_next/static/marketplace.js", DEPLOY.MARKETPLACE_MARKER),
            Response(
                "https://studio.0st.top/marketplace/?release_check=abc",
                '<script src="/_next/static/web-marketplace.js"></script>',
            ),
            Response("https://studio.0st.top/_next/static/web-marketplace.js", DEPLOY.MARKETPLACE_MARKER),
        ]
        with patch.object(DEPLOY.urllib.request, "urlopen", side_effect=responses):
            result = DEPLOY.verify_public_desktop("https://studio.0st.top/desktop-app/", "abc")

        self.assertEqual(result["scriptCount"], 1)
        self.assertEqual(result["marketplaceScriptCount"], 1)
        self.assertEqual(result["marketplaceUrl"], "https://studio.0st.top/desktop-app/marketplace/")
        self.assertEqual(result["webMarketplaceScriptCount"], 1)
        self.assertEqual(result["webMarketplaceUrl"], "https://studio.0st.top/marketplace/")

    def test_public_verification_retries_transient_tls_failures(self):
        class Response:
            status = 200
            url = "https://studio.0st.top/desktop-app/?release_check=abc"

            def __init__(self, body):
                self.body = body.encode("utf-8")

            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self, _limit=None): return self.body

        responses = [
            DEPLOY.urllib.error.URLError("unexpected TLS EOF"),
            Response("<script src='/_next/static/desktop.js'></script>"),
            Response(" ".join(desktop_markers)),
            Response("<script src='/_next/static/marketplace.js'></script>"),
            Response(DEPLOY.MARKETPLACE_MARKER),
            Response("<script src='/_next/static/web-marketplace.js'></script>"),
            Response(DEPLOY.MARKETPLACE_MARKER),
        ]
        with patch.object(DEPLOY.urllib.request, "urlopen", side_effect=responses), patch.object(DEPLOY.time, "sleep"):
            result = DEPLOY.verify_public_desktop("https://studio.0st.top/desktop-app/", "abc")

        self.assertEqual(result["marketplaceScriptCount"], 1)
        self.assertEqual(result["webMarketplaceScriptCount"], 1)

    def test_preserves_desktop_packages_and_updater_feed_from_live_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            live = root / "live"
            candidate = root / "candidate"
            live_feed = live / "downloads" / "updates" / "windows-x64"
            live_feed.mkdir(parents=True)
            (live_feed / "latest.yml").write_text("version: 0.2.14\n", encoding="utf-8")
            (live_feed / "Helstera-Setup-0.2.14.exe").write_bytes(b"installer")
            (live / "downloads" / "desktop-release-windows-x64.json").write_text("live manifest", encoding="utf-8")
            (candidate / "downloads").mkdir(parents=True)
            (candidate / "downloads" / "desktop-release-windows-x64.json").write_text("stale source manifest", encoding="utf-8")
            (candidate / "downloads" / "public-guide.json").write_text("web-owned", encoding="utf-8")

            copied = preserve_managed_downloads(live, candidate)

            self.assertEqual(copied, 3)
            self.assertEqual((candidate / "downloads" / "desktop-release-windows-x64.json").read_text("utf-8"), "live manifest")
            self.assertEqual((candidate / "downloads" / "updates" / "windows-x64" / "latest.yml").read_text("utf-8"), "version: 0.2.14\n")
            self.assertEqual((candidate / "downloads" / "public-guide.json").read_text("utf-8"), "web-owned")

    def test_candidate_release_assets_are_kept_when_live_download_tree_is_missing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            live = root / "live"
            candidate = root / "candidate"
            downloads = candidate / "downloads"
            feed = downloads / "updates" / "windows-x64"
            feed.mkdir(parents=True)
            (downloads / "Helstera-0.2.14-win-x64.zip").write_bytes(b"portable-package")
            (downloads / "desktop-release-windows-x64.json").write_text("release manifest", encoding="utf-8")
            (feed / "Helstera-Setup-0.2.14-Windows-x64.exe").write_bytes(b"setup-package")
            (feed / "latest.yml").write_text("version: 0.2.14\n", encoding="utf-8")

            copied = preserve_managed_downloads(live, candidate)

            self.assertEqual(copied, 0)
            self.assertEqual((downloads / "Helstera-0.2.14-win-x64.zip").read_bytes(), b"portable-package")
            self.assertEqual((downloads / "desktop-release-windows-x64.json").read_text("utf-8"), "release manifest")
            self.assertEqual((feed / "Helstera-Setup-0.2.14-Windows-x64.exe").read_bytes(), b"setup-package")
            self.assertEqual((feed / "latest.yml").read_text("utf-8"), "version: 0.2.14\n")

    def test_refuses_to_snapshot_a_desktop_release_while_it_is_uploading(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "live" / "downloads" / ".release-active").mkdir(parents=True)

            with self.assertRaisesRegex(RuntimeError, "release is in progress"):
                preserve_managed_downloads(root / "live", root / "candidate")

    def test_remote_staging_path_must_be_a_sibling_of_web_output(self):
        web_root = PurePosixPath("/www/helstera/apps/web")

        self.assertEqual(
            validate_stage_path(web_root, "/www/helstera/apps/web/.helstera-static.XYZ"),
            PurePosixPath("/www/helstera/apps/web/.helstera-static.XYZ"),
        )
        with self.assertRaisesRegex(RuntimeError, "outside the approved Web directory"):
            validate_stage_path(web_root, "/www/helstera/.helstera-static.XYZ")

    def test_requires_desktop_canvas_and_static_asset_routes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "desktop").mkdir()
            (root / "desktop-app").mkdir()
            (root / "desktop-app" / "marketplace").mkdir()
            (root / "canvas").mkdir()
            (root / "_next" / "static").mkdir(parents=True)
            (root / "index.html").write_text("home", encoding="utf-8")
            (root / "marketplace" / "index.html").parent.mkdir(parents=True)
            (root / "marketplace" / "index.html").write_text(
                '<script src="/_next/static/marketplace.js"></script>', encoding="utf-8"
            )
            (root / "desktop" / "index.html").write_text(
                '<script src="/_next/static/desktop.js"></script>', encoding="utf-8"
            )
            (root / "desktop-app" / "index.html").write_text(
                '<script src="/_next/static/desktop.js"></script>', encoding="utf-8"
            )
            (root / "desktop-app" / "marketplace" / "index.html").write_text("marketplace", encoding="utf-8")
            (root / "canvas" / "index.html").write_text("canvas", encoding="utf-8")
            (root / "_next" / "static" / "desktop.js").write_text(
                " ".join(desktop_markers), encoding="utf-8"
            )

            self.assertEqual(validate_source(root), root.resolve())
            validate_local_desktop_bundle(root)
            (root / "_next" / "static" / "marketplace.js").write_text(
                DEPLOY.MARKETPLACE_MARKER, encoding="utf-8"
            )
            validate_local_web_marketplace_bundle(root)

    def test_archive_contains_only_the_export_tree_and_returns_its_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "out"
            root.mkdir()
            for relative in ("index.html", "marketplace/index.html", "desktop/index.html", "desktop-app/index.html", "desktop-app/marketplace/index.html", "canvas/index.html", "_next/static/app.js"):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(relative, encoding="utf-8")
            archive = Path(temporary) / "candidate.zip"

            digest = create_archive(root.resolve(), archive)

            self.assertEqual(len(digest), 64)
            with zipfile.ZipFile(archive) as bundle:
                self.assertIn("out/desktop/index.html", bundle.namelist())
                self.assertIn("out/marketplace/index.html", bundle.namelist())
                self.assertIn("out/desktop-app/index.html", bundle.namelist())
                self.assertIn("out/desktop-app/marketplace/index.html", bundle.namelist())
                self.assertNotIn("apps/server/src/app.ts", bundle.namelist())

    def test_desktop_route_must_reference_the_expected_feature_bundle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            desktop = root / "desktop-app"
            assets = root / "_next" / "static" / "chunks" / "app" / "desktop-app"
            desktop.mkdir()
            assets.mkdir(parents=True)
            (desktop / "index.html").write_text(
                '<script src="/_next/static/chunks/app/desktop-app/page.js"></script>',
                encoding="utf-8",
            )
            (assets / "page.js").write_text("old desktop bundle", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "missing expected features"):
                validate_local_desktop_bundle(root)


if __name__ == "__main__":
    unittest.main()
