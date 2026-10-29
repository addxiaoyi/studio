import type {
  AIMessage,
  AIMessageChunk,
  ToolMessage,
} from "@langchain/core/messages";
import {
  AIMessageChunk as AIMessageChunkClass,
  AIMessage as AIMessageClass,
  ToolMessage as ToolMessageClass,
} from "@langchain/core/messages";

import { imageArtifactSchema, videoArtifactSchema } from "@helstera/shared";
import type { StreamEvent, ToolArtifact } from "@helstera/shared";

import { classifyErrorForClient, isRetryableUpstreamError } from "../utils/error-sanitizer.js";

/**
 * Shape of a LangChain v2 stream event from `streamEvents()`.
 */
type LangChainStreamEvent = {
  event: string;
  name?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  run_id?: string;
  tags?: string[];
};

type AdaptDeepAgentStreamOptions = {
  conversationId: string;
  now?: () => string;
  runId: string;
  sessionId: string;
  singleImageTask?: boolean;
  signal?: AbortSignal;
  stream: AsyncIterable<LangChainStreamEvent | unknown>;
  /**
   * 可选的“上游流工厂”。已消费的 async iterable 无法复活，所以供应商 503 这类
   * 首包前的失败只有能重建上游流时才可能重试；不提供时行为与改动前完全一致（不重试）。
   */
  createStream?: () => AsyncIterable<LangChainStreamEvent | unknown> | Promise<AsyncIterable<LangChainStreamEvent | unknown>>;
  retry?: StreamRetryOptions;
  onModelUsage?: (usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }) => void;
};

/** 重试尝试的观测信息（用于日志与测试断言）。 */
export type StreamRetryAttempt = {
  attempt: number;
  delayMs: number;
  errorCode: string;
  errorType: string;
  maxRetries: number;
  runId: string;
};

/** 首包前有限重试的配置；默认最多 2 次、指数退避 + 抖动。 */
export type StreamRetryOptions = {
  /** 首次尝试之外的重试次数，默认 2。 */
  maxRetries?: number;
  /** 首次退避基数（毫秒），默认 250。 */
  baseDelayMs?: number;
  /** 单次退避上限（毫秒），默认 4000。 */
  maxDelayMs?: number;
  /** 抖动比例 0..1，默认 0.2（±20%）。 */
  jitterRatio?: number;
  /** 随机源，测试可注入。 */
  random?: () => number;
  /** 睡眠实现，测试可注入以避免真实等待。 */
  sleep?: (delayMs: number) => Promise<void>;
  /** 每次真正重试前的回调。 */
  onRetry?: (info: StreamRetryAttempt) => void;
};

type ResolvedRetryOptions = Required<Omit<StreamRetryOptions, "onRetry">> & {
  onRetry?: (info: StreamRetryAttempt) => void;
};

const DEFAULT_STREAM_RETRY = {
  baseDelayMs: 250,
  jitterRatio: 0.2,
  maxDelayMs: 4000,
  maxRetries: 2,
} as const;

/**
 * Sub-agent parent tool names whose inner tools should have their
 * artifacts suppressed (the parent re-emits them with placement).
 */
const SUB_AGENT_PARENT_TOOLS = new Set(["video_generate"]);
/** Inner tools that may be suppressed when running inside a sub-agent. */
const INNER_SUB_AGENT_TOOLS = new Set(["generate_video"]);

