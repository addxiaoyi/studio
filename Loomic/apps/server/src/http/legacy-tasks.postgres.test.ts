import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import { registerLocalGrowthRoutes } from "./local-growth.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const schema = `legacy_tasks_${randomUUID().replaceAll("-", "")}`;
const ownerId = randomUUID();
const peerId = randomUUID();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const headers = { authorization: "Bearer owner" };
let admin: Pool;
let db: Pool;
let app: ReturnType<typeof Fastify>;

describe.skipIf(!databaseUrl)(
  "legacy task access and recovery with PostgreSQL",
  () => {
    beforeAll(async () => {
      if (
        !databaseUrl ||
        !["127.0.0.1", "localhost", "[::1]"].includes(
          new URL(databaseUrl).hostname,
        )
      ) {
        throw new Error(
          "Legacy task regression requires a loopback test database.",
        );
      }
      admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`create schema ${schema}`);
      db = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema},public`,
      });
      await db.query(
        await readFile(
          new URL("../local-db/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      for (const name of [
        "20261020000000_website_capture.sql",
        "20261020000001_website_capture_job_link.sql",
      ]) {
        await db.query(
          await readFile(
            new URL(`../local-db/migrations/${name}`, import.meta.url),
            "utf8",
          ),
        );
      }
      await db.query(
        "insert into app_users(id,email) values($1,'legacy-owner@example.test'),($2,'legacy-peer@example.test')",
        [ownerId, peerId],
      );
      await db.query(
        "insert into workspaces(id,owner_user_id,name) values($1,$3,'Legacy task regression'),($2,$4,'Other workspace')",
        [workspaceId, otherWorkspaceId, ownerId, peerId],
      );
      await db.query(
        "insert into workspace_members(workspace_id,user_id) values($1,$2),($1,$3)",
        [workspaceId, ownerId, peerId],
      );
      await db.query(
        "insert into credit_balances(workspace_id,balance) values($1,10)",
        [workspaceId],
      );
      app = Fastify();
      registerLocalGrowthRoutes(app, {
        db,
        auth: {
          authenticate: async (request) => {
            const id =
              request.headers.authorization === "Bearer owner"
                ? ownerId
                : request.headers.authorization === "Bearer peer"
                  ? peerId
                  : null;
            return id
              ? {
                  id,
                  email: `${id}@example.test`,
                  accessToken: "fixture",
                  userMetadata: {},
                }
              : null;
          },
        },
        viewerService: {
          ensureViewer: async (user: AuthenticatedUser) => ({
            workspace: {
              id: workspaceId,
              name: "Legacy task regression",
              type: "personal",
              ownerUserId: ownerId,
            },
            profile: { id: user.id, email: user.email, displayName: "Fixture" },
            membership: {
              workspaceId,
              userId: user.id,
              role: user.id === ownerId ? "owner" : "member",
            },
            isSystemAdmin: false,
          }),
        },
      });
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
      await db?.end();
      if (admin) {
        await admin.query(`drop schema if exists ${schema} cascade`);
        await admin.end();
      }
    });

    async function job(
      jobType = "image_generation",
      status = "failed",
      workspace = workspaceId,
    ) {
      const id = randomUUID();
      await db.query(
        `insert into background_jobs(id,workspace_id,created_by,job_type,queue_name,status,payload,
      attempt_count,max_attempts,error_code,error_message,failed_at)
      values($1,$2,$3,$4,'fixture_queue',$5,$6,1,3,'upstream_outcome_unknown','Sensitive provider failure',now())`,
        [
          id,
          workspace,
          ownerId,
          jobType,
          status,
          { prompt: "Private prompt", providerTaskId: "private-provider-task" },
        ],
      );
      return id;
    }

    it.each(["", "/export", "/retry"])(
      "rejects another member of the same workspace at /api/tasks/:id%s",
      async (suffix) => {
        const id = await job();
        const response = await app.inject({
          method: suffix === "/retry" ? "POST" : "GET",
          url: `/api/tasks/${id}${suffix}`,
          headers: { authorization: "Bearer peer" },
        });
        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain("Private prompt");
        expect(
          (
            await db.query("select status from background_jobs where id=$1", [
              id,
            ])
          ).rows[0].status,
        ).toBe("failed");
      },
    );

    it("reads and exports only the caller's task in the active workspace", async () => {
      const id = await job();
      const read = await app.inject({ url: `/api/tasks/${id}`, headers });
      expect(read.statusCode).toBe(200);
      expect(read.json().data.payload.prompt).toBe("Private prompt");
      expect(read.headers["cache-control"]).toBe("private, no-store");
      const exported = await app.inject({
        url: `/api/tasks/${id}/export`,
        headers,
      });
      expect(exported.statusCode).toBe(200);
      expect(exported.json()).toMatchObject({
        id,
        status: "failed",
        payload: { prompt: "Private prompt" },
      });
      expect(exported.headers["content-disposition"]).toBe(
        `attachment; filename=task-${id}.json`,
      );
      const other = await job("image_generation", "failed", otherWorkspaceId);
      expect(
        (await app.inject({ url: `/api/tasks/${other}`, headers })).statusCode,
      ).toBe(404);
    });

    it.each(["", "/export", "/retry"])(
      "rejects an invalid task id and requires authentication at %s",
      async (suffix) => {
        const request = {
          method: suffix === "/retry" ? ("POST" as const) : ("GET" as const),
          url: `/api/tasks/not-a-uuid${suffix}`,
        };
        expect((await app.inject(request)).statusCode).toBe(401);
        const response = await app.inject({ ...request, headers });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("invalid_task_id");
        expect(response.body).not.toContain("uuid:");
      },
    );

    it.each(["image_generation", "video_generation"])(
      "does not restart refunded or ambiguous %s jobs through the old endpoint",
      async (jobType) => {
        const id = await job(jobType);
        await db.query(
          `insert into credit_transactions(workspace_id,user_id,transaction_type,amount,balance_after,job_id)
      values($1,$2,'generation_deduct',-3,7,$3),($1,$2,'generation_refund',3,10,$3)`,
          [workspaceId, ownerId, id],
        );
        const before = (
          await db.query("select * from background_jobs where id=$1", [id])
        ).rows[0];
        const ledgerBefore = (
          await db.query(
            "select * from credit_transactions where job_id=$1 order by id",
            [id],
          )
        ).rows;
        const replies = await Promise.all(
          Array.from({ length: 3 }, () =>
            app.inject({
              method: "POST",
              url: `/api/tasks/${id}/retry`,
              headers,
            }),
          ),
        );
        expect(replies.map((response) => response.statusCode)).toEqual([
          409, 409, 409,
        ]);
        expect(replies[0]?.json()).toMatchObject({
          ok: false,
          error: { code: "task_recovery_required" },
          recovery: {
            path: `/api/jobs/${jobType === "image_generation" ? "image-generation" : "video-generation"}`,
            requiresNewRequest: true,
            requiresCostReview: true,
          },
        });
        expect(
          (await db.query("select * from background_jobs where id=$1", [id]))
            .rows[0],
        ).toEqual(before);
        expect(
          (
            await db.query(
              "select * from credit_transactions where job_id=$1 order by id",
              [id],
            )
          ).rows,
        ).toEqual(ledgerBefore);
        expect(
          Number(
            (
              await db.query(
                "select balance from credit_balances where workspace_id=$1",
                [workspaceId],
              )
            ).rows[0].balance,
          ),
        ).toBe(10);
      },
    );

    it("directs a saved provider result to synchronization without running generation again", async () => {
      const id = await job("video_generation", "sync_failed");
      const response = await app.inject({
        method: "POST",
        url: `/api/tasks/${id}/retry`,
        headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().recovery).toEqual({
        method: "POST",
        path: `/api/jobs/${id}/sync`,
        statusUrl: `/api/jobs/${id}`,
      });
      expect(
        (await db.query("select status from background_jobs where id=$1", [id]))
          .rows[0].status,
      ).toBe("sync_failed");
    });

    it("directs website capture recovery to the owned task approval workflow", async () => {
      const id = await job("website_capture");
      const captureId = randomUUID();
      await db.query(
        "insert into website_capture_tasks(id,workspace_id,created_by,start_url,background_job_id,status,mode,idempotency_key) values($1,$2,$3,'https://example.test',$4,'failed','isolated',$5)",
        [captureId, workspaceId, ownerId, id, captureId],
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/tasks/${id}/retry`,
        headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().recovery.path).toBe(
        `/api/website-capture/${captureId}/retry`,
      );
      expect(
        (
          await db.query(
            "select status from website_capture_tasks where id=$1",
            [captureId],
          )
        ).rows[0].status,
      ).toBe("failed");
    });

    it("does not disclose a foreign capture linked to an owned job", async () => {
      const id = await job("website_capture");
      const captureId = randomUUID();
      await db.query(
        "insert into website_capture_tasks(id,workspace_id,created_by,start_url,background_job_id,status,mode,idempotency_key) values($1,$2,$3,'https://example.test',$4,'failed','isolated',$5)",
        [captureId, workspaceId, peerId, id, captureId],
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/tasks/${id}/retry`,
        headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().recovery).toEqual({
        statusUrl: `/api/jobs/${id}`,
      });
      expect(response.body).not.toContain(captureId);
    });

    it("directs content recovery to its owned automation without resetting its queue job", async () => {
      const id = await job("feed_structure");
      const packageId = randomUUID();
      const automationId = randomUUID();
      await db.query(
        `insert into content_packages(id,workspace_id,created_by,title,brief,goal,content_type,platforms,duration_seconds,workflow_mode)
      values($1,$2,$3,'fixture','fixture','fixture','video',array['douyin'],10,'review')`,
        [packageId, workspaceId, ownerId],
      );
      await db.query(
        `insert into feed_automation_runs(id,workspace_id,created_by,package_id,structure_job_id,idempotency_key,status)
      values($1::uuid,$2,$3,$4,$5,($1::uuid)::text,'failed')`,
        [automationId, workspaceId, ownerId, packageId, id],
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/tasks/${id}/retry`,
        headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().recovery.path).toBe(
        `/api/feed/automation/${automationId}/retry`,
      );
      expect(
        (await db.query("select status from background_jobs where id=$1", [id]))
          .rows[0].status,
      ).toBe("failed");
      expect(
        (
          await db.query(
            "select status from feed_automation_runs where id=$1",
            [automationId],
          )
        ).rows[0].status,
      ).toBe("failed");
    });

    it("does not requeue finished or active work", async () => {
      for (const status of ["queued", "running", "succeeded", "canceled"]) {
        const id = await job("image_generation", status);
        const response = await app.inject({
          method: "POST",
          url: `/api/tasks/${id}/retry`,
          headers,
        });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("task_not_retryable");
        expect(
          (
            await db.query("select status from background_jobs where id=$1", [
              id,
            ])
          ).rows[0].status,
        ).toBe(status);
      }
    });
  },
);
