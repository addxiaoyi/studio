import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerGenerationApprovalRoutes } from "./generation-approvals.js";

describe("generation approval routes", () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns an empty successful response when no approval is pending", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    app = Fastify();

    registerGenerationApprovalRoutes(app, {
      auth: {
        authenticate: vi.fn().mockResolvedValue({ id: "user-1", accessToken: "token" }),
      } as any,
      viewerService: {
        ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }),
      } as any,
      db: db as any,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/generation-approvals/pending?canvasId=canvas-1",
      headers: { authorization: "Bearer token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: null });
  });

  it("returns terminal job state for a historical approval", async () => {
    const db = {
      query: vi.fn().mockImplementation((sql: string) =>
        sql.includes("from generation_approvals ga")
          ? { rows: [{
            id: "approval-1",
            job_type: "video_generation",
            model: "minimax-h3",
            estimated_credits: "1.728",
            expires_at: "2026-10-17T07:00:00.000Z",
            status: "approved",
            job_id: "job-1",
            job_status: "dead_letter",
            job_error_code: "upstream_outcome_unknown",
            job_error_message: "Provider result was not confirmed.",
            job_updated_at: "2026-10-17T06:30:52.000Z",
          }] }
          : { rows: [] },
      ),
    };
    app = Fastify();

    registerGenerationApprovalRoutes(app, {
      auth: {
        authenticate: vi.fn().mockResolvedValue({ id: "user-1", accessToken: "token" }),
      } as any,
      viewerService: {
        ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }),
      } as any,
      db: db as any,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/generation-approvals/approval-1/status",
      headers: { authorization: "Bearer token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        approvalId: "approval-1",
        approvalStatus: "approved",
        jobStatus: "dead_letter",
        errorCode: "upstream_outcome_unknown",
      },
    });
  });
});
