"""One-time lifecycle bridge orchestration; the injected host owns all live proofs."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from typing import Protocol


PHASES = ('preflight', 'block_ingress', 'stop_legacy_api', 'stop_legacy_worker',
          'verify_quiescent', 'start_bridge_api', 'verify_bridge_api',
          'start_bridge_worker', 'verify_bridge_worker', 'switch_routes',
          'verify_public', 'persist')
ROLLBACK_ACTIONS = ('block_ingress', 'drain_bridge_api', 'drain_bridge_worker',
                    'verify_quiescent', 'restart_legacy_worker', 'restart_legacy_api',
                    'verify_legacy', 'restore_routes', 'persist_rollback')
PROOF_ACTIONS = frozenset(('stop_legacy_api', 'stop_legacy_worker', 'verify_quiescent',
                           'verify_bridge_api', 'verify_bridge_worker', 'verify_public',
                           'drain_bridge_api', 'drain_bridge_worker', 'verify_legacy'))


class BootstrapHost(Protocol):
    # Stop proofs describe observed legacy exits, never process-authored drain receipts.
    def preflight(self) -> None: ...
    def block_ingress(self) -> None: ...
    def stop_legacy_api(self) -> bool: ...
    def stop_legacy_worker(self) -> bool: ...
    def verify_quiescent(self) -> bool: ...
    def start_bridge_api(self) -> None: ...
    def verify_bridge_api(self) -> bool: ...
    def start_bridge_worker(self) -> None: ...
    def verify_bridge_worker(self) -> bool: ...
    def switch_routes(self) -> None: ...
    def verify_public(self) -> bool: ...
    def persist(self) -> None: ...
    def drain_bridge_api(self) -> bool: ...
    def drain_bridge_worker(self) -> bool: ...
    def restart_legacy_worker(self) -> None: ...
    def restart_legacy_api(self) -> None: ...
    def verify_legacy(self) -> bool: ...
    def restore_routes(self) -> None: ...
    def persist_rollback(self) -> None: ...


def write_journal(path: Path, report: dict, *, create: bool = False) -> None:
    """Persist before invoking a host action, using an exclusive initial claim."""
    payload = (json.dumps(report, sort_keys=True, indent=2) + '\n').encode()
    temporary = None
    if create:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    else:
        descriptor, temporary = tempfile.mkstemp(prefix='.legacy-bootstrap-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        if temporary is not None:
            os.replace(temporary, path)
        if os.name == 'posix':
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def invoke(host: BootstrapHost, action: str) -> None:
    proof = getattr(host, action)()
    if action in PROOF_ACTIONS and proof is not True:
        raise RuntimeError(f'{action} did not return an affirmative proof')


def rollback_actions(attempted: list[str]) -> list[str]:
    if 'block_ingress' not in attempted:
        return []
    actions = ['block_ingress']
    if 'start_bridge_api' in attempted:
        actions.append('drain_bridge_api')
    if 'start_bridge_worker' in attempted:
        actions.append('drain_bridge_worker')
    if 'stop_legacy_worker' in attempted or 'start_bridge_api' in attempted:
        actions.append('verify_quiescent')
    if 'stop_legacy_worker' in attempted:
        actions.append('restart_legacy_worker')
    if 'stop_legacy_api' in attempted:
        actions.append('restart_legacy_api')
    return actions + ['verify_legacy', 'restore_routes', 'persist_rollback']


def rollback(host: BootstrapHost, journal: Path, report: dict) -> dict:
    actions = (['verify_legacy', 'persist_rollback'] if 'restore_routes' in report['rollbackCompleted']
               else rollback_actions(report['attempted']))
    for action in actions:
        report['phase'] = 'rollback:' + action
        report['rollbackAttempted'].append(action)
        write_journal(journal, report)
        try:
            invoke(host, action)
        except Exception as error:
            report.update(phase='rollback_incomplete', recoveryError={'action': action, 'kind': type(error).__name__})
            write_journal(journal, report)
            raise RuntimeError(f'Legacy bootstrap rollback incomplete at {action}') from error
        report['rollbackCompleted'].append(action)
    report['phase'] = 'rolled_back'
    report.pop('recoveryError', None)
    write_journal(journal, report)
    return report


def rollout(host: BootstrapHost, journal: Path) -> dict:
    if journal.exists():
        raise FileExistsError('Bootstrap journal exists; inspect or recover that transaction')
    report = {'phase': 'prepared', 'attempted': [], 'completed': [],
              'rollbackAttempted': [], 'rollbackCompleted': []}
    write_journal(journal, report, create=True)
    try:
        for phase in PHASES:
            report['phase'] = phase
            report['attempted'].append(phase)
            write_journal(journal, report)
            invoke(host, phase)
            report['completed'].append(phase)
        report['phase'] = 'committed'
        write_journal(journal, report)
        return report
    except Exception as error:
        report['error'] = {'action': report['attempted'][-1], 'kind': type(error).__name__}
        rollback(host, journal, report)
        raise


def recover(host: BootstrapHost, journal: Path) -> dict:
    """Replay rollback only; the host must make each recovery action identity-safe."""
    report = json.loads(journal.read_bytes())
    attempted = report.get('attempted') if isinstance(report, dict) else None
    completed = report.get('completed') if isinstance(report, dict) else None
    if (not isinstance(attempted, list) or attempted != list(PHASES[:len(attempted)])
            or not isinstance(completed, list) or completed != attempted[:len(completed)]
            or len(completed) > len(attempted)
            or not isinstance(report.get('rollbackAttempted'), list)
            or not isinstance(report.get('rollbackCompleted'), list)):
        raise ValueError('Bootstrap journal has an invalid phase sequence')
    if report.get('phase') == 'committed':
        if completed != list(PHASES):
            raise ValueError('Committed bootstrap is missing completed phases')
        return report
    if report.get('phase') == 'rolled_back':
        return report
    valid_phases = {'prepared', 'rollback_incomplete', *PHASES,
                    *('rollback:' + action for action in ROLLBACK_ACTIONS)}
    if report.get('phase') not in valid_phases:
        raise ValueError('Bootstrap journal has an unknown recovery state')
    report['recovered'] = True
    return rollback(host, journal, report)
