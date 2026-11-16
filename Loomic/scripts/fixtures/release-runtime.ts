// Only the HTTP surface and work payload are fixtures; receipt and queue lifecycle use production code.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const { createProcessReceipt } = await import(pathToFileURL(process.env.RELEASE_TEST_RECEIPT_MODULE!));
const { startQueueRunner } = await import(pathToFileURL(process.env.RELEASE_TEST_QUEUE_MODULE!));
const role = import.meta.url.endsWith("/worker.ts") ? "worker" : "server";
const receipt = createProcessReceipt(role);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
await db.query("select 1");

let closeWork: () => Promise<unknown>;
if (role === "worker") {
  const runner = startQueueRunner({
    queues: [{ name: "release-work", concurrency: 1 }],
    poll: async () => {
      const { rows } = await db.query(`with candidate as (
        select id from release_work where state='queued' order by id for update skip locked limit 1
      ) update release_work w set state='claimed',owner_pid=$1 from candidate c where w.id=c.id returning w.*`, [process.pid]);
      return rows;
    },
    execute: async (_queue, work) => {
      await db.query("insert into release_events(task_id,phase,pid) values($1,'started',$2)", [work.id, process.pid]);
      await db.query("update release_work set state='running' where id=$1", [work.id]);
      for (let progress = 10; progress <= 100; progress += 10) {
        await delay(work.duration_ms / 10);
        await db.query("update release_work set progress=$2 where id=$1", [work.id, progress]);
      }
      await db.query("update release_work set state='completed' where id=$1", [work.id]);
      await db.query("insert into release_events(task_id,phase,pid) values($1,'completed',$2)", [work.id, process.pid]);
    },
    release: async (_queue, work) => {
      await db.query("update release_work set state='queued',owner_pid=null where id=$1 and state='claimed'", [work.id]);
    },
    onError: (_queue, error) => { console.error("Fixture queue failed", error); process.exitCode = 1; },
  });
  closeWork = () => runner.stop();
} else {
  const server = createServer(async (request, reply) => {
    try {
      reply.setHeader("Content-Type", "application/json");
      if (request.url?.startsWith("/api/agent/")) {
        reply.writeHead(401).end(JSON.stringify({ ok: false, error: { code: "unauthorized" } }));
        return;
      }
      if (request.url === "/api/health" || request.url === "/api/health/ready") {
        await db.query("select 1");
        const ready = process.env.RELEASE_TEST_BAD_READY !== "1";
        const checks = Object.fromEntries(["database", "storage", "accepting"].map(name => [name, { ok: ready }]));
        reply.writeHead(ready ? 200 : 503).end(JSON.stringify({ ok: ready, version, checks }));
        return;
      }
      reply.writeHead(404).end(JSON.stringify({ ok: false }));
    } catch {
      reply.writeHead(503).end(JSON.stringify({ ok: false }));
    }
  });
  await new Promise<void>(resolve => server.listen(Number(process.env.HELSTERA_SERVER_PORT), "127.0.0.1", resolve));
  closeWork = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= (async () => {
    await closeWork();
    await db.end();
    await receipt.drained();
  })().catch(error => { console.error("Fixture drain failed", error); process.exitCode = 1; });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await receipt.ready();
process.send?.("ready");