export async function* adaptDeepAgentStream(
  options: AdaptDeepAgentStreamOptions,
): AsyncGenerator<StreamEvent> {
  const now = options.now ?? (() => new Date().toISOString());
  const retry = resolveRetryOptions(options.retry);

  yield {
    conversationId: options.conversationId,
    runId: options.runId,
    sessionId: options.sessionId,
    timestamp: now(),
    type: "run.started",
  };

  let attempt = 0;
  for (;;) {
    const source = options.createStream
      ? await options.createStream()
      : options.stream;
    const iterator = adaptDeepAgentStreamAttempt({
      ...options,
      now,
      stream: source,
    });
    /** 本次尝试已产出的事件数；>0 说明已经对外输出过内容，禁止重试。 */
    let emitted = 0;
    let terminalEmitted = false;
    let failure: unknown;
    let failed = false;

    try {
      for (;;) {
        const step = await iterator.next();
        if (step.done) break;
        emitted += 1;
        terminalEmitted = isTerminalEvent(step.value);
        yield step.value;
      }
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      await iterator.return?.(undefined);
    }

    if (!failed) {
      // 内层已给出终态（run.failed / run.canceled）时不再补 run.completed。
      if (!terminalEmitted) {
        yield {
          runId: options.runId,
          timestamp: now(),
          type: "run.completed",
        };
      }
      return;
    }

    // 取消（含超时看门狗触发的中断）绝不能被重试吞掉。
    if (isAbortError(failure) || options.signal?.aborted) {
      yield canceledEvent(options.runId, now);
      return;
    }

    const classification = classifyErrorForClient(failure);
    const canRetry =
      emitted === 0 &&
      attempt < retry.maxRetries &&
      typeof options.createStream === "function" &&
      isRetryableUpstreamError(failure);

    if (canRetry) {
      attempt += 1;
      const delayMs = retryDelayMs(retry, attempt);
      const errorType = errorTypeOf(failure);
      const attemptInfo: StreamRetryAttempt = {
        attempt,
        delayMs,
        errorCode: classification.code,
        errorType,
        maxRetries: retry.maxRetries,
        runId: options.runId,
      };
      logRetryAttempt(attemptInfo);
      retry.onRetry?.(attemptInfo);
      await retry.sleep(delayMs);
      if (options.signal?.aborted) {
        yield canceledEvent(options.runId, now);
        return;
      }
      continue;
    }

    // Log full error detail server-side
    console.error(
      `[stream-adapter] Stream error for run ${options.runId}:`,
      failure,
    );

    yield {
      error: {
        ...classification,
      },
      runId: options.runId,
      timestamp: now(),
      type: "run.failed",
    };
    return;
  }
}

/**
 * 单次尝试：把 LangChain 事件流翻译成 StreamEvent。
 * 不产出 run.started / run.completed，错误一律抛给外层重试包装器决策。
 */
