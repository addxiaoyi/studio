import { describe, expect, it, vi } from "vitest";
import { consumeRecordingApproval, decideRecordingApproval, requestRecordingApproval } from "./recording-approval.js";

describe("website recording approvals", () => {
  it("creates a task-bound request with the recording parameters", async () => {
    const approval = { id: "approval-1", task_id: "task-1", action: { url: "https://example.com/" }, expires_at: new Date() };
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "task-1" }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [approval] }).mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    await expect(requestRecordingApproval({ connect: vi.fn().mockResolvedValue({ query, release }) } as never, "task-1", "workspace-1", "user-1")).resolves.toEqual(approval);
    const [sql, values] = query.mock.calls[3]!;
    expect(sql).toContain("'url', t.start_url");
    expect(sql).toContain("'connectionId', t.assistant_connection_id");
    expect(sql).toContain("t.record_video=true and t.status='queued'");
    expect(values).toEqual(["task-1", "workspace-1", "user-1"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("only decides a pending, unexpired approval matching the current task", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(decideRecordingApproval({ query } as never, "approval-1", "workspace-1", "user-1", true)).resolves.toBe(false);
    expect(query.mock.calls[0]![0]).toContain("a.expires_at>now()");
    expect(query.mock.calls[0]![0]).toContain("a.action=(jsonb_build_object");
    expect(query.mock.calls[0]![1]).toEqual(["approval-1", "workspace-1", "user-1", "approved"]);
  });

  it("atomically consumes only an approved matching request", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "approval-1" }] }).mockResolvedValueOnce({ rows: [] });
    expect(await consumeRecordingApproval({ query } as never, "approval-1", "task-1")).toBe(true);
    expect(await consumeRecordingApproval({ query } as never, "approval-1", "task-1")).toBe(false);
    expect(query.mock.calls[0]![0]).toContain("a.status='approved' and a.expires_at>now()");
    expect(query.mock.calls[0]![0]).toContain("a.action=(jsonb_build_object");
  });
});
