import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('route-public-media-recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
CONFIG = '''server {
    root /www/helstera/apps/web/out;
    location /api/ { proxy_pass http://127.0.0.1:3003; }
    location ^~ /fashion-gallery/img/ {
        proxy_pass http://127.0.0.1:3003/api/public-media/fashion-gallery/img/;
    }
    location ^~ /fashion-gallery/thumbs/ {
        proxy_pass http://127.0.0.1:3003/api/public-media/fashion-gallery/thumbs/;
    }
}
'''


class PublicMediaRecoveryTests(unittest.TestCase):
    def test_changes_only_the_public_gallery_and_adds_matching_api_routes(self):
        updated = recovery.prepare(CONFIG, 3003, 3014)
        self.assertIn('location /api/ { proxy_pass http://127.0.0.1:3003; }', updated)
        self.assertIn('root /www/helstera/apps/web/out;', updated)
        self.assertEqual(updated.count('location ^~ /api/public-media/fashion-gallery/'), 2)
        self.assertEqual(updated.count('proxy_pass http://127.0.0.1:3014'), 4)

    def test_refuses_an_unexpected_existing_upstream(self):
        with self.assertRaises(ValueError):
            recovery.prepare(CONFIG.replace(':3003/api/public-media/', ':9000/api/public-media/'), 3003, 3014)

    def test_refuses_duplicate_or_nested_locations(self):
        for config in [CONFIG + CONFIG, CONFIG.replace('location ^~ /fashion-gallery/thumbs/', 'location ^~ /fashion-gallery/img/'), CONFIG.replace('proxy_pass http', 'if ($arg_probe) { return 404; } proxy_pass http')]:
            with self.assertRaises(ValueError):
                recovery.prepare(config, 3003, 3014)

    def test_rolls_back_bytes_when_validation_or_reload_fails(self):
        for failure in (['nginx', '-t'], ['nginx', '-s', 'reload']):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
                config.write_text(CONFIG)
                calls = []
                failed = False

                def runner(command):
                    nonlocal failed
                    calls.append(command)
                    if command == failure and not failed:
                        failed = True
                        raise subprocess.CalledProcessError(1, command)

                with self.assertRaises(subprocess.CalledProcessError):
                    recovery.apply(config, backup, receipt, 3003, 3014, runner)
                self.assertEqual(config.read_text(), CONFIG)
                self.assertEqual(backup.read_text(), CONFIG)
                self.assertFalse(receipt.exists())
                self.assertEqual(calls[-1], ['nginx', '-s', 'reload'])

    def test_verified_rollback_refuses_outside_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
            config.write_text(CONFIG)
            runner = lambda command: None
            recovery.apply(config, backup, receipt, 3003, 3014, runner)
            changed = config.read_text() + '# outside edit\n'
            config.write_text(changed)
            with self.assertRaises(RuntimeError):
                recovery.rollback(receipt, runner)
            self.assertEqual(config.read_text(), changed)

    def test_apply_failure_preserves_an_outside_config_edit(self):
        with tempfile.TemporaryDirectory() as folder:
            config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
            config.write_text(CONFIG)
            changed = CONFIG + '# another deployment\n'
            failure = subprocess.CalledProcessError(1, ['nginx', '-t'])
            calls = []

            def runner(command):
                calls.append(command)
                config.write_text(changed)
                raise failure

            with self.assertRaisesRegex(RuntimeError, 'changed during recovery') as raised:
                recovery.apply(config, backup, receipt, 3003, 3014, runner)
            self.assertIs(raised.exception.__cause__, failure)
            self.assertEqual(config.read_text(), changed)
            self.assertEqual(backup.read_text(), CONFIG)
            self.assertFalse(receipt.exists())
            self.assertEqual(calls, [['nginx', '-t']])

    def test_apply_does_not_record_a_concurrent_config_edit_as_its_cutover(self):
        with tempfile.TemporaryDirectory() as folder:
            config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
            config.write_text(CONFIG)
            changed = CONFIG + '# another deployment\n'

            def runner(command):
                if command == ['nginx', '-s', 'reload']:
                    config.write_text(changed)

            with self.assertRaisesRegex(RuntimeError, 'changed during recovery'):
                recovery.apply(config, backup, receipt, 3003, 3014, runner)
            self.assertEqual(config.read_text(), changed)
            self.assertFalse(receipt.exists())

    def test_can_restore_the_exact_reviewed_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
            config.write_text(CONFIG)
            runner = lambda command: None
            recovery.apply(config, backup, receipt, 3003, 3014, runner)
            recovery.rollback(receipt, runner)
            self.assertEqual(config.read_text(), CONFIG)
            self.assertEqual(json.loads(receipt.read_text())['phase'], 'rolled_back')

    def test_failed_rollback_restores_recovery_routing_and_can_be_retried(self):
        for failure in (['nginx', '-t'], ['nginx', '-s', 'reload']):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
                config.write_text(CONFIG)
                recovery.apply(config, backup, receipt, 3003, 3014, lambda command: None)
                routed = config.read_bytes()
                calls = []
                failed = False

                def runner(command):
                    nonlocal failed
                    calls.append(command)
                    if command == failure and not failed:
                        failed = True
                        raise subprocess.CalledProcessError(1, command)

                with self.assertRaises(subprocess.CalledProcessError) as raised:
                    recovery.rollback(receipt, runner)
                self.assertEqual(raised.exception.cmd, failure)
                self.assertEqual(config.read_bytes(), routed)
                self.assertEqual(json.loads(receipt.read_text())['phase'], 'routed')
                self.assertEqual(calls[-2:], [['nginx', '-t'], ['nginx', '-s', 'reload']])
                recovery.rollback(receipt, runner)
                self.assertEqual(config.read_text(), CONFIG)

    def test_failed_rollback_receipt_write_restores_recovery_routing(self):
        with tempfile.TemporaryDirectory() as folder:
            config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
            config.write_text(CONFIG)
            recovery.apply(config, backup, receipt, 3003, 3014, lambda command: None)
            routed = config.read_bytes()
            write = recovery.atomic_write

            def reject_receipt(path, content):
                if path == receipt:
                    raise OSError('receipt is read-only')
                write(path, content)

            with patch.object(recovery, 'atomic_write', side_effect=reject_receipt):
                with self.assertRaisesRegex(OSError, 'receipt is read-only'):
                    recovery.rollback(receipt, lambda command: None)
            self.assertEqual(config.read_bytes(), routed)
            self.assertEqual(json.loads(receipt.read_text())['phase'], 'routed')
            recovery.rollback(receipt, lambda command: None)
            self.assertEqual(config.read_text(), CONFIG)

    def test_failed_rollback_preserves_an_outside_config_edit(self):
        with tempfile.TemporaryDirectory() as folder:
            config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
            config.write_text(CONFIG)
            recovery.apply(config, backup, receipt, 3003, 3014, lambda command: None)
            changed = CONFIG + '# another deployment\n'

            def runner(command):
                config.write_text(changed)
                raise subprocess.CalledProcessError(1, command)

            with self.assertRaisesRegex(RuntimeError, 'changed during rollback') as raised:
                recovery.rollback(receipt, runner)
            self.assertIsInstance(raised.exception.__cause__, subprocess.CalledProcessError)
            self.assertEqual(config.read_text(), changed)
            self.assertEqual(json.loads(receipt.read_text())['phase'], 'routed')

    def test_failed_recovery_reload_keeps_both_failure_contexts_and_allows_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
            config.write_text(CONFIG)
            recovery.apply(config, backup, receipt, 3003, 3014, lambda command: None)
            routed = config.read_bytes()
            failures = []

            def runner(command):
                if command != ['nginx', '-s', 'reload']:
                    return
                error = subprocess.CalledProcessError(len(failures) + 1, command)
                failures.append(error)
                raise error

            with self.assertRaisesRegex(RuntimeError, 'recovery routing') as raised:
                recovery.rollback(receipt, runner)
            self.assertIs(raised.exception.__cause__, failures[1])
            self.assertIs(failures[1].__context__, failures[0])
            self.assertEqual(config.read_bytes(), routed)
            recovery.rollback(receipt, lambda command: None)
            self.assertEqual(config.read_text(), CONFIG)

    def test_rollback_refuses_a_modified_backup_before_touching_config(self):
        with tempfile.TemporaryDirectory() as folder:
            config, backup, receipt = (Path(folder) / name for name in ('nginx.conf', 'before.conf', 'receipt.json'))
            config.write_text(CONFIG)
            recovery.apply(config, backup, receipt, 3003, 3014, lambda command: None)
            routed = config.read_bytes()
            backup.write_text(CONFIG + '# modified backup\n')
            calls = []
            with self.assertRaisesRegex(RuntimeError, 'backup differs'):
                recovery.rollback(receipt, calls.append)
            self.assertEqual(config.read_bytes(), routed)
            self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
