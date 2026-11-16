import importlib.util
import sys
import tempfile
import unittest
import zipfile
from types import SimpleNamespace
from contextlib import ExitStack
from unittest.mock import MagicMock
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
from scripts.test_prepare_production_candidate import write_creative_runtime


class WebStaticCandidateTests(unittest.TestCase):
    def test_html_shells_without_creative_assets_are_rejected_before_ssh(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "apps/web/out"
            for relative in DEPLOY.REQUIRED_FILES:
                path = output.joinpath(*relative.parts[1:])
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('<script src="/_next/static/app.js"></script>', encoding="utf-8")
            (output / "_next/static").mkdir(parents=True)
            (output / "_next/static/app.js").write_text(" ".join((*desktop_markers, DEPLOY.MARKETPLACE_MARKER)), encoding="utf-8")
            with patch.object(DEPLOY, "PROJECT_ROOT", root, create=True), \
                 patch.object(DEPLOY.paramiko, "SSHClient") as ssh:
                with self.assertRaisesRegex(FileNotFoundError, "Creative runtime is missing"):
                    DEPLOY.deploy(SimpleNamespace(source=output, resume_stage=None, resume_backup=None,
                        dry_run=True, password_env="UNUSED_TEST_PASSWORD"))
            ssh.assert_not_called()

    def test_staged_export_must_match_the_checked_archive_even_when_resuming(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, archive = root / "out", root / "candidate.zip"
            path = output / "creative/visualforge/entry.mjs"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"stale editor")
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("out/creative/visualforge/entry.mjs", b"verified editor")
            with self.assertRaisesRegex(ValueError, "Staged Web file differs"):
                DEPLOY.verify_staged_archive(archive, output)
            path.write_bytes(b"verified editor")
            DEPLOY.verify_staged_archive(archive, output)
            path.unlink()
            with self.assertRaisesRegex(FileNotFoundError, "Staged Web file is missing"):
                DEPLOY.verify_staged_archive(archive, output)

    def test_staged_check_allows_retained_chunks_and_managed_downloads(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, archive = root / "out", root / "candidate.zip"
            (output / "_next/static").mkdir(parents=True)
            (output / "downloads").mkdir()
            (output / "_next/static/current.js").write_bytes(b"current")
            (output / "_next/static/previous.js").write_bytes(b"retained")
            (output / "downloads/desktop-release-windows-x64.json").write_bytes(b"live manifest")
            live = root / "live"
            (live / "_next/static").mkdir(parents=True)
            (live / "downloads").mkdir()
            (live / "_next/static/previous.js").write_bytes(b"retained")
            (live / "downloads/desktop-release-windows-x64.json").write_bytes(b"live manifest")
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("out/_next/static/current.js", b"current")
                bundle.writestr("out/downloads/desktop-release-windows-x64.json", b"stale manifest")
            DEPLOY.verify_staged_archive(archive, output, live)
            (output / "downloads/desktop-release-windows-x64.json").write_bytes(b"altered manifest")
            with self.assertRaisesRegex(ValueError, "Staged Web file differs"):
                DEPLOY.verify_staged_archive(archive, output, live)

    def test_staged_web_owned_downloads_and_extra_modules_cannot_be_modified(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, archive = root / "out", root / "candidate.zip"
            (output / "downloads").mkdir(parents=True)
            (output / "downloads/guide.json").write_bytes(b"modified guide")
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("out/downloads/guide.json", b"reviewed guide")
            with self.assertRaisesRegex(ValueError, "Staged Web file differs"):
                DEPLOY.verify_staged_archive(archive, output)
            (output / "downloads/guide.json").write_bytes(b"reviewed guide")
            (output / "unreviewed.js").write_bytes(b"module")
            with self.assertRaisesRegex(ValueError, "Unreviewed file"):
                DEPLOY.verify_staged_archive(archive, output)

    def publication(self, *, switch_unknown=False, public_failure=False, rollback_failure=False, resume=False, staged_failure=False):
        scripts = []
        stage = '/www/helstera/apps/web/.helstera-static.TEST'

        def archive(_source, destination):
            destination.write_bytes(b'candidate')
            return 'A' * 64

        def remote(_client, command, **_kwargs):
            if 'mktemp -d' in command:
                return stage
            if 'sha256sum' in command:
                return 'A' * 64
            return ''

        def python(_client, source, **_kwargs):
            scripts.append(source)
            if staged_failure and 'staged-files-verified' in source:
                raise ValueError('Staged Web file differs from verified archive')
            if 'with zipfile.ZipFile' in source:
                return stage + '/out'
            if switch_unknown and ('atomic-exchange-ok' in source or "else 'not-exchanged'" in source):
                raise RuntimeError('SSH observation failed')
            if rollback_failure and 'rollback-exchange-ok' in source:
                raise RuntimeError('rollback failed')
            return '{}'

        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            args = SimpleNamespace(resume_stage=None, resume_backup=None, source=Path(directory), password_env='TEST_DEPLOY_SECRET',
                dry_run=False, jump_host='jump', jump_port=22, jump_user='test', target_host='target', target_user='test',
                verify_url='https://example.test/desktop-app/')
            if resume:
                args.resume_stage = stage
                args.resume_backup = '/www/helstera/backups/web-static-test'
            stack.enter_context(patch.dict(DEPLOY.os.environ, {'TEST_DEPLOY_SECRET': 'test-only'}))
            stack.enter_context(patch.object(DEPLOY.paramiko, 'SSHClient', return_value=MagicMock()))
            stack.enter_context(patch.object(DEPLOY, 'configure_ssh'))
            stack.enter_context(patch.object(DEPLOY, 'validate_source', return_value=Path(directory)))
            stack.enter_context(patch.object(DEPLOY, 'validate_local_desktop_bundle'))
            stack.enter_context(patch.object(DEPLOY, 'validate_local_web_marketplace_bundle'))
            stack.enter_context(patch.object(DEPLOY, 'create_archive', side_effect=archive))
            stack.enter_context(patch.object(DEPLOY, 'remote_run', side_effect=remote))
            stack.enter_context(patch.object(DEPLOY, 'remote_python', side_effect=python))
            stack.enter_context(patch.object(DEPLOY, 'verify_public_desktop',
                side_effect=RuntimeError('public verification failed') if public_failure else None, return_value={'status': 200}))
            stack.enter_context(patch('builtins.print'))
            failure = None
            try:
                DEPLOY.deploy(args)
            except Exception as error:
                failure = error
        return scripts, failure

    def test_modified_resume_tree_is_rejected_before_exchange(self):
        scripts, failure = self.publication(resume=True, staged_failure=True)
        self.assertIn('Staged Web file differs', str(failure))
        self.assertFalse(any('atomic-exchange-ok' in source for source in scripts))

    def test_unknown_switch_keeps_the_only_recovery_tree(self):
        scripts, failure = self.publication(switch_unknown=True)
        self.assertIn('outcome is unknown', str(failure))
        self.assertFalse(any('shutil.rmtree' in source for source in scripts))
        self.assertFalse(any('retention.apply' in source for source in scripts))

    def test_verified_publication_retires_old_archives_and_cleans_its_stage(self):
        scripts, failure = self.publication()
        self.assertIsNone(failure)
        self.assertEqual(sum('shutil.rmtree' in source for source in scripts), 1)
        self.assertTrue(any('retention.apply' in source and "'archives'" in source for source in scripts))

    def test_failed_public_check_restores_before_cleaning_without_retiring_archives(self):
        scripts, failure = self.publication(public_failure=True)
        self.assertIn('public verification failed', str(failure))
        rollback = next(i for i, source in enumerate(scripts) if 'rollback-exchange-ok' in source)
        cleanup = next(i for i, source in enumerate(scripts) if 'shutil.rmtree' in source)
        self.assertLess(rollback, cleanup)
        self.assertFalse(any('retention.apply' in source for source in scripts))

    def test_failed_rollback_keeps_recovery_files(self):
        scripts, failure = self.publication(public_failure=True, rollback_failure=True)
        self.assertIn('rollback failed', str(failure))
        self.assertFalse(any('shutil.rmtree' in source for source in scripts))

    def test_archive_cleanup_executes_policy_and_keeps_two_newest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archives = []
            for day in ('01', '02', '03'):
                archive = root / 'backups' / f'web-static-202611{day}-010000-AABB' / 'out.tar.gz'
                archive.parent.mkdir(parents=True)
                archive.write_bytes(b'archive')
                archives.append(archive)

            def remote(_client, source, **_kwargs):
                exec(compile(source, '<remote-retention>', 'exec'), {})
                return 'verified'

            with patch.object(DEPLOY, 'DEFAULT_ROOT', str(root)), patch.object(DEPLOY, 'remote_python', side_effect=remote), patch('builtins.print'):
                self.assertEqual(DEPLOY.retire_static_archives(None), 'verified')
            self.assertFalse(archives[0].exists())
            self.assertTrue(all(p.exists() for p in archives[1:]))


    def test_retains_one_previous_static_generation_without_copying_private_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            live, candidate, following = root / "live", root / "candidate", root / "following"
            for directory, name in ((live, "old.js"), (candidate, "new.js"), (following, "next.js")):
                (directory / "_next/static").mkdir(parents=True)
                (directory / "_next/static" / name).write_text(name)
            (live / ".env").write_text("do not publish")
            self.assertEqual(DEPLOY.preserve_previous_static(live, candidate), 1)
            self.assertEqual(DEPLOY.preserve_previous_static(live, candidate), 1)
            self.assertEqual((candidate / "_next/static/old.js").read_text(), "old.js")
            self.assertFalse((candidate / ".env").exists())
            self.assertEqual(DEPLOY.preserve_previous_static(candidate, following), 1)
            self.assertTrue((following / "_next/static/new.js").exists())
            self.assertFalse((following / "_next/static/old.js").exists())

    def test_static_retention_rejects_changed_content_at_an_immutable_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, content in (("live", "old"), ("candidate", "new")):
                path = root / name / "_next/static/shared.js"
                path.parent.mkdir(parents=True)
                path.write_text(content)
            with self.assertRaisesRegex(ValueError, "immutable"):
                DEPLOY.preserve_previous_static(root / "live", root / "candidate")
            self.assertEqual((root / "candidate/_next/static/shared.js").read_text(), "new")

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
            project = Path(temporary)
            write_creative_runtime(project, project)
            root = project / "apps/web/out"
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

            with patch.object(DEPLOY, "PROJECT_ROOT", project):
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
