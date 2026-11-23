"""Restore the newest local dump into a private Unix-socket-only cluster."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

if __package__:
    from .ops_common import lock_operation, read_config, write_json
    from .ops_backup import sha256_file
else:
    from ops_common import lock_operation, read_config, write_json
    from ops_backup import sha256_file


def restore_rehearsal(config_path: str) -> dict:
    config = read_config(config_path)
    root, backups = Path(config['root']), Path(config['backupRoot'])
    with lock_operation(backups, 'backup'):
        latest = json.loads((backups / 'latest.json').read_text())
        dump = Path(latest['databaseFile']).resolve(strict=True)
        if not dump.is_relative_to(backups.resolve()) or sha256_file(dump) != latest['databaseSha256']:
            raise RuntimeError('Restore source is outside backup root or differs from receipt')
        started = time.time()
        rehearsal_base = root / 'rehearsal'
        rehearsal_base.mkdir(mode=0o711, exist_ok=True)
        rehearsal_base.chmod(0o711)
        logfile = root / 'restore.log'
        with logfile.open('w') as log:
            process = subprocess.run(['python3', str(Path(__file__).with_name('isolated-pg-rehearsal.py')),
                                      '--base', str(rehearsal_base), '--dump', str(dump),
                                      '--server', config['server'], '--bin-dir', config['pgBin']], stdout=log, stderr=subprocess.STDOUT, timeout=1800)
        logfile.chmod(0o600)
        if process.returncode:
            raise RuntimeError('Isolated restore failed; inspect the private restore.log')
        report = {'completedAt': time.time(), 'seconds': round(time.time()-started), 'stamp': latest['stamp'],
                  'databaseSha256': latest['databaseSha256'], 'restoreVerified': True,
                  'remainingClusters': [str(path) for path in rehearsal_base.glob('.loomic-pg-rehearsal-*')]}
        if report['remainingClusters']:
            raise RuntimeError('A temporary restore cluster was not cleaned up')
        write_json(backups / 'restore.json', report)
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(restore_rehearsal(args.config), indent=2))
