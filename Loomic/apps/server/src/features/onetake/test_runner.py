import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("onetake_runner", Path(__file__).with_name("runner.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class SubtitleSizingTests(unittest.TestCase):
    def test_reviewed_source_accepts_both_checkout_line_endings_and_rejects_edits(self):
        source = Path(__file__).with_name("upstream") / "asr_demo.py"
        contents = source.read_bytes().replace(b"\r\n", b"\n")
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory) / "asr_demo.py"
            for content in (contents, contents.replace(b"\n", b"\r\n")):
                checkout.write_bytes(content)
                runner.verify_source(checkout)
            checkout.write_bytes(contents + b"# modified\n")
            with self.assertRaisesRegex(RuntimeError, "reviewed pinned version"):
                runner.verify_source(checkout)

    def test_auto_size_follows_output_orientation(self):
        self.assertEqual(runner.subtitle_dimensions(720, 1280, None), (51, 128))
        self.assertEqual(runner.subtitle_dimensions(1280, 720, None), (36, 57))

    def test_manual_size_and_small_sources_remain_readable(self):
        self.assertEqual(runner.subtitle_dimensions(720, 1280, 32), (32, 128))
        self.assertEqual(runner.subtitle_dimensions(320, 180, None), (16, 14))


if __name__ == "__main__":
    unittest.main()
