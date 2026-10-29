import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { ChatServiceError, toIsoTimestamp } from "../features/chat/chat-service.js";
import { createLocalChatService } from "./chat-service.js";

const user = { id: "user-1" } as any;

type QueryResult = { rows?: any[]; rowCount?: number };

function fakePool(handler: (sql: string, params: any[] | undefined) => QueryResult) {
  const calls: Array<{ sql: string; params: any[] | undefined }> = [];
  const pool = {
    query: async (sql: string, params?: any[]) => {
      calls.push({ sql, params });
      const result = handler(sql, params);
      return { rows: result.rows ?? [], rowCount: result.rowCount ?? (result.rows?.length ?? 0) };
    },
  } as unknown as Pool;
  return { pool, calls };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-1",
    role: "user",
    content: "hello",
    tool_activities: null,
    content_blocks: null,
    created_at: new Date("2026-10-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("chat message send time", () => {
  it("maps a stored timestamp to ISO so the bubble can show a send time", async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.startsWith("select 1 from chat_sessions")) return { rowCount: 1 };
      if (sql.includes("from chat_messages")) return { rows: [messageRow()] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = createLocalChatService(pool);

    const [message] = await service.listMessages(user, "session-1");

    expect(message?.createdAt).toBe("2026-10-28T00:00:00.000Z");
    // The timestamp has to be selected from the database, not synthesized: a
    // response without `created_at` would silently drop the send time.
    expect(String(calls[1]?.sql)).toContain("created_at");
  });

  it("accepts a string timestamp as well as a Date, so both adapters agree", async () => {
    const { pool } = fakePool((sql) => {
      if (sql.startsWith("select 1 from chat_sessions")) return { rowCount: 1 };
      if (sql.includes("from chat_messages")) {
        return { rows: [messageRow({ created_at: "2026-10-28T08:30:00.000+08:00" })] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = createLocalChatService(pool);

    const [message] = await service.listMessages(user, "session-1");

    expect(message?.createdAt).toBe("2026-10-28T00:30:00.000Z");
  });

  it("returns the stored timestamp when a new message is written", async () => {
    const { pool } = fakePool((sql) => {
      if (sql.startsWith("select 1 from chat_sessions")) return { rowCount: 1 };
      if (sql.startsWith("insert into chat_messages")) {
        return { rows: [messageRow({ id: "message-new", created_at: new Date("2026-10-29T04:05:06.000Z") })] };
      }
      if (sql.startsWith("update chat_sessions")) return { rowCount: 1 };
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = createLocalChatService(pool);

    const message = await service.createMessage(user, "session-1", {
      role: "user",
      content: "hello",
    });

    expect(message.createdAt).toBe("2026-10-29T04:05:06.000Z");
  });

  it("fails loudly instead of returning a message without a send time", async () => {
    const { pool } = fakePool((sql) => {
      if (sql.startsWith("select 1 from chat_sessions")) return { rowCount: 1 };
      if (sql.includes("from chat_messages")) {
        return { rows: [messageRow({ created_at: null })] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = createLocalChatService(pool);

    await expect(service.listMessages(user, "session-1")).rejects.toThrow(ChatServiceError);
    await expect(service.listMessages(user, "session-1")).rejects.toThrow(
      /missing created_at/,
    );
  });
});

describe("toIsoTimestamp", () => {
  it("normalizes Date, ISO string and offset string to the same instant", () => {
    expect(toIsoTimestamp(new Date("2026-10-28T00:00:00.000Z"))).toBe(
      "2026-10-28T00:00:00.000Z",
    );
    expect(toIsoTimestamp("2026-10-28T00:00:00.000Z")).toBe("2026-10-28T00:00:00.000Z");
    expect(toIsoTimestamp("2026-10-28T08:00:00.000+08:00")).toBe(
      "2026-10-28T00:00:00.000Z",
    );
  });

  it("throws a 500 chat error for unusable values", () => {
    for (const value of [undefined, null, "", "not-a-date"]) {
      let caught: unknown;
      try {
        toIsoTimestamp(value);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ChatServiceError);
      expect((caught as ChatServiceError).statusCode).toBe(500);
    }
  });
});
