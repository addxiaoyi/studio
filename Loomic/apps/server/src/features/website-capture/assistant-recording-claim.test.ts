import { describe, expect, it, vi } from "vitest";
import { WebsiteAssistantHub } from "./assistant-hub.js";

const { claim } = vi.hoisted(() => ({ claim: vi.fn() }));
vi.mock("./recording-approval.js", async importOriginal => ({
  ...await importOriginal<typeof import("./recording-approval.js")>(),
  claimApprovedRecording: claim,
}));

function connectedHub(recordVideo: boolean) {
  const task = {
    id: "task-1", workspace_id: "workspace-1", created_by: "user-1", mode: "local",
    session_id: "session-1", start_url: "https://example.test/demo", page_limit: 3,
    record_video: recordVideo, status: "queued", assistant_connection_id: "browser-1", follow_external: false,
  };
  const query = vi.fn().mockResolvedValue({ rows: [] }).mockResolvedValueOnce({ rows: [task] });
  const send = vi.fn();
  const hub = new WebsiteAssistantHub({ db: { query } as never, storage: {} as never,
    webOrigin: "https://studio.example.test", storageRoot: "/tmp/website-capture-test" });
  const connections = (hub as unknown as { connections: Map<string, unknown> }).connections;
  connections.set("browser-1", { ws: { readyState: 1, send }, paused: false });
  return { hub, task, query, send };
}

describe("local browser recording dispatch", () => {
  it("does not dispatch or remove prior artifacts when exact recording approval cannot be consumed", async () => {
    claim.mockResolvedValueOnce(false);
    const { hub, task, query, send } = connectedHub(true);
    await expect(hub.startLocalTask(task.id, task.created_by)).rejects.toThrow("recording approval is required");
    expect(claim).toHaveBeenLastCalledWith(expect.anything(), task.id, {
      kind: "website_recording", url: task.start_url, mode: "local", pageLimit: 3,
      followExternal: false, sessionId: "session-1", connectionId: "browser-1",
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not remove artifacts after another worker already claimed a non-recording task", async () => {
    const { hub, task, query, send } = connectedHub(false);
    await expect(hub.startLocalTask(task.id, task.created_by)).rejects.toThrow("could not be claimed");
    expect(query).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });
});
