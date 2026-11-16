import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalJobService } from "../local-db/job-service.js";
import { JOB_SHUTDOWN_STAGE } from "./job-shutdown-checkpoint.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const schema = `worker_process_${randomUUID().replaceAll("-", "")}`;
const userId = randomUUID();
const workspaceId = randomUUID();
const workers: WorkerProcess[] = [];
const PROCESS_TIMEOUT_MS = 20_000;
let admin: Pool;
let database: Pool;
let root: string;
let scopedUrl: string;

type WorkerProcess = {
  process: ChildProcess;
  receipt: string;
  output: string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

type JobState = {
  status: string;
  stage: string | null;
  progress: number;
  attempt_count: number;
  starts: number;
  completions: number;
  submissions: number;
  heartbeats: number;
  owner_pid: number | null;
};

async function until<T>(
  probe: () => Promise<T>,
  description: string,
  worker?: WorkerProcess,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + PROCESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const answer = await probe();
    if (answer) return answer as NonNullable<T>;
    if (
      worker &&
      (worker.process.exitCode !== null || worker.process.signalCode !== null)
    ) {
      throw new Error(
        `Worker exited while waiting for ${description}: ${worker.output}`,
      );
    }
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${description}. ${worker?.output ?? ""}`,
  );
}

async function startTestWorker(
  entry = new URL("./fixtures/worker-process.ts", import.meta.url),
): Promise<WorkerProcess> {
  const receipt = join(root, `worker-${workers.length}.json`);
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    DATABASE_URL: scopedUrl,
    STORAGE_ROOT: root,
    HELSTERA_PROCESS_RECEIPT: receipt,
    WORKER_POLL_INTERVAL_MS: "1000",
    WORKER_IMAGE_CONCURRENCY: "1",
    WORKER_VIDEO_CONCURRENCY: "1",
  });
  const child = spawn(
    process.execPath,
    ["--import", "tsx", fileURLToPath(entry)],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  const worker: WorkerProcess = {
    process: child,
    receipt,
    output: "",
    exit: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
  };
  workers.push(worker);
  const capture = (chunk: Buffer) => {
    worker.output = (worker.output + chunk.toString()).slice(-40_000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  await until(
    async () => {
      try {
        const entry = JSON.parse(await readFile(receipt, "utf8"));
        return entry.state === "ready" && entry.pid === child.pid;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    "Worker ready receipt",
    worker,
  );
  return worker;
}

function requestStop(worker: WorkerProcess) {
  if (process.platform === "win32") worker.process.send("SIGTERM");
  else worker.process.kill("SIGTERM");
}

async function waitForExit(worker: WorkerProcess) {
  await until(
    async () =>
      worker.process.exitCode !== null || worker.process.signalCode !== null,
    "Worker process exit",
    worker,
  );
  return worker.exit;
}

async function seedJob() {
  const id = randomUUID();
  await database.query("insert into worker_test_controls(job_id) values($1)", [
    id,
  ]);
  await database.query(
    `insert into background_jobs(id,workspace_id,created_by,queue_name,job_type)
     values($1,$2,$3,'website_capture_jobs','website_capture')`,
    [id, workspaceId, userId],
  );
  return id;
}

async function jobState(jobId: string) {
  const row = (
    await database.query<JobState>(
      `select j.status,j.stage,j.progress,j.attempt_count,c.starts,c.completions,c.submissions,c.heartbeats,c.owner_pid
     from background_jobs j join worker_test_controls c on c.job_id=j.id where j.id=$1`,
      [jobId],
    )
  ).rows[0];
  if (!row) throw new Error(`Worker test task ${jobId} is missing.`);
  return row;
}

describe.skipIf(!databaseUrl)(
  "production Worker process lifecycle on isolated PostgreSQL",
  () => {
    beforeAll(async () => {
      if (!databaseUrl) throw new Error("HELT_TEST_DATABASE_URL is required");
      const url = new URL(databaseUrl);
      if (url.hostname !== "127.0.0.1" || url.search || url.hash)
        throw new Error(
          "Explicit loopback PostgreSQL without routing overrides required.",
        );
      admin = new Pool({ connectionString: url.href });
      await admin.query(
        "create extension if not exists pgcrypto with schema public",
      );
      await admin.query(`create schema ${schema}`);
      url.searchParams.set("options", `-c search_path=${schema},public`);
      scopedUrl = url.href;
      database = new Pool({ connectionString: scopedUrl });
      await database.query(
        await readFile(
          new URL("../local-db/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      await database.query(`create table worker_test_controls (
      job_id uuid primary key, released boolean not null default false,
      starts integer not null default 0, completions integer not null default 0,
      submissions integer not null default 0, heartbeats integer not null default 0, owner_pid integer
    )`);
      await database.query(
        "insert into app_users(id,email) values($1,'worker-process@test.invalid')",
        [userId],
      );
      await database.query(
        "insert into workspaces(id,owner_user_id,name) values($1,$2,'Worker process test')",
        [workspaceId, userId],
      );
      root = await mkdtemp(join(tmpdir(), "helstera-worker-process-"));
    }, 30_000);

    afterAll(async () => {
      for (const worker of workers) {
        if (
          worker.process.exitCode === null &&
          worker.process.signalCode === null
        )
          worker.process.kill("SIGKILL");
        await worker.exit;
      }
      await database?.end();
      if (admin) {
        if (!/^worker_process_[a-f0-9]{32}$/.test(schema))
          throw new Error("Unrecognized test schema");
        await admin.query(`drop schema if exists ${schema} cascade`);
        await admin.end();
      }
      if (root) await rm(root, { recursive: true, force: true });
    }, 30_000);

    it("still starts the actual command-line entry and cannot report a drain after being killed", async () => {
      const worker = await startTestWorker(
        new URL("../worker.ts", import.meta.url),
      );
      const receipt = JSON.parse(await readFile(worker.receipt, "utf8"));
      expect(receipt).toMatchObject({
        role: "worker",
        pid: worker.process.pid,
        state: "ready",
      });
      worker.process.kill("SIGKILL");
      await waitForExit(worker);
      expect(JSON.parse(await readFile(worker.receipt, "utf8")).state).toBe(
        "ready",
      );
      expect(worker.output).not.toMatch(/failed|Fatal error/i);
    }, 30_000);

    it("stops at excess-cost review after producing the result without retrying the executor", async () => {
      const jobId = await seedJob();
      const debit = randomUUID();
      await database.query(
        "insert into credit_balances(workspace_id,balance) values($1,97) on conflict(workspace_id) do update set balance=97",
        [workspaceId],
      );
      await database.query(
        `insert into credit_transactions(id,workspace_id,user_id,transaction_type,amount,balance_after,job_id)
      values($1,$2,$3,'generation_deduct',-3,97,$4)`,
        [debit, workspaceId, userId, jobId],
      );
      await database.query(
        "update background_jobs set credits_cost=3,credits_transaction_id=$2,payload=$3::jsonb where id=$1",
        [
          jobId,
          debit,
          JSON.stringify({
            model: "MiniMax-H3",
            duration: 10,
            settlement_test: true,
          }),
        ],
      );
      await database.query(
        `insert into generation_approvals(workspace_id,user_id,job_type,model,payload,payload_fingerprint,
      estimated_credits,expires_at,status,consumed_at,job_id,billing_pricing)
      values($1,$2,'video_generation','MiniMax-H3','{}',$4,3,now()+interval '1 hour','approved',now(),$3,
      '{"billingUnit":"per_second","creditCost":0.3}'::jsonb)`,
        [workspaceId, userId, jobId, `settlement-${jobId}`],
      );
      await database.query(
        "update worker_test_controls set released=true where job_id=$1",
        [jobId],
      );
      const worker = await startTestWorker();
      await until(
        async () => (await jobState(jobId)).status === "sync_failed",
        "excess-cost review",
        worker,
      );
      requestStop(worker);
      expect(await waitForExit(worker)).toEqual({ code: 0, signal: null });
      expect(await jobState(jobId)).toMatchObject({
        starts: 1,
        submissions: 1,
        completions: 1,
        attempt_count: 1,
      });
      const pending = (
        await database.query(
          "select settlement_review,result from background_jobs where id=$1",
          [jobId],
        )
      ).rows[0];
      expect(pending.settlement_review).toMatchObject({
        status: "pending",
        additionalCredits: 0.6,
      });
      expect(pending.result.output).toBe(join(root, `${jobId}.txt`));
      expect(
        Number(
          (
            await database.query(
              "select balance from credit_balances where workspace_id=$1",
              [workspaceId],
            )
          ).rows[0].balance,
        ),
      ).toBe(97);
    }, 30_000);

    it("keeps the shutdown checkpoint through heartbeats, drains, and does not rerun completed work after restart", async () => {
      const first = await startTestWorker();
      const jobId = await seedJob();
      await until(
        async () => (await jobState(jobId)).heartbeats > 1,
        "active task",
        first,
      );
      requestStop(first);
      await until(
        async () => (await jobState(jobId)).stage === JOB_SHUTDOWN_STAGE,
        "shutdown checkpoint",
        first,
      );
      const checkpoint = await jobState(jobId);
      await until(
        async () =>
          (await jobState(jobId)).heartbeats > checkpoint.heartbeats + 1,
        "heartbeat after shutdown",
        first,
      );
      expect(await jobState(jobId)).toMatchObject({
        status: "running",
        stage: JOB_SHUTDOWN_STAGE,
        progress: 48,
      });
      expect(JSON.parse(await readFile(first.receipt, "utf8")).state).toBe(
        "ready",
      );
      await database.query(
        "update worker_test_controls set released=true where job_id=$1",
        [jobId],
      );
      expect(await waitForExit(first)).toEqual({ code: 0, signal: null });
      expect(JSON.parse(await readFile(first.receipt, "utf8")).state).toBe(
        "drained",
      );
      const second = await startTestWorker();
      requestStop(second);
      expect(await waitForExit(second)).toEqual({ code: 0, signal: null });
      expect(await jobState(jobId)).toMatchObject({
        status: "succeeded",
        starts: 1,
        completions: 1,
        submissions: 1,
        attempt_count: 1,
      });
      expect(await readFile(join(root, `${jobId}.txt`), "utf8")).toBe(
        `completed:${jobId}`,
      );
      expect(first.output + second.output).not.toMatch(/failed|Fatal error/i);
    }, 60_000);

    it("does not execute a paid task until the real debit receipt is linked", async () => {
      const jobId = await seedJob();
      await database.query(
        `update background_jobs set job_type='image_generation',queue_name='image_generation_jobs',billing_required=true where id=$1`,
        [jobId],
      );
      await database.query(
        "update worker_test_controls set released=true where job_id=$1",
        [jobId],
      );
      const worker = await startTestWorker();
      await delay(1500);
      expect(await jobState(jobId)).toMatchObject({
        starts: 0,
        submissions: 0,
        status: "queued",
      });
      const debit = randomUUID();
      await database.query(
        `insert into credit_transactions(id,workspace_id,user_id,transaction_type,amount,balance_after,job_id)
      values($1,$2,$3,'generation_deduct',-1,96,$4)`,
        [debit, workspaceId, userId, jobId],
      );
      await delay(500);
      expect((await jobState(jobId)).starts).toBe(0);
      await createLocalJobService(database).setCreditsInfo(jobId, 1, debit);
      await until(
        async () => (await jobState(jobId)).status === "succeeded",
        "execution after receipt linkage",
        worker,
      );
      requestStop(worker);
      expect(await waitForExit(worker)).toEqual({ code: 0, signal: null });
      expect(await jobState(jobId)).toMatchObject({
        starts: 1,
        submissions: 1,
        completions: 1,
      });
    }, 60_000);

    it("restores a canceled legacy reservation on Worker startup without submitting its media job", async () => {
      const jobId = await seedJob();
      await database.query(
        "insert into credit_balances(workspace_id,balance) values($1,97) on conflict(workspace_id) do update set balance=97",
        [workspaceId],
      );
      const debit = randomUUID();
      await database.query(
        `insert into credit_transactions(id,workspace_id,user_id,transaction_type,amount,balance_after,job_id)
      values($1,$2,$3,'generation_deduct',-3,97,$4)`,
        [debit, workspaceId, userId, jobId],
      );
      await database.query(
        `update background_jobs set job_type='image_generation',queue_name='image_generation_jobs',
      status='canceled',credits_cost=3,credits_transaction_id=$2,billing_required=true where id=$1`,
        [jobId, debit],
      );
      const worker = await startTestWorker();
      await until(
        async () =>
          Number(
            (
              await database.query(
                "select balance from credit_balances where workspace_id=$1",
                [workspaceId],
              )
            ).rows[0].balance,
          ) === 100,
        "canceled credit recovery",
        worker,
      );
      requestStop(worker);
      expect(await waitForExit(worker)).toEqual({ code: 0, signal: null });
      expect(await jobState(jobId)).toMatchObject({
        status: "canceled",
        starts: 0,
        submissions: 0,
      });
      expect(
        (
          await database.query(
            "select count(*)::int as count from credit_transactions where job_id=$1 and transaction_type='generation_refund'",
            [jobId],
          )
        ).rows[0].count,
      ).toBe(1);
    }, 30_000);

    it("recovers an interrupted checkpoint with its saved result and does not claim a safe drain before completion", async () => {
      const first = await startTestWorker();
      const jobId = await seedJob();
      await until(
        async () => (await jobState(jobId)).heartbeats > 1,
        "active task",
        first,
      );
      requestStop(first);
      await until(
        async () => (await jobState(jobId)).stage === JOB_SHUTDOWN_STAGE,
        "shutdown checkpoint",
        first,
      );
      first.process.kill("SIGKILL");
      await waitForExit(first);
      expect(JSON.parse(await readFile(first.receipt, "utf8")).state).toBe(
        "ready",
      );
      const second = await startTestWorker();
      await until(
        async () => (await jobState(jobId)).starts === 2,
        "resumed executor",
        second,
      );
      await database.query(
        "update worker_test_controls set released=true where job_id=$1",
        [jobId],
      );
      await until(
        async () => (await jobState(jobId)).status === "succeeded",
        "recovered completion",
        second,
      );
      requestStop(second);
      expect(await waitForExit(second)).toEqual({ code: 0, signal: null });
      expect(await jobState(jobId)).toMatchObject({
        status: "succeeded",
        starts: 2,
        completions: 1,
        submissions: 1,
        attempt_count: 2,
      });
      expect(await readFile(join(root, `${jobId}.txt`), "utf8")).toBe(
        `completed:${jobId}`,
      );
      expect(second.output).not.toMatch(/failed|Fatal error/i);
    }, 60_000);

    it("lets only the claiming Worker checkpoint a task while a peer drains", async () => {
      const first = await startTestWorker();
      const second = await startTestWorker();
      const jobId = await seedJob();
      await until(
        async () => (await jobState(jobId)).heartbeats > 1,
        "task claimed by one Worker",
      );
      const ownerPid = (await jobState(jobId)).owner_pid;
      expect([first.process.pid, second.process.pid]).toContain(ownerPid);
      const owner = ownerPid === first.process.pid ? first : second;
      const peer = owner === first ? second : first;
      requestStop(peer);
      expect(await waitForExit(peer)).toEqual({ code: 0, signal: null });
      expect(await jobState(jobId)).toMatchObject({
        status: "running",
        stage: "fixture_heartbeat",
        starts: 1,
        submissions: 1,
      });
      requestStop(owner);
      await until(
        async () => (await jobState(jobId)).stage === JOB_SHUTDOWN_STAGE,
        "owner checkpoint",
        owner,
      );
      await database.query(
        "update worker_test_controls set released=true where job_id=$1",
        [jobId],
      );
      expect(await waitForExit(owner)).toEqual({ code: 0, signal: null });
      expect(await jobState(jobId)).toMatchObject({
        status: "succeeded",
        starts: 1,
        completions: 1,
        submissions: 1,
      });
      expect(first.output + second.output).not.toMatch(/failed|Fatal error/i);
    }, 60_000);
  },
);
