"""Publish the reviewed pricing overlay, preserving desktop pages and downloads."""

import base64
import hashlib
import json
import pathlib
import shlex
import tarfile
import time
import sys
import urllib.request
import zipfile
from importlib.machinery import SourceFileLoader

ROOT = pathlib.Path(__file__).resolve().parents[1]
CANDIDATE = ROOT / "release-candidates/website-minimax-20261024"
ssh = SourceFileLoader("website_ssh", str(ROOT / "scripts/inspect-website-release.py")).load_module()
ROUTES = ["home", "canvas", "model-pricing", "settings", "feed", "image", "video", "texture-lab", "ecom-images", "desktop-app"]


def remote_python(client, source, timeout=180):
    encoded = base64.b64encode(source.encode()).decode()
    return ssh.run(client, "python3 -c " + shlex.quote("import base64;exec(base64.b64decode(" + repr(encoded) + "))"), timeout)


def package():
    with tarfile.open(ROOT / "release-candidates/website-production-source.tar.gz") as original:
        baseline = {entry.name: hashlib.sha256(original.extractfile(entry).read()).hexdigest()
                    for entry in original if entry.isfile()}
    changes = {}
    for relative, previous in baseline.items():
        path = CANDIDATE / relative
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != previous:
            changes[relative] = {"before": previous, "after": digest}
    manifest = {"files": changes, "webRoutes": ROUTES}
    (CANDIDATE / "WEBSITE-MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    archive = ROOT / "release-candidates/website-pricing-20261024.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        bundle.writestr("WEBSITE-MANIFEST.json", json.dumps(manifest))
        for relative in changes:
            bundle.write(CANDIDATE / relative, relative)
        web = ROOT / "apps/web/out"
        for directory in [web / "_next/static", *(web / route for route in ROUTES)]:
            for path in directory.rglob("*"):
                if path.is_file():
                    bundle.write(path, "web/" + path.relative_to(web).as_posix())
    return archive, hashlib.sha256(archive.read_bytes()).hexdigest()


def main():
    archive, digest = package()
    print("CANDIDATE", json.dumps({"sha256": digest, "bytes": archive.stat().st_size}), flush=True)
    client, proxy = ssh.connect()
    swapped = []
    services_stopped = False
    provider_changed = False
    stage = None
    try:
        stage = ssh.run(client, "mktemp -d /www/helstera/.website-pricing.XXXXXX")
        if pathlib.PurePosixPath(stage).parent != pathlib.PurePosixPath("/www/helstera") or not pathlib.PurePosixPath(stage).name.startswith(".website-pricing."):
            raise RuntimeError("Unexpected staging path")
        print("BACKUP_STAGE", stage, flush=True)
        with client.open_sftp() as sftp:
            sftp.put(str(archive), stage + "/candidate.zip")
        print(remote_python(client, f'''
import hashlib,json,pathlib,zipfile,shutil,os
stage=pathlib.Path({stage!r}); root=pathlib.Path('/www/helstera')
assert hashlib.sha256((stage/'candidate.zip').read_bytes()).hexdigest()=={digest!r}
with zipfile.ZipFile(stage/'candidate.zip') as bundle:
 for name in bundle.namelist():
  path=pathlib.PurePosixPath(name)
  if path.is_absolute() or '..' in path.parts: raise RuntimeError('Unsafe archive path')
 bundle.extractall(stage/'payload')
manifest=json.loads((stage/'payload/WEBSITE-MANIFEST.json').read_text())
for relative, hashes in manifest['files'].items():
 if hashlib.sha256((root/relative).read_bytes()).hexdigest()!=hashes['before']: raise RuntimeError('Production changed: '+relative)
 if hashlib.sha256((stage/'payload'/relative).read_bytes()).hexdigest()!=hashes['after']: raise RuntimeError('Candidate hash mismatch: '+relative)
for relative in ['apps/server/src','packages/shared/dist','apps/web/out']:
 shutil.copytree(root/relative,stage/'next'/relative,copy_function=os.link)
for relative in manifest['files']:
 os.replace(stage/'payload'/relative,stage/'next'/relative)
for path in (stage/'payload/web').rglob('*'):
 if path.is_file():
  destination=stage/'next/apps/web/out'/path.relative_to(stage/'payload/web')
  destination.parent.mkdir(parents=True,exist_ok=True)
  os.replace(path,destination)
print('staged-hashes-verified')
'''), flush=True)
        # The dump stays on the server. No database password is printed or downloaded.
        backup_file = '/www/helstera/.website-pricing.r2H7V1/database.dump' if '--reuse-backup' in sys.argv else stage + '/database.dump'
        if '--reuse-backup' in sys.argv:
            print("WAITING_FOR_EXISTING_BACKUP", backup_file, flush=True)
            for attempt in range(120):
                running = ssh.run(client, "pgrep -x pg_dump || true")
                if not running:
                    break
                if attempt % 6 == 0:
                    print("BACKUP_BYTES", ssh.run(client, "stat -c %s " + shlex.quote(backup_file)), flush=True)
                time.sleep(5)
            else:
                raise RuntimeError("Database backup still running; live services unchanged")
        print("DATABASE_BACKUP", ssh.node(client, f'''
import {{execFileSync}} from 'node:child_process';
import {{existsSync}} from 'node:fs';
const url=new URL(process.env.DATABASE_URL);
const env={{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)}};
if (!existsSync({json.dumps(backup_file)})) execFileSync('/usr/lib/postgresql/18/bin/pg_dump',['--format=custom','--no-owner','--no-acl','--file',{json.dumps(backup_file)}],{{env,stdio:['ignore','ignore','pipe'],timeout:300000}});
execFileSync('/usr/lib/postgresql/18/bin/pg_restore',['--file=/dev/null',{json.dumps(backup_file)}],{{stdio:['ignore','ignore','pipe'],timeout:300000}});
console.log('verified');
''', timeout=360), flush=True)
        jobs = ssh.node(client, """import pg from 'pg';const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();try{console.log(JSON.stringify((await db.query("select status,count(*)::int as count from background_jobs where status in ('queued','running') group by status")).rows));}finally{await db.end();}""")
        if json.loads(jobs):
            raise RuntimeError("Jobs are active; staged release retained without changing live services")
        # Preserve the exact provider rows for a targeted rollback, separate from the full dump.
        ssh.node(client, f'''
import pg from 'pg';import {{writeFileSync}} from 'node:fs';
const db=new pg.Client({{connectionString:process.env.DATABASE_URL}});await db.connect();
try{{const provider=(await db.query("select id,enabled,health_status,models,last_error,last_probed_at from provider_configs where id='093790f5-816b-4830-84d9-302f45bb854e'")).rows;
const models=(await db.query("select id,enabled,health_status,priority,price_credits,max_resolution from provider_models where lower(model_id)='minimax-h3'")).rows;
writeFileSync({json.dumps(stage + '/providers-before.json')},JSON.stringify({{provider,models}}),{{mode:0o600}});}}finally{{await db.end();}}
''')
        services_stopped = True
        ssh.run(client, "pm2 stop helstera-worker --kill-timeout 30000 && pm2 stop helstera-server --kill-timeout 30000", timeout=90)
        for relative in ["packages/shared/dist", "apps/server/src"]:
            exchange(client, stage, relative)
            swapped.append(relative)
        print("IMPORT_CHECK", ssh.run(client, "cd /www/helstera/apps/server && node --import tsx --input-type=module -e " + shlex.quote("await import('./src/http/video-models.ts');await import('./src/agent/runtime.ts');const shared=await import('@helstera/shared');if(shared.calculateVideoCost('MiniMax-H3','1440p',5)!==1.9)throw new Error('Pricing mismatch');console.log('ok')")), flush=True)
        provider_changed = True
        print("PROVIDER", ssh.node(client, """
import pg from 'pg';const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{await db.query('begin');
await db.query("update provider_configs set enabled=true,health_status='healthy',models=$1::jsonb,last_error=null,last_probed_at=now(),updated_at=now() where id=$2 and base_url=$3",[JSON.stringify(['MiniMax-H3']),'093790f5-816b-4830-84d9-302f45bb854e','https://ai.furry.vg/v1']);
await db.query("update provider_models set enabled=false,updated_at=now() where lower(model_id)='minimax-h3' and provider_id<>'093790f5-816b-4830-84d9-302f45bb854e'");
const updated=await db.query("update provider_models set enabled=true,priority=1,price_credits=0.3,max_resolution='1440p',updated_at=now() where provider_id='093790f5-816b-4830-84d9-302f45bb854e' and model_id='MiniMax-H3' returning model_id");
if(updated.rowCount!==1)throw new Error('Expected exactly one MiniMax model');
await db.query('commit');console.log(JSON.stringify(updated.rows));
}catch(error){await db.query('rollback');throw error;}finally{await db.end();}
"""), flush=True)
        ssh.run(client, "pm2 restart helstera-server && pm2 restart helstera-worker", timeout=60)
        services_stopped = False
        health(client)
        exchange(client, stage, "apps/web/out")
        swapped.append("apps/web/out")
        public = urllib.request.Request("https://studio.0st.top/api/video-models?release_check=" + digest[:12], headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(public, timeout=30) as response:
            body = json.load(response)
        minimax = [model for model in body["models"] if model["id"].lower() == "minimax-h3"]
        if len(minimax) != 1 or [r["priceCnyPerSecond"] for r in minimax[0].get("resolutionRates", [])] != [0.22, 0.3, 0.34, 0.38]:
            raise RuntimeError("Public MiniMax pricing verification failed")
        for route in ["home", "model-pricing", "canvas"]:
            with urllib.request.urlopen("https://studio.0st.top/" + route + "/?release_check=" + digest[:12], timeout=30) as response:
                page = response.read()
            if hashlib.sha256(page).digest() != hashlib.sha256((ROOT / "apps/web/out" / route / "index.html").read_bytes()).digest():
                raise RuntimeError("Public HTML differs from built candidate: " + route)
        ssh.run(client, "pm2 save", timeout=30)
        receipt = {"sha256": digest, "backup": stage, "databaseBackup": backup_file, "model": minimax[0], "webRoutes": ROUTES}
        (CANDIDATE / "DEPLOYED.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print("DEPLOYED", json.dumps(receipt), flush=True)
        swapped.clear()
        provider_changed = False
    except Exception:
        if swapped or services_stopped:
            print("ROLLBACK", stage, flush=True)
            ssh.run(client, "pm2 stop helstera-server && pm2 stop helstera-worker", timeout=90)
            for relative in reversed(swapped):
                exchange(client, stage, relative)
            if provider_changed:
                ssh.node(client, f'''
import pg from 'pg';import {{readFileSync}} from 'node:fs';
const db=new pg.Client({{connectionString:process.env.DATABASE_URL}});await db.connect();
try{{await db.query('begin');const snapshot=JSON.parse(readFileSync({json.dumps(stage + '/providers-before.json')},'utf8'));
for(const p of snapshot.provider)await db.query('update provider_configs set enabled=$2,health_status=$3,models=$4,last_error=$5,last_probed_at=$6 where id=$1',[p.id,p.enabled,p.health_status,JSON.stringify(p.models),p.last_error,p.last_probed_at]);
for(const m of snapshot.models)await db.query('update provider_models set enabled=$2,health_status=$3,priority=$4,price_credits=$5,max_resolution=$6 where id=$1',[m.id,m.enabled,m.health_status,m.priority,m.price_credits,m.max_resolution]);
await db.query('commit');}}catch(error){{await db.query('rollback');throw error;}}finally{{await db.end();}}
''')
            ssh.run(client, "pm2 restart helstera-server && pm2 restart helstera-worker", timeout=60)
            health(client)
        raise
    finally:
        client.close()
        proxy.close()


def exchange(client, stage, relative):
    remote_python(client, f'''
import ctypes,os,pathlib
root=pathlib.Path('/www/helstera'); a=root/{relative!r};b=pathlib.Path({stage!r})/'next'/{relative!r}
if not a.is_dir() or not b.is_dir() or a.is_symlink() or b.is_symlink():raise RuntimeError('Invalid switch directories')
rename=ctypes.CDLL(None,use_errno=True).renameat2
rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
if rename(-100,os.fsencode(a),-100,os.fsencode(b),2):raise OSError(ctypes.get_errno(),'Atomic switch failed')
''')


def health(client):
    for attempt in range(15):
        try:
            response = ssh.run(client, "curl -fsS --max-time 3 http://127.0.0.1:3000/api/health")
            print("HEALTH", response, flush=True)
            return
        except RuntimeError:
            if attempt == 14:
                raise
            time.sleep(2)


if __name__ == "__main__":
    main()
