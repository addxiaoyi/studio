import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { StreamRetryAttempt, StreamRetryOptions } from "./stream-adapter.js";
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

// ---------------------------------------------------------------------------
// 首包（首个 token / 首个内容事件）之前的有限重试
// ---------------------------------------------------------------------------

type CollectedEvent = { type: string } & Record<string, unknown>;

function emptyStream(): AsyncIterable<unknown> {
  return (async function* nothing() {})();
}

function textEvent(text: string) {
  return { event: "on_chat_model_stream", data: { chunk: new AIMessageChunk({ id: "a", content: text }) } };
}

/** 上游 503，等价于生产日志里的 `MiddlewareError: 503 Service temporarily unavailable`。 */
function unavailableError(detail = "MiddlewareError: 503 Service temporarily unavailable") {
  return new Error(detail);
}

/** 用可重建的流工厂驱动 adapter，并记录尝试次数、退避时长与重试次数。 */
async function collectWithFactory(
  factory: (call: number) => AsyncIterable<unknown>,
  options: { retry?: StreamRetryOptions; signal?: AbortSignal } = {},
): Promise<{
  calls: number;
  delays: number[];
  events: CollectedEvent[];
  retries: StreamRetryAttempt[];
}> {
  let calls = 0;
  const delays: number[] = [];
  const retries: StreamRetryAttempt[] = [];
  const events: CollectedEvent[] = [];

  for await (const event of adaptDeepAgentStream({
    conversationId: "conversation",
    createStream: () => {
      calls += 1;
      return factory(calls);
    },
    runId: "run-retry",
    sessionId: "session",
    ...(options.signal ? { signal: options.signal } : {}),
    stream: emptyStream(),
    retry: {
      onRetry: (info) => retries.push(info),
      random: () => 0.5,
      sleep: async (delayMs: number) => {
        delays.push(delayMs);
      },
      ...options.retry,
    },
  })) {
    events.push(event as unknown as CollectedEvent);
  }

  return { calls, delays, events, retries };
}

describe("adaptDeepAgentStream 首包前重试", () => {
  it("503 在前三次尝试内恢复时不放弃，并只输出一次 run.started / run.completed", async () => {
    const { calls, delays, events, retries } = await collectWithFactory(async function* recover(call) {
      if (call <= 2) throw unavailableError();
      yield textEvent("好");
      yield textEvent("的");
    });

    expect(calls).toBe(3);
    expect(events.filter((event) => event.type === "run.started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "run.completed" });
    expect(events.filter((event) => event.type === "message.delta")).toMatchObject([
      { delta: "好" },
      { delta: "的" },
    ]);
    expect(retries.map((info) => info.attempt)).toEqual([1, 2]);
    expect(retries.every((info) => info.errorCode === "provider_unavailable")).toBe(true);
    expect(retries.every((info) => info.runId === "run-retry")).toBe(true);
    // 指数退避：250ms → 500ms（抖动固定为 0.5 时等于基数）
    expect(delays).toEqual([250, 500]);
  });

  it("超过重试上限后放弃，并以 provider_unavailable 结束", async () => {
    const { calls, delays, events, retries } = await collectWithFactory(async function* alwaysDown() {
      throw unavailableError();
    });

    expect(calls).toBe(3); // 1 次初始 + 2 次重试
    expect(delays).toEqual([250, 500]);
    expect(retries).toHaveLength(2);
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      error: { code: "provider_unavailable", retryable: true },
    });
  });

  it("已经产出内容事件之后不再重试，不会重复输出", async () => {
    const { calls, events, retries } = await collectWithFactory(async function* partial() {
      yield textEvent("前半句");
      throw unavailableError();
    });

    expect(calls).toBe(1);
    expect(retries).toHaveLength(0);
    expect(events.filter((event) => event.type === "message.delta")).toMatchObject([
      { delta: "前半句" },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      error: { code: "provider_unavailable", retryable: true },
    });
  });

  it("取消不被重试吞掉：中断错误直接走 canceled", async () => {
    const { calls, events, retries } = await collectWithFactory(async function* aborted() {
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    });

    expect(calls).toBe(1);
    expect(retries).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "run.canceled" });
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(0);
  });

  it("取消不被重试吞掉：退避期间被取消则不再发起下一次尝试", async () => {
    const controller = new AbortController();
    const { calls, retries, events } = await collectWithFactory(
      async function* down() {
        throw unavailableError();
      },
      {
        signal: controller.signal,
        retry: {
          // 模拟用户在退避等待中点了取消
          sleep: async () => {
            controller.abort();
          },
        },
      },
    );

    expect(calls).toBe(1);
    expect(retries).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "run.canceled" });
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(0);
  });

  it("非可重试错误不重试", async () => {
    const { calls, delays, events, retries } = await collectWithFactory(async function* unauthorized() {
      throw new Error("HTTP 401 provider unauthorized");
    });

    expect(calls).toBe(1);
    expect(delays).toEqual([]);
    expect(retries).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      error: { code: "provider_auth_failed", retryable: false },
    });
  });

  it("没有可重建的流工厂时保持单次尝试（不重试）", async () => {
    async function* failing(): AsyncGenerator<unknown> {
      throw unavailableError();
    }
    const events: CollectedEvent[] = [];
    for await (const event of adaptDeepAgentStream({
      conversationId: "conversation",
      runId: "run-legacy",
      sessionId: "session",
      stream: failing(),
    })) {
      events.push(event as unknown as CollectedEvent);
    }

    expect(events.filter((event) => event.type === "run.started")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      error: { code: "provider_unavailable", retryable: true },
    });
  });

  it("重试日志带 run id / 第几次 / 错误类别，且不泄漏敏感信息", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await collectWithFactory(async function* leaky() {
        throw new Error("HTTP 503 Authorization: Bearer sk-live-secret-value");
      });

      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("run-retry");
      expect(logged).toContain("attempt 1/2");
      expect(logged).toContain("provider_unavailable");
      expect(logged).not.toContain("sk-live-secret-value");
      expect(logged).not.toContain("Bearer");
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
