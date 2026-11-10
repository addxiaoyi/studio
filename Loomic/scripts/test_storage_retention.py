import importlib.util
import json
import pathlib
import os
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('retention', pathlib.Path(__file__).with_name('storage-retention.py'))
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)

class RetentionTests(unittest.TestCase):
    def test_multiple_candidate_links_to_same_file_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            downloads = root / 'apps/web/out/downloads'
            updates = downloads / 'updates/linux-x64'
            updates.mkdir(parents=True)
            for version in [23, 28, 29, 30]:
                (downloads / f'Helstera-0.2.{version}.AppImage').write_bytes(b'installer')
            old = downloads / 'Helstera-0.2.23.AppImage'
            linked = updates / old.name
            os.link(old, linked)
            plan = retention.preview(root)
            receipt = retention.apply(root, plan)
            self.assertEqual(receipt['errors'], [])
            self.assertEqual(receipt['removedFiles'], 2)
            self.assertFalse(linked.exists())
            self.assertEqual(receipt['exclusiveBytes'], 9)

    def test_preserves_current_previous_and_referenced_installers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for stamp in ['20261101', '20261102', '20261103', '20261104']:
                backup = root / 'backups' / f'web-static-{stamp}-010000-ABCDEF1234'
                backup.mkdir(parents=True); (backup / 'out.tar.gz').write_bytes(b'archive')
            downloads = root / 'apps/web/out/downloads'; downloads.mkdir(parents=True)
            for version in range(23, 31): (downloads / f'Helstera-0.2.{version}.AppImage').write_bytes(b'app')
            (downloads / 'desktop-release-linux-x64.json').write_text(json.dumps({'version':'0.2.30','fileName':'Helstera-0.2.30.AppImage'}))
            (downloads / 'user-file.mp4').write_bytes(b'keep')
            plan = retention.preview(root)
            paths = [entry['path'] for entry in plan['files']]
            self.assertIn('backups/web-static-20261101-010000-ABCDEF1234/out.tar.gz', paths)
            self.assertNotIn('backups/web-static-20261104-010000-ABCDEF1234/out.tar.gz', paths)
            self.assertNotIn('apps/web/out/downloads/Helstera-0.2.27.AppImage', paths)
            changed = root / paths[0]; changed.write_bytes(b'changed')
            with self.assertRaisesRegex(RuntimeError,'changed'): retention.apply(root, plan)
            self.assertTrue((downloads / 'Helstera-0.2.23.AppImage').exists())

    def test_rejects_path_injection_and_removes_only_verified_archives(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for stamp in ['20261101','20261102','20261103']:
                backup = root / 'backups' / f'web-static-{stamp}-010000-ABCDEF1234'
                backup.mkdir(parents=True); (backup/'out.tar.gz').write_bytes(b'archive')
            plan = retention.preview(root)
            plan['files'][0]['path'] = '../outside'
            with self.assertRaises(ValueError): retention.apply(root, plan)
            plan = retention.preview(root)
            receipt = retention.apply(root, plan)
            self.assertEqual(receipt['removedFiles'], 1)
            self.assertEqual(receipt['unlinkedBytes'], 7)
            self.assertEqual(len(retention.preview(root)['files']), 0)

if __name__ == '__main__': unittest.main()
