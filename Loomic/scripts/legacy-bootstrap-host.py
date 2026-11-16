"""Host adapter for the guarded one-time lifecycle bootstrap; never use it as a general deployer."""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from typing import Callable
from urllib.parse import urlsplit


STOP_SECONDS = 1200
READY_SECONDS = 90
BARRIER_TIMEOUT_SECONDS = 15
BARRIER_POLL_SECONDS = 0.1
BARRIER_PROBE_SECONDS = 1
AUTH_PATHS = tuple('/api/agent/' + name for name in ('goals', 'suggestions', 'memories', 'connectors'))
MEDIA_PATHS = tuple(prefix + kind + '/SPR-0001.webp'
                    for prefix in ('/fashion-gallery/', '/api/public-media/fashion-gallery/')
                    for kind in ('img', 'thumbs'))
ACTIVITY_TABLES = frozenset(('background_jobs', 'agent_runs', 'agent_goals', 'agent_goal_steps',
                             'video_transcripts', 'video_transcript_exports', 'desktop_agent_tasks', 'media_resource_leases'))


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    if spec is None or spec.loader is None:
        raise RuntimeError('Bootstrap helper is unavailable: ' + name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def private_write(path: Path, content: bytes) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix='.bootstrap-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        if os.name == 'posix':
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def request(url: str, method: str = 'GET', headers: dict | None = None, body: bytes | None = None,
            timeout: float = 10) -> dict:
    address = urlsplit(url)
    if (address.scheme not in ('http', 'https') or not address.hostname or address.username or
            address.password or address.fragment):
        raise ValueError('Bootstrap HTTP probes require an explicit HTTP(S) URL without credentials')
    connection = None
    try:
        if address.scheme == 'https':
            # The loopback probe deliberately selects the reviewed virtual host with Host.
            context = ssl._create_unverified_context() if address.hostname in ('127.0.0.1', '::1') else ssl.create_default_context()
            connection = http.client.HTTPSConnection(address.hostname, address.port or 443, context=context, timeout=timeout)
        else:
            connection = http.client.HTTPConnection(address.hostname, address.port or 80, timeout=timeout)
        target = address.path or '/'
        if address.query:
            target += '?' + address.query
        connection.request(method, target, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read(4 * 1024 * 1024 + 1)
        if len(payload) > 4 * 1024 * 1024:
            raise RuntimeError('Bootstrap probe exceeded its response limit')
        return {'status': response.status, 'headers': {key.lower(): value for key, value in response.getheaders()}, 'body': payload}
    except (OSError, http.client.HTTPException):
        raise RuntimeError('Bootstrap HTTP probe failed') from None
    finally:
        if connection is not None:
            connection.close()


@contextmanager
def release_locks(root: Path, upstream_path: Path = Path('/run/lock/helstera-upstream.lock'), lock_api=None):
    if lock_api is None:
        import fcntl
        lock_api = fcntl
    with ExitStack() as locks:
        for path in (root / '.release.lock', upstream_path):
            stream = locks.enter_context(path.open('a'))
            try:
                lock_api.flock(stream, lock_api.LOCK_EX | lock_api.LOCK_NB)
            except OSError:
                raise RuntimeError('Another release or upstream transaction holds the bootstrap lock') from None
        yield


def _pause_barrier(seconds: float) -> None:
    threading.Event().wait(seconds)


class BootstrapHost:
    def __init__(self, root: Path, config: Path, bootstrap_dir: Path, bridge: Path,
                 api_name: str, worker_name: str, api_pid: int, worker_pid: int,
                 manifest_sha256: str, backup: Path, env_file: Path, expected_config_sha256: str,
                 public_url: str = 'https://studio.0st.top', old_port: int = 3003, new_port: int = 3002,
                 runner: Callable | None = None, proc_root: Path = Path('/proc'), http: Callable | None = None,
                 pm2_log: Path | None = None, backup_tar_sha256: str | None = None,
                 backup_dump_sha256: str | None = None, ingress_url: str = 'https://127.0.0.1'):
        self.root = root.resolve(strict=True)
        self.config = config.resolve(strict=True)
        self.stage = bootstrap_dir.resolve(strict=True)
        self.bridge = bridge.resolve(strict=True)
        self.backup = backup.resolve(strict=True)
        self.env_file = env_file.resolve(strict=True)
        bridge_parent = self.bridge.parent
        bridge_owned = (bridge_parent == self.root or bridge_parent == self.root / '.releases')
        canonical = all(path.absolute() == path.resolve(strict=True) for path in (bootstrap_dir, bridge, backup))
        if (self.stage.parent != self.root or not bridge_owned or self.backup.parent != self.root or not canonical or
                len({self.stage, self.bridge, self.backup}) != 3 or
                not re.fullmatch(r'[A-Za-z0-9._-]{1,96}', self.bridge.name)):
            raise ValueError('Bootstrap and backup must be separate root children; the immutable bridge must be a regular root or .releases child')
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,96}', self.stage.name):
            raise ValueError('Bootstrap directory name is invalid')
        if (old_port, new_port) != (3003, 3002):
            raise ValueError('This bootstrap adapter only supports the reviewed 3003 to 3002 transition')
        for name, kind in ((api_name, 'server'), (worker_name, 'worker')):
            if not re.fullmatch(r'helstera-' + kind + r'(?:-[A-Za-z0-9_-]+)?', name):
                raise ValueError('Legacy process name is not a recognized ' + kind)
        if type(api_pid) is not int or type(worker_pid) is not int or min(api_pid, worker_pid) <= 0 or api_pid == worker_pid:
            raise ValueError('Two distinct positive legacy process PIDs are required')
        for value in (manifest_sha256, expected_config_sha256, backup_tar_sha256, backup_dump_sha256):
            if value is not None and not re.fullmatch(r'[a-fA-F0-9]{64}', value):
                raise ValueError('Bootstrap artifact hashes must be SHA-256 values')
        public = urlsplit(public_url)
        ingress = urlsplit(ingress_url)
        if (public.scheme not in ('http', 'https') or not public.hostname or public.username or public.password or
                public.path not in ('', '/') or public.query or public.fragment):
            raise ValueError('Public URL must be a credential-free HTTP(S) origin')
        if (ingress.scheme not in ('http', 'https') or ingress.hostname not in ('127.0.0.1', '::1') or
                ingress.username or ingress.password or ingress.path not in ('', '/') or ingress.query or ingress.fragment):
            raise ValueError('Ingress probes must use a loopback HTTP(S) origin')
        self.public_url, self.ingress_url = public_url.rstrip('/'), ingress_url.rstrip('/')
        self.host_header = public.netloc
        self.old_port, self.new_port = old_port, new_port
        self.manifest_sha256 = manifest_sha256.lower()
        self.expected_config_sha256 = expected_config_sha256.lower()
        self.backup_tar_sha256 = backup_tar_sha256.lower() if backup_tar_sha256 else None
        self.backup_dump_sha256 = backup_dump_sha256.lower() if backup_dump_sha256 else None
        self.expected = {'server': {'name': api_name, 'pid': api_pid}, 'worker': {'name': worker_name, 'pid': worker_pid}}
        self.names = {role: 'helstera-' + role + '-bridge-' + self.stage.name.lstrip('.').replace('.', '-') for role in ('server', 'worker')}
        self.context_path = self.stage / 'context.json'
        self.state_path = self.root / '.active-release.json'
        self.proc_root = proc_root
        self.pm2_log = (pm2_log or Path(os.environ.get('PM2_HOME', str(Path.home() / '.pm2'))) / 'pm2.log').resolve(strict=True)
        self.runner, self.http = runner, http or request
        self.release = load_script('blue-green-release')
        self.topology = load_script('release-topology')
        self.maintenance = load_script('legacy-maintenance')
        self.switcher = load_script('switch-server-upstream')
        self.context: dict = {}

    def run(self, arguments: list[str], timeout: int = 60, cwd: Path | None = None, env: dict | None = None) -> str:
        try:
            if self.runner is not None:
                return self.runner(arguments, timeout=timeout, cwd=cwd, env=env)
            return subprocess.run(arguments, check=True, capture_output=True, text=True, timeout=timeout, cwd=cwd, env=env).stdout
        except Exception:
            # Child diagnostics and command arguments may contain inherited credentials.
            raise RuntimeError('Bootstrap command failed; inspect the private host logs') from None

    def processes(self) -> list[dict]:
        return json.loads(self.run(['pm2', 'jlist']))

    def process(self, name: str) -> dict:
        matches = [item for item in self.processes() if item.get('name') == name]
        if len(matches) != 1:
            raise RuntimeError('Expected exactly one reviewed PM2 process named ' + name)
        return matches[0]

    def process_identity(self, item: dict) -> dict:
        pid = item['pid']
        location = self.proc_root / str(pid)
        stat = (location / 'stat').read_text()
        start = stat.rsplit(')', 1)[1].split()[19]
        cwd = (location / 'cwd').resolve(strict=True)
        if str(cwd) != str(Path(item['pm2_env']['pm_cwd']).resolve(strict=True)):
            raise RuntimeError('PM2 working directory disagrees with the running process')
        return {'name': item['name'], 'pid': pid, 'pmId': item['pm_id'], 'startTicks': start, 'cwd': str(cwd)}

    def _proc_gone(self, identity: dict) -> bool:
        location = self.proc_root / str(identity['pid'])
        if not location.exists():
            return True
        try:
            stat = (location / 'stat').read_text()
            return stat.rsplit(')', 1)[1].split()[19] != identity['startTicks']
        except FileNotFoundError:
            return True

    def _same_process(self, role: str, generation: str = 'legacy') -> dict:
        identity = self.context[generation][role]
        item = self.process(identity['name'])
        if item['pm2_env']['status'] != 'online' or self.process_identity(item) != identity:
            raise RuntimeError('Reviewed ' + generation + ' ' + role + ' process identity changed')
        return item

    def save_context(self) -> None:
        private_write(self.context_path, (json.dumps(self.context, sort_keys=True, indent=2) + '\n').encode())

    def validate_bridge(self) -> dict:
        manifest_path = self.bridge / 'BRIDGE-MANIFEST.json'
        if digest(manifest_path) != self.manifest_sha256:
            raise RuntimeError('Bridge manifest SHA-256 differs from the reviewed artifact')
        manifest = json.loads(manifest_path.read_bytes())
        if (manifest.get('kind') != 'legacy-lifecycle-bridge' or manifest.get('phase') != 'prepared' or
                manifest.get('receiptSupportOnly') is not True or
                any(manifest.get(key) is not False for key in ('processesStarted', 'databaseChanged', 'routesChanged'))):
            raise RuntimeError('Bridge manifest is not a preparation-only lifecycle artifact')
        files, links = manifest.get('files'), manifest.get('links')
        if not isinstance(files, dict) or not isinstance(links, dict):
            raise ValueError('Bridge file and dependency link manifests are required')
        for name in list(files) + list(links):
            parts = PurePosixPath(name).parts
            if not parts or PurePosixPath(name).is_absolute() or any(part in ('.', '..') or ':' in part for part in parts) or '\\' in name:
                raise ValueError('Bridge manifest has an unsafe relative path')
        for name, details in files.items():
            path = self.bridge / name
            if (not path.is_file() or path.is_symlink() or not path.resolve(strict=True).is_relative_to(self.bridge) or
                    digest(path) != details.get('sha256')):
                raise RuntimeError('Bridge file differs from the reviewed manifest: ' + name)
        for name, details in links.items():
            path = self.bridge / name
            if not path.is_symlink() or path.resolve(strict=True) != Path(details['target']).resolve(strict=True):
                raise RuntimeError('Bridge dependency link differs from the reviewed manifest: ' + name)
            if not path.resolve(strict=True).is_relative_to(self.root):
                raise RuntimeError('Bridge dependencies must remain inside the deployment root')
        actual_files, actual_links = set(), set()
        for current, folders, names in os.walk(self.bridge, followlinks=False):
            parent = Path(current)
            for name in folders + names:
                path = parent / name
                relative = path.relative_to(self.bridge).as_posix()
                if path.is_symlink():
                    actual_links.add(relative)
                elif path.is_file() and relative != 'BRIDGE-MANIFEST.json':
                    actual_files.add(relative)
        if actual_files != set(files) or actual_links != set(links):
            raise RuntimeError('Bridge contains missing or unreviewed files or dependency links')
        expected_shared = self.bridge / 'packages/shared/dist'
        if self.topology.resolve_shared(self.root, self.bridge / 'apps/server') != expected_shared:
            raise RuntimeError('Bridge Node resolution does not select its copied Shared snapshot')
        return manifest

    def _pointer(self) -> bytes | None:
        return self.state_path.read_bytes() if self.state_path.exists() else None

    def assert_owned_state(self) -> None:
        before = self.context.get('previousState')
        actual = self._pointer()
        if actual == (before.encode() if before is not None else None):
            return
        if actual is not None and json.loads(actual) == self.context.get('activeState'):
            return
        raise RuntimeError('Active release pointer changed outside this bootstrap')

    def _snapshot(self, name: str) -> bytes:
        path = self.stage / ('nginx.' + name)
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != self.context['snapshots'][name]:
            raise RuntimeError('Saved Nginx snapshot differs from its private context')
        return content

    def _assert_routes(self, names: tuple[str, ...]) -> None:
        self.assert_owned_state()
        if self.config.read_bytes() not in tuple(self._snapshot(name) for name in names):
            raise RuntimeError('Nginx changed outside this bootstrap transaction')

    def preflight(self) -> None:
        if self.context_path.exists():
            raise FileExistsError('Bootstrap context exists; use guarded recovery')
        if digest(self.config) != self.expected_config_sha256:
            raise RuntimeError('Nginx differs from the explicitly reviewed configuration')
        manifest = self.validate_bridge()
        processes = self.processes()
        if any(item.get('name') in self.names.values() for item in processes):
            raise RuntimeError('Bridge PM2 names are already registered')
        topology = self.topology.inspect(self.root, self.config, processes)
        old = topology['active']
        if old['api'] != self.expected['server']['name'] or old['worker'] != self.expected['worker']['name'] or old['port'] != self.old_port:
            raise RuntimeError('Active topology does not match the reviewed legacy API and worker')
        if (manifest['source']['server'] != str(Path(topology['source']) / 'apps/server') or
                manifest['source']['shared'] != topology['shared']):
            raise RuntimeError('Bridge source provenance differs from the actual legacy runtime')
        for role in ('server', 'worker'):
            if digest(Path(manifest['source']['server']) / 'src' / (role + '.ts')) != manifest['source'][role + 'Sha256']:
                raise RuntimeError('Legacy source changed after the lifecycle bridge was prepared')
        if (Path(manifest['source']['server']) / 'node_modules').resolve(strict=True) != Path(manifest['source']['dependencies']).resolve(strict=True):
            raise RuntimeError('Bridge dependency provenance does not match the actual legacy dependency directory')
        legacy, launches, logs, launch_metadata = {}, {}, {}, {}
        for role in ('server', 'worker'):
            item = self.process(self.expected[role]['name'])
            if item['pid'] != self.expected[role]['pid'] or item['pm2_env']['status'] != 'online':
                raise RuntimeError('Legacy process changed before bootstrap preflight')
            legacy[role] = self.process_identity(item)
            env, env_file = self.release.process_launch(item['pid'], self.root, self.proc_root)
            if env_file.resolve(strict=True) != self.env_file:
                raise RuntimeError('Legacy process uses a different environment file')
            interpreter = (self.proc_root / str(item['pid']) / 'exe').resolve(strict=True)
            launches[role] = {'env': env, 'envFile': str(env_file), 'interpreter': str(interpreter)}
            logs[role] = str(Path(item['pm2_env']['pm_out_log_path']).resolve(strict=True))
            launch_metadata[role] = {key: item['pm2_env'].get(key) for key in
                ('pm_exec_path', 'exec_interpreter', 'node_args', 'args', 'pm_cwd', 'exec_mode', 'instances')}
        archive, dump = self.backup / 'current.tgz', self.backup / 'database.dump'
        hashes = {'tar': digest(archive), 'dump': digest(dump)}
        expected_dump = (self.backup / 'database.dump.sha256').read_text().split()[0]
        if (hashes['dump'] != expected_dump.lower() or
                self.backup_tar_sha256 is not None and hashes['tar'] != self.backup_tar_sha256 or
                self.backup_dump_sha256 is not None and hashes['dump'] != self.backup_dump_sha256):
            raise RuntimeError('Bootstrap backup archive or database dump SHA-256 differs')
        with tarfile.open(archive, 'r:gz') as bundle:
            member = bundle.extractfile('SOURCE-LAYOUT.json')
            layout = json.load(member) if member else None
            expected_layout = {'source': topology['source'], 'web': topology['web'], 'shared': topology['shared']}
            if not isinstance(layout, dict) or any(layout.get(key) != value for key, value in expected_layout.items()):
                raise RuntimeError('Rollback backup does not represent the actual legacy source, static root, and Shared')
            if not bundle.getmember('packages/shared/dist/index.js').isfile():
                raise RuntimeError('Rollback backup lacks its Shared entry')
        self.run(['pg_restore', '--list', str(dump)], timeout=300)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', self.new_port))
        before = self.config.read_bytes()
        barrier = self.maintenance.prepare(before.decode(), self.old_port).encode()
        server, galleries, blocked, _ = self.maintenance.analyze(before.decode(), self.old_port)
        edits = []
        for location in blocked:
            for proxy in location.children:
                if self.maintenance.proxy_port(proxy) == self.old_port:
                    original = before.decode()[proxy.start:proxy.end]
                    changed = original.replace('http://127.0.0.1:' + str(self.old_port), 'http://127.0.0.1:' + str(self.new_port), 1)
                    edits.append((proxy.start, proxy.end, changed))
        after = before.decode()
        for start, end, replacement in sorted(edits, reverse=True):
            after = after[:start] + replacement + after[end:]
        self.maintenance.analyze(after, self.new_port)
        previous = self._pointer()
        token = self.stage.name.lstrip('.').replace('.', '-')
        self.context = {'schemaVersion': 1, 'root': str(self.root), 'config': str(self.config),
                        'stage': str(self.stage), 'bridge': str(self.bridge), 'backup': str(self.backup),
                        'manifestSha256': self.manifest_sha256, 'publicUrl': self.public_url, 'ingressUrl': self.ingress_url,
                        'envFile': str(self.env_file), 'oldPort': self.old_port, 'newPort': self.new_port,
                        'envFileSha256': digest(self.env_file),
                        'legacy': legacy, 'launches': launches, 'logs': logs, 'pm2Log': str(self.pm2_log),
                        'legacyLaunchMetadata': launch_metadata,
                        'bridgeProcesses': {}, 'bridgeLaunchAttempted': [], 'stopAttempts': {}, 'stopProofs': {}, 'restartProcesses': {},
                        'previousState': previous.decode() if previous is not None else None,
                        'version': json.loads((Path(topology['source']) / 'apps/server/package.json').read_bytes())['version'],
                        'names': self.names, 'token': token, 'topology': topology, 'backupHashes': hashes,
                        'snapshots': {}, 'proofs': {}, 'helperHashes': {name: digest(Path(__file__).with_name(name))
                        for name in ('legacy-bootstrap.py', 'legacy-maintenance.py', 'legacy-release-activity.mjs',
                                     'blue-green-release.py', 'release-topology.py', 'legacy-bootstrap-host.py')}}
        self.context['activeState'] = {'api': self.names['server'], 'worker': self.names['worker'],
            'port': self.new_port, 'web': topology['web'], 'release': str(self.bridge), 'version': self.context['version'],
            'previous': old}
        if json.loads((self.bridge / 'apps/server/package.json').read_bytes()).get('version') != self.context['version']:
            raise RuntimeError('Lifecycle bridge changed the pinned legacy package version')
        self.stage.chmod(0o700)
        for name, content in (('before', before), ('maintenance', barrier), ('after', after.encode())):
            private_write(self.stage / ('nginx.' + name), content)
            self.context['snapshots'][name] = hashlib.sha256(content).hexdigest()
        self.save_context()
        self._activity()
        self._ready(self.old_port)
        self.context['media'] = self._media(self.public_url)
        self.save_context()
        self.run(['nginx', '-t'])
        self._assert_routes(('before',))

    def _activity(self) -> dict:
        self._assert_env_file()
        program = Path(__file__).with_name('legacy-release-activity.mjs').resolve(strict=True)
        if digest(program) != self.context['helperHashes'][program.name]:
            raise RuntimeError('Read-only activity helper changed after bootstrap preflight')
        probe = ("import {createRequire} from 'node:module';"
                 "const require=createRequire(process.cwd()+'/package.json');const {Pool}=require('pg');"
                 "const {inspectLegacyReleaseActivity,validateLoopbackDatabaseUrl}=await import(" + json.dumps(program.as_uri()) + ");"
                 "const db=new Pool({connectionString:validateLoopbackDatabaseUrl(process.env.DATABASE_URL),max:1,connectionTimeoutMillis:5000});"
                 "try{process.stdout.write(JSON.stringify(await inspectLegacyReleaseActivity({pool:db})));}finally{await db.end();}")
        launch = self.context['launches']['server']
        raw = self.run([launch['interpreter'], '--env-file=' + launch['envFile'], '--input-type=module', '-e', probe],
                       cwd=Path(self.context['legacy']['server']['cwd']), env=launch['env'])
        report = json.loads(raw)
        if (report.get('readOnly') is not True or report.get('activity') != 'none_observed' or report.get('blockers') != []):
            raise RuntimeError('Read-only activity inspection found blockers or incomplete evidence')
        self._validate_activity_schema(report)
        self.context['proofs']['activity'] = report
        self.save_context()
        return report

    def _assert_env_file(self) -> None:
        if digest(self.env_file) != self.context['envFileSha256']:
            raise RuntimeError('Pinned environment file changed after bootstrap preflight')

    def _validate_activity_schema(self, report: dict) -> None:
        coverage, tables = report.get('coverage'), report.get('tables')
        if (not isinstance(coverage, dict) or not isinstance(tables, dict) or set(tables) != ACTIVITY_TABLES or
                set(coverage.get('checked', [])) != ACTIVITY_TABLES or coverage.get('absent') != [] or
                coverage.get('unsupported') != []):
            raise RuntimeError('Activity inspection does not cover every reviewed legacy work table')
        schema, partial = {}, set()
        for name, table in tables.items():
            unavailable = table.get('unavailableChecks')
            columns = table.get('columns')
            if (table.get('state') != 'checked' or not isinstance(unavailable, list) or
                    not isinstance(columns, list) or not columns or
                    any(not isinstance(column, dict) or not isinstance(column.get('name'), str) or
                        not isinstance(column.get('type'), str) for column in columns)):
                raise RuntimeError('Activity inspection has an unsupported or incomplete table schema')
            if unavailable:
                if name != 'agent_runs' or set(unavailable) != {'run_owner', 'run_lease_until'}:
                    raise RuntimeError('Activity inspection is missing an unreviewed execution or lease check')
                partial.add(name)
            statuses, metrics = table.get('statuses', {}), table.get('metrics', {})
            running_states = ('accepted', 'running') if name == 'agent_runs' else ('running',)
            metric_checks = {'background_jobs': ('sync_claims',), 'agent_runs': ('active_ownerless', 'active_owned'),
                'agent_goal_steps': ('leases',), 'video_transcripts': ('live_leases',),
                'video_transcript_exports': ('live_leases',), 'media_resource_leases': ('live_leases',)}
            states = running_states if name not in ('agent_goals', 'media_resource_leases') else ()
            if (any(statuses.get(state, 0) != 0 for state in states) or
                    any(metrics.get(metric, 0) != 0 for metric in metric_checks.get(name, ())) or
                    table.get('unknownStatuses', 0) != 0):
                raise RuntimeError('Activity table aggregates contain active execution or lease blockers')
            schema[name] = {'state': 'checked', 'columns': columns, 'unavailableChecks': sorted(unavailable)}
        if set(coverage.get('partial', [])) != partial:
            raise RuntimeError('Activity inspection partial coverage does not match its table evidence')
        observed = {'tables': schema, 'partial': sorted(partial)}
        if 'activitySchema' in self.context and self.context['activitySchema'] != observed:
            raise RuntimeError('Legacy activity schema changed after bootstrap preflight')
        self.context['activitySchema'] = observed

    def _response(self, origin: str, path: str, method: str = 'GET', headers: dict | None = None,
                  timeout: float | None = None) -> dict:
        options = {'method': method, 'headers': {'Host': self.host_header, 'Cache-Control': 'no-cache', **(headers or {})},
                   'body': b'{}' if method == 'POST' else None}
        if timeout is not None:
            options['timeout'] = timeout
        return self.http(origin + path, **options)

    def _ready(self, port: int) -> None:
        response = self._response('http://127.0.0.1:' + str(port), '/api/health/ready')
        health = json.loads(response['body'])
        if (response['status'] != 200 or health.get('ok') is not True or health.get('version') != self.context['version'] or
                any(health.get('checks', {}).get(key, {}).get('ok') is not True for key in ('database', 'storage', 'accepting'))):
            raise RuntimeError('API dependencies or pinned version are not ready')

    def _auth(self, origin: str) -> None:
        for path in AUTH_PATHS:
            response = self._response(origin, path)
            document = json.loads(response['body'])
            if (response['status'] != 401 or document.get('ok') is not False or
                    document.get('error', {}).get('code') != 'unauthorized'):
                raise RuntimeError('API authentication boundary did not reject an anonymous request')

    def _media(self, origin: str) -> dict:
        proofs = {}
        for path in MEDIA_PATHS:
            for label, headers in (('full', {}), ('range', {'Range': 'bytes=0-31'})):
                response = self._response(origin, path, headers=headers)
                if response['status'] not in (200, 206) or not response['body']:
                    raise RuntimeError('Public gallery media proof failed')
                proofs[path + ':' + label] = {'status': response['status'], 'sha256': hashlib.sha256(response['body']).hexdigest(),
                    'bytes': len(response['body']), 'etag': response['headers'].get('etag'),
                    'type': response['headers'].get('content-type'), 'range': response['headers'].get('content-range')}
        return proofs

    def _apply_routes(self, target: str, allowed: tuple[str, ...]) -> None:
        self._assert_routes(allowed)
        content = self._snapshot(target)
        if self.config.read_bytes() != content:
            self.switcher.replace_config(self.config, content, self.config.stat())
        self.run(['nginx', '-t'])
        self._assert_routes((target,))
        self.run(['nginx', '-s', 'reload'])

    def block_ingress(self) -> None:
        self._apply_routes('maintenance', ('before', 'maintenance', 'after'))
        report = self.maintenance.inspect(self._snapshot('before').decode(), self.old_port)
        paths = set()
        for selector in report['blockedLocations'] + report['addedLocations']:
            path = selector.split()[-1]
            paths.add(path)
        paths.update(('/api', '/api/__bootstrap_probe__', '/api/ws', '/api/website-capture/assistant/ws'))
        probes = [(path, method, {}, '') for path in sorted(paths) for method in ('GET', 'POST')]
        websocket = {'Connection': 'Upgrade', 'Upgrade': 'websocket',
                     'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='}
        probes.extend((path, 'GET', websocket, ' websocket')
                      for path in ('/api/ws', '/api/website-capture/assistant/ws'))
        deadline = time.monotonic() + BARRIER_TIMEOUT_SECONDS
        last_failure = 'no completed ingress proof'
        while True:
            self._assert_routes(('maintenance',))
            failures = []
            for path, method, headers, label in probes:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError('Nginx maintenance barrier did not converge: ' + last_failure)
                try:
                    response = self._response(self.ingress_url, path, method, headers,
                                              timeout=min(BARRIER_PROBE_SECONDS, remaining))
                except (OSError, RuntimeError, http.client.HTTPException):
                    failures.append(f'{method} {path}{label} status=unavailable')
                    continue
                status = response.get('status')
                safe_status = str(status) if type(status) is int and 100 <= status <= 599 else 'invalid'
                if (status != 503 or response.get('headers', {}).get('retry-after') != '30' or
                        response.get('headers', {}).get('cache-control') != 'no-store'):
                    failures.append(f'{method} {path}{label} status={safe_status}')
            self._assert_routes(('maintenance',))
            if not failures:
                break
            last_failure = failures[0]
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError('Nginx maintenance barrier did not converge: ' + last_failure)
            _pause_barrier(min(BARRIER_POLL_SECONDS, remaining))
        if self._media(self.public_url) != self.context['media']:
            raise RuntimeError('Maintenance changed the verified public gallery media')
        self.context['proofs']['barrier'] = True
        self.save_context()

    def _log_mark(self, path: Path) -> dict:
        stat = path.stat()
        return {'path': str(path), 'offset': stat.st_size, 'dev': stat.st_dev, 'ino': stat.st_ino}

    def _log_tail(self, mark: dict) -> str:
        path = Path(mark['path'])
        stat = path.stat()
        if stat.st_dev != mark['dev'] or stat.st_ino != mark['ino'] or stat.st_size < mark['offset']:
            raise RuntimeError('Process log rotated or changed during the reviewed stop')
        with path.open('rb') as stream:
            stream.seek(mark['offset'])
            return stream.read().decode('utf-8', 'replace')

    def _prove_legacy_stop(self, role: str) -> None:
        identity = self.context['legacy'][role]
        item = self.process(identity['name'])
        self._assert_legacy_spec(role, item)
        if (item['pm_id'] != identity['pmId'] or item['pm2_env']['status'] != 'stopped' or
                item['pm2_env'].get('exit_code') != 0 or not self._proc_gone(identity)):
            raise RuntimeError('Legacy process did not have an observed clean stop')
        attempt = self.context['stopAttempts'][role]
        tail = self._log_tail(attempt['pm2'])
        name = re.escape(identity['name']) + ':' + str(identity['pmId'])
        lines = [line for line in tail.splitlines() if 'App [' + identity['name'] + ':' + str(identity['pmId']) + ']' in line]
        if (any('SIGKILL' in line for line in lines) or
                not any(re.search(r'App \[' + name + r'\] exited with code \[0\] via signal \[(?:SIGINT|SIGTERM)\]', line) for line in lines)):
            raise RuntimeError('New PM2 log evidence does not prove a clean legacy exit signal')
        if role == 'worker' and 'Shutdown complete.' not in self._log_tail(attempt['output']):
            raise RuntimeError('Legacy worker did not write a new successful shutdown log')
        self.context['stopProofs'][role] = {'kind': 'legacy_stop_observed', **identity, 'cleanSignal': True}
        self.save_context()

    def _assert_legacy_spec(self, role: str, item: dict) -> None:
        saved = self.context.get('legacyLaunchMetadata', {}).get(role)
        if saved is not None and any(item['pm2_env'].get(key) != value for key, value in saved.items()):
            raise RuntimeError('Legacy PM2 launch metadata changed outside this bootstrap')

    def _stop_legacy(self, role: str) -> bool:
        self._assert_routes(('maintenance',))
        if role == 'worker' and 'server' not in self.context['stopProofs']:
            raise RuntimeError('Legacy API must stop before the legacy worker')
        if role in self.context['stopProofs']:
            self._prove_legacy_stop(role)
            return True
        item = self.process(self.context['legacy'][role]['name'])
        if item['pm2_env']['status'] == 'online':
            self._same_process(role)
            if role not in self.context['stopAttempts']:
                self.context['stopAttempts'][role] = {'pm2': self._log_mark(self.pm2_log),
                    'output': self._log_mark(Path(self.context['logs'][role]))}
                self.save_context()
            self.run(['pm2', 'stop', item['name'], '--kill-timeout', str(STOP_SECONDS * 1000)], timeout=STOP_SECONDS + 60)
        if role not in self.context['stopAttempts']:
            raise RuntimeError('Legacy stop has no saved log boundary; automatic adoption refused')
        self._prove_legacy_stop(role)
        return True

    def stop_legacy_api(self) -> bool:
        return self._stop_legacy('server')

    def stop_legacy_worker(self) -> bool:
        return self._stop_legacy('worker')

    def _bridge_absent_or_stopped(self, role: str) -> None:
        matches = [item for item in self.processes() if item.get('name') == self.names[role]]
        if not matches:
            if role in self.context['bridgeProcesses'] or role in self.context.get('bridgeLaunchAttempted', []):
                raise RuntimeError('Recorded bridge process disappeared from PM2; automatic stop proof refused')
            return
        identity = self.context['bridgeProcesses'].get(role)
        instance = self.context.get('instances', {}).get(role)
        if (len(matches) != 1 or matches[0]['pm2_env']['status'] != 'stopped' or
                matches[0]['pm2_env'].get('exit_code') != 0 or identity is None or not instance or
                matches[0]['pm_id'] != identity['pmId'] or not self._proc_gone(identity)):
            raise RuntimeError('Bridge process still owns work or lacks a clean stop proof; legacy restart refused')
        receipt = self.release.process_receipt(self.stage / (role + '-receipt.json'), identity['pid'], 'drained', instance)
        if receipt.get('role') != role:
            raise RuntimeError('Stopped bridge receipt has the wrong process role')

    def verify_quiescent(self) -> bool:
        self._assert_routes(('maintenance',))
        for role in ('server', 'worker'):
            self._prove_legacy_stop(role)
            self._bridge_absent_or_stopped(role)
        self._activity()
        self.context['proofs']['quiescent'] = True
        self.save_context()
        return True

    def _start_bridge(self, role: str) -> None:
        self._assert_routes(('maintenance',))
        self._assert_env_file()
        for kind in ('server', 'worker'):
            self._prove_legacy_stop(kind)
        if role == 'server':
            self.verify_quiescent()
        elif self.verify_bridge_api() is not True:
            raise RuntimeError('Bridge API must be ready before its worker starts')
        self.validate_bridge()
        if any(item.get('name') == self.names[role] for item in self.processes()):
            raise RuntimeError('Bridge process is already registered; use guarded recovery')
        launch = self.context['launches'][role]
        env = dict(launch['env'])
        env.update(HOST='127.0.0.1', HELSTERA_SERVER_PORT=str(self.new_port),
                   HELSTERA_PROCESS_RECEIPT=str(self.stage / (role + '-receipt.json')),
                   HELSTERA_BOOTSTRAP_ID=self.context['token'])
        spec = {'name': self.names[role], 'cwd': str(self.bridge / 'apps/server'), 'script': './src/' + role + '.ts',
                'interpreter': launch['interpreter'], 'node_args': ['--env-file=' + launch['envFile'], '--import', 'tsx'],
                'exec_mode': 'fork', 'instances': 1, 'wait_ready': True, 'listen_timeout': READY_SECONDS * 1000,
                'kill_timeout': STOP_SECONDS * 1000, 'env': env}
        path = self.stage / (role + '.config.json')
        private_write(path, json.dumps({'apps': [spec]}).encode())
        self.context['proofs'].pop('quiescent', None)
        self.context.setdefault('bridgeLaunchAttempted', []).append(role)
        self.save_context()
        self.run(['pm2', 'start', str(path)], timeout=READY_SECONDS + 30)
        item = self.process(self.names[role])
        if item['pm2_env']['status'] != 'online':
            raise RuntimeError('Bridge process failed to start; inspect private context')
        self.context['bridgeProcesses'][role] = self.process_identity(item)
        self.save_context()

    def start_bridge_api(self) -> None:
        self._start_bridge('server')

    def start_bridge_worker(self) -> None:
        self._start_bridge('worker')

    def _verify_bridge(self, role: str) -> bool:
        identity = self.context['bridgeProcesses'].get(role)
        if identity is None:
            raise RuntimeError('Bridge process identity was not durably recorded')
        item = self.process(identity['name'])
        if item['pm2_env']['status'] != 'online' or self.process_identity(item) != identity:
            raise RuntimeError('Bridge process restarted or changed outside this bootstrap')
        if item['pm2_env'].get('HELSTERA_BOOTSTRAP_ID') != self.context['token']:
            raise RuntimeError('Bridge PM2 launch token does not match its saved transaction')
        instance = self.context.get('instances', {}).get(role)
        receipt = self.release.process_receipt(self.stage / (role + '-receipt.json'), identity['pid'], 'ready', instance)
        if receipt.get('role') != role:
            raise RuntimeError('Bridge receipt role does not match the reviewed process')
        if instance is None:
            # Keep process identity comparisons independent from the receipt's random instance.
            self.context.setdefault('instances', {})[role] = receipt['instanceId']
            self.save_context()
        if receipt['instanceId'] != self.context.get('instances', {}).get(role):
            raise RuntimeError('Bridge lifecycle instance changed')
        return True

    def verify_bridge_api(self) -> bool:
        self._verify_bridge('server')
        return self._wait_ready(lambda: self._api_checks(self.new_port))

    def _api_checks(self, port: int) -> bool:
        self._ready(port)
        self._auth('http://127.0.0.1:' + str(port))
        return True

    def verify_bridge_worker(self) -> bool:
        return self._verify_bridge('worker')

    def switch_routes(self) -> None:
        self.verify_bridge_api()
        self.verify_bridge_worker()
        self._apply_routes('after', ('maintenance',))

    def verify_public(self) -> bool:
        self._assert_routes(('after',))
        self.verify_bridge_api()
        self.verify_bridge_worker()
        self._wait_ready(self._public_checks)
        self._assert_routes(('after',))
        self._verify_bridge('server')
        self._verify_bridge('worker')
        self.context['proofs']['public'] = True
        self.save_context()
        return True

    def _public_checks(self) -> bool:
        response = self._response(self.public_url, '/api/health/ready')
        health = json.loads(response['body'])
        if (response['status'] != 200 or health.get('ok') is not True or health.get('version') != self.context['version'] or
                any(health.get('checks', {}).get(key, {}).get('ok') is not True for key in ('database', 'storage', 'accepting'))):
            raise RuntimeError('Public route does not serve the bridge version')
        self._auth(self.public_url)
        if self._media(self.public_url) != self.context['media']:
            raise RuntimeError('Bridge route changed the verified public gallery media')
        return True

    def _wait_ready(self, proof: Callable[[], bool]) -> bool:
        deadline = time.monotonic() + READY_SECONDS
        while True:
            try:
                return proof()
            except (OSError, RuntimeError, ValueError, KeyError):
                if time.monotonic() >= deadline:
                    raise RuntimeError('Bootstrap dependency readiness did not converge') from None
                time.sleep(0.25)

    def persist(self) -> None:
        self.verify_public()
        self.assert_owned_state()
        self.run(['pm2', 'save'])
        private_write(self.state_path, (json.dumps(self.context['activeState'], sort_keys=True) + '\n').encode())
        self.context['committed'] = True
        self.save_context()

    def _drain_bridge(self, role: str) -> bool:
        self._assert_routes(('maintenance',))
        if role == 'worker':
            self._bridge_absent_or_stopped('server')
        matches = [item for item in self.processes() if item.get('name') == self.names[role]]
        if not matches:
            if role in self.context['bridgeProcesses'] or role in self.context.get('bridgeLaunchAttempted', []):
                raise RuntimeError('Recorded bridge process disappeared from PM2; drain evidence is incomplete')
            return True
        identity = self.context['bridgeProcesses'].get(role)
        instance = self.context.get('instances', {}).get(role)
        if len(matches) != 1 or identity is None or not instance:
            raise RuntimeError('Bridge identity or ready receipt was never recorded; automatic drain refused')
        item = matches[0]
        if item['pm2_env']['status'] == 'online':
            self._verify_bridge(role)
            self.run(['pm2', 'stop', identity['name'], '--kill-timeout', str(STOP_SECONDS * 1000)], timeout=STOP_SECONDS + 60)
            item = self.process(identity['name'])
        if (item['pm_id'] != identity['pmId'] or item['pm2_env']['status'] != 'stopped' or
                item['pm2_env'].get('exit_code') != 0 or not self._proc_gone(identity)):
            raise RuntimeError('Bridge process did not exit cleanly')
        receipt = self.release.process_receipt(self.stage / (role + '-receipt.json'), identity['pid'], 'drained', instance)
        if receipt.get('role') != role:
            raise RuntimeError('Bridge drained receipt has the wrong role')
        self.context.setdefault('bridgeDrained', {})[role] = True
        self.save_context()
        return True

    def drain_bridge_api(self) -> bool:
        return self._drain_bridge('server')

    def drain_bridge_worker(self) -> bool:
        return self._drain_bridge('worker')

    def _restart_legacy(self, role: str) -> None:
        self._assert_routes(('maintenance',))
        self._assert_env_file()
        for kind in ('server', 'worker'):
            self._bridge_absent_or_stopped(kind)
        item = self.process(self.context['legacy'][role]['name'])
        self._assert_legacy_spec(role, item)
        saved = self.context['restartProcesses'].get(role)
        if item['pm2_env']['status'] == 'online':
            expected = saved or self.context['legacy'][role]
            if self.process_identity(item) != expected:
                raise RuntimeError('Legacy process identity changed during recovery')
            return
        self._prove_legacy_stop(role)
        if role == 'server' and self.process(self.context['legacy']['worker']['name'])['pm2_env']['status'] != 'online':
            raise RuntimeError('Legacy worker must recover before its API')
        self.run(['pm2', 'restart', item['name']], timeout=READY_SECONDS + 30)
        item = self.process(item['name'])
        if item['pm2_env']['status'] != 'online':
            raise RuntimeError('Legacy process did not become online after recovery')
        self.context['restartProcesses'][role] = self.process_identity(item)
        self.save_context()

    def restart_legacy_worker(self) -> None:
        self._restart_legacy('worker')

    def restart_legacy_api(self) -> None:
        self._restart_legacy('server')

    def verify_legacy(self) -> bool:
        self._assert_routes(('maintenance', 'before'))
        for role in ('server', 'worker'):
            item = self.process(self.context['legacy'][role]['name'])
            expected = self.context['restartProcesses'].get(role) or self.context['legacy'][role]
            if item['pm2_env']['status'] != 'online' or self.process_identity(item) != expected:
                raise RuntimeError('Legacy terminal process identities are not restored')
            self._bridge_absent_or_stopped(role)
        self._ready(self.old_port)
        self._auth('http://127.0.0.1:' + str(self.old_port))
        return True

    def restore_routes(self) -> None:
        self.verify_legacy()
        self._apply_routes('before', ('maintenance', 'before'))

    def persist_rollback(self) -> None:
        self.verify_legacy()
        self._assert_routes(('before',))
        previous = self.context['previousState']
        if previous is None:
            self.state_path.unlink(missing_ok=True)
        else:
            private_write(self.state_path, previous.encode())
        self.run(['pm2', 'save'])
        self.context['committed'] = False
        self.save_context()

    def verify_terminal(self, phase: str) -> None:
        if phase == 'committed':
            if self._pointer() is None or json.loads(self._pointer()) != self.context['activeState']:
                raise RuntimeError('Committed bootstrap journal disagrees with the active release pointer')
            for role in ('server', 'worker'):
                self._prove_legacy_stop(role)
            self.verify_public()
            return
        if phase == 'rolled_back':
            self.verify_legacy()
            self._assert_routes(('before',))
            previous = self.context['previousState']
            if self._pointer() != (previous.encode() if previous is not None else None):
                raise RuntimeError('Rolled-back bootstrap journal disagrees with the restored pointer')
            self._public_checks()
            return
        raise RuntimeError('Bootstrap did not reach a verifiable terminal state')

    def load_context(self) -> None:
        context = json.loads(self.context_path.read_bytes())
        expected = {'schemaVersion': 1, 'root': str(self.root), 'config': str(self.config), 'stage': str(self.stage),
                    'bridge': str(self.bridge), 'backup': str(self.backup), 'manifestSha256': self.manifest_sha256,
                    'publicUrl': self.public_url, 'ingressUrl': self.ingress_url, 'envFile': str(self.env_file),
                    'oldPort': self.old_port, 'newPort': self.new_port, 'names': self.names}
        if any(context.get(key) != value for key, value in expected.items()):
            raise ValueError('Recovery arguments differ from the saved private context')
        if os.name == 'posix' and self.context_path.stat().st_mode & 0o077:
            raise ValueError('Private bootstrap context has unsafe filesystem permissions')
        for name, checksum in context['helperHashes'].items():
            if digest(Path(__file__).with_name(name)) != checksum:
                raise RuntimeError('Bootstrap helper changed after preparation; recovery refused')
        if any(context['legacy'][role]['name'] != self.expected[role]['name'] or
               context['legacy'][role]['pid'] != self.expected[role]['pid'] for role in ('server', 'worker')):
            raise ValueError('Recovery legacy identities differ from the saved transaction')
        self.context = context
        self.pm2_log = Path(context['pm2Log'])
        self._assert_env_file()
        if context['snapshots']['before'] != self.expected_config_sha256:
            raise ValueError('Recovery original configuration hash differs from the saved transaction')
        self.validate_bridge()
        self._assert_routes(('before', 'maintenance', 'after'))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('root', 'config', 'bootstrap-dir', 'bridge', 'backup', 'env-file'):
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ('api-name', 'worker-name', 'manifest-sha256', 'expected-config-sha256', 'backup-tar-sha256', 'backup-dump-sha256'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--api-pid', type=int, required=True)
    parser.add_argument('--worker-pid', type=int, required=True)
    parser.add_argument('--public-url', default='https://studio.0st.top')
    parser.add_argument('--ingress-url', default='https://127.0.0.1')
    parser.add_argument('--pm2-log', type=Path)
    parser.add_argument('--recover', action='store_true')
    args = vars(parser.parse_args())
    recovery = args.pop('recover')
    with release_locks(args['root'].resolve(strict=True)):
        host = BootstrapHost(**args)
        orchestrator = load_script('legacy-bootstrap')
        if recovery:
            host.load_context()
        report = (orchestrator.recover if recovery else orchestrator.rollout)(host, host.stage / 'transaction.json')
        host.verify_terminal(report['phase'])
        print(json.dumps({'phase': report['phase'], 'completed': report['completed'], 'journal': str(host.stage / 'transaction.json')}))


if __name__ == '__main__':
    try:
        main()
    except Exception as failure:
        sys.stderr.write(json.dumps({'ok': False, 'error': {'code': 'bootstrap_host_failed', 'kind': type(failure).__name__}}) + '\n')
        raise SystemExit(1) from None
