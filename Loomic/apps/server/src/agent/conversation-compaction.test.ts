import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { conversationCompactionConfig, conversationCompactionMiddleware } from "./conversation-compaction.js";

type CompactionResult = { messages: Array<{ type: string }> } | undefined;

describe("conversation compaction", () => {
  it("does not change short conversations", async () => {
    const messages = [new HumanMessage("hello"), new AIMessage("hi")];
    const result = await (conversationCompactionMiddleware.beforeModel as unknown as (state: unknown) => Promise<unknown>)({ messages });
    expect(result).toBeUndefined();
  });

  it("keeps recent messages and emits removal messages for long conversations", async () => {
    const messages = Array.from({ length: conversationCompactionConfig.maxMessages + 4 }, (_, index) => new HumanMessage({ id: `human-${index}`, content: `message ${index}` }));
    const result = await (conversationCompactionMiddleware.beforeModel as unknown as (state: unknown) => Promise<CompactionResult>)({ messages });
    expect(result?.messages).toBeDefined();
    expect(result!.messages.length).toBeGreaterThan(conversationCompactionConfig.keepMessages);
    expect(result!.messages.some((message: { type: string }) => message.type === "remove")).toBe(true);
    expect(result!.messages.some((message: { type: string }) => message.type === "system")).toBe(true);
  });

  it("compacts a few oversized messages by character budget", async () => {
    const messages = Array.from({ length: 4 }, (_, index) => new HumanMessage({ id: `long-${index}`, content: `${index}-${"x".repeat(8_000)}` }));
    const result = await (conversationCompactionMiddleware.beforeModel as unknown as (state: unknown) => Promise<CompactionResult>)({ messages });
    expect(result?.messages.some((message: { type: string }) => message.type === "remove")).toBe(true);
  });

  it("keeps a tool call paired with its result", async () => {
    const messages: Array<HumanMessage | AIMessage | ToolMessage> = Array.from({ length: 31 }, (_, index) => new HumanMessage({ id: `old-${index}`, content: `message ${index}` }));
    messages.push(new AIMessage({ id: "ai-call-1", content: "", tool_calls: [{ id: "call-1", name: "inspect_canvas", args: {} }] }));
    messages.push(new ToolMessage({ id: "tool-result-1", tool_call_id: "call-1", content: "canvas result" }));
    const result = await (conversationCompactionMiddleware.beforeModel as unknown as (state: unknown) => Promise<CompactionResult>)({ messages });
    const kept = result!.messages.filter((message: { type: string }) => message.type !== "remove" && message.type !== "system");
    expect(kept.some((message: { type: string }) => message.type === "ai")).toBe(true);
    expect(kept.some((message: { type: string }) => message.type === "tool")).toBe(true);
  });
});
