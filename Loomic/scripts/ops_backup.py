"""Create recoverable daily backups and publish only authenticated ciphertext off-host."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import time

if __package__:
    from .ops_common import lock_operation, read_config, runtime, write_json
    from .ops_crypto import encrypt_backup
else:
    from ops_common import lock_operation, read_config, runtime, write_json
    from ops_crypto import encrypt_backup


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def create_backup(config_path: str) -> dict:
    config = read_config(config_path)
    root = Path(config['backupRoot']).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    with lock_operation(root, 'backup'):
        if shutil.disk_usage(root).free < 12 * 1024**3:
            raise RuntimeError('Backup requires at least 12 GiB free space')
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        folder = root / stamp
        folder.mkdir(mode=0o700)
        started = time.time()
        dump = folder / 'database.dump'
        runtime(config_path, 'dump', str(dump), timeout=1260)
        dump.chmod(0o600)
        archive = folder / 'backup.tar'
        with tarfile.open(archive, 'w') as bundle:
            bundle.add(dump, arcname='database.dump')
            bundle.add(config['envFile'], arcname='config/server.env')
            bundle.add('/etc/nginx/sites-available/studio.0st.top.conf', arcname='config/nginx.conf')
            for name in ['src', 'package.json', 'tsconfig.json']:
                bundle.add(Path(config['server']) / name, arcname='server/' + name)
            uploads = Path(config.get('uploads', '/www/helstera/uploads'))
            if uploads.is_dir():
                bundle.add(uploads, arcname='uploads', recursive=True)
        archive.chmod(0o600)
        encrypted = folder / (stamp + '.tar.enc')
        encrypt_backup(archive, encrypted, Path(config['publicKey']).read_bytes())
        digest = sha256_file(encrypted)
        report = {'stamp': stamp, 'startedAt': started, 'completedAt': time.time(),
                  'encryptedFile': str(encrypted), 'databaseBytes': dump.stat().st_size,
                  'databaseFile': str(dump), 'databaseSha256': sha256_file(dump),
                  'encryptedBytes': encrypted.stat().st_size, 'sha256': digest,
                  'publicKeySha256': hashlib.sha256(Path(config['publicKey']).read_bytes()).hexdigest()}
        write_json(folder / 'receipt.json', report)
        write_json(root / 'latest.json', report)
        archive.unlink()
        folders = sorted((path for path in root.iterdir() if path.is_dir() and re.fullmatch(r'\d{8}T\d{6}Z', path.name)), reverse=True)
        for prior in folders[1:]:
            if prior.is_symlink():
                raise RuntimeError('Backup folder cannot be a symlink')
            # Weekly rehearsal uses the newest local dump; older copies remain encrypted.
            (prior / 'database.dump').unlink(missing_ok=True)
        for expired in folders[config.get('localKeep', 7):]:
            if expired.resolve().parent != root or expired.is_symlink():
                raise RuntimeError('Backup retention path escapes its root')
            if (expired / 'receipt.json').is_file():
                shutil.rmtree(expired)
        key = config['storagePrefix'] + encrypted.name
        if config.get('offsiteEnabled') is False:
            report['offsitePending'] = 'Operator deferred offsite storage configuration'
            write_json(folder / 'receipt.json', report)
            write_json(root / 'latest.json', report)
            return report
        uploaded = runtime(config_path, 'upload', str(encrypted), key, timeout=3600)
        report.update({'offsite': uploaded, 'offsiteCompletedAt': time.time()})
        write_json(folder / 'receipt.json', report)
        write_json(root / 'latest.json', report)
        report['retention'] = runtime(config_path, 'prune')
        write_json(folder / 'receipt.json', report)
        write_json(root / 'latest.json', report)
        return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    print(json.dumps(create_backup(args.config), indent=2))


if __name__ == '__main__':
    os.umask(0o077)
    main()