async function* adaptDeepAgentStreamAttempt(
  options: AdaptDeepAgentStreamOptions,
): AsyncGenerator<StreamEvent> {
  const now = options.now ?? (() => new Date().toISOString());
  const seenCompletedToolCalls = new Set<string>();
  const seenStreamedMessageIds = new Set<string>();
  let streamedVisibleText = false;
  const seenStartedToolCalls = new Set<string>();
  /** Tracks active sub-agent parent runs so we can detect nested inner tools. */
  const activeSubAgentRuns = new Set<string>();

  if (options.signal?.aborted) {
    yield canceledEvent(options.runId, now);
    return;
  }

  try {
    for await (const rawEvent of options.stream) {
      if (options.signal?.aborted) {
        yield canceledEvent(options.runId, now);
        return;
      }

      if (!isStreamEvent(rawEvent)) {
        continue;
      }

      const evt = rawEvent;

      // Per-token streaming from the chat model
      if (evt.event === "on_chat_model_stream") {
        const chunk = evt.data?.chunk;
        if (!chunk) continue;

        // Skip chunks that are tool calls (no text to emit)
        if (
          AIMessageChunkClass.isInstance(chunk) ||
          AIMessageClass.isInstance(chunk)
        ) {
          const msg = chunk as AIMessageChunk | AIMessage;
          if ((msg.tool_calls?.length ?? 0) > 0) continue;
        }

        const messageId =
          (chunk as { id?: string }).id ?? `message_${options.runId}`;

        const content = (chunk as { content: unknown }).content;

        // Handle array content (e.g. Gemini thinking + text blocks)
        if (Array.isArray(content)) {
          for (const part of content) {
            if (
              part &&
              typeof part === "object" &&
              "type" in part &&
              part.type === "thinking" &&
              "thinking" in part &&
              typeof part.thinking === "string" &&
              part.thinking
            ) {
              yield {
                type: "thinking.delta" as const,
                runId: options.runId,
                messageId,
                delta: part.thinking,
                timestamp: now(),
              };
            } else {
              const text =
                typeof part === "string"
                  ? part
                  : part &&
                      typeof part === "object" &&
                      "text" in part &&
                      typeof (part as { text: unknown }).text === "string"
                    ? (part as { text: string }).text
                    : "";
              if (text) {
                seenStreamedMessageIds.add(messageId);
                streamedVisibleText = true;
                yield {
                  type: "message.delta" as const,
                  runId: options.runId,
                  messageId,
                  delta: text,
                  timestamp: now(),
                };
              }
            }
          }
          continue;
        }

        // String content (normal text)
        const delta = extractChunkText(chunk);
        const reasoning = extractReasoningText(chunk);
        if (reasoning) {
          yield {
            type: "thinking.delta" as const,
            runId: options.runId,
            messageId,
            delta: reasoning,
            timestamp: now(),
          };
        }
        if (!delta) continue;

        seenStreamedMessageIds.add(messageId);
        streamedVisibleText = true;
        yield {
          delta,
          messageId,
          runId: options.runId,
          timestamp: now(),
          type: "message.delta",
        };
        continue;
      }

      // Fallback: complete message from non-streaming model (on_chat_model_end)
      if (evt.event === "on_chat_model_end") {
        const output = evt.data?.output;
        if (!output) continue;

        const usage = (output as { usage_metadata?: {
          input_tokens?: number;
          output_tokens?: number;
          input_token_details?: { cache_read?: number };
        } }).usage_metadata;
        if (usage && options.onModelUsage) {
          options.onModelUsage({
            ...(usage.input_tokens != null ? { inputTokens: usage.input_tokens } : {}),
            ...(usage.output_tokens != null ? { outputTokens: usage.output_tokens } : {}),
            ...(usage.input_token_details?.cache_read != null
              ? { cacheReadTokens: usage.input_token_details.cache_read }
              : {}),
          });
        }

        if (
          AIMessageClass.isInstance(output) ||
          AIMessageChunkClass.isInstance(output)
        ) {
          const msg = output as AIMessage | AIMessageChunk;
          const messageId = msg.id ?? `message_${options.runId}`;

          // Skip if this was a tool call message (tool lifecycle via on_tool_*)
          if ((msg.tool_calls?.length ?? 0) > 0) continue;
          // Some compatible gateways assign a new id to the final message.
          // Once visible text was streamed, the final event is only a duplicate.
          if (streamedVisibleText || seenStreamedMessageIds.has(messageId)) continue;

          const delta = extractChunkText(msg);
          if (!delta) continue;

          yield {
            delta,
            messageId,
            runId: options.runId,
            timestamp: now(),
            type: "message.delta",
          };
        }
        continue;
      }

      // Tool execution started
      if (evt.event === "on_tool_start") {
        const toolName = evt.name ?? "unknown_tool";
        // Use run_id as the tool call identifier for consistent start/end pairing
        const toolCallId = readString(evt.run_id) ?? `tool_${Date.now()}`;

        if (seenStartedToolCalls.has(toolCallId)) continue;
        seenStartedToolCalls.add(toolCallId);

        // Extract tool input arguments for frontend display
        const rawInput = evt.data?.input;
        let toolInput =
          rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
            ? (rawInput as Record<string, unknown>)
            : undefined;

        // LangChain also emits image arguments inside a serialized `input` field.
        if (toolName === "generate_image") {
          const serialized = typeof rawInput === "string" ? rawInput : toolInput?.input;
          const parsed = typeof serialized === "string" ? tryParseJson(serialized) : undefined;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            toolInput = parsed as Record<string, unknown>;
          }
        }

        // Track sub-agent parent tools so we can detect nested inner calls.
        if (SUB_AGENT_PARENT_TOOLS.has(toolName)) {
          activeSubAgentRuns.add(toolCallId);
        }

        yield {
          runId: options.runId,
          timestamp: now(),
          toolCallId,
          toolName,
          ...(toolInput ? { input: toolInput } : {}),
          type: "tool.started",
        };
        continue;
      }

      // Tool execution completed
      if (evt.event === "on_tool_end") {
        const toolName = evt.name ?? "unknown_tool";
        // Use run_id for consistent pairing with on_tool_start
        const toolCallId = readString(evt.run_id) ?? `tool_${Date.now()}`;

        if (seenCompletedToolCalls.has(toolCallId)) continue;
        seenCompletedToolCalls.add(toolCallId);

        const output = evt.data?.output;

        // Some gateways omit on_tool_start after a resumed stream. Persist a
        // complete lifecycle instead of losing the tool result in chat history.
        if (!seenStartedToolCalls.has(toolCallId)) {
          seenStartedToolCalls.add(toolCallId);
          yield {
            runId: options.runId,
            timestamp: now(),
            toolCallId,
            toolName,
            type: "tool.started",
          };
        }

        // When an inner tool runs inside an active sub-agent parent,
        // suppress its artifacts because the parent will re-emit them.
        const isNestedInSubAgent =
          INNER_SUB_AGENT_TOOLS.has(toolName) && activeSubAgentRuns.size > 0;
        const extractedArtifacts = isNestedInSubAgent ? undefined : extractArtifacts(output);
        const extractedOutput = extractOutput(output, (extractedArtifacts?.length ?? 0) > 0);
        yield {
          output: extractedOutput,
          outputSummary: summarizeOutput(output),
          artifacts: extractedArtifacts,
          runId: options.runId,
          timestamp: now(),
          toolCallId,
          toolName,
          type: "tool.completed",
        };

        // Clean up sub-agent parent tracking after its tool.completed is emitted.
        if (SUB_AGENT_PARENT_TOOLS.has(toolName)) {
          activeSubAgentRuns.delete(toolCallId);
        }

        if (toolName === "manipulate_canvas") {
          yield {
            type: "canvas.sync" as const,
            runId: options.runId,
            timestamp: now(),
          } satisfies StreamEvent;
        }
        continue;
      }

      if (evt.event === "on_tool_error") {
        const toolName = evt.name ?? "unknown_tool";
        const toolCallId = readString(evt.run_id) ?? `tool_${Date.now()}`;
        if (seenCompletedToolCalls.has(toolCallId)) continue;
        seenCompletedToolCalls.add(toolCallId);
        activeSubAgentRuns.delete(toolCallId);

        const rawError = evt.data?.error;
        const rawMessage = rawError instanceof Error
          ? rawError.message
          : typeof rawError === "string"
            ? rawError
            : rawError && typeof rawError === "object" && "message" in rawError
              ? String((rawError as { message?: unknown }).message ?? "")
            : "";
        const failure = classifyErrorForClient(rawError ?? "Tool execution failed");
        const message = failure.message;
        const approval = parseApprovalRequired(rawMessage) ?? parseApprovalRequired(message);
        if (!seenStartedToolCalls.has(toolCallId)) {
          seenStartedToolCalls.add(toolCallId);
          yield {
            runId: options.runId,
            timestamp: now(),
            toolCallId,
            toolName,
            type: "tool.started",
          };
        }
        yield {
          output: approval ?? {
            status: "job_failed",
            error: message,
            ...(failure.code !== "run_failed" ? { errorCode: failure.code } : {}),
          },
          outputSummary: approval
            ? "Confirmation required before credits are charged."
            : message,
          runId: options.runId,
          timestamp: now(),
          toolCallId,
          toolName,
          type: "tool.completed",
        };
        if (approval) continue;
        if (failure.code !== "run_failed") {
          yield {
            error: failure,
            runId: options.runId,
            timestamp: now(),
            type: "run.failed",
          };
          return;
        }
        continue;
      }
    }
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      yield canceledEvent(options.runId, now);
      return;
    }
    // 交给外层重试包装器：由它决定是否重试、以及最终是否产出 run.failed。
    throw error;
  }
}

