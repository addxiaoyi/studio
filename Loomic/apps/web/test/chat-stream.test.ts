import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@helstera/shared";

import { streamEventKey } from "../src/hooks/use-chat-stream";

describe("chat stream event identity", () => {
  it("treats a replayed terminal failure as the same event", () => {
    const event: Extract<StreamEvent, { type: "run.failed" }> = {
      type: "run.failed" as const,
      runId: "run-1",
      error: { code: "run_failed", message: "request failed", retryable: true },
      timestamp: "2026-10-26T12:00:00.000Z",
    };

    expect(streamEventKey(event)).toBe(streamEventKey({ ...event }));
  });

  it("keeps separate tool calls distinct", () => {
    const first = { type: "tool.started" as const, runId: "run-1", toolCallId: "tool-1", toolName: "website_capture", timestamp: "2026-10-26T12:00:00.000Z" };
    const second = { ...first, toolCallId: "tool-2" };

    expect(streamEventKey(first)).not.toBe(streamEventKey(second));
  });
});
