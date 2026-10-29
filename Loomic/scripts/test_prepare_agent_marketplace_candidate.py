import importlib.util
import pathlib
import tempfile
import unittest
import zipfile


SCRIPT = pathlib.Path(__file__).with_name("prepare-agent-marketplace-candidate.py")
SPEC = importlib.util.spec_from_file_location("prepare_agent_marketplace_candidate", SCRIPT)
candidate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(candidate)


class PatchArchiveTests(unittest.TestCase):
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
