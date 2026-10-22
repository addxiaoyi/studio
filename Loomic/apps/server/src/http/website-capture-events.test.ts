import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerWebsiteCaptureRoutes } from "./website-capture.js";

describe("website capture event history", () => {
  it("returns a bounded recent event window after task workspace authorization", async () => {
    const task = {
      id: "task-1",
      background_job_id: null,
      status: "running",
      mode: "isolated",
      start_url: "https://example.test/",
      progress: 30,
      stage: "page_loading",
      result: null,
      error_message: null,
      created_at: new Date("2026-10-22T00:00:00Z"),
      updated_at: new Date("2026-10-22T00:00:00Z"),
      follow_external: false,
      assistant_connection_id: null,
    };
    const events = [{ id: 101, stage: "page_loading", detail: "Opened page", created_at: "2026-10-22T00:01:00Z" }];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from website_capture_tasks where id=$1 and workspace_id=$2")) return { rows: [task] };
      if (sql.includes("from website_capture_events")) return { rows: events };
      return { rows: [] };
    });
    const app = Fastify();
    registerWebsiteCaptureRoutes(app, {
      db: { query } as never,
      auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1", email: "user@example.test" }) } as never,
      viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
      jobService: {} as never,
      assistantHub: {} as never,
    });

    const response = await app.inject({ method: "GET", url: "/api/website-capture/task-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.events).toEqual(events);
    const eventQuery = query.mock.calls.find(([sql]) => sql.includes("from website_capture_events"))?.[0];
    expect(eventQuery).toContain("order by id desc limit 100");
    expect(eventQuery).toContain(") recent order by id");
    await app.close();
  });
});