/** 已经对外宣告结束的事件：出现后不再补 run.completed。 */
function isTerminalEvent(event: StreamEvent): boolean {
  return event.type === "run.failed" || event.type === "run.canceled";
}

/** 仅取错误类型名用于日志，绝不取 message（可能含凭证、URL、请求体）。 */
function errorTypeOf(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return typeof error;
}

function resolveRetryOptions(options?: StreamRetryOptions): ResolvedRetryOptions {
  return {
    baseDelayMs: Math.max(0, options?.baseDelayMs ?? DEFAULT_STREAM_RETRY.baseDelayMs),
    jitterRatio: Math.min(1, Math.max(0, options?.jitterRatio ?? DEFAULT_STREAM_RETRY.jitterRatio)),
    maxDelayMs: Math.max(0, options?.maxDelayMs ?? DEFAULT_STREAM_RETRY.maxDelayMs),
    maxRetries: Math.max(0, Math.floor(options?.maxRetries ?? DEFAULT_STREAM_RETRY.maxRetries)),
    random: options?.random ?? Math.random,
    sleep: options?.sleep ?? defaultSleep,
    ...(options?.onRetry ? { onRetry: options.onRetry } : {}),
  };
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

/** 指数退避 + 抖动：base * 2^(attempt-1)，叠加 ±jitterRatio 随机抖动，最后按 maxDelayMs 截顶。 */
function retryDelayMs(retry: ResolvedRetryOptions, attempt: number): number {
  const capped = Math.min(
    retry.maxDelayMs,
    retry.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  if (capped <= 0) return 0;
  const spread = capped * retry.jitterRatio;
  const jittered = capped - spread + retry.random() * spread * 2;
  return Math.max(0, Math.round(jittered));
}

/**
 * 重试的可观测日志：只输出 run id、第几次、错误类别、错误类型名、退避时长。
 * 刻意不输出错误 message / 堆栈 / 请求体 / 凭证，避免日志成为泄漏渠道。
 */
function logRetryAttempt(info: StreamRetryAttempt): void {
  console.warn(
    `[stream-adapter] retrying run ${info.runId} attempt ${info.attempt}/${info.maxRetries} after ${info.errorCode} (error=${info.errorType}, backoff=${info.delayMs}ms)`,
  );
}

function parseApprovalRequired(message: string): Record<string, unknown> | null {
  const prefix = "GENERATION_CONFIRMATION_REQUIRED:";
  if (!message.startsWith(prefix)) return null;
  try {
    const request = JSON.parse(message.slice(prefix.length)) as Record<string, unknown>;
    if (typeof request.approvalId !== "string") return null;
    return { status: "confirmation_required", ...request };
  } catch {
    return null;
  }
}

function canceledEvent(runId: string, now: () => string): StreamEvent {
  return {
    runId,
    timestamp: now(),
    type: "run.canceled",
  };
}

/**
 * LangChain sub-agent tools return a Command object whose real payload
 * lives inside update.messages[0].kwargs.content (a JSON string).
 * Unwrap it so extractArtifacts can find url/placement at the top level.
 */
function unwrapCommandOutput(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (record.lg_name !== "Command") return record;
  try {
    const messages = (record.update as any)?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return record;
    const content = messages[0]?.kwargs?.content ?? messages[0]?.content;
    if (typeof content !== "string") return record;
    const inner = JSON.parse(content);
    if (inner && typeof inner === "object") return inner as Record<string, unknown>;
  } catch {
    // fall through
  }
  return record;
}

const ARTIFACT_KEYS = new Set([
  "url",
  "imageUrl",
  "screenshotUrl",
  "videoUrl",
  "durationSeconds",
  "mimeType",
  "width",
  "height",
  "placement",
]);
const OUTPUT_SIZE_LIMIT = 10240; // 10KB

function extractOutput(
  output: unknown,
  hasArtifacts: boolean,
): Record<string, unknown> | undefined {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const direct = output as Record<string, unknown>;
    if (direct.status === "confirmation_required" && typeof direct.approvalId === "string") {
      return { ...direct };
    }
  }

  let text = "";
  if (ToolMessageClass.isInstance(output)) {
    text = extractChunkText(output);
  } else if (typeof output === "string") {
    text = output;
  } else if (output && typeof output === "object") {
    text = JSON.stringify(output);
  }

  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;

  const unwrapped = unwrapCommandOutput(parsed as Record<string, unknown>);

  // Strip artifact keys if artifacts were extracted
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(unwrapped)) {
    if (hasArtifacts && ARTIFACT_KEYS.has(key)) continue;
    result[key] = value;
  }

  // Skip if empty after stripping
  if (Object.keys(result).length === 0) return undefined;

  // Size limit check
  const serialized = JSON.stringify(result);
  if (serialized.length > OUTPUT_SIZE_LIMIT) return undefined;

  return result;
}

