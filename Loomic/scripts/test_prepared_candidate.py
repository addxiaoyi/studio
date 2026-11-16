from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile


PROTECTED_FILES = {
    "apps/server/src": "app.ts",
    "packages/shared/dist": "index.js",
    "deploy/server-runtime/packages/shared/dist": "index.js",
}


def candidate_fixture(folder: str) -> types.SimpleNamespace:
    root = Path(folder) / "deployment"
    stage = root / ".helstera-candidate.reviewed"
    candidate = stage / "candidate"
    files = {
        "apps/server/src/app.ts": b"export const version = 'candidate';\n",
        "apps/server/src/worker.ts": b"export const worker = 'candidate';\n",
        "apps/server/src/local-db/migrations/current.sql": b"select 1;\n",
        "packages/shared/dist/index.js": b"export const shared = 'candidate';\n",
        "packages/shared/dist/index.d.ts": b"export declare const shared: string;\n",
        "deploy/server-runtime/packages/shared/dist/index.js": b"export const shared = 'candidate';\n",
        "deploy/server-runtime/packages/shared/dist/index.d.ts": b"export declare const shared: string;\n",
        "deploy/server-runtime/packages/shared/package.json": b'{"name":"@helstera/shared","type":"module"}\n',
        "deploy/server-runtime/apps/server/package.json": b'{"name":"@helstera/server"}\n',
        "deploy/server-runtime/package.json": b'{"private":true}\n',
        "deploy/server-runtime/pnpm-lock.yaml": b"lockfileVersion: '9.0'\n",
        "deploy/server-runtime/pnpm-workspace.yaml": b"packages:\n  - apps/*\n  - packages/*\n",
        "apps/web/out/index.html": b"<html>candidate</html>\n",
        "apps/web/out/_next/static/app.js": b"console.log('candidate');\n",
        "apps/server/package.json": b'{"name":"@helstera/server","version":"1.0.0"}\n',
        "apps/server/tsconfig.json": b'{"extends":"../../tsconfig.base.json"}\n',
        "apps/desktop/package.json": b'{"name":"@helstera/desktop"}\n',
        "package.json": b'{"private":true,"packageManager":"pnpm@10.0.0"}\n',
        "pnpm-lock.yaml": b"lockfileVersion: '9.0'\n",
        "pnpm-workspace.yaml": b"packages:\n  - apps/*\n  - packages/*\n",
        "tsconfig.base.json": b'{"compilerOptions":{"strict":true}}\n',
    }
    for relative, content in files.items():
        target = candidate / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    manifest = {"files": {name: {"sha256": hashlib.sha256(content).hexdigest()}
                          for name, content in files.items()}}
    manifest_bytes = json.dumps(manifest, sort_keys=True).encode()
    (candidate / "RELEASE-MANIFEST.json").write_bytes(manifest_bytes)
    archive = stage / "candidate.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        for relative, content in files.items():
            bundle.writestr(relative, content)
        bundle.writestr("RELEASE-MANIFEST.json", manifest_bytes)
    old_files = {
        "apps/server/src/Server.ts": b"old server that was removed\n",
        "apps/server/src/local-db/migrations/obsolete.sql": b"old migration that was removed\n",
        "packages/shared/dist/Shared.js": b"old shared that was removed\n",
    }
    for relative, content in old_files.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return types.SimpleNamespace(root=root, stage=stage, candidate=candidate, archive=archive,
                                 prepared=stage / "next", files=files, old_files=old_files)


class PreparedCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        paramiko = types.ModuleType("paramiko")
        paramiko.SSHClient = object
        path = Path(__file__).with_name("deploy-production-candidate.py")
        spec = importlib.util.spec_from_file_location("prepared_candidate_deploy", path)
        if spec is None or spec.loader is None:
            raise RuntimeError("Deployment module could not be loaded")
        cls.deploy = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"paramiko": paramiko}):
            spec.loader.exec_module(cls.deploy)

    def test_complete_preparation_uses_reviewed_trees_and_preserves_legacy_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = candidate_fixture(folder)
            self.deploy.prepare_complete_candidate(fixture.root, fixture.stage)
            for relative, content in fixture.files.items():
                self.assertEqual((fixture.prepared / relative).read_bytes(), content, relative)
            for relative, content in fixture.old_files.items():
                self.assertFalse((fixture.prepared / relative).exists(), relative)
                self.assertEqual((fixture.root / relative).read_bytes(), content, relative)
            self.assertFalse((fixture.prepared / "apps/server/src/src").exists())

    def test_complete_preparation_refuses_an_occupied_next_without_touching_it(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = candidate_fixture(folder)
            fixture.prepared.mkdir()
            preserved = fixture.prepared / "operator-notes.txt"
            preserved.write_bytes(b"preserve this existing release\n")
            with self.assertRaises((FileExistsError, ValueError, RuntimeError)):
                self.deploy.prepare_complete_candidate(fixture.root, fixture.stage)
            self.assertEqual(preserved.read_bytes(), b"preserve this existing release\n")
            self.assertEqual(list(fixture.prepared.iterdir()), [preserved])
            for relative, content in fixture.old_files.items():
                self.assertEqual((fixture.root / relative).read_bytes(), content)

    def test_complete_command_serializes_the_same_safe_preparation(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = candidate_fixture(folder)
            command = self.deploy.prepare_candidate_command(str(fixture.root), str(fixture.stage), complete=True)
            arguments = shlex.split(command)
            self.assertEqual(arguments[1], "-c")
            completed = subprocess.run([sys.executable, *arguments[1:]], capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual((fixture.prepared / "apps/server/src/app.ts").read_bytes(),
                             fixture.files["apps/server/src/app.ts"])
            for relative, content in fixture.old_files.items():
                self.assertFalse((fixture.prepared / relative).exists(), relative)
                self.assertEqual((fixture.root / relative).read_bytes(), content)

    def test_prepared_code_accepts_the_exact_reviewed_files(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = candidate_fixture(folder)
            shutil.copytree(fixture.candidate, fixture.prepared)
            self.deploy.verify_prepared_code(fixture.archive, fixture.prepared)

    def test_prepared_code_rejects_extra_missing_and_changed_files_in_each_prefix(self):
        for prefix, name in PROTECTED_FILES.items():
            for change in ("extra", "missing", "changed"):
                with self.subTest(prefix=prefix, change=change), tempfile.TemporaryDirectory() as folder:
                    fixture = candidate_fixture(folder)
                    shutil.copytree(fixture.candidate, fixture.prepared)
                    target = fixture.prepared / prefix / name
                    if change == "extra":
                        (target.parent / "unreviewed.js").write_bytes(b"unreviewed code\n")
                    elif change == "missing":
                        target.unlink()
                    else:
                        target.write_bytes(b"different reviewed code\n")
                    with self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
                        self.deploy.verify_prepared_code(fixture.archive, fixture.prepared)

    def test_prepared_code_rejects_file_symlinks_even_when_the_bytes_match(self):
        for prefix, name in PROTECTED_FILES.items():
            with self.subTest(prefix=prefix), tempfile.TemporaryDirectory() as folder:
                fixture = candidate_fixture(folder)
                shutil.copytree(fixture.candidate, fixture.prepared)
                target = fixture.prepared / prefix / name
                target.unlink()
                try:
                    target.symlink_to(fixture.candidate / prefix / name)
                except OSError as error:
                    self.skipTest("File symlinks are unavailable: " + str(error))
                with self.assertRaises((ValueError, RuntimeError)):
                    self.deploy.verify_prepared_code(fixture.archive, fixture.prepared)

    def test_prepared_code_rejects_symlinked_protected_directories(self):
        for prefix in PROTECTED_FILES:
            with self.subTest(prefix=prefix), tempfile.TemporaryDirectory() as folder:
                fixture = candidate_fixture(folder)
                shutil.copytree(fixture.candidate, fixture.prepared)
                target = fixture.prepared / prefix
                shutil.rmtree(target)
                try:
                    target.symlink_to(fixture.candidate / prefix, target_is_directory=True)
                except OSError as error:
                    self.skipTest("Directory symlinks are unavailable: " + str(error))
                with self.assertRaises((ValueError, RuntimeError)):
                    self.deploy.verify_prepared_code(fixture.archive, fixture.prepared)

    def test_prepared_code_rejects_a_nested_legacy_source_tree(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = candidate_fixture(folder)
            shutil.copytree(fixture.candidate, fixture.prepared)
            nested = fixture.prepared / "apps/server/src/src/Server.ts"
            nested.parent.mkdir()
            nested.write_bytes(b"legacy source copied into src/src\n")
            with self.assertRaises((ValueError, RuntimeError)):
                self.deploy.verify_prepared_code(fixture.archive, fixture.prepared)

    def test_dependency_symlinks_outside_protected_code_are_allowed(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = candidate_fixture(folder)
            shutil.copytree(fixture.candidate, fixture.prepared)
            dependencies = fixture.root / "dependencies"
            dependencies.mkdir()
            for relative in ("node_modules", "apps/server/node_modules", "deploy/server-runtime/node_modules"):
                try:
                    (fixture.prepared / relative).symlink_to(dependencies, target_is_directory=True)
                except OSError as error:
                    self.skipTest("Directory symlinks are unavailable: " + str(error))
            self.deploy.verify_prepared_code(fixture.archive, fixture.prepared)


if __name__ == "__main__":
    unittest.main()
