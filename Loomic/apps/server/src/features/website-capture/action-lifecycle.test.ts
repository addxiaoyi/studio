import { describe, expect, it, vi } from "vitest";

import { WebsiteAssistantHub } from "./assistant-hub.js";

function buildHub(query: ReturnType<typeof vi.fn>) {
  return new WebsiteAssistantHub({
    db: { query } as never,
    storage: {} as never,
    webOrigin: "https://studio.example.test",
    storageRoot: "/tmp/website-capture-test",
  });
}

type HubInternals = {
  consumeApprovedAction(live: unknown, message: unknown): Promise<void>;
  recordingFailed(live: unknown, message: unknown): Promise<void>;
  updateProgress(live: unknown, message: unknown): Promise<void>;
};

const live = { id: "connection-1", userId: "user-1", ws: { readyState: 1, send: vi.fn() } };
const runningTask = {
  id: "task-1",
  workspace_id: "workspace-1",
  created_by: "user-1",
  start_url: "http://127.0.0.1/",
  page_limit: 3,
  record_video: true,
  status: "running",
  assistant_connection_id: "connection-1",
  follow_external: false,
};

describe("website capture assistant event lifecycle", () => {
  it("only consumes an approved action while its task is still running on the same connection", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const hub = buildHub(query);
    const internals = hub as unknown as HubInternals;

    await internals.consumeApprovedAction(live, {
      actionId: "action-1",
      taskId: "task-1",
      approvalToken: "one-time-token",
      action: { kind: "submit", target: "Checkout" },
    });

    const [sql, values] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("t.status='running'");
    expect(sql).toContain("t.workspace_id=a.workspace_id");
    expect(sql).toContain("t.assistant_connection_id=$2");
    expect(sql).toContain("a.status='approved'");
    expect(values.slice(0, 2)).toEqual(["action-1", "connection-1"]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("ignores recording failure messages for tasks not owned by the assistant connection", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const hub = buildHub(query);
    const internals = hub as unknown as HubInternals;

    await internals.recordingFailed(live, { taskId: "other-task", message: "spoofed" });

    expect(query.mock.calls).toHaveLength(2);
    expect(String(query.mock.calls[1]?.[0])).toContain("created_by=$2 and assistant_connection_id=$3");
  });

  it("bounds progress event persistence to one event per second and normalizes unknown stages", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("select id,workspace_id,created_by,start_url")) return { rows: [runningTask] };
      if (sql.includes("update website_capture_tasks")) return { rows: [{ id: "task-1" }] };
      return { rows: [] };
    });
    const hub = buildHub(query);
    const internals = hub as unknown as HubInternals;

    await internals.updateProgress(live, { taskId: "task-1", progress: 12, stage: "attacker_injected_stage", detail: "first" });
    await internals.updateProgress(live, { taskId: "task-1", progress: 13, stage: "attacker_injected_stage", detail: "second" });

    const eventInserts = query.mock.calls.filter(([sql]) => String(sql).includes("insert into website_capture_events"));
    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0]?.[1]).toEqual(["task-1", "browsing", "first"]);
  });
});
