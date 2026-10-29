#!/usr/bin/env python3
"""Atomically deploy the website-capture worker fix and restart only the Worker."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import pathlib
import shlex
import time
from importlib.machinery import SourceFileLoader


ROOT = pathlib.Path(__file__).resolve().parents[1]
REMOTE_ROOT = "/www/helstera"
RELATIVE_FILE = "apps/server/src/features/jobs/executors/website-capture.ts"
TARGET_FILE = f"{REMOTE_ROOT}/{RELATIVE_FILE}"
ssh = SourceFileLoader("website_ssh", str(ROOT / "scripts/inspect-website-release.py")).load_module()


def remote_python(client, source: str, timeout: int = 120) -> str:
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    command = "python3 -c " + shlex.quote(
        "import base64; exec(base64.b64decode(" + repr(encoded) + "))"
    )
    return ssh.run(client, command, timeout)


def production_state(client) -> dict[str, object]:
    services = json.loads(ssh.run(client, "pm2 jlist"))
    worker = next((item for item in services if item.get("name") == "helstera-worker"), None)
    if not worker:
        raise RuntimeError("helstera-worker is not registered in PM2.")
    counts = json.loads(ssh.node(client, """
import pg from 'pg';
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
try {
 const jobs = (await db.query("select status,count(*)::int as count from background_jobs where status='running' group by status")).rows;
 const tasks = (await db.query("select status,count(*)::int as count from website_capture_tasks where status in ('queued','running') group by status")).rows;
 console.log(JSON.stringify({jobs,tasks}));
} finally { await db.end(); }
"""))
    return {
        "workerStatus": worker["pm2_env"]["status"],
        "workerPid": worker.get("pid"),
        "runningJobs": sum(int(row["count"]) for row in counts["jobs"]),
        "websiteCaptureTasks": counts["tasks"],
        "productionSha256": ssh.run(client, f"sha256sum {shlex.quote(TARGET_FILE)}").split()[0],
    }


def deploy() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", action="store_true", help="Read production Worker and queue state only.")
    args = parser.parse_args()
    source = ROOT / RELATIVE_FILE
    payload = source.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    client, proxy = ssh.connect()
    stage_file = ""
    backup_file = ""
    replaced = False
    stopped = False
    try:
        remote = production_state(client)
        baseline_hash = remote["productionSha256"]
        print("PRODUCTION", json.dumps(remote), flush=True)
        if args.inspect:
            return
        if remote["workerStatus"] != "online":
            raise RuntimeError("helstera-worker must be online before deployment.")

        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        backup_dir = f"{REMOTE_ROOT}/backups/website-capture-worker-{stamp}-{digest[:10]}"
        stage_file = f"{backup_dir}/website-capture.ts.stage"
        backup_file = f"{backup_dir}/website-capture.ts"
        ssh.run(client, "mkdir -p " + shlex.quote(backup_dir))
        with client.open_sftp() as sftp:
            sftp.put(str(source), stage_file)
        staged_hash = ssh.run(client, "sha256sum " + shlex.quote(stage_file)).split()[0]
        if staged_hash != digest:
            raise RuntimeError("Staged Worker source SHA-256 does not match the local file.")

        for attempt in range(40):
            state = production_state(client)
            if state["runningJobs"] == 0:
                break
            if attempt % 4 == 0:
                print("WAITING_FOR_RUNNING_JOBS", json.dumps(state), flush=True)
            time.sleep(15)
        else:
            raise RuntimeError("Worker remains busy; staged source retained and live Worker unchanged.")

        if state["productionSha256"] != baseline_hash:
            raise RuntimeError("Production Worker source changed during staging; live file left untouched.")

        stopped = True
        ssh.run(client, "pm2 stop helstera-worker", timeout=60)
        live = shlex.quote(TARGET_FILE)
        staged = shlex.quote(stage_file)
        backup = shlex.quote(backup_file)
        current_hash = ssh.run(client, "sha256sum " + live).split()[0]
        if current_hash != baseline_hash:
            raise RuntimeError("Production Worker source changed before atomic replacement.")
        ssh.run(client, f"cp -p {live} {backup} && chmod --reference={live} {staged} && mv -f {staged} {live}")
        replaced = True
        ssh.run(client, "pm2 restart helstera-worker", timeout=120)
        stopped = False

        smoke = ssh.run(
            client,
            "cd /www/helstera/apps/server && node --env-file=/www/.env.local --import tsx --input-type=module -e "
            + shlex.quote("await import('./src/features/jobs/executors/website-capture.ts');console.log('worker module import ok')"),
            timeout=60,
        )
        state = production_state(client)
        if state["workerStatus"] != "online":
            raise RuntimeError("Worker did not return to online status after restart.")
        health = ssh.run(client, "curl -fsS --max-time 5 http://127.0.0.1:3000/api/health", timeout=15)
        if json.loads(health).get("ok") is not True:
            raise RuntimeError("Server health check failed after Worker restart.")
        print("DEPLOYED_SHA256", digest, flush=True)
        print("BACKUP", backup_file, flush=True)
        print("IMPORT", smoke, flush=True)
        print("WORKER", json.dumps(state), flush=True)
        print("SERVER_HEALTH", health, flush=True)
    except Exception:
        if replaced:
            live = shlex.quote(TARGET_FILE)
            backup = shlex.quote(backup_file)
            restore = shlex.quote(backup_file + ".restore")
            ssh.run(client, "pm2 stop helstera-worker || true", timeout=60)
            ssh.run(client, f"cp -p {backup} {restore} && mv -f {restore} {live} && pm2 restart helstera-worker", timeout=120)
            print("ROLLED_BACK", backup_file, flush=True)
        elif stopped:
            ssh.run(client, "pm2 restart helstera-worker", timeout=120)
        raise
    finally:
        client.close()
        proxy.close()


if __name__ == "__main__":
    deploy()
