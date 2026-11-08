import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentGoalResultSchema } from "@helstera/shared";
import { captureIsolatedWebsite } from "../website-capture/isolated-browser.js";
import { buildGoalTaskRequest, type BackgroundGoalInput } from "./agent-goal-worker.js";

import { createBackgroundGoalExecutor, writeCaptureToCanvas } from "./agent-goal-background.js";

vi.mock("../website-capture/isolated-browser.js", () => ({ captureIsolatedWebsite: vi.fn() }));

const capture = {
  title: "Example", startUrl: "https://example.com/", introduction: "# Example\nObserved evidence only.",
  pages: [{ url: "https://example.com/", title: "Example", description: "Example", headings: [], navigation: [], assetId: "image-asset", screenshotUrl: "https://example.com/image.jpg" }],
  evidence: [], claims: [], completedAt: "2026-10-31T00:00:00.000Z",
};
const goal: BackgroundGoalInput["goal"] = {
  id: "00000000-0000-4000-8000-000000000001", workspace_id: "workspace", created_by: "user",
  canvas_id: "canvas", chat_session_id: null, goal: "Read https://example.com", status: "running",
  plan: { steps: [], generatedAt: "2026-10-31T00:00:00.000Z" }, execution_mode: "isolated_browser",
  output_kind: "document", execution_policy: "approval_required", capabilities: [], next_attempt_at: null,
};

function setup() {
  const state = { active: true, connectorEnabled: true };
  const db = { query: vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes("from agent_connector_permissions")) return { rows: [{ enabled: state.connectorEnabled }] };
    if (sql.includes("select g.status")) return { rows: state.active ? [{ status: "running", task_status: "running" }] : [] };
    if (sql.includes("from generated_assets ga")) return { rows: [{ id: "image-asset", object_path: "image.jpg", mime_type: "image/jpeg" }] };
    return { rows: [] };
  }) };
  const writer = { insertImage: vi.fn().mockResolvedValue({ elementId: "image-element" }), insertVideo: vi.fn() };
  const execute = createBackgroundGoalExecutor({ db: db as never, storage: {} as never, storageRoot: "test", webOrigin: "https://example.com", canvasWriter: writer });
  return { state, db, writer, execute };
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(captureIsolatedWebsite).mockResolvedValue(capture); });

