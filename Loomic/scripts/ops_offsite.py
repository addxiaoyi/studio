"""Upload the latest verified archive without creating or charging for another snapshot."""
import argparse
import json
from pathlib import Path
import time

if __package__:
    from .ops_common import lock_operation, read_config, runtime, write_json
    from .ops_backup import sha256_file
else:
    from ops_common import lock_operation, read_config, runtime, write_json
    from ops_backup import sha256_file


def sync_latest(config_path: str) -> dict:
    config = read_config(config_path)
    if config.get('offsiteEnabled') is not True:
        raise RuntimeError('Offsite uploads are not enabled')
    root = Path(config['backupRoot']).resolve(strict=True)
    with lock_operation(root, 'backup'):
        receipt = json.loads((root/'latest.json').read_text())
        archive = Path(receipt['encryptedFile']).resolve(strict=True)
        if not archive.is_relative_to(root) or sha256_file(archive) != receipt['sha256']:
            raise ValueError('Latest backup archive does not match its receipt')
        uploaded = runtime(config_path, 'upload', str(archive), config['storagePrefix'] + archive.name, timeout=3600)
        if uploaded.get('sha256') != receipt['sha256']:
            raise RuntimeError('Uploaded backup checksum differs')
        receipt.update({'offsite': uploaded, 'offsiteCompletedAt': time.time()})
        receipt.pop('offsitePending', None)
        write_json(archive.parent/'receipt.json', receipt)
        write_json(root/'latest.json', receipt)
        receipt['retention'] = runtime(config_path, 'prune', timeout=180)
        write_json(archive.parent/'receipt.json', receipt)
        write_json(root/'latest.json', receipt)
        return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    print(json.dumps(sync_latest(args.config), indent=2))
