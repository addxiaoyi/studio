import importlib.util
import json
import pathlib
import tempfile
import unittest
import zipfile
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).with_name("prepare-agent-marketplace-candidate.py")
SPEC = importlib.util.spec_from_file_location("prepare_agent_marketplace_candidate", SCRIPT)
candidate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(candidate)


class PatchArchiveTests(unittest.TestCase):
    def test_existing_runtime_cannot_override_current_lock_and_shared_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            cached = root / "deploy/server-runtime"
            cached.mkdir(parents=True)
            (cached / "pnpm-lock.yaml").write_text("stale lock", encoding="utf-8")
            (cached / "obsolete.js").write_text("stale module", encoding="utf-8")
            shared = root / "packages/shared/dist/contracts.js"
            shared.parent.mkdir(parents=True)
            shared.write_text("current contracts", encoding="utf-8")
            archive = root / "marketplace.zip"
            with patch.object(candidate, "ROOT", root), \
                 patch.object(candidate, "OVERLAYS", ("deploy/server-runtime",)), \
                 patch.object(candidate.subprocess, "run", return_value=SimpleNamespace(
                     stdout=json.dumps({"pnpm-lock.yaml": "current lock", "package.json": "{}"}))) as build:
                candidate.create_patch_archive(archive)
            build.assert_called_once()
            with zipfile.ZipFile(archive) as bundle:
                self.assertEqual(bundle.read("deploy/server-runtime/pnpm-lock.yaml"), b"current lock")
                self.assertEqual(bundle.read("deploy/server-runtime/packages/shared/dist/contracts.js"), b"current contracts")
                self.assertNotIn("deploy/server-runtime/obsolete.js", bundle.namelist())

    def test_patch_archive_contains_only_the_explicit_overlay_and_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = pathlib.Path(temporary) / "marketplace.zip"
            digest, files = candidate.create_patch_archive(archive)

            self.assertEqual(len(digest), 64)
            self.assertIn("apps/server/src/http/agent-marketplace.ts", files)
            with zipfile.ZipFile(archive) as bundle:
                names = set(bundle.namelist())
            self.assertEqual(names, set(files))
            self.assertIn("deploy/server-runtime/pnpm-lock.yaml", names)
            self.assertNotIn("apps/server/src/local-db/migrations/20261027000000_agent_marketplace_installs.sql", names)
            self.assertNotIn("apps/server/src/runtime.ts", names)
            self.assertNotIn("apps/web/out/index.html", names)


if __name__ == "__main__":
    unittest.main()
