import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalJobService } from "../local-db/job-service.js";
import { JOB_SHUTDOWN_STAGE } from "./job-shutdown-checkpoint.js";
import { JOB_RECOVERED_STAGE, recoverInterruptedJobs } from "./job-recovery.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const schema = `job_recovery_${randomUUID().replaceAll("-", "")}`;
let admin: Pool | undefined;
let database: Pool | undefined;

describe.skipIf(!databaseUrl)("job recovery with real PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1") throw new Error("Local test database required");
    admin = new Pool({ connectionString: url.href });
    await admin.query(`create schema ${schema}`);
    database = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
    await database.query(`
      create table background_jobs (
        id text primary key,
        status text not null,
        job_type text not null,
        stage text,
        updated_at timestamptz not null,
        progress integer not null default 0,
        attempt_count integer not null,
        max_attempts integer not null,
        error_code text,
        error_message text,
        failed_at timestamptz
      )
    `);
  });

  afterAll(async () => {
    await database?.end();
    if (admin) {
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  });

  it("immediately requeues shutdown checkpoints and only recovers truly stale jobs once", async () => {
    if (!database) throw new Error("Test PostgreSQL was not initialized");
    await database.query("delete from background_jobs");
    await database.query(
      `insert into background_jobs (id,status,job_type,stage,updated_at,attempt_count,max_attempts)
       values
         ('graceful','running','website_capture',$1,now(),1,3),
         ('stale-image','running','image_generation',null,now()-interval '11 minutes',1,3),
         ('active-video','running','video_generation',null,now()-interval '2 minutes',1,3),
         ('expired-video','running','video_generation',null,now()-interval '31 minutes',1,3),
         ('attempts-exhausted','running','image_generation',$1,now(),3,3)`,
      [JOB_SHUTDOWN_STAGE],
    );

    const jobs = createLocalJobService(database);
    await jobs.updateProgress("graceful", 48, "rendering");
    const checkpoint = await database.query(
      "select stage,progress from background_jobs where id='graceful'",
    );
    expect(checkpoint.rows[0]).toEqual({ stage: JOB_SHUTDOWN_STAGE, progress: 48 });

    const first = await recoverInterruptedJobs(database);
    expect(first).toEqual({ expired: 1, recovered: 2 });
    const states = await database.query("select id,status,stage,error_code from background_jobs order by id");
    expect(states.rows).toEqual([
      { id: "active-video", status: "running", stage: null, error_code: null },
      { id: "attempts-exhausted", status: "running", stage: JOB_SHUTDOWN_STAGE, error_code: null },
      { id: "expired-video", status: "failed", stage: null, error_code: "stale_job_timeout" },
      { id: "graceful", status: "queued", stage: JOB_RECOVERED_STAGE, error_code: null },
      { id: "stale-image", status: "queued", stage: JOB_RECOVERED_STAGE, error_code: null },
    ]);

    expect(await recoverInterruptedJobs(database)).toEqual({ expired: 0, recovered: 0 });
  });
});
