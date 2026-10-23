import importlib.util
import pathlib
import unittest


SCRIPT = pathlib.Path(__file__).with_name("release-desktop.py")
SPEC = importlib.util.spec_from_file_location("release_desktop", SCRIPT)
release_desktop = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(release_desktop)


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
        stage = pathlib.Path("C:/tmp/stage")
        output = pathlib.Path("C:/tmp/build")

        self.assertEqual(release_desktop.resolve_stage_path(self.root, stage), stage.resolve())
        self.assertEqual(release_desktop.resolve_build_output(self.root, output), output.resolve())

    def test_platform_installer_patterns_match_electron_builder_arch_names(self) -> None:
        version = "0.2.14"
        self.assertEqual(release_desktop.installer_pattern("windows-x64", version), "Helstera-Setup-0.2.14-Windows-x64.exe")
        self.assertEqual(release_desktop.installer_pattern("macos-x64", version), "Helstera-0.2.14-mac-x64.dmg")
        self.assertEqual(release_desktop.installer_pattern("macos-arm64", version), "Helstera-0.2.14-mac-arm64.dmg")
        self.assertEqual(release_desktop.installer_pattern("linux-x64", version), "*.AppImage")


if __name__ == "__main__":
    unittest.main()