describe("background website reports", () => {
  it("returns a validated document, sources and canvas evidence without claiming local storage", async () => {
    const { execute, db } = setup();
    const result = agentGoalResultSchema.parse(await execute({ taskId: "task-1", goal, request: buildGoalTaskRequest(goal) }));
    expect(result.documents?.[0]).toMatchObject({ content: capture.introduction, sourceUrls: [capture.startUrl], mimeType: "text/markdown" });
    expect(result.canvasElementIds).toEqual(["image-element"]);
    expect(result.localPaths).toBeUndefined();
    expect(db.query.mock.calls.find(([sql]) => sql.includes("insert into website_capture_tasks"))?.[1]?.[7]).toBe(`agent-goal:${goal.id}:task-1`);
  });

  it("uses a distinct capture key for an explicit retry", async () => {
    const { execute, db } = setup();
    for (const taskId of ["first", "retry"]) await execute({ taskId, goal, request: buildGoalTaskRequest(goal) });
    const keys = db.query.mock.calls.filter(([sql]) => sql.includes("insert into website_capture_tasks")).map(([, values]) => values?.[7]);
    expect(new Set(keys).size).toBe(2);
  });

  it("releases a paused goal without starting a capture or blocking the worker", async () => {
    const { execute, db } = setup();
    db.query.mockResolvedValueOnce({ rows: [{ enabled: true }] }).mockResolvedValueOnce({ rows: [{ status: "paused", task_status: "paused" }] });
    await expect(execute({ taskId: "task", goal, request: buildGoalTaskRequest(goal) })).rejects.toThrow("Resuming restarts this capture");
    expect(captureIsolatedWebsite).not.toHaveBeenCalled();
  });

  it("stops before writing evidence when the browser connector is disabled during capture", async () => {
    const { execute, state, writer } = setup();
    vi.mocked(captureIsolatedWebsite).mockImplementation(async () => { state.connectorEnabled = false; return capture; });
    await expect(execute({ taskId: "task", goal, request: buildGoalTaskRequest(goal) })).rejects.toThrow("isolated-browser connector is disabled");
    expect(writer.insertImage).not.toHaveBeenCalled();
  });

  it("does not write canvas evidence after cancellation during capture", async () => {
    const { execute, state, writer, db } = setup();
    vi.mocked(captureIsolatedWebsite).mockImplementation(async () => { state.active = false; return capture; });
    await expect(execute({ taskId: "task", goal, request: buildGoalTaskRequest(goal) })).rejects.toThrow("no longer running");
    expect(writer.insertImage).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql, values]) => sql.includes("set status=$3") && values?.[2] === "canceled")).toBe(true);
  });

  it("does not mark capture successful when canvas delivery fails", async () => {
    const { execute, writer, db } = setup();
    writer.insertImage.mockRejectedValue(new Error("Canvas unavailable"));
    await expect(execute({ taskId: "task", goal, request: buildGoalTaskRequest(goal) })).rejects.toThrow("Canvas unavailable");
    expect(db.query.mock.calls.some(([sql]) => sql.includes("status='succeeded'"))).toBe(false);
  });

  it("checks cancellation between canvas writes without claiming to undo earlier evidence", async () => {
    const { execute, state, writer } = setup();
    vi.mocked(captureIsolatedWebsite).mockResolvedValue({ ...capture, pages: [...capture.pages, ...capture.pages] });
    writer.insertImage.mockImplementation(async () => { state.active = false; return { elementId: "already-written" }; });
    await expect(execute({ taskId: "task", goal, request: buildGoalTaskRequest(goal) })).rejects.toThrow("no longer running");
    expect(writer.insertImage).toHaveBeenCalledOnce();
    expect(writer.insertVideo).not.toHaveBeenCalled();
  });

  it.each(["录制网站", "录屏网站", "录像网站", "record website"])("rejects unapproved recording: %s", async (text) => {
    const { execute } = setup();
    await expect(execute({ taskId: "task", goal: { ...goal, goal: text }, request: buildGoalTaskRequest(goal) })).rejects.toThrow("exact action approval");
    expect(captureIsolatedWebsite).not.toHaveBeenCalled();
  });
});

describe("background website capture canvas writeback", () => {
  it("rejects deleted or expired evidence before adding any element",async()=>{
    const image=vi.fn(),video=vi.fn();
    await expect(writeCaptureToCanvas({db:{query:vi.fn(async()=>({rows:[]}))} as never,storage:{} as never,writer:{insertImage:image,insertVideo:video},canvasId:"canvas",taskId:"task",workspaceId:"workspace",pages:[{assetId:"missing",title:"Missing"}]})).rejects.toThrow("到期");
    expect(image).not.toHaveBeenCalled();expect(video).not.toHaveBeenCalled();
  });
  it("writes captured screenshots and recordings to the selected canvas", async () => {
    const image = vi.fn().mockResolvedValue({ elementId: "image-element" });
    const video = vi.fn().mockResolvedValue({ elementId: "video-element" });
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from generated_assets ga")) {
          return { rows: [
            { id: "asset-image", object_path: "workspace/image.jpg", mime_type: "image/jpeg" },
            { id: "asset-video", object_path: "workspace/recording.webm", mime_type: "video/webm" },
          ] };
        }
        return { rows: [] };
      }),
    };

    await expect(writeCaptureToCanvas({
      db: db as never,
      storage: {} as never,
      writer: { insertImage: image, insertVideo: video },
      canvasId: "canvas-1",
      taskId: "task-1",
      workspaceId: "workspace-1",
      pages: [{ assetId: "asset-image", title: "Home" }],
      recordingAssetId: "asset-video",
      recordingUrl: "https://studio.example.test/api/uploads/video/file",
    })).resolves.toEqual(["image-element", "video-element"]);
    expect(image).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({
      canvasId: "canvas-1",
      objectPath: "workspace/image.jpg",
      jobId: "task-1:screenshot:asset-image",
    }));
    expect(video).toHaveBeenCalledWith(db, expect.objectContaining({
      canvasId: "canvas-1",
      signedUrl: "https://studio.example.test/api/uploads/video/file",
      jobId: "task-1:recording:asset-video",
    }));
  });
});
