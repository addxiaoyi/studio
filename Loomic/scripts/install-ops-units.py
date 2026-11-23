"""Install systemd maintenance schedules from a reviewed operations configuration."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def units(config_path: Path) -> dict[str, str]:
    config = json.loads(config_path.read_text())
    root = Path(config['root']).resolve(strict=True)
    if any(char.isspace() for char in str(root) + str(config_path)):
        raise ValueError('Unit configuration paths cannot contain whitespace')
    services = {
        'helstera-backup': ('Daily encrypted database and uploads backup', 'ops_backup.py', '2h'),
        'helstera-restore': ('Weekly isolated PostgreSQL recovery rehearsal', 'ops_restore.py', '40min'),
        'helstera-monitor': ('Helstera service and backup health checks', 'ops_monitor.py', '3min'),
    }
    schedules = {
        'helstera-backup': 'OnCalendar=*-*-* 03:10:00 Asia/Shanghai\nRandomizedDelaySec=10m\nPersistent=true',
        'helstera-restore': 'OnCalendar=Sun *-*-* 04:20:00 Asia/Shanghai\nRandomizedDelaySec=10m\nPersistent=true',
        'helstera-monitor': 'OnBootSec=2m\nOnUnitActiveSec=5m',
    }
    definitions = {}
    for name, (description, entry, timeout) in services.items():
        if not (root/entry).is_file():
            raise ValueError('Operations script is missing: ' + entry)
        definitions[name+'.service'] = (f'[Unit]\nDescription={description}\nAfter=network-online.target\nWants=network-online.target\n\n'
            f'[Service]\nType=oneshot\nUser=root\nUMask=0077\nNice=10\nIOSchedulingClass=best-effort\nIOSchedulingPriority=7\n'
            f'WorkingDirectory={root}\nExecStart=/usr/bin/python3 {root/entry} --config {config_path}\nTimeoutStartSec={timeout}\n')
        definitions[name+'.timer'] = f'[Unit]\nDescription={name} schedule\n\n[Timer]\n{schedules[name]}\nUnit={name}.service\n\n[Install]\nWantedBy=timers.target\n'
    return definitions


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    definitions = units(args.config.resolve(strict=True))
    if args.apply:
        if os.geteuid() != 0:
            raise PermissionError('Installing systemd units requires root')
        for name, definition in definitions.items():
            Path('/etc/systemd/system', name).write_text(definition)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', 'enable', '--now', *[name for name in definitions if name.endswith('.timer')]], check=True)
    print(json.dumps({'applied': args.apply, 'units': definitions}, indent=2))
