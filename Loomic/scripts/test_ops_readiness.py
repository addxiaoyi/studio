from pathlib import Path
import tempfile
import unittest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from scripts.ops_crypto import encrypt_backup, decrypt_backup
from scripts.ops_monitor import evaluate_checks, notification_due
from scripts.ops_backup import sha256_file
from scripts.ops_external_monitor import should_notify


class BackupCryptoTest(unittest.TestCase):
    def test_restores_bytes_and_rejects_tampering_without_partial_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            public = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
            private_bytes = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
            source, encrypted, restored = (root / name for name in ['source.tar', 'backup.enc', 'restored.tar'])
            source.write_bytes(b'secret database' * 10000)
            encrypt_backup(source, encrypted, public)
            self.assertNotIn(b'secret database', encrypted.read_bytes())
            decrypt_backup(encrypted, restored, private_bytes)
            self.assertEqual(source.read_bytes(), restored.read_bytes())
            self.assertEqual(sha256_file(source), sha256_file(restored))
            content = bytearray(encrypted.read_bytes())
            content[-20] ^= 1
            encrypted.write_bytes(content)
            restored.unlink()
            with self.assertRaises(Exception):
                decrypt_backup(encrypted, restored, private_bytes)
            self.assertFalse(restored.exists())
            self.assertFalse(restored.with_suffix('.tar.partial').exists())


class MonitorTest(unittest.TestCase):
    def test_external_outage_requires_two_failures_and_reports_recovery(self):
        self.assertFalse(should_notify(False,1,{},100))
        self.assertTrue(should_notify(False,2,{},100))
        prior={'notifiedDown':True,'sentAt':100}
        self.assertFalse(should_notify(False,3,prior,200))
        self.assertTrue(should_notify(True,0,prior,200))

    def test_reports_independent_failures_without_crashing(self):
        issues = evaluate_checks({'ready': False, 'workerOnline': False, 'queued': 8,
                                  'oldestQueuedSeconds': 1500, 'oldestRunningSeconds': 8000,
                                  'diskFreeBytes': 1000, 'diskFreeRatio': 0.01,
                                  'backupAgeSeconds': 100000, 'offsiteAgeSeconds': 100000,
                                  'restoreAgeSeconds': 900000})
        self.assertEqual(set(issues), {'readiness','worker','queue','running','disk','backup','offsite','restore'})

    def test_missing_backup_and_worker_are_failures(self):
        self.assertIn('backup', evaluate_checks({}))
        self.assertIn('worker', evaluate_checks({}))

    def test_alert_changes_recoveries_and_repeats_are_delivered(self):
        self.assertTrue(notification_due(['worker'], {}, 100))
        prior = {'issues':['worker'], 'sentAt':100}
        self.assertFalse(notification_due(['worker'], prior, 200))
        self.assertTrue(notification_due([], prior, 200))
        self.assertTrue(notification_due(['worker'], prior, 4000))
        self.assertFalse(notification_due([], {}, 100))


if __name__ == '__main__':
    unittest.main()
