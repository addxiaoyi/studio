import importlib.util
import pathlib
import unittest
from email.message import Message
from unittest.mock import patch

import yaml


SCRIPT = pathlib.Path(__file__).with_name("release-desktop.py")
SPEC = importlib.util.spec_from_file_location("release_desktop", SCRIPT)
release_desktop = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(release_desktop)


class FakeResponse:
    def __init__(self, content_type: str, body: bytes) -> None:
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        self.body = body

    def read(self) -> bytes:
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class ReleasePathTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = pathlib.Path("C:/work/studio")

    def test_stage_path_is_relative_to_repository_root(self) -> None:
        result = release_desktop.resolve_stage_path(self.root, pathlib.Path(".codex/stage"))

        self.assertEqual(result, (self.root / ".codex/stage").resolve())

    def test_build_output_is_relative_to_desktop_app(self) -> None:
        result = release_desktop.resolve_build_output(self.root, pathlib.Path("release-candidates/0.2.2"))

        self.assertEqual(result, (self.root / "apps/desktop/release-candidates/0.2.2").resolve())

    def test_absolute_paths_remain_absolute(self) -> None:
        stage = pathlib.Path.cwd() / "tmp" / "stage"
        output = pathlib.Path.cwd() / "tmp" / "build"

        self.assertEqual(release_desktop.resolve_stage_path(self.root, stage), stage.resolve())
        self.assertEqual(release_desktop.resolve_build_output(self.root, output), output.resolve())

    def test_platform_installer_patterns_match_electron_builder_arch_names(self) -> None:
        version = "0.2.14"
        self.assertEqual(release_desktop.installer_pattern("windows-x64", version), "Helstera-Setup-0.2.14-Windows-x64.exe")
        self.assertEqual(release_desktop.installer_pattern("macos-x64", version), "Helstera-0.2.14-mac-x64.dmg")
        self.assertEqual(release_desktop.installer_pattern("macos-arm64", version), "Helstera-0.2.14-mac-arm64.dmg")
        self.assertEqual(release_desktop.installer_pattern("linux-x64", version), "*.AppImage")

    def test_workspace_build_scripts_use_explicit_boolean_approval(self) -> None:
        workspace_path = pathlib.Path(__file__).resolve().parents[1] / "pnpm-workspace.yaml"
        workspace = yaml.safe_load(workspace_path.read_text(encoding="utf-8"))
        allowed = workspace["allowBuilds"]

        self.assertIs(allowed["electron"], True)
        self.assertIs(allowed["esbuild"], True)
        self.assertIs(allowed["sharp"], True)
        self.assertIs(allowed["tesseract.js"], True)
        self.assertFalse(allowed["@google/genai"])
        self.assertFalse(allowed["protobufjs"])
        self.assertTrue(all(type(value) is bool for value in allowed.values()))


class PublicVersionTests(unittest.TestCase):
    def response(self, content_type: str, body: bytes) -> FakeResponse:
        return FakeResponse(content_type, body)

    def test_missing_json_and_updater_html_allow_initial_platform_release(self) -> None:
        with patch.object(
            release_desktop.urllib.request,
            "urlopen",
            side_effect=[
                self.response("text/html", b"<!doctype html><html></html>"),
                self.response("text/html", b"<!doctype html><html></html>"),
            ],
        ):
            release_desktop.verify_version_is_newer("macos-x64", "0.2.14")

    def test_existing_updater_manifest_blocks_a_downgrade_when_json_is_missing(self) -> None:
        with patch.object(
            release_desktop.urllib.request,
            "urlopen",
            side_effect=[
                self.response("text/html", b"<!doctype html><html></html>"),
                self.response("application/octet-stream", b"version: 0.2.15\n"),
            ],
        ):
            with self.assertRaisesRegex(RuntimeError, "not newer"):
                release_desktop.verify_version_is_newer("macos-x64", "0.2.14")

    def test_malformed_json_manifest_fails_closed(self) -> None:
        with patch.object(
            release_desktop.urllib.request,
            "urlopen",
            return_value=self.response("application/json", b"not json"),
        ):
            with self.assertRaisesRegex(RuntimeError, "malformed"):
                release_desktop.verify_version_is_newer("windows-x64", "0.2.14")


if __name__ == "__main__":
    unittest.main()
