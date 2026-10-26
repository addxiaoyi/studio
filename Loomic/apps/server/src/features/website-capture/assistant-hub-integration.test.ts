import { describe, expect, it, vi } from "vitest";

import { WebsiteAssistantHub } from "./assistant-hub.js";

type HubInternals = {
  connections: Map<string, unknown>;
  pendingVisionRequests: Map<
    string,
    { connectionId: string; description: string }
  >;
  consumeDesktopRecordingChunk(live: unknown, message: unknown): Promise<void>;
  consumeDesktopVisionResult(live: unknown, message: unknown): void;
};

function createHub(options: {
  visionAnalyzer?: (input: {
    screenshotBase64: string;
    screenshotMimeType: string;
    screenshotWidth: number;
    screenshotHeight: number;
    description: string;
  }) => Promise<{ found: boolean; x: number; y: number; confidence: number }>;
} = {}) {
  const query = vi.fn(async () => ({ rows: [] }));
  const hub = new WebsiteAssistantHub({
    db: { query } as never,
    storage: {} as never,
    webOrigin: "https://studio.example.test",
    storageRoot: "/tmp/website-capture-test",
    ...(options.visionAnalyzer ? { analyzeDesktopScreenshot: options.visionAnalyzer } : {}),
  });
  return { hub, query, internals: hub as unknown as HubInternals };
}

function activeConnection(sent: Array<Record<string, unknown>>) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "user-1",
    workspaceId: "00000000-0000-0000-0000-000000000010",
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
    },
    sessionToken: "unused",
    browser: "chrome",
    platform: "windows",
    paused: false,
    mcpTools: [],
  };
}

describe("desktop recording chunk upload", () => {
  it("assembles ordered chunks into an evidence event and audits the recording", async () => {
    const { hub, internals } = createHub();
    const sent: Array<Record<string, unknown>> = [];
    const live = activeConnection(sent);
    internals.connections.set(live.id, live);
    // Bypass DB persistence inside handleDesktopAgentEvent for the final evidence event.
    const eventSpy = vi
      .spyOn(hub as unknown as { handleDesktopAgentEvent: (live: unknown, event: unknown) => Promise<void> }, "handleDesktopAgentEvent")
      .mockResolvedValue(undefined);

    const live_ = internals.connections.get(live.id);
    await internals.consumeDesktopRecordingChunk(live_, {
      type: "desktop_agent.recording_chunk",
      taskId: "00000000-0000-0000-0000-0000000000aa",
      uploadId: "upload-1",
      chunkIndex: 0,
      totalChunks: 2,
      data: "AAAA",
    });
    expect(eventSpy).not.toHaveBeenCalled();

    await internals.consumeDesktopRecordingChunk(live_, {
      type: "desktop_agent.recording_chunk",
      taskId: "00000000-0000-0000-0000-0000000000aa",
      uploadId: "upload-1",
      chunkIndex: 1,
      totalChunks: 2,
      isLast: true,
      data: "BBBB",
    });

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const event = eventSpy.mock.calls[0]![1] as {
      taskId: string;
      eventType: string;
      result?: { recordingBase64?: string };
    };
    expect(event.taskId).toBe("00000000-0000-0000-0000-0000000000aa");
    expect(event.eventType).toBe("evidence");
    expect(event.result?.recordingBase64).toBe("data:video/webm;base64,AAAABBBB");
  });

  it("ignores chunks from a mismatched connection or task", async () => {
    const { hub, internals } = createHub();
    const sent: Array<Record<string, unknown>> = [];
    const live = activeConnection(sent);
    internals.connections.set(live.id, live);
    const eventSpy = vi
      .spyOn(hub as unknown as { handleDesktopAgentEvent: (live: unknown, event: unknown) => Promise<void> }, "handleDesktopAgentEvent")
      .mockResolvedValue(undefined);
    const live_ = internals.connections.get(live.id);

    await internals.consumeDesktopRecordingChunk(live_, {
      type: "desktop_agent.recording_chunk",
      taskId: "00000000-0000-0000-0000-0000000000aa",
      uploadId: "upload-2",
      chunkIndex: 0,
      totalChunks: 2,
      data: "AAAA",
    });

    // A different connection id arrives via a cloned live object with a different id.
    const otherLive = { ...live_, id: "00000000-0000-0000-0000-0000000000ff" };
    await internals.consumeDesktopRecordingChunk(otherLive, {
      type: "desktop_agent.recording_chunk",
      taskId: "00000000-0000-0000-0000-0000000000aa",
      uploadId: "upload-2",
      chunkIndex: 1,
      totalChunks: 2,
      isLast: true,
      data: "BBBB",
    });

    expect(eventSpy).not.toHaveBeenCalled();
  });

  it("ignores malformed chunks", async () => {
    const { hub, internals } = createHub();
    const sent: Array<Record<string, unknown>> = [];
    const live = activeConnection(sent);
    internals.connections.set(live.id, live);
    const eventSpy = vi
      .spyOn(hub as unknown as { handleDesktopAgentEvent: (live: unknown, event: unknown) => Promise<void> }, "handleDesktopAgentEvent")
      .mockResolvedValue(undefined);
    const live_ = internals.connections.get(live.id);

    await internals.consumeDesktopRecordingChunk(live_, { type: "desktop_agent.recording_chunk" });
    await internals.consumeDesktopRecordingChunk(live_, {
      type: "desktop_agent.recording_chunk",
      taskId: "00000000-0000-0000-0000-0000000000aa",
      uploadId: "upload-3",
      chunkIndex: -1,
      totalChunks: 2,
      data: "AAAA",
    });

    expect(eventSpy).not.toHaveBeenCalled();
  });
});

