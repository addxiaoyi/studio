"""Switch an existing Nginx upstream only after dependency readiness succeeds."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
import urllib.request

def ready(port, version):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health/ready', timeout=5) as response:
        health = json.load(response)
    checks = health.get('checks', {})
    if not health.get('ok') or health.get('version') != version or any(checks.get(key, {}).get('ok') is not True for key in ['database', 'storage', 'accepting']):
        raise RuntimeError('Candidate dependencies or version are not ready')
    return health

def replace_config(path, content, metadata):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.helstera-upstream-', delete=False) as output:
        temp = pathlib.Path(output.name)
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    try:
        os.chmod(temp, metadata.st_mode & 0o777)
        if hasattr(os, 'chown'): os.chown(temp, metadata.st_uid, metadata.st_gid)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)

def switch(config, old_port, new_port, version, apply=False, execute=subprocess.run):
    if old_port == new_port or not all(1024 <= port <= 65535 for port in [old_port, new_port]):
        raise ValueError('Distinct unprivileged ports are required')
    path = pathlib.Path(config).resolve(strict=True)
    if not path.is_file(): raise ValueError('Nginx config must be a regular file')
    before = path.read_bytes()
    source = re.compile(re.escape(f'http://127.0.0.1:{old_port}'.encode()) + rb'(?=[/;\s])')
    target = f'http://127.0.0.1:{new_port}'.encode()
    count = len(source.findall(before))
    if count == 0 or target in before: raise ValueError('Config no longer matches the reviewed upstream')
    after = source.sub(target, before)
    report = {'config': str(path), 'fromPort': old_port, 'toPort': new_port, 'proxyLocations': count,
              'beforeSha256': hashlib.sha256(before).hexdigest(), 'afterSha256': hashlib.sha256(after).hexdigest(),
              'health': ready(new_port, version), 'applied': False}
    if not apply: return report
    if path.read_bytes() != before: raise RuntimeError('Nginx config changed during preflight')
    metadata = path.stat()
    replace_config(path, after, metadata)
    try:
        execute(['nginx', '-t'], check=True, capture_output=True, timeout=20)
        ready(new_port, version)
        execute(['nginx', '-s', 'reload'], check=True, capture_output=True, timeout=20)
    except Exception:
        replace_config(path, before, metadata)
        execute(['nginx', '-t'], check=True, capture_output=True, timeout=20)
        execute(['nginx', '-s', 'reload'], check=True, capture_output=True, timeout=20)
        raise
    report['applied'] = True
    return report

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--from-port', type=int, required=True)
    parser.add_argument('--to-port', type=int, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    import fcntl
    with open('/run/lock/helstera-upstream.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(switch(args.config, args.from_port, args.to_port, args.version, args.apply)))

if __name__ == '__main__': main()
