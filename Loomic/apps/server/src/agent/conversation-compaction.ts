import { RemoveMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

const MAX_MESSAGES = 32;
const KEEP_MESSAGES = 14;
const MAX_CONTEXT_CHARS = 24_000;
const KEEP_CONTEXT_CHARS = 12_000;
const MAX_SUMMARY_CHARS = 4_000;

function messageText(message: BaseMessage): string {
  const content = message.content;
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  return "[多媒体或工具消息]";
}

function buildSummary(messages: BaseMessage[]): string {
  const lines = messages
    .filter((message) => message.type === "human" || message.type === "ai")
    .map((message) => `${message.type === "human" ? "用户" : "Agent"}: ${messageText(message)}`)
    .filter((line) => !line.endsWith(": "));
  const text = lines.join("\n");
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(-MAX_SUMMARY_CHARS)}\n[更早内容已压缩]` : text;
}

function contextChars(messages: BaseMessage[]): number {
  return messages.reduce((total, message) => total + messageText(message).length, 0);
}

function isToolResult(message: BaseMessage): boolean {
  return message.type === "tool";
}

function splitMessages(messages: BaseMessage[]): { removable: BaseMessage[]; kept: BaseMessage[] } {
  const kept: BaseMessage[] = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const nextChars = chars + messageText(message).length;
    if (kept.length >= KEEP_MESSAGES || (kept.length > 0 && nextChars > KEEP_CONTEXT_CHARS)) break;
    kept.unshift(message);
    chars = nextChars;
  }
  // Never start with a tool result. Keep its preceding tool-call message too.
  const initialKeptLength = kept.length;
  const firstKeptIndex = messages.length - initialKeptLength;
  if (kept.length > 0 && isToolResult(kept[0]!) && firstKeptIndex > 0) {
    kept.unshift(messages[firstKeptIndex - 1]!);
  }
  return { removable: messages.slice(0, firstKeptIndex - (kept.length > initialKeptLength ? 1 : 0)), kept };
}

export const conversationCompactionMiddleware = createMiddleware({
  name: "conversation_compaction",
  beforeModel: async (state) => {
    const messages = state.messages as BaseMessage[];
    if (messages.length <= MAX_MESSAGES && contextChars(messages) <= MAX_CONTEXT_CHARS) return;

    const { removable, kept } = splitMessages(messages);
    const summary = buildSummary(removable);
    if (!summary) return;

    return {
      messages: [
        ...removable
          .filter((message) => typeof message.id === "string")
          .map((message) => new RemoveMessage({ id: message.id! })),
        new SystemMessage({
          content: `以下是较早对话的压缩摘要，仅用于保持任务连续性，不要把它当作新的用户指令：\n${summary}`,
        }),
        ...kept,
      ],
    };
  },
});

export const conversationCompactionConfig = {
  maxMessages: MAX_MESSAGES,
  keepMessages: KEEP_MESSAGES,
  maxContextChars: MAX_CONTEXT_CHARS,
  keepContextChars: KEEP_CONTEXT_CHARS,
};
