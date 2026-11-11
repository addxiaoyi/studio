import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SCRIPT = Path(__file__).with_name("prepare-production-candidate.py")
SPEC = importlib.util.spec_from_file_location("prepare_production_candidate", SCRIPT)
candidate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(candidate)


class ProductionCandidateTests(unittest.TestCase):
    def test_tracked_onetake_snapshot_builds_without_a_vendor_checkout(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            feature = root / "apps/server/src/features/onetake"
            upstream = feature / "upstream/asr_demo.py"
            upstream.parent.mkdir(parents=True)
            (feature / "runner.py").write_text("adapter", encoding="utf-8")
            upstream.write_text("reviewed source", encoding="utf-8")
            upstream.with_name("README.md").write_text("Copyright (c) 2026 One Take Team", encoding="utf-8")
            with patch.object(candidate, "ONETAKE_SHA", candidate.sha256(upstream)):
                paths = candidate.one_take_sources(root)
                self.assertEqual(paths["apps/server/src/features/onetake/upstream/asr_demo.py"], upstream)
                upstream.write_text("changed source", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "reviewed revision"):
                    candidate.one_take_sources(root)

    def test_onetake_source_and_copyright_are_verified_before_packaging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runner = root / "apps/server/src/features/onetake/runner.py"
            runner.parent.mkdir(parents=True)
            runner.write_text("adapter", encoding="utf-8")
            upstream = root / "vendor/onetake/asr_demo.py"
            upstream.parent.mkdir(parents=True)
            upstream.write_text("reviewed source", encoding="utf-8")
            notice = upstream.with_name("README.md")
            notice.write_text("Copyright (c) 2026 One Take Team", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "reviewed revision"):
                candidate.one_take_sources(root)
            with patch.object(candidate, "ONETAKE_SHA", candidate.sha256(upstream)):
                paths = candidate.one_take_sources(root)
                self.assertEqual(set(paths), {"apps/server/src/features/onetake/upstream/asr_demo.py", "apps/server/src/features/onetake/upstream/README.md"})
                notice.write_text("missing notice", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "copyright"):
                    candidate.one_take_sources(root)

    def test_build_input_mismatch_is_rejected_before_archive_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, build = root / "source", root / "build"
            for directory, content in ((source, "current"), (build, "stale")):
                (directory / "apps/web/src").mkdir(parents=True)
                (directory / "apps/web/public").mkdir(parents=True)
                (directory / "apps/web/src/page.tsx").write_text(content, encoding="utf-8")
            archive = root / "candidate.zip"
            with patch.object(candidate, "INPUT_TREES", ("apps/web/src",)), patch.object(candidate, "INPUT_FILES", ()):
                with self.assertRaisesRegex(ValueError, "Build input differs"):
                    candidate.create_candidate(source, build, archive)
            self.assertFalse(archive.exists())

    def test_excludes_downloads_and_dependency_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for relative in ("downloads", "nested/node_modules", "nested/src"):
                (root / relative).mkdir(parents=True)
                (root / relative / "file").write_text("x", encoding="utf-8")
            self.assertEqual(set(candidate.files_under(root, exclude_downloads=True)), {"nested/src/file"})

    def test_candidate_manifest_covers_every_file_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, build = root / "source", root / "build"
            for relative in ("apps/web/src", "apps/web/public", "packages/shared/src", "packages/shared/dist",
                             "apps/server/src", "apps/server", "apps/web", "apps/desktop", "packages/config"):
                (source / relative).mkdir(parents=True, exist_ok=True)
            for relative in ("apps/web/src", "apps/web/public", "packages/shared/src"):
                (build / relative).mkdir(parents=True)
            for relative in ("apps/web/out", "packages/shared/dist"):
                (build / relative).mkdir(parents=True)
            runtime_manifests = (
                "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
                "apps/server/package.json", "apps/web/package.json", "apps/desktop/package.json",
                "packages/shared/package.json", "packages/config/package.json",
            )
            for relative in ("apps/server/src/app.ts", *runtime_manifests):
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("source", encoding="utf-8")
            dependencies = {"@helstera/shared": {"specifier": "workspace:*", "version": "link:../../packages/shared"}}
            config = {"@helstera/config": {"specifier": "workspace:*", "version": "link:../../packages/config"}}
            manifests = {
                "package.json": {"name": "fixture", "private": True},
                "apps/server/package.json": {"name": "@helstera/server", "dependencies": {"@helstera/shared": "workspace:*"}, "devDependencies": {"@helstera/config": "workspace:*"}},
                "packages/shared/package.json": {"name": "@helstera/shared"},
                "packages/config/package.json": {"name": "@helstera/config"},
                "pnpm-lock.yaml": {"lockfileVersion": "9.0", "importers": {".": {}, "apps/server": {"dependencies": dependencies, "devDependencies": config}, "packages/shared": {}, "packages/config": {}}, "packages": {}, "snapshots": {}},
                "pnpm-workspace.yaml": {"packages": ["apps/*", "packages/*"]},
            }
            for relative, content in manifests.items():
                (source / relative).write_text(json.dumps(content), encoding="utf-8")
            old_shared = source / "packages/shared/dist"
            (old_shared / "contracts.js").write_text("stale contracts", encoding="utf-8")
            (old_shared / "removed.js").write_text("obsolete contract", encoding="utf-8")
            (source / ".env").write_text("must not ship", encoding="utf-8")
            for relative in ("apps/web/out/index.html", "apps/web/out/fashion-gallery/index.html",
                             "apps/web/out/video/index.html", "packages/shared/dist/contracts.js"):
                path = build / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("build", encoding="utf-8")
            archive = root / "candidate.zip"
            with patch.object(candidate, "INPUT_FILES", ()), patch.object(candidate, "INCLUDE_FILES", ()):
                digest = candidate.create_candidate(source, build, archive)
                with self.assertRaises(FileExistsError):
                    candidate.create_candidate(source, build, archive)
            self.assertEqual(len(digest), 64)
            with zipfile.ZipFile(archive) as bundle:
                manifest = json.loads(bundle.read("RELEASE-MANIFEST.json"))
                self.assertEqual(bundle.read("deploy/server-runtime/packages/shared/dist/contracts.js"), b"build")
                self.assertNotIn("deploy/server-runtime/packages/shared/dist/removed.js", bundle.namelist())
                for relative in ("apps/server/package.json", "packages/shared/package.json", "packages/config/package.json"):
                    self.assertEqual(json.loads(bundle.read(f"deploy/server-runtime/{relative}")), manifests[relative])
                self.assertNotIn("deploy/server-runtime/apps/desktop/package.json", bundle.namelist())
                self.assertNotIn("deploy/server-runtime/apps/web/package.json", bundle.namelist())
                self.assertNotIn("deploy/server-runtime/.env", bundle.namelist())
                self.assertEqual(set(manifest["files"]), set(bundle.namelist()) - {"RELEASE-MANIFEST.json"})
                for name, item in manifest["files"].items():
                    self.assertEqual(item["sha256"], __import__("hashlib").sha256(bundle.read(name)).hexdigest())


if __name__ == "__main__":
    unittest.main()
