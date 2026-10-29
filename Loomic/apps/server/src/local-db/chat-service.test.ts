import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT, createLocalChatService } from "./chat-service.js";

const user = { id: "user-1" } as any;

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

type QueryResult = { rows: any[]; rowCount: number };

function fakePool(handler: (sql: string, params: any[] | undefined) => QueryResult) {
  const calls: Array<{ sql: string; params: any[] | undefined }> = [];
  const pool = {
    query: async (sql: string, params?: any[]) => {
      calls.push({ sql, params });
      const result = handler(sql, params);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  } as unknown as Pool;
  return { pool, calls };
}

describe("local chat message idempotency", () => {
  it("returns the stored row and skips the insert when clientMessageId already exists", async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.startsWith("select 1 from chat_sessions")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (sql.startsWith("select") && sql.includes("client_message_id = $2")) {
        return { rows: [messageRow()], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = createLocalChatService(pool);

    const message = await service.createMessage(user, "session-1", {
      role: "user",
      content: "hello",
      clientMessageId: "client-1",
    });

    expect(message.id).toBe("message-1");
    expect(calls).toHaveLength(2);
    expect(calls.some((call) => call.sql.startsWith("insert into chat_messages"))).toBe(false);
    expect(calls[1]?.params).toEqual(["session-1", "client-1"]);
  });

  it("refetches the winning row when the insert returns no row", async () => {
    let inserted = false;
    const { pool, calls } = fakePool((sql) => {
      if (sql.startsWith("select 1 from chat_sessions")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (sql.startsWith("insert into chat_messages")) {
        inserted = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("select") && sql.includes("client_message_id = $2")) {
        return inserted
          ? { rows: [messageRow({ id: "raced-message" })], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("update chat_sessions")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = createLocalChatService(pool);

    const message = await service.createMessage(user, "session-1", {
      role: "user",
      content: "hello",
      clientMessageId: "client-1",
    });

    expect(message.id).toBe("raced-message");
    expect(inserted).toBe(true);
    expect(calls.some((call) => call.sql.startsWith("update chat_sessions"))).toBe(false);
  });

  it("folds consecutive identical messages the same way the remote adapter does", async () => {
    const { pool } = fakePool((sql) => {
      if (sql.startsWith("select 1 from chat_sessions")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (sql.startsWith("select") && sql.includes("from chat_messages")) {
        return {
          rows: [
            messageRow({ id: "message-1", role: "user", content: "same" }),
            messageRow({ id: "message-2", role: "user", content: "same" }),
            messageRow({ id: "message-3", role: "assistant", content: "" }),
            messageRow({ id: "message-4", role: "assistant", content: "" }),
          ],
          rowCount: 4,
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = createLocalChatService(pool);

    const messages = await service.listMessages(user, "session-1");

    expect(messages.map((message) => message.id)).toEqual(["message-1", "message-3"]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });
});

describe("local chat message pagination", () => {
  function pagedPool() {
    return fakePool((sql) => {
      if (sql.startsWith("select 1 from chat_sessions")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (sql.includes("from chat_messages")) {
        return {
          rows: [
            messageRow({ id: "m-3", role: "assistant" }),
            messageRow({ id: "m-2", role: "user" }),
            messageRow({ id: "m-1", role: "assistant" }),
          ],
          rowCount: 3,
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
  }

  function messageQuery(calls: Array<{ sql: string; params: any[] | undefined }>) {
    return calls.find((call) => call.sql.includes("from chat_messages"));
  }

  // The ChatService contract exposes two parameters; the local adapter accepts
  // an optional page window as a wider, still-compatible signature.
  function listPage(service: ReturnType<typeof createLocalChatService>) {
    return service.listMessages as unknown as (
      user: unknown,
      sessionId: string,
      options?: { limit?: number },
    ) => Promise<unknown>;
  }

  it("only loads the newest window of a long session and keeps chronological order", async () => {
    const { pool, calls } = pagedPool();
    const service = createLocalChatService(pool);

    const messages = await service.listMessages(user, "session-1");

    expect(messages.map((message) => message.id)).toEqual(["m-3", "m-2", "m-1"]);
    const query = messageQuery(calls);
    expect(query?.sql).toContain("order by created_at desc");
    expect(query?.sql).toContain("limit $2");
    expect(query?.params).toEqual(["session-1", DEFAULT_MESSAGE_LIMIT]);
  });

  it("honours an explicit page size and clamps it to the hard maximum", async () => {
    const { pool, calls } = pagedPool();
    const service = createLocalChatService(pool);
    const listWithPage = listPage(service);

    await listWithPage(user, "session-1", { limit: 25 });
    expect(messageQuery(calls)?.params).toEqual(["session-1", 25]);

    calls.length = 0;
    await listWithPage(user, "session-1", { limit: 100_000 });
    expect(messageQuery(calls)?.params).toEqual(["session-1", MAX_MESSAGE_LIMIT]);

    calls.length = 0;
    await listWithPage(user, "session-1", { limit: 0 });
    expect(messageQuery(calls)?.params).toEqual(["session-1", 1]);
  });
});
