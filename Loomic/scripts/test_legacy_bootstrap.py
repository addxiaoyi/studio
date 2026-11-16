"""Exercise bridge orchestration without shell, PM2, Nginx, or PostgreSQL."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).with_name('legacy-bootstrap.py'))
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class FakeHost:
    def __init__(self, journal, failure=None, rollback_failure=None, false_proof=None):
        self.journal = journal
        self.failure = failure
        self.rollback_failure = rollback_failure
        self.false_proof = false_proof
        self.calls = []
        self.routes = 'legacy'
        self.api = {'legacy': True, 'bridge': False}
        self.worker = {'legacy': True, 'bridge': False}
        self.failed = False
        self.snapshots = []

    def __getattr__(self, action):
        if action not in set(bootstrap.PHASES) | set(bootstrap.ROLLBACK_ACTIONS):
            raise AttributeError(action)

        def run():
            report = json.loads(self.journal.read_bytes())
            expected = action if report['phase'] == action else 'rollback:' + action
            if report['phase'] != expected:
                raise AssertionError(f'{action} ran before its durable journal entry')
            self.snapshots.append(report)
            self.calls.append(action)
            if action == 'block_ingress':
                self.routes = 'maintenance'
            elif action == 'stop_legacy_api':
                if not self.worker['legacy']:
                    raise AssertionError('Legacy worker stopped before legacy API')
                self.api['legacy'] = False
            elif action == 'stop_legacy_worker':
                if self.api['legacy']:
                    raise AssertionError('Legacy API can still submit work')
                self.worker['legacy'] = False
            elif action == 'start_bridge_api':
                if self.api['legacy'] or self.worker['legacy']:
                    raise AssertionError('Legacy writers remain active')
                self.api['bridge'] = True
            elif action == 'start_bridge_worker':
                if self.worker['legacy']:
                    raise AssertionError('Two worker generations would overlap')
                self.worker['bridge'] = True
            elif action == 'switch_routes':
                self.routes = 'bridge'
            elif action == 'drain_bridge_api':
                if self.api['bridge'] and 'start_bridge_worker' in report['attempted'] and not self.worker['bridge']:
                    raise AssertionError('Bridge worker stopped before its API')
                self.api['bridge'] = False
            elif action == 'drain_bridge_worker':
                if self.api['bridge']:
                    raise AssertionError('Bridge API may still submit work')
                self.worker['bridge'] = False
            elif action == 'restart_legacy_worker':
                if self.api['bridge'] or self.worker['bridge']:
                    raise AssertionError('Bridge still owns work')
                self.worker['legacy'] = True
            elif action == 'restart_legacy_api':
                if not self.worker['legacy']:
                    raise AssertionError('Legacy API started before its worker')
                self.api['legacy'] = True
            elif action == 'verify_legacy':
                if not self.api['legacy'] or not self.worker['legacy']:
                    raise AssertionError('Legacy service is unavailable')
            elif action == 'restore_routes':
                if 'verify_legacy' not in self.calls:
                    raise AssertionError('Legacy traffic restored before health proof')
                self.routes = 'legacy'
            is_rollback = report['phase'].startswith('rollback:')
            if is_rollback and action == self.rollback_failure:
                raise RuntimeError('recovery operation failed')
            if not is_rollback and action == self.failure and not self.failed:
                self.failed = True
                raise RuntimeError('identity or phase proof failed')
            if action == self.false_proof:
                return False
            return True if action in bootstrap.PROOF_ACTIONS else None

        return run


class BootstrapTests(unittest.TestCase):
    def test_success_obeys_phase_order_and_commits_only_after_persistence(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'journal.json'
            host = FakeHost(journal)
            report = bootstrap.rollout(host, journal)
            self.assertEqual(host.calls, list(bootstrap.PHASES))
            self.assertEqual(report['phase'], 'committed')
            self.assertEqual(report['attempted'], list(bootstrap.PHASES))
            self.assertEqual(report['completed'], list(bootstrap.PHASES))
            self.assertEqual(host.snapshots[-1]['phase'], 'persist')
            self.assertEqual(host.routes, 'bridge')
            self.assertNotIn('drained', journal.read_text())

    def test_each_forward_phase_failure_rolls_back_only_attempted_roles(self):
        for failure in bootstrap.PHASES:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                journal = Path(folder) / 'journal.json'
                host = FakeHost(journal, failure=failure)
                with self.assertRaisesRegex(RuntimeError, 'identity or phase proof failed'):
                    bootstrap.rollout(host, journal)
                report = json.loads(journal.read_bytes())
                self.assertEqual(report['phase'], 'rolled_back')
                forward = list(bootstrap.PHASES[:bootstrap.PHASES.index(failure) + 1])
                self.assertEqual(report['attempted'], forward)
                if 'stop_legacy_worker' not in forward:
                    self.assertNotIn('restart_legacy_worker', host.calls)
                if 'stop_legacy_api' not in forward:
                    self.assertNotIn('restart_legacy_api', host.calls)
                if 'start_bridge_api' not in forward:
                    self.assertNotIn('drain_bridge_api', host.calls)
                self.assertEqual(host.routes, 'legacy')
                self.assertEqual(host.api, {'legacy': True, 'bridge': False})
                self.assertEqual(host.worker, {'legacy': True, 'bridge': False})

    def test_candidate_rollback_blocks_then_drains_api_before_worker_and_restores_routes_last(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'journal.json'
            host = FakeHost(journal, failure='verify_public')
            with self.assertRaises(RuntimeError):
                bootstrap.rollout(host, journal)
            tail = host.calls[len(bootstrap.PHASES) - 1:]
            self.assertEqual(tail, ['block_ingress', 'drain_bridge_api', 'drain_bridge_worker',
                                   'verify_quiescent', 'restart_legacy_worker', 'restart_legacy_api',
                                   'verify_legacy', 'restore_routes', 'persist_rollback'])

    def test_drain_or_quiescence_failure_keeps_maintenance_and_never_restarts_old_worker(self):
        for failure in ['block_ingress', 'drain_bridge_api', 'drain_bridge_worker', 'verify_quiescent']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                journal = Path(folder) / 'journal.json'
                host = FakeHost(journal, failure='verify_public', rollback_failure=failure)
                with self.assertRaisesRegex(RuntimeError, 'rollback incomplete') as raised:
                    bootstrap.rollout(host, journal)
                self.assertIsInstance(raised.exception.__cause__, RuntimeError)
                report = json.loads(journal.read_bytes())
                self.assertEqual(report['phase'], 'rollback_incomplete')
                self.assertNotIn('restart_legacy_worker', host.calls)
                self.assertNotIn('restore_routes', host.calls)
                self.assertEqual(host.routes, 'maintenance')

    def test_false_stop_or_health_proofs_never_advance_to_the_next_forward_phase(self):
        for action in bootstrap.PROOF_ACTIONS & set(bootstrap.PHASES):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as folder:
                journal = Path(folder) / 'journal.json'
                host = FakeHost(journal, false_proof=action)
                with self.assertRaises(RuntimeError):
                    bootstrap.rollout(host, journal)
                report = json.loads(journal.read_bytes())
                self.assertEqual(report['attempted'][-1], action)
                if action == 'verify_quiescent':
                    self.assertEqual(report['phase'], 'rollback_incomplete')
                    self.assertNotIn('restart_legacy_worker', host.calls)

    def test_no_route_restore_or_further_restarts_after_a_rollback_failure(self):
        for failure in ['restart_legacy_worker', 'restart_legacy_api', 'verify_legacy', 'restore_routes', 'persist_rollback']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                journal = Path(folder) / 'journal.json'
                host = FakeHost(journal, failure='verify_public', rollback_failure=failure)
                with self.assertRaisesRegex(RuntimeError, 'rollback incomplete'):
                    bootstrap.rollout(host, journal)
                self.assertEqual(host.calls[-1], failure)
                self.assertEqual(json.loads(journal.read_bytes())['phase'], 'rollback_incomplete')

    def test_initial_journal_failure_prevents_even_preflight_and_existing_journal_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'journal.json'
            host = FakeHost(journal)
            with patch.object(bootstrap, 'write_journal', side_effect=OSError('disk unavailable')):
                with self.assertRaises(OSError):
                    bootstrap.rollout(host, journal)
            self.assertEqual(host.calls, [])
            journal.write_text('{"phase":"another transaction"}')
            with self.assertRaisesRegex(FileExistsError, 'exists'):
                bootstrap.rollout(host, journal)
            self.assertEqual(journal.read_text(), '{"phase":"another transaction"}')

    def test_recovery_retries_safe_rollback_after_an_interruption(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'journal.json'
            host = FakeHost(journal, failure='verify_public', rollback_failure='drain_bridge_api')
            with self.assertRaises(RuntimeError):
                bootstrap.rollout(host, journal)
            host.rollback_failure = None
            report = bootstrap.recover(host, journal)
            self.assertEqual(report['phase'], 'rolled_back')
            self.assertEqual(host.routes, 'legacy')
            self.assertEqual(host.worker, {'legacy': True, 'bridge': False})

    def test_recovery_after_route_restore_only_rechecks_legacy_and_persists(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'journal.json'
            host = FakeHost(journal, failure='verify_public', rollback_failure='persist_rollback')
            with self.assertRaises(RuntimeError):
                bootstrap.rollout(host, journal)
            host.rollback_failure = None
            before = len(host.calls)
            report = bootstrap.recover(host, journal)
            self.assertEqual(host.calls[before:], ['verify_legacy', 'persist_rollback'])
            self.assertEqual(report['phase'], 'rolled_back')

    def test_none_is_not_a_valid_stop_proof(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'journal.json'
            host = FakeHost(journal)
            stop = host.stop_legacy_api

            def no_proof():
                stop()
                return None

            host.stop_legacy_api = no_proof
            with self.assertRaisesRegex(RuntimeError, 'affirmative proof'):
                bootstrap.rollout(host, journal)
            self.assertNotIn('stop_legacy_worker', host.calls)
            self.assertNotIn('start_bridge_api', host.calls)

    def test_recovery_rejects_tampered_phase_sequences_and_leaves_completed_transactions_alone(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'journal.json'
            host = FakeHost(journal)
            journal.write_text(json.dumps({'phase': 'start_bridge_worker', 'attempted': ['preflight', 'start_bridge_worker']}))
            with self.assertRaises(ValueError):
                bootstrap.recover(host, journal)
            self.assertEqual(host.calls, [])
            journal.unlink()
            report = bootstrap.rollout(host, journal)
            calls = list(host.calls)
            self.assertEqual(bootstrap.recover(host, journal), report)
            self.assertEqual(host.calls, calls)


if __name__ == '__main__':
    unittest.main()