function extractArtifacts(output: unknown): ToolArtifact[] | undefined {
  let text = "";
  if (ToolMessageClass.isInstance(output)) {
    text = extractChunkText(output);
  } else if (typeof output === "string") {
    text = output;
  } else if (output && typeof output === "object") {
    text = JSON.stringify(output);
  }

  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object") return undefined;

  // If this is a LangChain Command object (from sub-agent), dig into
  // update.messages[0].kwargs.content to find the real structured response.
  const unwrapped = unwrapCommandOutput(parsed as Record<string, unknown>);

  const artifacts: ToolArtifact[] = [];
  const record = unwrapped;

  // New format: sub-agent structured response with url + placement
  if (typeof record.url === "string" && record.url.length > 0) {
    const candidate: Record<string, unknown> = {
      type: "image" as const,
      url: record.url,
      mimeType: (record.mimeType as string) ?? "image/png",
      width: (record.placement as any)?.width ?? 512,
      height: (record.placement as any)?.height ?? 512,
    };
    if (typeof record.title === "string" && record.title.length > 0) {
      candidate.title = record.title;
    }
    if (record.placement && typeof record.placement === "object") {
      candidate.placement = record.placement;
    }
    const result = imageArtifactSchema.safeParse(candidate);
    if (result.success) {
      artifacts.push(result.data);
    }
  }

  // Legacy format: direct tool response with imageUrl
  if (artifacts.length === 0 && typeof record.imageUrl === "string") {
    const candidate: Record<string, unknown> = {
      type: "image" as const,
      url: record.imageUrl,
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
    };
    if (typeof record.title === "string" && record.title.length > 0) {
      candidate.title = record.title;
    }
    if (record.placement && typeof record.placement === "object") {
      candidate.placement = record.placement;
    }
    const result = imageArtifactSchema.safeParse(candidate);
    if (result.success) {
      artifacts.push(result.data);
    }
  }

  // Screenshot format: tool response with screenshotUrl
  if (artifacts.length === 0 && typeof record.screenshotUrl === "string") {
    const candidate: Record<string, unknown> = {
      type: "image" as const,
      url: record.screenshotUrl,
      mimeType: "image/png",
      width: typeof record.width === "number" ? record.width : 1024,
      height: typeof record.height === "number" ? record.height : 1024,
    };
    const result = imageArtifactSchema.safeParse(candidate);
    if (result.success) {
      artifacts.push(result.data);
    }
  }

  // Video format: tool response with videoUrl from generate_video
  if (typeof record.videoUrl === "string" && record.videoUrl.length > 0) {
    const candidate: Record<string, unknown> = {
      type: "video" as const,
      url: record.videoUrl,
      mimeType: (record.mimeType as string) ?? "video/mp4",
      width: typeof record.width === "number" ? record.width : 1280,
      height: typeof record.height === "number" ? record.height : 720,
    };
    if (typeof record.durationSeconds === "number") {
      candidate.durationSeconds = record.durationSeconds;
    }
    // Prefer LLM-authored title, then original prompt, then technical summary
    if (typeof record.title === "string" && record.title.length > 0) {
      candidate.title = record.title.slice(0, 120);
    } else if (typeof record.prompt === "string") {
      candidate.title = record.prompt.slice(0, 200);
    } else if (typeof record.summary === "string") {
      candidate.title = record.summary.slice(0, 100);
    }
    if (record.placement && typeof record.placement === "object") {
      candidate.placement = record.placement;
    }
    const result = videoArtifactSchema.safeParse(candidate);
    if (result.success) {
      artifacts.push(result.data);
    }
  }

  return artifacts.length > 0 ? artifacts : undefined;
}

