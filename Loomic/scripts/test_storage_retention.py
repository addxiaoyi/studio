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
    def test_keeps_the_newest_three_versions_per_update_platform(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            downloads = root / 'apps/web/out/downloads'
            linux = downloads / 'updates/linux-x64'
            windows = downloads / 'updates/windows-x64'
            linux.mkdir(parents=True)
            windows.mkdir(parents=True)
            for patch in range(20, 26):
                (linux / f'Helstera-0.2.{patch}.AppImage').write_bytes(b'linux')
            for patch in range(10, 16):
                (windows / f'Helstera-0.2.{patch}.exe').write_bytes(b'windows')
            for patch in range(40, 44):
                (downloads / f'Helstera-0.2.{patch}.zip').write_bytes(b'global')

            paths = {entry['path'] for entry in retention.preview(root)['files']}

            self.assertIn('apps/web/out/downloads/updates/linux-x64/Helstera-0.2.20.AppImage', paths)
            self.assertNotIn('apps/web/out/downloads/updates/linux-x64/Helstera-0.2.23.AppImage', paths)
            self.assertIn('apps/web/out/downloads/updates/windows-x64/Helstera-0.2.10.exe', paths)
            self.assertNotIn('apps/web/out/downloads/updates/windows-x64/Helstera-0.2.13.exe', paths)
            self.assertIn('apps/web/out/downloads/Helstera-0.2.40.zip', paths)
            self.assertNotIn('apps/web/out/downloads/Helstera-0.2.41.zip', paths)

    def test_multiple_candidate_links_to_same_file_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            downloads = root / 'apps/web/out/downloads'
            updates = downloads / 'updates/linux-x64'
            updates.mkdir(parents=True)
            for version in [23, 28, 29, 30]:
                (downloads / f'Helstera-0.2.{version}.AppImage').write_bytes(b'installer')
            for version in [31, 32, 33]:
                (updates / f'Helstera-0.2.{version}.AppImage').write_bytes(b'newer')
            old = downloads / 'Helstera-0.2.23.AppImage'
            linked = updates / old.name
            os.link(old, linked)
            plan = retention.preview(root)
            receipt = retention.apply(root, plan)
            self.assertEqual(receipt['errors'], [])
            self.assertEqual(receipt['removedFiles'], 2, receipt['paths'])
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

    def test_preserves_channel_referenced_installer_and_rejects_manifest_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            downloads = root / 'apps/web/out/downloads'
            channel = downloads / 'updates/windows-x64'
            channel.mkdir(parents=True)
            for patch in range(20, 26):
                installer = channel / f'Helstera-Setup-0.2.{patch}-Windows-x64.exe'
                installer.write_bytes(f'installer-{patch}'.encode())
                pathlib.Path(str(installer) + '.blockmap').write_bytes(b'blockmap')
            manifest = channel / 'latest.yml'
            manifest.write_text(
                'version: 0.2.25\nfiles:\n  - url: Helstera-Setup-0.2.20-Windows-x64.exe\n',
                encoding='utf-8',
            )

            plan = retention.preview(root, 'installers')
            paths = {entry['path'] for entry in plan['files']}
            referenced = 'apps/web/out/downloads/updates/windows-x64/Helstera-Setup-0.2.20-Windows-x64.exe'
            referenced_blockmap = referenced + '.blockmap'
            self.assertNotIn(referenced, paths)
            self.assertNotIn(referenced_blockmap, paths)
            self.assertIn(
                'apps/web/out/downloads/updates/windows-x64/Helstera-Setup-0.2.21-Windows-x64.exe',
                paths,
            )

            manifest.write_text(
                'version: 0.2.25\nfiles:\n  - url: Helstera-Setup-0.2.21-Windows-x64.exe\n',
                encoding='utf-8',
            )
            with self.assertRaisesRegex(RuntimeError, 'Published channels changed'):
                retention.apply(root, plan, 'installers')
            self.assertTrue((channel / 'Helstera-Setup-0.2.20-Windows-x64.exe').exists())
            self.assertTrue((channel / 'Helstera-Setup-0.2.20-Windows-x64.exe.blockmap').exists())

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