describe("desktop vision grounding bridge", () => {
  it("captures a screenshot from the desktop, analyzes it, and returns coordinates", async () => {
    const { hub, internals } = createHub({
      visionAnalyzer: async (input) => {
        expect(input.screenshotMimeType).toBe("image/png");
        expect(input.screenshotWidth).toBe(800);
        expect(input.description).toBe("the red close button");
        return { found: true, x: 640, y: 32, confidence: 0.9 };
      },
    });
    const sent: Array<Record<string, unknown>> = [];
    const live = activeConnection(sent);
    internals.connections.set(live.id, live);

    const pending = hub
      .analyzeDesktopScreenshotViaDesktop({
        userId: "user-1",
        workspaceId: live.workspaceId,
        description: "the red close button",
      })
      .then((result) => {
        expect(result).toEqual({ found: true, x: 640, y: 32, confidence: 0.9 });
        return result;
      });

    // The hub sent a vision_request to the desktop; simulate the desktop reply.
    await vi.waitFor(() => {
      expect(sent.some((message) => message.type === "desktop_agent.vision_request")).toBe(true);
    });
    const request = sent.find((message) => message.type === "desktop_agent.vision_request")!;
    const live_ = internals.connections.get(live.id);
    internals.consumeDesktopVisionResult(live_, {
      type: "desktop_agent.vision_result",
      requestId: request.requestId,
      screenshotBase64: "c2hvdA==",
      screenshotMimeType: "image/png",
      screenshotWidth: 800,
      screenshotHeight: 600,
    });

    await expect(pending).resolves.toEqual({ found: true, x: 640, y: 32, confidence: 0.9 });
  });

  it("rejects when no analyzer is configured", async () => {
    const { hub } = createHub();
    await expect(
      hub.analyzeDesktopScreenshotViaDesktop({
        userId: "user-1",
        workspaceId: "00000000-0000-0000-0000-000000000010",
        description: "anything",
      }),
    ).rejects.toThrow(/not configured/);
  });

  it("propagates desktop capture failures", async () => {
    const { hub, internals } = createHub({
      visionAnalyzer: async () => ({ found: false, x: -1, y: -1, confidence: 0 }),
    });
    const sent: Array<Record<string, unknown>> = [];
    const live = activeConnection(sent);
    internals.connections.set(live.id, live);

    const pending = hub.analyzeDesktopScreenshotViaDesktop({
      userId: "user-1",
      workspaceId: live.workspaceId,
      description: "anything",
    });

    await vi.waitFor(() => {
      expect(sent.some((message) => message.type === "desktop_agent.vision_request")).toBe(true);
    });
    const request = sent.find((message) => message.type === "desktop_agent.vision_request")!;
    const live_ = internals.connections.get(live.id);
    internals.consumeDesktopVisionResult(live_, {
      type: "desktop_agent.vision_result",
      requestId: request.requestId,
      error: "screenshot blocked by credential guard",
    });

    await expect(pending).rejects.toThrow(/credential guard/);
  });
});