/**
 * Extract text from a chat model stream chunk.
 */
function extractChunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";

  // AIMessageChunk / AIMessage with string content
  if ("content" in chunk) {
    const content = (chunk as { content: unknown }).content;
    if (typeof content === "string") return content;

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            return part.text;
          }
          return "";
        })
        .join("");
    }
  }

  return "";
}

function extractReasoningText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";

  const record = chunk as Record<string, unknown>;
  const additional = record.additional_kwargs;
  const responseMetadata = record.response_metadata;
  const candidates = [
    record.reasoning_content,
    record.reasoning,
    additional && typeof additional === "object"
      ? (additional as Record<string, unknown>).reasoning_content
      : undefined,
    additional && typeof additional === "object"
      ? (additional as Record<string, unknown>).reasoning
      : undefined,
    responseMetadata && typeof responseMetadata === "object"
      ? (responseMetadata as Record<string, unknown>).reasoning_content
      : undefined,
  ];

  return candidates.find((value): value is string => typeof value === "string") ?? "";
}

function summarizeOutput(output: unknown): string | undefined {
  if (ToolMessageClass.isInstance(output)) {
    const textContent = extractChunkText(output);
    const parsed = tryParseJson(textContent);
    if (
      parsed &&
      typeof parsed === "object" &&
      "summary" in parsed &&
      typeof parsed.summary === "string"
    ) {
      return parsed.summary;
    }
    return textContent || undefined;
  }

  if (output && typeof output === "object") {
    const serialized = JSON.stringify(output);
    const parsed = tryParseJson(serialized);
    if (
      parsed &&
      typeof parsed === "object" &&
      "summary" in parsed &&
      typeof parsed.summary === "string"
    ) {
      return parsed.summary;
    }
    return serialized.length > 200
      ? `${serialized.slice(0, 197)}...`
      : serialized;
  }

  if (typeof output === "string") return output || undefined;
  return undefined;
}

function tryParseJson(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "This operation was aborted")
  );
}

function isStreamEvent(value: unknown): value is LangChainStreamEvent {
  return (
    value !== null &&
    typeof value === "object" &&
    "event" in value &&
    typeof (value as { event: unknown }).event === "string"
  );
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
