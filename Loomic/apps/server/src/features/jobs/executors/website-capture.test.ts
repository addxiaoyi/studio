import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureIsolatedWebsite, claimApprovedRecording } = vi.hoisted(() => ({ captureIsolatedWebsite: vi.fn(), claimApprovedRecording: vi.fn() }));

vi.mock("../../website-capture/isolated-browser.js", () => ({
  captureIsolatedWebsite,
  WebsiteCaptureError: class WebsiteCaptureError extends Error {
    code = "capture_failed";
  },
}));
vi.mock("../../website-capture/asset-cleanup.js", () => ({ softDeleteWebsiteCaptureAssets: vi.fn().mockResolvedValue(0) }));
vi.mock("../../website-capture/recording-approval.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../website-capture/recording-approval.js")>(), claimApprovedRecording,
}));

import { getExecutor } from "../job-executor.js";
import { softDeleteWebsiteCaptureAssets } from "../../website-capture/asset-cleanup.js";
import "./website-capture.js";

const jobId = "job-1";
const task = {
  id: "task-1",
  workspace_id: "workspace-1",
  created_by: "user-1",
  start_url: "https://example.com/",
  page_limit: 2,
  record_video: false,
  follow_external: false,
  status: "queued",
};

function makeContext(payload: Record<string, unknown>, linkedTaskIds: string[] = []) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("from website_capture_tasks where id=$1")) return { rows: [task] };
    if (sql.includes("where background_job_id=$1")) return { rows: linkedTaskIds.map((id) => ({ id })) };
    if (sql.includes("set status='running', progress=1")) return { rows: [{ id: task.id }] };
    if (sql.includes("with completed as")) return { rows: [{ session_id: "session-1" }] };
    return { rows: [] };
  });
  const ctx = {
    jobService: {
      getJobAdmin: vi.fn().mockResolvedValue({ id: jobId, payload }),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    },
    localDb: { query },
    storage: {},
    env: { storageRoot: "/tmp/helstera", webOrigin: "https://studio.example.test" },
  } as never;
  return { ctx, query };
}

beforeEach(() => {
  vi.clearAllMocks();
  captureIsolatedWebsite.mockResolvedValue({ pages: [] });
});

describe("website capture job payload recovery", () => {
  it("marks the task failed if its initial event cannot be saved", async () => {
    const { ctx, query } = makeContext({ task_id: "task-1" });
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("from website_capture_tasks where id=$1")) return { rows: [task] };
      if (sql.includes("set status='running', progress=1")) return { rows: [{ id: task.id }] };
      if (sql.includes("insert into website_capture_events") && params?.[1] === "connecting") throw new Error("event unavailable");
      return { rows: [] };
    });
    await expect(getExecutor("website_capture")!(jobId, { job_id: jobId }, ctx)).rejects.toThrow("event unavailable");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("else 'failed'"), expect.any(Array));
    expect(captureIsolatedWebsite).not.toHaveBeenCalled();
  });

  it("preserves completed assets if the final event cannot be saved", async () => {
    const { ctx, query } = makeContext({ task_id: "task-1" });
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("insert into website_capture_events") && params?.[1] === "completed") throw new Error("event unavailable");
      return original(sql, params);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(getExecutor("website_capture")!(jobId, { job_id: jobId }, ctx)).resolves.toEqual({ pages: [] });
      expect(softDeleteWebsiteCaptureAssets).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("[website-capture] failed to append completed event", expect.any(Error));
    } finally { log.mockRestore(); }
  });

  it("loads task_id from the persisted job because queue messages only carry job metadata", async () => {
    const { ctx, query } = makeContext({ task_id: "task-1", recording_approval_id: "approval-1" });
    const executor = getExecutor("website_capture");

    await expect(executor?.(jobId, { job_id: jobId, job_type: "website_capture" }, ctx)).resolves.toEqual({ pages: [] });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("from website_capture_tasks where id=$1"),
      ["task-1"],
    );
    expect(captureIsolatedWebsite).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("on conflict (session_id,client_message_id) do nothing"),
      expect.arrayContaining(["website-capture:task-1:completed"]),
    );
  });

  it("recovers legacy jobs through their task background_job_id link", async () => {
    const { ctx } = makeContext({}, ["task-1"]);
    const executor = getExecutor("website_capture");

    await expect(executor?.(jobId, { job_id: jobId }, ctx)).resolves.toEqual({ pages: [] });
    expect(captureIsolatedWebsite).toHaveBeenCalledOnce();
  });

  it("includes the recording link when delivering a completed capture to chat", async () => {
    captureIsolatedWebsite.mockResolvedValue({
      introduction: "Introduction",
      pages: [],
      recordingUrl: "/assets/recording.webm",
    });
    const { ctx, query } = makeContext({ task_id: "task-1" });
    await getExecutor("website_capture")?.(jobId, { job_id: jobId }, ctx);
    const completion = query.mock.calls.find(([sql]) => sql.includes("with completed as"));
    expect(completion?.[1]).toEqual(expect.arrayContaining([
      expect.stringContaining("[网站录屏](/assets/recording.webm)"),
    ]));
  });

  it("does not report completion when the task was canceled during capture", async () => {
    const { ctx, query } = makeContext({ task_id: "task-1" });
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("from website_capture_tasks where id=$1")) return { rows: [task] };
      if (sql.includes("set status='running', progress=1")) return { rows: [{ id: task.id }] };
      return { rows: [] };
    });
    const executor = getExecutor("website_capture");
    await expect(executor?.(jobId, { job_id: jobId }, ctx)).rejects.toMatchObject({ code: "job_canceled" });
  });

  it.each(["running", "succeeded", "canceled"])("does not execute a task that cannot be claimed (%s)", async (status) => {
    const { ctx, query } = makeContext({ task_id: "task-1" });
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("from website_capture_tasks where id=$1")) return { rows: [{ ...task, status }] };
      return { rows: [] };
    });
    await expect(getExecutor("website_capture")!(jobId, { job_id: jobId }, ctx)).rejects.toThrow();
    expect(captureIsolatedWebsite).not.toHaveBeenCalled();
  });

  it("fails clearly when neither the job payload nor task association identifies a task", async () => {
    const { ctx } = makeContext({});
    const executor = getExecutor("website_capture");

    await expect(executor?.(jobId, { job_id: jobId }, ctx)).rejects.toThrow("Website capture job is missing task_id.");
    expect(captureIsolatedWebsite).not.toHaveBeenCalled();
  });

  it("does not launch a recording without an approved claim", async () => {
    const { ctx, query } = makeContext({ task_id: "task-1", recording_approval_id: "approval-1" });
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("from website_capture_tasks where id=$1")) return { rows: [{ ...task, record_video: true, mode: "isolated", session_id: null, assistant_connection_id: null }] };
      return { rows: [] };
    });
    claimApprovedRecording.mockResolvedValue(false);
    await expect(getExecutor("website_capture")!(jobId, { job_id: jobId }, ctx)).rejects.toMatchObject({ code: "capture_not_claimed" });
    expect(claimApprovedRecording).toHaveBeenCalledWith(expect.anything(), "task-1", expect.objectContaining({ kind: "website_recording", url: task.start_url }), "approval-1");
    expect(captureIsolatedWebsite).not.toHaveBeenCalled();
  });
});
