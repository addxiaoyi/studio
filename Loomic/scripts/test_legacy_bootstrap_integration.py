"""Isolated Linux PM2/Nginx bootstrap checks, with an optional private fixture database.

HELT_BOOTSTRAP_TEST_NODE_MODULES must identify the server's installed node_modules.
HELT_BOOTSTRAP_TEST_TMPDIR selects a traversable fixture parent (default /www/helstera).
HELT_BOOTSTRAP_TEST_DATABASE_URL optionally enables a random fixture schema on a
loopback database whose name contains test, fixture, or rehearsal. No .env is read.
HELT_BOOTSTRAP_TEST_REQUIRED=1 makes missing integration prerequisites a failure.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.parse import unquote, urlsplit
import urllib.error
import urllib.request
from uuid import uuid4
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


REPO = Path(__file__).resolve().parents[1]
TOOLS = os.environ.get('HELT_BOOTSTRAP_TEST_NODE_MODULES')
DATABASE = os.environ.get('HELT_BOOTSTRAP_TEST_DATABASE_URL')
REQUIRED = os.environ.get('HELT_BOOTSTRAP_TEST_REQUIRED') == '1'
AVAILABLE = bool(sys.platform.startswith('linux') and TOOLS and
                 all(shutil.which(tool) for tool in ('node', 'pm2', 'nginx')) and
                 (not DATABASE or shutil.which('psql')))

RUNTIME = r'''
import { appendFile, open, readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const { createProcessReceipt } = await import(pathToFileURL(process.env.BOOTSTRAP_RECEIPT_MODULE));
const role = process.env.BOOTSTRAP_ROLE;
const generation = process.env.BOOTSTRAP_GENERATION;
const root = process.env.BOOTSTRAP_ROOT;
const receipt = createProcessReceipt(role, generation === 'bridge' ? process.env.HELSTERA_PROCESS_RECEIPT : undefined);
let pool;
if (process.env.BOOTSTRAP_TEST_DATABASE_URL) {
  const require = createRequire(import.meta.url);
  const { Pool } = require('pg');
  pool = new Pool({connectionString: process.env.BOOTSTRAP_TEST_DATABASE_URL,
    options: '-csearch_path=' + process.env.BOOTSTRAP_SCHEMA,
    application_name: process.env.BOOTSTRAP_PREFIX, max: 1});
  pool.on('error', error => { console.error('Fixture database connection failed', error.code); process.exitCode = 1; });
  await pool.query('insert into activity(role,pid) values($1,$2)', [role, process.pid]);
}
const record = phase => appendFile(join(root, 'events.jsonl'), JSON.stringify({role,generation,phase,pid:process.pid})+'\n');
let lock;
let work;
let server;
const sockets = new Set();
if (role === 'worker') {
  lock = await open(join(root, 'worker.lock'), 'wx');
  await lock.writeFile(String(process.pid));
  work = (async () => {
    try { await readFile(join(root, 'job.pending')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await record('job-start');
    await delay(350);
    await unlink(join(root, 'job.pending'));
    await record('job-complete');
  })();
} else {
  server = createServer((request,response) => {
    response.writeHead(200, {'Content-Type':'application/json'});
    response.end(JSON.stringify({ok:true,version:generation,pid:process.pid}));
  });
  server.on('upgrade', (request,socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(Number(process.env.BOOTSTRAP_PORT),'127.0.0.1',resolve);
  });
}
await receipt.ready();
await record('ready');
process.send?.('ready');
const keepAlive = setInterval(() => {}, 1000);
let closing;
const stop = () => {
  closing ??= (async () => {
    await record('shutdown-start');
    if (server) {
      const closed = new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
      for (const socket of sockets) socket.destroy();
      await closed;
    }
    await work;
    if (lock) { await lock.close(); await unlink(join(root,'worker.lock')); }
    if (pool) { await pool.query('delete from activity where role=$1 and pid=$2',[role,process.pid]); await pool.end(); }
    await receipt.drained();
    await record('shutdown-complete');
    console.log('Shutdown complete.', role, generation, process.pid);
    clearInterval(keepAlive);
  })().catch(error => { console.error('Fixture shutdown failed', error.code ?? error.name); process.exitCode=1; clearInterval(keepAlive); });
};
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
'''


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wait_until(probe, timeout=15):
    deadline = time.monotonic() + timeout
    while True:
        try:
            answer = probe()
            if answer:
                return answer
        except (OSError, ValueError, RuntimeError, KeyError):
            if time.monotonic() >= deadline:
                raise
        if time.monotonic() >= deadline:
            raise RuntimeError('Isolated bootstrap fixture did not reach its expected state')
        time.sleep(0.05)


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def validate_database_url(address):
    url = urlsplit(address)
    database = unquote(url.path.removeprefix('/'))
    if (url.scheme not in ('postgres', 'postgresql') or url.hostname != '127.0.0.1'
            or not re.fullmatch(r'[A-Za-z0-9_-]*(?:test|fixture|rehearsal)[A-Za-z0-9_-]*', database)
            or url.query or url.fragment):
        raise ValueError('Integration database must be an explicit loopback test URL without overrides')
    return address


class EnvironmentTests(unittest.TestCase):
    def test_database_must_be_an_explicit_loopback_test_database(self):
        self.assertEqual(validate_database_url('postgres://operator@127.0.0.1/bridge_test'), 'postgres://operator@127.0.0.1/bridge_test')
        for address in ['postgres://operator@203.0.113.1/bridge_test', 'postgres://operator@127.0.0.1/helstera',
                        'postgres://operator@127.0.0.1/bridge_test?host=elsewhere', '', 'postgres:///bridge_test']:
            with self.subTest(address=address), self.assertRaises(ValueError):
                validate_database_url(address)


@unittest.skipUnless(AVAILABLE or REQUIRED, 'requires explicit Linux PM2/Nginx/Node tools; optional private PostgreSQL')
class BootstrapIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not AVAILABLE:
            raise RuntimeError('Required isolated bootstrap integration prerequisites are missing')

    def setUp(self):
        self.bootstrap, self.maintenance = load('legacy-bootstrap'), load('legacy-maintenance')
        if DATABASE:
            validate_database_url(DATABASE)
        parent = Path(os.environ.get('HELT_BOOTSTRAP_TEST_TMPDIR', '/www/helstera')).resolve()
        if not parent.is_dir():
            raise RuntimeError('Explicit bootstrap test temporary parent does not exist')
        if any(not ancestor.stat().st_mode & 0o001 for ancestor in (parent, *parent.parents)):
            raise RuntimeError('Nginx fixture parent and its ancestors must allow traversal; select a public test parent')
        self.folder = tempfile.TemporaryDirectory(prefix='.bootstrap-integration-', dir=parent)
        self.root = Path(self.folder.name)
        self.root.chmod(0o755)
        self.prefix = 'bootstrap-test-' + uuid4().hex[:12]
        self.env = {**os.environ, 'PM2_HOME': str(self.root / '.pm2'), 'PM2_DISABLE_INTERNAL_AGENT': 'true',
                    'DATABASE_URL': '', 'PGHOST': '', 'PGHOSTADDR': '', 'PGSERVICE': '', 'PGOPTIONS': ''}
        self.master = self.websocket = self.sidecar = None
        self.schema = None
        self.identities = {}
        self.addCleanup(self.cleanup)
        runtime = self.root / 'runtime'
        runtime.mkdir()
        (runtime / 'node_modules').symlink_to(Path(TOOLS).resolve(), target_is_directory=True)
        (runtime / 'fixture.mjs').write_text(RUNTIME)
        if DATABASE:
            self.schema = 'bootstrap_fixture_' + uuid4().hex
            self.sql(f'create schema {self.schema}; create table {self.schema}.activity(role text primary key,pid integer not null);')
        ports = set()
        while len(ports) < 3:
            ports.add(free_port())
        self.ports = dict(zip(('legacy', 'bridge', 'public'), sorted(ports)))
        (self.root / 'index.html').write_text('static application')
        (self.root / 'index.html').chmod(0o644)
        (self.root / 'job.pending').write_text('durable fixture job')
        self.start('legacy', 'worker')
        self.start('legacy', 'server')
        case = self

        class Gallery(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'verified-fixture-gallery')

            def log_message(self, *_args):
                pass

        self.sidecar = ThreadingHTTPServer(('127.0.0.1', 0), Gallery)
        self.sidecar_thread = threading.Thread(target=self.sidecar.serve_forever, daemon=True)
        self.sidecar_thread.start()
        gallery = ''.join(f'location ^~ /{prefix}fashion-gallery/{kind}/ {{ proxy_pass http://127.0.0.1:3014'
                          + (f'/api/public-media/fashion-gallery/{kind}/' if not prefix else '') + '; }\n'
                          for prefix in ('', 'api/public-media/') for kind in ('img', 'thumbs'))
        canonical = (f'pid {self.root}/nginx.pid;\nerror_log {self.root}/nginx.log;\nevents {{}}\nhttp {{ access_log off;\nserver {{\n'
                     f'listen 127.0.0.1:{self.ports["public"]};\nroot {self.root};\n' + gallery
                     + f'location /api/ws {{ proxy_pass http://127.0.0.1:{self.ports["legacy"]}; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }}\n'
                     + f'location /api/ {{ proxy_pass http://127.0.0.1:{self.ports["legacy"]}; }}\nlocation / {{ try_files $uri =404; }}\n}}\n}}\n')
        blocked = self.maintenance.prepare(canonical, self.ports['legacy'])
        self.assertIn(gallery, blocked)
        sidecar = str(self.sidecar.server_address[1])
        self.before = canonical.replace(':3014', ':' + sidecar).encode()
        self.blocked = blocked.replace(':3014', ':' + sidecar).encode()
        self.after = self.before.replace(f':{self.ports["legacy"]}'.encode(), f':{self.ports["bridge"]}'.encode())
        self.config = self.root / 'nginx.conf'
        self.config.write_bytes(self.before)
        self.nginx('-t')
        self.master = subprocess.Popen(['nginx', '-p', str(self.root) + '/', '-c', str(self.config), '-g', 'daemon off;'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=self.env)
        wait_until(lambda: self.get('/api/health')[1].get('version') == 'legacy')
        self.websocket = socket.create_connection(('127.0.0.1', self.ports['public']), timeout=3)
        self.websocket.sendall(b'GET /api/ws HTTP/1.1\r\nHost: fixture\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
        self.assertIn(b'101 Switching Protocols', self.websocket.recv(4096))
        self.calls = []
        self.quiet_proofs = 0

        class Host:
            def preflight(self):
                case.calls.append('preflight')
                case.assertEqual(case.config.read_bytes(), case.before)
                for role in ('server', 'worker'):
                    case.assertFalse(case.receipt('legacy', role).exists())
                    case.assert_identity('legacy', role)

            def block_ingress(self):
                case.calls.append('block_ingress')
                case.route(case.blocked, (case.before, case.blocked, case.after))
                for method, path, headers in [('GET', '/api/jobs', {}), ('POST', '/api/jobs', {}),
                                               ('GET', '/api/ws', {'Connection': 'Upgrade', 'Upgrade': 'websocket'})]:
                    wait_until(lambda path=path: case.get(path)[0] == 503)
                    status, _, response_headers = case.get(path, method, headers)
                    case.assertEqual(status, 503)
                    case.assertEqual(response_headers['Retry-After'], '30')
                    case.assertEqual(response_headers['Cache-Control'], 'no-store')
                case.assert_gallery()

            def stop_legacy_api(self):
                case.calls.append('stop_legacy_api')
                case.stop('legacy', 'server')
                case.websocket.settimeout(3)
                case.assertEqual(case.websocket.recv(4096), b'')
                return True

            def stop_legacy_worker(self):
                case.calls.append('stop_legacy_worker')
                case.stop('legacy', 'worker')
                case.assertFalse((case.root / 'job.pending').exists())
                return True

            def verify_quiescent(self):
                case.calls.append('verify_quiescent')
                case.assertFalse((case.root / 'worker.lock').exists())
                if DATABASE:
                    case.assertEqual(case.sql(f'select count(*) from {case.schema}.activity;').strip(), '0')
                case.quiet_proofs += 1
                return True

            def start_bridge_api(self):
                case.calls.append('start_bridge_api')
                case.start('bridge', 'server')

            def verify_bridge_api(self):
                case.calls.append('verify_bridge_api')
                case.check_receipt('bridge', 'server', 'ready')
                return case.get('/api/health', port=case.ports['bridge'])[1].get('version') == 'bridge'

            def start_bridge_worker(self):
                case.calls.append('start_bridge_worker')
                case.start('bridge', 'worker')

            def verify_bridge_worker(self):
                case.calls.append('verify_bridge_worker')
                case.check_receipt('bridge', 'worker', 'ready')
                return True

            def switch_routes(self):
                case.calls.append('switch_routes')
                case.route(case.after, (case.blocked,))

            def verify_public(self):
                case.calls.append('verify_public')
                wait_until(lambda: case.get('/api/health')[1].get('version') == 'bridge')
                case.assert_gallery()
                if getattr(case, 'fail_public', False):
                    raise RuntimeError('injected public verification failure')
                return True

            def persist(self):
                case.calls.append('persist')
                case.command(['pm2', 'save'])

            def drain_bridge_api(self):
                case.calls.append('drain_bridge_api')
                case.stop('bridge', 'server')
                case.check_receipt('bridge', 'server', 'drained')
                return True

            def drain_bridge_worker(self):
                case.calls.append('drain_bridge_worker')
                case.stop('bridge', 'worker')
                case.check_receipt('bridge', 'worker', 'drained')
                return True

            def restart_legacy_worker(self):
                case.calls.append('restart_legacy_worker')
                case.start('legacy', 'worker', restart=True)

            def restart_legacy_api(self):
                case.calls.append('restart_legacy_api')
                case.start('legacy', 'server', restart=True)

            def verify_legacy(self):
                case.calls.append('verify_legacy')
                case.assert_identity('legacy', 'worker')
                return case.get('/api/health', port=case.ports['legacy'])[1].get('version') == 'legacy'

            def restore_routes(self):
                case.calls.append('restore_routes')
                case.route(case.before, (case.blocked,))
                wait_until(lambda: case.get('/api/health')[1].get('version') == 'legacy')

            def persist_rollback(self):
                case.calls.append('persist_rollback')
                case.command(['pm2', 'save'])

        self.host = Host()

    def name(self, generation, role):
        return f'{self.prefix}-{generation}-{role}'

    def receipt(self, generation, role):
        return self.root / f'{generation}-{role}.receipt.json'

    def command(self, arguments, timeout=25):
        child = subprocess.run(arguments, env=self.env, capture_output=True, text=True, timeout=timeout)
        if child.returncode:
            raise RuntimeError(f'Isolated fixture command {arguments[0]} failed with exit {child.returncode}')
        return child.stdout

    def sql(self, statement):
        env = {**self.env, 'PGDATABASE': DATABASE}
        child = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement,
                               env=env, capture_output=True, text=True, timeout=10)
        if child.returncode:
            raise RuntimeError('Isolated fixture database query failed')
        return child.stdout

    def process(self, generation, role):
        matches = [item for item in json.loads(self.command(['pm2', 'jlist'])) if item.get('name') == self.name(generation, role)]
        if len(matches) != 1:
            raise RuntimeError('Fixture process identity is missing or ambiguous')
        return matches[0]

    def start(self, generation, role, restart=False):
        name = self.name(generation, role)
        if restart:
            self.command(['pm2', 'restart', name])
        else:
            spec = {'name': name, 'cwd': str(self.root / 'runtime'), 'script': './fixture.mjs',
                    'interpreter': shutil.which('node'), 'node_args': ['--import', 'tsx'],
                    'wait_ready': True, 'listen_timeout': 10000, 'kill_timeout': 10000,
                    'env': {'BOOTSTRAP_ROLE': role, 'BOOTSTRAP_GENERATION': generation,
                            'BOOTSTRAP_ROOT': str(self.root), 'BOOTSTRAP_PORT': str(self.ports[generation]),
                            'BOOTSTRAP_RECEIPT_MODULE': str(REPO / 'apps/server/src/runtime/process-receipt.ts'),
                            'HELSTERA_PROCESS_RECEIPT': str(self.receipt(generation, role)) if generation == 'bridge' else '',
                            'BOOTSTRAP_TEST_DATABASE_URL': DATABASE or '', 'BOOTSTRAP_SCHEMA': self.schema or '',
                            'BOOTSTRAP_PREFIX': self.prefix}}
            path = self.root / f'{generation}-{role}.pm2.json'
            path.write_text(json.dumps({'apps': [spec]}))
            path.chmod(0o600)
            self.command(['pm2', 'start', str(path)])
        item = wait_until(lambda: (value if (value := self.process(generation, role))['pm2_env']['status'] == 'online' else False))
        self.identities[generation, role] = item['pid']
        if generation == 'bridge':
            wait_until(lambda: self.check_receipt(generation, role, 'ready'))

    def assert_identity(self, generation, role):
        item = self.process(generation, role)
        self.assertEqual(item['pm2_env']['status'], 'online')
        self.assertEqual(item['pid'], self.identities[generation, role])

    def stop(self, generation, role):
        self.assert_identity(generation, role)
        pid = self.identities[generation, role]
        self.command(['pm2', 'stop', self.name(generation, role), '--kill-timeout', '10000'])
        item = self.process(generation, role)
        self.assertEqual(item['pm2_env']['status'], 'stopped')
        self.assertEqual(item['pm2_env'].get('exit_code'), 0)
        self.assertFalse(Path(f'/proc/{pid}').exists())
        events = [json.loads(line) for line in (self.root / 'events.jsonl').read_text().splitlines()]
        self.assertTrue(any(event['phase'] == 'shutdown-complete' and event['pid'] == pid for event in events))

    def check_receipt(self, generation, role, state):
        receipt = json.loads(self.receipt(generation, role).read_bytes())
        self.assertEqual(receipt['pid'], self.identities[generation, role])
        self.assertEqual(receipt['state'], state)
        self.assertEqual(receipt['role'], role)
        self.assertTrue(receipt['instanceId'])
        return receipt

    def nginx(self, *arguments):
        return self.command(['nginx', '-p', str(self.root) + '/', '-c', str(self.config), *arguments])

    def route(self, content, allowed):
        self.assertIn(self.config.read_bytes(), allowed)
        if self.config.read_bytes() == content:
            return
        self.config.write_bytes(content)
        self.nginx('-t')
        self.nginx('-s', 'reload')
        time.sleep(0.1)

    def get(self, path, method='GET', headers=None, port=None):
        request = urllib.request.Request(f'http://127.0.0.1:{port or self.ports["public"]}{path}', method=method, headers=headers or {})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            response = opener.open(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            return response.status, json.loads(body) if response.headers.get('Content-Type') == 'application/json' else body, response.headers

    def assert_gallery(self):
        for path in ['/fashion-gallery/img/SPR-0001.webp', '/fashion-gallery/thumbs/SPR-0001.webp',
                     '/api/public-media/fashion-gallery/img/SPR-0001.webp', '/api/public-media/fashion-gallery/thumbs/SPR-0001.webp']:
            status, body, _ = self.get(path)
            self.assertEqual((status, body), (200, b'verified-fixture-gallery'))
        self.assertEqual(self.get('/index.html')[:2], (200, b'static application'))

    def cleanup(self):
        failures = []
        if self.websocket:
            self.websocket.close()
        if self.master:
            try:
                self.nginx('-s', 'quit')
                self.master.wait(timeout=10)
            except Exception as error:
                failures.append(error)
                self.master.kill()
                self.master.wait(timeout=5)
        try:
            self.command(['pm2', 'kill'])
        except Exception as error:
            failures.append(error)
        if self.sidecar:
            self.sidecar.shutdown()
            self.sidecar.server_close()
            self.sidecar_thread.join(timeout=5)
        if self.schema:
            try:
                self.sql(f'drop schema {self.schema} cascade;')
            except Exception as error:
                failures.append(error)
        self.folder.cleanup()
        if failures:
            raise RuntimeError('Isolated bootstrap fixture cleanup failed') from failures[0]

    def assert_event_order(self):
        events = [json.loads(line) for line in (self.root / 'events.jsonl').read_text().splitlines()]
        phases = [(event['generation'], event['role'], event['phase']) for event in events]
        self.assertLess(phases.index(('legacy', 'server', 'shutdown-complete')), phases.index(('legacy', 'worker', 'shutdown-start')))
        self.assertEqual(phases.count(('legacy', 'worker', 'job-complete')), 1)
        self.assertEqual(phases.count(('bridge', 'worker', 'job-start')), 0)

    def test_success_uses_authored_bridge_receipts_and_keeps_gallery_available(self):
        report = self.bootstrap.rollout(self.host, self.root / 'journal.json')
        self.assertEqual(report['phase'], 'committed')
        self.assertEqual(self.quiet_proofs, 1)
        self.assertEqual(self.config.read_bytes(), self.after)
        self.assert_event_order()
        for role in ('server', 'worker'):
            self.check_receipt('bridge', role, 'ready')
            self.assertFalse(self.receipt('legacy', role).exists())

    def test_failed_public_cutover_reblocks_and_drains_bridge_before_restarting_legacy(self):
        self.fail_public = True
        with self.assertRaisesRegex(RuntimeError, 'injected public verification failure'):
            self.bootstrap.rollout(self.host, self.root / 'journal.json')
        report = json.loads((self.root / 'journal.json').read_bytes())
        self.assertEqual(report['phase'], 'rolled_back')
        self.assertEqual(self.quiet_proofs, 2)
        self.assertEqual(self.config.read_bytes(), self.before)
        self.assertLess(self.calls.index('drain_bridge_api'), self.calls.index('drain_bridge_worker'))
        self.assertLess(self.calls.index('drain_bridge_worker'), self.calls.index('restart_legacy_worker'))
        self.assert_event_order()
        self.assert_gallery()
        for role in ('server', 'worker'):
            self.check_receipt('bridge', role, 'drained')
            self.assertFalse(self.receipt('legacy', role).exists())


if __name__ == '__main__':
    unittest.main()
