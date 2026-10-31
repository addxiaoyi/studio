import importlib.util
import base64
import hashlib
import json
import pathlib
import tempfile
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
        self.status = 200

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
        self.assertEqual(release_desktop.portable_pattern("windows-x64", version), "Helstera-0.2.14-Windows-x64-portable.exe")
        self.assertEqual(release_desktop.installer_pattern("macos-x64", version), "Helstera-0.2.14-mac-x64.dmg")
        self.assertEqual(release_desktop.installer_pattern("macos-arm64", version), "Helstera-0.2.14-mac-arm64.dmg")
        self.assertEqual(release_desktop.installer_pattern("linux-x64", version), "*.AppImage")

    def test_files_for_release_publishes_portable_exe_and_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            release = root / "release"
            release.mkdir()
            stage = root / "stage"
            portable = release / "Helstera-0.2.14-Windows-x64-portable.exe"
            portable.write_bytes(b"portable-content")
            installer = release / "Helstera-Setup-0.2.14-Windows-x64.exe"
            installer.write_bytes(b"installer-content")
            updater_package = release / "Helstera-Setup-0.2.14-Windows-x64.exe"
            manifest = release / "latest.yml"
            manifest.write_text(yaml.safe_dump({
                "version": "0.2.14",
                "files": [{"url": updater_package.name}],
                "path": updater_package.name,
            }), encoding="utf-8")

            files, _, release_manifest = release_desktop.files_for_release(
                root,
                "windows-x64",
                "0.2.14",
                stage,
                release_dir=release,
            )

            public_portable = stage / "downloads" / portable.name
            self.assertIn(public_portable, files)
            document = json.loads(release_manifest.read_text(encoding="utf-8"))
            self.assertEqual(document["portableFileName"], portable.name)
            self.assertEqual(document["portableSha256"], hashlib.sha256(portable.read_bytes()).hexdigest())

    def test_remote_download_root_uses_posix_separators(self) -> None:
        self.assertEqual(str(release_desktop.DOWNLOAD_ROOT), "/www/helstera/apps/web/out/downloads")

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

    def test_pnpm_command_falls_back_to_corepack(self) -> None:
        with patch.object(release_desktop.shutil, "which", side_effect=lambda name: "/usr/bin/corepack" if name == "corepack" else None):
            self.assertEqual(release_desktop.pnpm_command(), ["/usr/bin/corepack", "pnpm"])

    def test_updater_manifest_requires_package_size_and_sha512_to_match(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            release = pathlib.Path(temporary)
            package = release / "Helstera-Setup-0.2.14-Windows-x64.exe"
            package.write_bytes(b"installer-content")
            manifest = release / "latest.yml"
            manifest.write_text(yaml.safe_dump({
                "version": "0.2.14",
                "files": [{
                    "url": package.name,
                    "size": package.stat().st_size,
                    "sha512": base64.b64encode(hashlib.sha512(package.read_bytes()).digest()).decode("ascii"),
                }],
                "path": package.name,
            }), encoding="utf-8")

            self.assertEqual(
                release_desktop.validate_updater_manifest(manifest, release),
                {package.name},
            )

            package.write_bytes(b"different")
            with self.assertRaisesRegex(RuntimeError, "size does not match"):
                release_desktop.validate_updater_manifest(manifest, release)

            package.write_bytes(b"different-content")
            with self.assertRaisesRegex(RuntimeError, "SHA-512 does not match"):
                release_desktop.validate_updater_manifest(manifest, release)

    def test_same_version_repair_keeps_the_existing_website_manifest(self) -> None:
        class RecordingSftp:
            def __init__(self) -> None:
                self.uploads: list[tuple[str, str]] = []
                self.renames: list[tuple[str, str]] = []

            def put(self, source: str, destination: str) -> None:
                self.uploads.append((source, destination))

            def posix_rename(self, source: str, destination: str) -> None:
                self.renames.append((source, destination))

        with tempfile.TemporaryDirectory() as temporary:
            stage = pathlib.Path(temporary)
            downloads = stage / "downloads"
            feed = stage / "updates" / "windows-x64"
            downloads.mkdir()
            feed.mkdir(parents=True)
            package = downloads / "Helstera-0.2.14-Windows-x64.exe"
            release_manifest = downloads / "desktop-release-windows-x64.json"
            updater_manifest = feed / "latest.yml"
            package.write_bytes(b"installer")
            release_manifest.write_text("leave-existing", encoding="utf-8")
            updater_manifest.write_text("version: 0.2.14\n", encoding="utf-8")
            sftp = RecordingSftp()

            with patch.object(release_desktop, "ensure_remote_dir"):
                release_desktop.publish_files(
                    sftp,
                    stage,
                    "/tmp/desktop-release",
                    "windows-x64",
                    [package, release_manifest, updater_manifest],
                    updater_manifest,
                    release_manifest,
                    publish_release_manifest=False,
                )

            self.assertFalse(any(pathlib.Path(source).name == release_manifest.name for source, _ in sftp.uploads))
            self.assertFalse(any(destination.endswith(release_manifest.name) for _, destination in sftp.renames))
            self.assertTrue(sftp.renames[-1][1].endswith("/updates/windows-x64/latest.yml"))


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

    def test_same_version_repair_requires_explicit_flag(self) -> None:
        with patch.object(release_desktop, "public_release_version", return_value="0.2.14"):
            with self.assertRaisesRegex(RuntimeError, "not newer"):
                release_desktop.verify_version_is_newer("windows-x64", "0.2.14")

    def test_same_version_repair_requires_matching_portable_package_and_missing_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            manifest_path = root / "desktop-release-windows-x64.json"
            manifest = {
                "version": "0.2.14",
                "portableFileName": "Helstera-0.2.14-win-x64.zip",
                "portableSha256": "a" * 64,
            }
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            package = root / "Helstera-0.2.14-win-x64.zip"

            with (
                patch.object(release_desktop, "public_release_version", return_value="0.2.14"),
                patch.object(release_desktop, "public_release_document", return_value=manifest),
                patch.object(release_desktop, "missing_public_artifacts", return_value=[package]),
            ):
                release_desktop.verify_version_is_newer(
                    "windows-x64",
                    "0.2.14",
                    repair_current=True,
                    release_manifest=manifest_path,
                    staged_files=[package],
                    stage=root,
                )

    def test_same_version_repair_refuses_a_different_portable_package(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            manifest_path = root / "desktop-release-windows-x64.json"
            manifest_path.write_text(json.dumps({
                "version": "0.2.14",
                "portableFileName": "Helstera-0.2.14-win-x64.zip",
                "portableSha256": "a" * 64,
            }), encoding="utf-8")

            with (
                patch.object(release_desktop, "public_release_version", return_value="0.2.14"),
                patch.object(release_desktop, "public_release_document", return_value={
                    "version": "0.2.14",
                    "portableFileName": "Helstera-0.2.14-win-x64.zip",
                    "portableSha256": "b" * 64,
                }),
                patch.object(release_desktop, "missing_public_artifacts") as find_missing,
            ):
                with self.assertRaisesRegex(RuntimeError, "published package does not match"):
                    release_desktop.verify_version_is_newer(
                        "windows-x64",
                        "0.2.14",
                        repair_current=True,
                        release_manifest=manifest_path,
                        staged_files=[],
                        stage=root,
                    )
                find_missing.assert_not_called()

    def test_public_verification_rejects_html_from_the_updater_feed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            stage = pathlib.Path(temporary)
            feed = stage / "updates" / "windows-x64"
            feed.mkdir(parents=True)
            manifest = feed / "latest.yml"
            manifest.write_text("version: 0.2.14\n", encoding="utf-8")

            with patch.object(
                release_desktop.urllib.request,
                "urlopen",
                return_value=self.response("text/html", b"<!doctype html>"),
            ):
                with self.assertRaisesRegex(RuntimeError, "HTML page"):
                    release_desktop.verify_public_installer([manifest], stage)


if __name__ == "__main__":
    unittest.main()
