import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


class FakeHost:
    def __init__(self, failure=None, rollback_failure=None):
        self.failure, self.rollback_failure = failure, rollback_failure
        self.calls = []
        self.routes = 'old'
        self.api = {'old': True, 'new': False}
        self.worker = {'old': True, 'new': False}
        self.migrated = False
        self.recovering = False

    def __getattr__(self, name):
        def run():
            self.calls.append(name)
            if name == 'is_committed':
                return False
            if name == 'block_ingress':
                self.routes = 'maintenance'
                if self.calls.count(name) > 1:
                    self.recovering = True
            if name == 'drain_old_api':
                if self.routes != 'maintenance' or not self.worker['old']:
                    raise AssertionError('Old API must drain behind maintenance with its worker alive')
                self.api['old'] = False
            if name == 'drain_worker':
                if self.api['old']:
                    raise AssertionError('Old API can still submit work')
                self.worker['old'] = False
            if name == 'migrate':
                if any(self.api.values()) or any(self.worker.values()) or self.routes != 'maintenance':
                    raise AssertionError('Schema migration requires every application writer stopped')
                self.migrated = True
            if name == 'start_api':
                if not self.migrated or 'verify_schema' not in self.calls:
                    raise AssertionError('Candidate must not start before recorded checksum verification')
                self.api['new'] = True
            if name == 'start_worker':
                if self.worker['old']:
                    raise AssertionError('Worker generations overlap')
                self.worker['new'] = True
            if name == 'switch_routes':
                self.routes = 'new'
            if name == 'stop_candidate_api':
                if self.worker['new'] is False and self.api['new'] and 'start_worker' in self.calls:
                    raise AssertionError('Candidate API lost its matching worker')
                self.api['new'] = False
            if name == 'stop_candidate_worker':
                if self.api['new']:
                    raise AssertionError('Candidate API may still submit work')
                self.worker['new'] = False
            if name in ('restart_worker', 'restart_api'):
                if self.migrated and 'verify_downgrade' not in self.calls:
                    raise AssertionError('Old code must not start without a downgrade proof')
                if any((self.api['new'], self.worker['new'])):
                    raise AssertionError('Candidate writers are still active')
                (self.worker if name == 'restart_worker' else self.api)['old'] = True
            if name == 'restore_routes':
                if not self.api['old'] or not self.worker['old'] or 'verify_legacy' not in self.calls:
                    raise AssertionError('Old ingress restored before old service readiness')
                self.routes = 'old'
            if (self.recovering and name == self.rollback_failure or
                    not self.recovering and name == self.failure):
                raise RuntimeError('fixture phase failed: ' + name)
        return run


class MigrationReleaseTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('migration-release.py')
        self.assertTrue(path.is_file(), 'Missing maintenance migration release adapter')
        spec = importlib.util.spec_from_file_location('migration_release', path)
        self.release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.release)

    def test_migration_runs_only_after_both_old_processes_drained_and_before_candidate_start(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost()
            report = self.release.migration_rollout(host, Path(folder) / 'transaction.json')
            self.assertEqual(report['phase'], 'committed')
            self.assertEqual(host.calls, ['preflight', *self.release.MIGRATION_PHASES])
            self.assertLess(host.calls.index('verify_quiescent'), host.calls.index('migrate'))
            self.assertLess(host.calls.index('verify_schema'), host.calls.index('start_api'))

    def test_every_forward_failure_reaches_verified_old_service_or_holds_maintenance(self):
        for phase in self.release.MIGRATION_PHASES:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as folder:
                host = FakeHost(failure=phase)
                journal = Path(folder) / 'transaction.json'
                with self.assertRaisesRegex(RuntimeError, 'fixture phase failed'):
                    self.release.migration_rollout(host, journal)
                self.assertEqual(json.loads(journal.read_bytes())['phase'], 'rolled_back')
                self.assertEqual(host.routes, 'old')
                self.assertEqual(host.api, {'old': True, 'new': False})
                self.assertEqual(host.worker, {'old': True, 'new': False})

    def test_downgrade_blocker_preserves_maintenance_without_restarting_old_code(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost(failure='verify_public', rollback_failure='verify_downgrade')
            journal = Path(folder) / 'transaction.json'
            with self.assertRaisesRegex(RuntimeError, 'rollback incomplete'):
                self.release.migration_rollout(host, journal)
            self.assertEqual(host.routes, 'maintenance')
            self.assertNotIn('restart_worker', host.calls)
            self.assertNotIn('restart_api', host.calls)
            self.assertEqual(json.loads(journal.read_bytes())['phase'], 'rollback_incomplete')

    def test_candidate_api_drain_failure_preserves_its_worker(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost(failure='verify_public', rollback_failure='stop_candidate_api')
            with self.assertRaisesRegex(RuntimeError, 'rollback incomplete'):
                self.release.migration_rollout(host, Path(folder) / 'transaction.json')
            self.assertNotIn('stop_candidate_worker', host.calls)
            self.assertNotIn('restart_worker', host.calls)
            self.assertTrue(host.worker['new'])

    def test_failed_strict_checksum_never_starts_candidate(self):
        with tempfile.TemporaryDirectory() as folder:
            host = FakeHost(failure='verify_schema')
            with self.assertRaises(RuntimeError):
                self.release.migration_rollout(host, Path(folder) / 'transaction.json')
            self.assertNotIn('start_api', host.calls)
            self.assertLess(host.calls.index('verify_downgrade'), host.calls.index('restart_worker'))

    def test_recovery_refuses_corrupt_phase_order_before_any_host_actions(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'transaction.json'
            journal.write_text(json.dumps({'phase': 'migrate', 'attempted': ['migrate']}))
            host = FakeHost()
            with self.assertRaises(ValueError):
                self.release.migration_recover(host, journal)
            self.assertEqual(host.calls, [])


if __name__ == '__main__':
    unittest.main()
