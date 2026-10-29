import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureIsolatedWebsite } = vi.hoisted(() => ({ captureIsolatedWebsite: vi.fn() }));

vi.mock("../../website-capture/isolated-browser.js", () => ({
  captureIsolatedWebsite,
  WebsiteCaptureError: class WebsiteCaptureError extends Error {
    code = "capture_failed";
  },
}));

import { getExecutor } from "../job-executor.js";
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
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from website_capture_tasks where id=$1")) return { rows: [task] };
    if (sql.includes("where background_job_id=$1")) return { rows: linkedTaskIds.map((id) => ({ id })) };
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
  it("loads task_id from the persisted job because queue messages only carry job metadata", async () => {
    const { ctx, query } = makeContext({ task_id: "task-1" });
    const executor = getExecutor("website_capture");

    await expect(executor?.(jobId, { job_id: jobId, job_type: "website_capture" }, ctx)).resolves.toEqual({ pages: [] });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("from website_capture_tasks where id=$1"),
      ["task-1"],
    );
    expect(captureIsolatedWebsite).toHaveBeenCalledOnce();
  });

  it("recovers legacy jobs through their task background_job_id link", async () => {
    const { ctx } = makeContext({}, ["task-1"]);
    const executor = getExecutor("website_capture");

    await expect(executor?.(jobId, { job_id: jobId }, ctx)).resolves.toEqual({ pages: [] });
    expect(captureIsolatedWebsite).toHaveBeenCalledOnce();
  });

  it("fails clearly when neither the job payload nor task association identifies a task", async () => {
    const { ctx } = makeContext({});
    const executor = getExecutor("website_capture");

    await expect(executor?.(jobId, { job_id: jobId }, ctx)).rejects.toThrow("Website capture job is missing task_id.");
    expect(captureIsolatedWebsite).not.toHaveBeenCalled();
  });
});
