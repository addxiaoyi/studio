"""DRAFT: maintenance migration transaction; host integration and recovery still require verification."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    if spec is None or spec.loader is None:
        raise RuntimeError('Migration release helper is unavailable: ' + name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


blue = load_script('blue-green-release')
maintenance = load_script('legacy-maintenance')
MIGRATION_PHASES = ('block_ingress', 'drain_old_api', 'drain_worker', 'verify_quiescent', 'migrate',
                    'verify_schema', 'start_api', 'verify_api', 'start_worker', 'verify_worker',
                    'switch_routes', 'verify_public', 'persist')


def migration_rollback(host, attempted: list[str]) -> list[str]:
    actions = ['block_ingress'] if 'block_ingress' in attempted else []
    if 'start_api' in attempted:
        actions.append('stop_candidate_api')
    if 'start_worker' in attempted:
        actions.append('stop_candidate_worker')
    if 'drain_old_api' in attempted:
        actions.append('verify_quiescent')
    if 'migrate' in attempted:
        actions.append('verify_downgrade')
    if 'drain_worker' in attempted:
        actions.append('restart_worker')
    if 'drain_old_api' in attempted:
        actions.append('restart_api')
    if 'block_ingress' in attempted:
        actions += ['verify_legacy', 'restore_routes', 'persist_rollback', 'verify_rollback']
    for action in actions:
        try:
            getattr(host, action)()
        except Exception as failure:
            return [action + ': ' + type(failure).__name__]
    return []


def migration_rollout(host, journal: Path) -> dict:
    if journal.exists():
        raise FileExistsError('Migration release journal already exists; use guarded recovery')
    host.preflight()
    report = {'schemaVersion': 1, 'kind': 'maintenance-migration-release', 'phase': 'prepared', 'attempted': []}
    blue.write_json(journal, report)
    try:
        for action in MIGRATION_PHASES:
            report['attempted'].append(action)
            report['phase'] = action
            blue.write_json(journal, report)
            getattr(host, action)()
        report['phase'] = 'committed'
        blue.write_json(journal, report)
        return report
    except Exception as failure:
        errors = migration_rollback(host, report['attempted'])
        report.update(phase='rollback_incomplete' if errors else 'rolled_back',
                      error={'kind': type(failure).__name__}, recoveryErrors=errors)
        blue.write_json(journal, report)
        if errors:
            raise RuntimeError('Migration release rollback incomplete: ' + '; '.join(errors)) from None
        raise


def migration_recover(host, journal: Path) -> dict:
    report = json.loads(journal.read_bytes())
    attempted = report.get('attempted') if isinstance(report, dict) else None
    if (not isinstance(attempted, list) or attempted != list(MIGRATION_PHASES[:len(attempted)]) or
            report.get('kind') != 'maintenance-migration-release'):
        raise ValueError('Migration journal has an invalid transaction or phase sequence')
    if report.get('phase') == 'committed':
        if attempted != list(MIGRATION_PHASES) or not host.is_committed():
            raise RuntimeError('Migration journal disagrees with the committed host state')
        host.verify_committed()
        return report
    if report.get('phase') == 'rolled_back':
        host.verify_rollback()
        return report
    errors = migration_rollback(host, attempted)
    report.update(phase='rollback_incomplete' if errors else 'rolled_back', recovered=True, recoveryErrors=errors)
    blue.write_json(journal, report)
    if errors:
        raise RuntimeError('Migration recovery rollback incomplete: ' + '; '.join(errors))
    return report


RECORDED_SCHEMA_PROBE = r"""
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
const db = new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const client = await db.connect();
try {
  await client.query('begin transaction isolation level repeatable read, read only');
  const {rows} = await client.query('select version,checksum from public.schema_migrations order by version');
  const applied = new Map(rows.map(row=>[row.version,row.checksum]));
  const pending=[];
  for(const name of (await readdir('./src/local-db/migrations')).filter(name=>name.endsWith('.sql')).sort()) {
    const sql=(await readFile('./src/local-db/migrations/'+name,'utf8')).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
    const checksum=createHash('sha256').update(sql).digest('hex');
    const version=name.slice(0,-4);
    if(applied.has(version)&&applied.get(version)!==checksum) throw new Error('Recorded migration checksum differs: '+name);
    if(!applied.has(version)) pending.push(version);
  }
  await client.query('commit');
  process.stdout.write(JSON.stringify({readOnly:true,recorded:rows,pending}));
} finally { client.release(); await db.end(); }
"""


class MigrationHost(blue.LocalHost):
    def __init__(self, root: Path, staging: Path, config: Path, public_url: str):
        super().__init__(root, staging, config, public_url)
        self.migration_state = {}
        self.old_api_restart_instance = None

    def check_schema_before_start(self, env_file: Path, env: dict) -> None:
        # The ordinary blue-green gate still rejects pending migrations. Only this maintenance
        # transaction may list them before stopping writers and running the complete migrator.
        report = json.loads(self.run(['node', '--env-file=' + str(env_file), '--input-type=module', '-e', RECORDED_SCHEMA_PROBE],
                                     cwd=self.server, env=env))
        if report.get('readOnly') is not True or not isinstance(report.get('recorded'), list) or not isinstance(report.get('pending'), list):
            raise RuntimeError('Recorded schema checksum inspection did not provide an affirmative proof')
        self.migration_state = {'schemaBefore': report, 'env': env, 'envFile': str(env_file),
                                'envSha256': blue.file_hash(env_file), 'helpers': {}}

    def preflight(self) -> None:
        super().preflight()
        deployment = load_script('deploy-production-candidate')
        deployment.verify_prepared_code(self.stage / 'candidate.zip', self.release)
        if (Path(self.previous['release']) / 'BRIDGE-MANIFEST.json').is_file() is False:
            raise RuntimeError('Maintenance migration requires the verified lifecycle bridge as its rollback baseline')
        for name in ('legacy-maintenance.py', 'legacy-release-activity.mjs', 'legacy-downgrade-guard.mjs', 'migration-release.py'):
            self.migration_state['helpers'][name] = blue.file_hash(Path(__file__).with_name(name))
        self.migration_state['oldVersion'] = self.old_version
        self.barrier = maintenance.prepare(self.before.decode(), self.previous['port']).encode()
        blue.atomic_write(self.stage / 'nginx.maintenance', self.barrier)
        self.migration_state['barrierSha256'] = hashlib.sha256(self.barrier).hexdigest()
        self.save_context()
        self._activity()
        self.verify_downgrade()

    def save_context(self) -> None:
        super().save_context()
        if self.migration_state:
            private = self.stage / 'migration-context.json'
            blue.write_json(private, self.migration_state)
            private.chmod(0o600)

    @classmethod
    def recover_context(cls, root: Path, staging: Path, config: Path, public_url: str):
        host = cls.__new__(cls)
        restored = blue.LocalHost.from_context(root, staging, config, public_url)
        host.__dict__.update(restored.__dict__)
        host.migration_state = json.loads((host.stage / 'migration-context.json').read_bytes())
        host.old_api_restart_instance = host.migration_state.get('oldApiRestartInstance')
        host.barrier = (host.stage / 'nginx.maintenance').read_bytes()
        if hashlib.sha256(host.barrier).hexdigest() != host.migration_state['barrierSha256']:
            raise RuntimeError('Saved maintenance snapshot does not match its private context')
        host._guard_files()
        return host

    def _guard_files(self) -> None:
        if blue.file_hash(Path(self.migration_state['envFile'])) != self.migration_state['envSha256']:
            raise RuntimeError('Migration environment file changed outside the transaction')
        for name, checksum in self.migration_state['helpers'].items():
            if blue.file_hash(Path(__file__).with_name(name)) != checksum:
                raise RuntimeError('Migration helper changed after preflight')

    def _database_probe(self, name: str, export: str) -> dict:
        self._guard_files()
        program = Path(__file__).with_name(name).resolve(strict=True)
        probe = ("import {createRequire} from 'node:module';const require=createRequire(process.cwd()+'/package.json');"
                 "const {Pool}=require('pg');const module=await import(" + json.dumps(program.as_uri()) + ");"
                 "const db=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});"
                 "try{process.stdout.write(JSON.stringify(await module." + export + "({pool:db})));}finally{await db.end();}")
        return json.loads(self.run(['node', '--env-file=' + self.migration_state['envFile'], '--input-type=module', '-e', probe],
                                   cwd=self.server, env=self.migration_state['env']))

    def _activity(self) -> dict:
        report = self._database_probe('legacy-release-activity.mjs', 'inspectLegacyReleaseActivity')
        tables = {'background_jobs', 'agent_runs', 'agent_goals', 'agent_goal_steps', 'video_transcripts',
                  'video_transcript_exports', 'desktop_agent_tasks', 'media_resource_leases'}
        coverage = report.get('coverage', {})
        if (report.get('readOnly') is not True or report.get('activity') != 'none_observed' or report.get('blockers') != [] or
                set(coverage.get('checked', [])) != tables or coverage.get('absent') != [] or coverage.get('unsupported') != []):
            raise RuntimeError('Migration activity proof is blocked or incomplete')
        return report

    def verify_downgrade(self) -> None:
        report = self._database_probe('legacy-downgrade-guard.mjs', 'inspectLegacyDowngrade')
        core = {'background_jobs', 'credit_transactions', 'generation_approvals'}
        if (report.get('readOnly') is not True or report.get('downgrade') != 'no_blockers_observed' or
                report.get('blockers') != [] or not core.issubset(set(report.get('coverage', {}).get('checked', []))) or
                report.get('coverage', {}).get('unsupported') != []):
            raise RuntimeError('Database contains state incompatible with the legacy lifecycle bridge')
        self.migration_state['downgradeProof'] = report
        self.save_context()

    def _assert_routes(self, expected: tuple[bytes, ...]) -> None:
        self.assert_active_pointer(allow_candidate=True)
        if self.config.read_bytes() not in expected:
            raise RuntimeError('Nginx changed outside the maintenance migration transaction')

    def block_ingress(self) -> None:
        self._assert_routes((self.before, self.barrier, self.after))
        self.switcher.replace_config(self.config, self.barrier, self.config.stat())
        self.run(['nginx', '-t'])
        self.run(['nginx', '-s', 'reload'])
        # Reuse the frozen HTTP barrier validator without modifying its host adapter.
        bootstrap = load_script('legacy-bootstrap-host')
        origin = urlsplit(self.public_url)
        deadline = time.monotonic() + 10
        while True:
            valid = True
            for method, path, headers in (('GET', '/api/__migration_probe__', {}), ('POST', '/api/__migration_probe__', {}),
                    ('GET', '/api/ws', {'Connection': 'Upgrade', 'Upgrade': 'websocket'})):
                response = bootstrap.request('https://127.0.0.1' + path, method, {'Host': origin.netloc, **headers}, b'{}' if method == 'POST' else None)
                valid = valid and response['status'] == 503 and response['headers'].get('retry-after') == '30' and response['headers'].get('cache-control') == 'no-store'
            if valid:
                return
            if time.monotonic() >= deadline:
                raise RuntimeError('Maintenance admission barrier did not converge')
            time.sleep(0.1)

    def drain_old_api(self) -> None:
        self._assert_routes((self.barrier,))
        self.retire_api()
        self.migration_state['oldApiStopped'] = True
        self.save_context()

    def drain_worker(self) -> None:
        self._assert_routes((self.barrier,))
        if not self.migration_state.get('oldApiStopped'):
            raise RuntimeError('Old API must drain before its worker')
        self.stop_worker(self.previous['worker'], self.old_receipt, self.old_worker_pid, self.old_instance)

    def _stopped(self, name: str, receipt: Path, pid: int, instance: str) -> None:
        item = self.process(name)
        if item['pm2_env']['status'] != 'stopped' or item['pm2_env'].get('exit_code') != 0:
            raise RuntimeError('Application process is not confirmed stopped before migration')
        blue.process_receipt(receipt, pid, 'drained', instance)

    def verify_quiescent(self) -> None:
        self._assert_routes((self.barrier,))
        self._stopped(self.previous['api'], Path(self.old_api_receipt), self.old_api_pid, self.old_api_instance)
        worker = self.process(self.previous['worker'])
        if worker['pm2_env']['status'] != 'online':
            self._stopped(self.previous['worker'], self.old_receipt, self.old_worker_pid, self.old_instance)
        elif self.migration_state.get('migrationsAttempted'):
            raise RuntimeError('Old worker became active while migration or candidate ownership was uncertain')
        for role in ('server', 'worker'):
            items = [item for item in self.processes() if item.get('name') == self.names[role]]
            if items:
                pid = self.new_api_pid if role == 'server' else self.new_worker_pid
                instance = self.new_api_instance if role == 'server' else self.new_worker_instance
                if not pid or not instance:
                    raise RuntimeError('Candidate process lacks an authored lifecycle identity')
                self._stopped(self.names[role], self.stage / (role + '-receipt.json'), pid, instance)
        self._activity()

    def migrate(self) -> None:
        self.verify_quiescent()
        self._stopped(self.previous['worker'], self.old_receipt, self.old_worker_pid, self.old_instance)
        self.migration_state['migrationsAttempted'] = True
        self.save_context()
        env = {**self.migration_state['env'], 'MIGRATION_STRICT_CHECKSUM': '1'}
        self.run(['node', '--env-file=' + self.migration_state['envFile'], '--import', 'tsx', './src/local-db/migrate.ts'],
                 cwd=self.server, env=env, timeout=600)

    def verify_schema(self) -> None:
        self._guard_files()
        blue.LocalHost.check_schema_before_start(self, Path(self.migration_state['envFile']), self.migration_state['env'])
        self.migration_state['schemaVerified'] = True
        self.save_context()

    def start_api(self) -> None:
        self._assert_routes((self.barrier,))
        if not self.migration_state.get('schemaVerified'):
            raise RuntimeError('Candidate cannot start without complete recorded migration checksums')
        super().start_api()

    def switch_routes(self) -> None:
        self._assert_routes((self.barrier,))
        self.verify_api()
        self.verify_worker()
        self.switcher.replace_config(self.config, self.after, self.config.stat())
        self.run(['nginx', '-t'])
        self.run(['nginx', '-s', 'reload'])

    def restart_worker(self) -> None:
        if self.migration_state.get('migrationsAttempted'):
            self.verify_downgrade()
        super().restart_worker()

    def restart_api(self) -> None:
        item = self.process(self.previous['api'])
        if item['pm2_env']['status'] == 'online':
            expected = self.old_api_restart_instance or self.old_api_instance
            blue.process_receipt(Path(self.old_api_receipt), item['pid'], 'ready', expected)
            return
        self._stopped(self.previous['api'], Path(self.old_api_receipt), self.old_api_pid, self.old_api_instance)
        if self.migration_state.get('migrationsAttempted'):
            self.verify_downgrade()
        self.run(['pm2', 'restart', self.previous['api']], timeout=blue.READY_SECONDS + 30)
        item = self.process(self.previous['api'])
        receipt = blue.process_receipt(Path(self.old_api_receipt), item['pid'], 'ready')
        if item['pm2_env']['status'] != 'online' or receipt['instanceId'] == self.old_api_instance:
            raise RuntimeError('Old bridge API did not restart with a fresh authored ready receipt')
        self.old_api_restart_instance = receipt['instanceId']
        self.migration_state['oldApiRestartInstance'] = receipt['instanceId']
        self.save_context()

    def verify_legacy(self) -> None:
        self.switcher.ready(self.previous['port'], self.old_version)
        item = self.process(self.previous['api'])
        blue.process_receipt(Path(self.old_api_receipt), item['pid'], 'ready', self.old_api_restart_instance or self.old_api_instance)
        worker = self.process(self.previous['worker'])
        if worker['pm2_env']['status'] != 'online':
            raise RuntimeError('Old bridge worker is not online')
        blue.process_receipt(self.old_receipt, worker['pid'], 'ready')

    def restore_routes(self) -> None:
        self.verify_legacy()
        self._assert_routes((self.before, self.barrier, self.after))
        self.switcher.replace_config(self.config, self.before, self.config.stat())
        self.run(['nginx', '-t'])
        self.run(['nginx', '-s', 'reload'])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--staging', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--public-url', required=True)
    parser.add_argument('--recover', action='store_true')
    args = parser.parse_args()
    bootstrap = load_script('legacy-bootstrap-host')
    with bootstrap.release_locks(args.root):
        host = (MigrationHost.recover_context if args.recover else MigrationHost)(args.root, args.staging, args.config, args.public_url)
        report = (migration_recover if args.recover else migration_rollout)(host, args.staging / 'migration-transaction.json')
        print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    raise SystemExit('DRAFT: migration host integration and guarded recovery are incomplete; production execution is disabled')
