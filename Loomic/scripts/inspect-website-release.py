"""Read the deployed website state without exposing provider credentials."""

import getpass
import json
import os
import pathlib
import shlex
import sys

import paramiko

ROOT = pathlib.Path(__file__).resolve().parents[1]


def connect():
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.load_host_keys(str(ROOT / "scripts/production-known-hosts"))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    proxy = paramiko.SSHClient()
    proxy.load_system_host_keys()
    proxy.load_host_keys(str(ROOT / "scripts/production-known-hosts"))
    proxy.set_missing_host_key_policy(paramiko.RejectPolicy())
    proxy.connect("103.40.14.25", port=19198, username="add", timeout=15)
    transport = proxy.get_transport()
    if transport is None or not transport.is_active():
        proxy.close()
        raise RuntimeError("Jump host transport is not active")
    channel = transport.open_channel("direct-tcpip", ("23.251.32.222", 22), ("127.0.0.1", 0), timeout=15)
    try:
        password = os.environ.get("HELT_DEPLOY_PASSWORD") or getpass.getpass("Production password: ")
        client.connect("23.251.32.222", username="root", sock=channel,
                       password=password,
                       look_for_keys=False, allow_agent=False, timeout=20)
    except Exception:
        proxy.close()
        raise
    return client, proxy


def run(client, command, timeout=60):
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error[-2000:] or "Remote command failed")
    return output.strip()


def node(client, script, timeout=60):
    return run(client, "cd /www/helstera/apps/server && node --env-file=/www/.env.local --input-type=module -e " + shlex.quote(script), timeout)


def main():
    client, proxy = connect()
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "backup-status":
            for command in ["stat -c '%s %y' /www/helstera/.website-pricing.r2H7V1/database.dump", "pg_dump --version", "pg_restore --version", "ls /usr/lib/postgresql", "df -h /www/helstera", "ps -eo pid,comm | grep pg_dump"]:
                try:
                    print(command, run(client, command), flush=True)
                except RuntimeError as error:
                    print(str(error), flush=True)
            return
        status = run(client, "pm2 jlist")
        print("SERVICES", json.dumps([
            {"name": p["name"], "pid": p.get("pid"),
             "status": p["pm2_env"]["status"], "cwd": p["pm2_env"].get("pm_cwd"),
             "script": p["pm2_env"].get("pm_exec_path")}
            for p in json.loads(status) if "helstera" in p["name"]
        ]), flush=True)
        print("DATABASE", node(client, """
import pg from 'pg';
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
try {
 const jobs = (await db.query("select job_type,status,count(*)::int as count from background_jobs where status in ('queued','running') group by job_type,status")).rows;
 const providers = (await db.query("select pc.id,pc.label,pc.base_url,pc.enabled,pc.health_status,pc.api_format,pc.key_last4,pc.request_template,pc.response_template,pm.model_id,pm.priority,pm.enabled as model_enabled,pm.health_status as model_health,pm.price_credits,pm.max_resolution from provider_configs pc join provider_models pm on pc.id=pm.provider_id where lower(pm.model_id)='minimax-h3' and (pc.enabled=true or pc.base_url like 'https://ai.furry.vg%') order by pm.priority")).rows;
 console.log(JSON.stringify({jobs,providers}));
} finally { await db.end(); }
"""), flush=True)
        print("PROBE", node(client, """
import pg from 'pg';
import {createDecipheriv} from 'node:crypto';
const db=new pg.Client({connectionString:process.env.DATABASE_URL}); await db.connect();
try {
 const {rows}=await db.query("select key_ciphertext,base_url from provider_configs where id='093790f5-816b-4830-84d9-302f45bb854e'");
 if(!rows[0]) throw new Error('Saved provider not found in live database');
 const row=rows[0], packed=Buffer.from(row.key_ciphertext,'base64');
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(process.env.PROVIDER_CONFIG_ENCRYPTION_KEY,'base64'),packed.subarray(0,12));
 decipher.setAuthTag(packed.subarray(12,28));
 const key=Buffer.concat([decipher.update(packed.subarray(28)),decipher.final()]).toString('utf8');
 const response=await fetch(row.base_url+'/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});
 let ids=[]; if(response.ok){const body=await response.json();ids=(body.data??[]).filter(m=>String(m.id).toLowerCase()==='minimax-h3').map(m=>m.id);}
 console.log(JSON.stringify({status:response.status,modelIds:ids,keyLast4:key.slice(-4)}));
} finally { await db.end(); }
"""), flush=True)
        baseline = ROOT / "release-candidates/website-production-baseline"
        baseline.mkdir(parents=True, exist_ok=True)
        paths = [
            "apps/server/src/agent/runtime.ts", "apps/server/src/http/video-models.ts",
            "apps/server/src/features/credits/tier-guard.ts", "apps/server/src/local-db/provider-generation.ts",
            "packages/shared/dist/contracts.js", "packages/shared/dist/credits.js",
            "packages/shared/dist/upstream-pricing.js", "apps/server/src/http/jobs.ts",
            "apps/server/src/http/generate.ts", "apps/server/src/agent/message-billing.ts",
            "apps/server/src/http/runs.ts", "apps/server/src/ws/handler.ts",
        ]
        with client.open_sftp() as sftp:
            for relative in paths:
                destination = baseline / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                sftp.get("/www/helstera/" + relative, str(destination))
        print("BASELINE", str(baseline), flush=True)
    finally:
        client.close()
        proxy.close()


if __name__ == "__main__":
    main()
