import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { adaptDeepAgentStream } from "./stream-adapter.js";

async function collect(events: unknown[], singleImageTask = false, onModelUsage?: (usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }) => void) {
  async function* stream() {
    yield* events;
  }

  const output = [];
  for await (const event of adaptDeepAgentStream({
    conversationId: "conversation",
    runId: "run",
    sessionId: "session",
    singleImageTask,
    stream: stream(),
    ...(onModelUsage ? { onModelUsage } : {}),
  })) {
    output.push(event);
  }
  return output;
}

describe("adaptDeepAgentStream", () => {
  it("normalizes the deployed LangChain input envelope for tool cards", async () => {
    const starts = ["first", "duplicate"].map((id) => ({
      event: "on_tool_start", name: "generate_image", run_id: id,
      data: { input: { input: JSON.stringify({ prompt: "One product poster", model: "gpt-image-2" }) } },
    }));
    const ends = ["first", "duplicate"].map((id) => ({
      event: "on_tool_end", name: "generate_image", run_id: id, data: { output: { summary: "done" } },
    }));
    const events = await collect([...starts, ...ends], true);
    expect(events.filter((event) => event.type === "tool.started")).toMatchObject([
      { toolCallId: "first", input: { prompt: "One product poster", model: "gpt-image-2" } },
      { toolCallId: "duplicate", input: { prompt: "One product poster", model: "gpt-image-2" } },
    ]);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(2);
  });

  it("emits one persisted card for three concurrent calls sharing the single image task", async () => {
    const starts = ["one", "two", "three"].map((id) => ({ event: "on_tool_start", name: "generate_image", run_id: id, data: { input: { prompt: "One mug" } } }));
    const ends = ["two", "one", "three"].map((id) => ({ event: "on_tool_end", name: "generate_image", run_id: id, data: { output: { summary: "done" } } }));
    const events = await collect([...starts, ...ends], true);
    const lifecycle = events.filter((e) => e.type === "tool.started" || e.type === "tool.completed");
    expect(lifecycle).toHaveLength(6);
    expect(lifecycle).toMatchObject([
      { type: "tool.started", toolCallId: "one" },
      { type: "tool.started", toolCallId: "two" },
      { type: "tool.started", toolCallId: "three" },
      { type: "tool.completed", toolCallId: "two" },
      { type: "tool.completed", toolCallId: "one" },
      { type: "tool.completed", toolCallId: "three" },
    ]);
  });

  it("keeps normal multi-image streams unchanged when no single-job guard is used", async () => {
    const events = await collect(["one", "two"].map((id) => ({ event: "on_tool_start", name: "generate_image", run_id: id, data: { input: { prompt: "One mug" } } })));
    expect(events.filter((e) => e.type === "tool.started")).toHaveLength(2);
  });

  it("does not let an invalid empty call hide the later valid image task", async () => {
    const events = await collect([
      { event: "on_tool_start", name: "generate_image", run_id: "empty", data: { input: {} } },
      { event: "on_tool_error", name: "generate_image", run_id: "empty", data: { error: new Error("prompt required") } },
      { event: "on_tool_start", name: "generate_image", run_id: "valid", data: { input: { prompt: "One mug" } } },
      { event: "on_tool_end", name: "generate_image", run_id: "valid", data: { output: { summary: "done" } } },
    ], true);
    expect(events.filter((e) => e.type === "tool.completed")).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.completed", toolCallId: "valid" }));
  });

  it("forwards standard content chunks incrementally", async () => {
    const events = await collect([
      { event: "on_chat_model_stream", data: { chunk: new AIMessageChunk({ id: "a", content: "你" }) } },
      { event: "on_chat_model_stream", data: { chunk: new AIMessageChunk({ id: "a", content: "好" }) } },
    ]);

    expect(events.filter((event) => event.type === "message.delta")).toMatchObject([
      { messageId: "a", delta: "你" },
      { messageId: "a", delta: "好" },
    ]);
  });

  it("converts compatible reasoning chunks to thinking deltas", async () => {
    const events = await collect([
      {
        event: "on_chat_model_stream",
        data: {
          chunk: new AIMessageChunk({
            id: "a",
            content: "",
            additional_kwargs: { reasoning_content: "分析中" },
          }),
        },
      },
    ]);

    expect(events).toContainEqual(expect.objectContaining({
      type: "thinking.delta",
      messageId: "a",
      delta: "分析中",
    }));
  });

  it("does not repeat a streamed answer when the final message id changes", async () => {
    const events = await collect([
      { event: "on_chat_model_stream", data: { chunk: new AIMessageChunk({ id: "chunk-id", content: "完成" }) } },
      { event: "on_chat_model_end", data: { output: new AIMessage({ id: "final-id", content: "完成" }) } },
    ]);

    expect(events.filter((event) => event.type === "message.delta")).toHaveLength(1);
  });

  it("reports prompt-cache usage from the final model event", async () => {
    const usage: Array<{ inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }> = [];
    await collect([
      { event: "on_chat_model_end", data: { output: Object.assign(new AIMessage({
        id: "final-id",
        content: "完成",
      }), {
        usage_metadata: {
          input_tokens: 2400,
          output_tokens: 120,
          input_token_details: { cache_read: 1800 },
        },
      }) } },
    ], false, (value) => usage.push(value));
    expect(usage).toEqual([{ inputTokens: 2400, outputTokens: 120, cacheReadTokens: 1800 }]);
  });

  it("uses the final message when the provider emits no text chunks", async () => {
    const events = await collect([
      { event: "on_chat_model_end", data: { output: new AIMessage({ id: "final-id", content: "完成" }) } },
    ]);

    expect(events).toContainEqual(expect.objectContaining({
      type: "message.delta",
      messageId: "final-id",
      delta: "完成",
    }));
  });

  it("does not expose tool-call chunks as visible text", async () => {
    const events = await collect([
      {
        event: "on_chat_model_stream",
        data: {
          chunk: new AIMessageChunk({
            content: "hidden",
            tool_call_chunks: [{ id: "call", name: "generate_video", args: "{}", index: 0 }],
          }),
        },
      },
    ]);

    expect(events.some((event) => event.type === "message.delta")).toBe(false);
  });

  it("completes a tool card when tool execution throws", async () => {
    const events = await collect([
      { event: "on_tool_start", name: "generate_video", run_id: "tool-run", data: { input: {} } },
      { event: "on_tool_error", name: "generate_video", run_id: "tool-run", data: { error: new Error("No compatible video model") } },
    ]);

    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.completed",
      toolCallId: "tool-run",
      toolName: "generate_video",
      output: expect.objectContaining({ error: expect.any(String) }),
    }));
  });

  it("synthesizes a start event when a resumed stream only has a tool result", async () => {
    const events = await collect([
      { event: "on_tool_end", name: "generate_image", run_id: "resumed-tool", data: { output: { summary: "done" } } },
    ]);

    expect(events.filter((event) => event.type === "tool.started" || event.type === "tool.completed")).toMatchObject([
      { type: "tool.started", toolCallId: "resumed-tool", toolName: "generate_image" },
      { type: "tool.completed", toolCallId: "resumed-tool" },
    ]);
  });

  it("stops after a non-retryable provider failure", async () => {
    const events = await collect([
      { event: "on_tool_start", name: "project_search", run_id: "search-1", data: { input: { query: "model" } } },
      { event: "on_tool_error", name: "project_search", run_id: "search-1", data: { error: new Error("HTTP 401 provider unauthorized") } },
      { event: "on_tool_start", name: "project_search", run_id: "search-2", data: { input: { query: "model" } } },
    ]);

    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      error: { code: "provider_auth_failed", retryable: false },
    });
  });

  it("preserves classified provider code on the completed tool card", async () => {
    const events = await collect([
      { event: "on_tool_start", name: "generate_video", run_id: "provider-tool", data: { input: {} } },
      { event: "on_tool_error", name: "generate_video", run_id: "provider-tool", data: { error: new Error("HTTP 401 provider unauthorized") } },
    ]);

    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.completed",
      toolCallId: "provider-tool",
      output: expect.objectContaining({ status: "job_failed", errorCode: "provider_auth_failed" }),
    }));
  });
});
