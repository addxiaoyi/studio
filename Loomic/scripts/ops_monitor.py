"""Check independent production signals and deliver deduplicated failure/recovery alerts."""
import argparse
import json
from pathlib import Path
import shutil
import ssl
import time
import urllib.request

if __package__:
    from .ops_common import lock_operation, read_config, runtime, write_json
else:
    from ops_common import lock_operation, read_config, runtime, write_json

BACKUP_MAX_AGE = 26 * 60 * 60
RESTORE_MAX_AGE = 8 * 24 * 60 * 60
REPEAT_SECONDS = 60 * 60


def evaluate_checks(checks: dict) -> list[str]:
    issues = []
    if checks.get('ready') is not True:
        issues.append('readiness')
    if checks.get('workerOnline') is not True:
        issues.append('worker')
    if checks.get('oldestQueuedSeconds', 0) > 600:
        issues.append('queue')
    if checks.get('oldestRunningSeconds', 0) > 7200:
        issues.append('running')
    if checks.get('diskFreeBytes', 0) < 8 * 1024**3 or checks.get('diskFreeRatio', 0) < 0.10:
        issues.append('disk')
    if checks.get('backupAgeSeconds', float('inf')) > BACKUP_MAX_AGE:
        issues.append('backup')
    if checks.get('offsiteAgeSeconds', float('inf')) > BACKUP_MAX_AGE:
        issues.append('offsite')
    if checks.get('restoreAgeSeconds', float('inf')) > RESTORE_MAX_AGE:
        issues.append('restore')
    return issues


def notification_due(issues: list[str], prior: dict, now: float) -> bool:
    changed = sorted(issues) != sorted(prior.get('issues', []))
    return changed or bool(issues and now - prior.get('sentAt', 0) >= REPEAT_SECONDS)


def read_receipt(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def collect_checks(config_path: str, config: dict) -> dict:
    checks = {}
    try:
        with urllib.request.urlopen(config['healthUrl'], timeout=15, context=ssl.create_default_context()) as response:
            health = json.load(response)
        checks['ready'] = health.get('ok') is True and all(health.get('checks', {}).get(name, {}).get('ok') is True for name in ['database','storage','accepting'])
        checks['version'] = health.get('version')
    except Exception as error:
        checks.update({'ready': False, 'readinessError': type(error).__name__})
    try:
        checks.update(runtime(config_path, 'database'))
    except Exception as error:
        checks.update({'workerOnline': False, 'databaseError': type(error).__name__})
    disk = shutil.disk_usage(config['backupRoot'])
    checks.update({'diskFreeBytes': disk.free, 'diskFreeRatio': disk.free / disk.total})
    now = time.time()
    for filename, fields in [('latest.json', {'completedAt':'backupAgeSeconds','offsiteCompletedAt':'offsiteAgeSeconds'}), ('restore.json', {'completedAt':'restoreAgeSeconds'})]:
        try:
            receipt = read_receipt(Path(config['backupRoot']) / filename)
            for source, target in fields.items():
                if receipt.get(source):
                    checks[target] = max(0, now - receipt[source])
        except (OSError, ValueError):
            checks[filename + 'Invalid'] = True
    return checks


def monitor(config_path: str, test_notice: bool = False) -> dict:
    config = read_config(config_path)
    root = Path(config['root'])
    with lock_operation(root, 'monitor'):
        now = time.time()
        checks = collect_checks(config_path, config)
        issues = evaluate_checks(checks)
        prior = read_receipt(root / 'last-notice.json')
        report = {'checkedAt': now, 'checks': checks, 'issues': issues, 'alertsEnabled': config.get('alertsEnabled', False)}
        report['deferred'] = ['offsite'] if config.get('offsiteEnabled') is False else []
        write_json(root / 'health.json', report)
        due = notification_due(issues, prior, now)
        if not (test_notice or due) or not config.get('alertsEnabled'):
            return report
        status = 'TEST' if test_notice else ('ALERT' if issues else 'RECOVERED')
        notice = {'subject': '[Helstera] ' + status + ' studio.0st.top',
                  'text': 'Helstera production monitoring\nStatus: ' + status + '\nIssues: ' + (', '.join(issues) or 'none') + '\n\n' + json.dumps(checks, indent=2) + '\n\nThis message contains no user content or credentials.'}
        notice_path = root / 'pending-notice.json'
        write_json(notice_path, notice)
        delivery = runtime(config_path, 'mail', str(notice_path))
        report['delivery'] = delivery
        write_json(root / ('test-notice.json' if test_notice else 'last-notice.json'), {'issues': issues, 'sentAt': now, 'delivery': delivery})
        notice_path.unlink()
        return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--test-notice', action='store_true')
    args = parser.parse_args()
    print(json.dumps(monitor(args.config, args.test_notice), indent=2))


if __name__ == '__main__':
    main()
