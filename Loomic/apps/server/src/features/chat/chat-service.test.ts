import { describe, expect, it, vi } from "vitest";

import type { DataClient } from "../../auth/types.js";
import { createChatService } from "./chat-service.js";

const user = {
  accessToken: "token",
  email: "user@example.com",
  id: "user-1",
  userMetadata: {},
};

type InsertResult = {
  data: Record<string, unknown> | null;
  error: { message: string; code?: string } | null;
};

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-1",
    role: "user",
    content: "hello",
    tool_activities: null,
    content_blocks: null,
    created_at: "2026-10-28T00:00:00.000Z",
    ...overrides,
  };
}

function createFakeClient(options: {
  insertResult: InsertResult;
  replayRow?: Record<string, unknown> | null;
}) {
  const state = {
    inserted: [] as Record<string, unknown>[],
    replayFilters: [] as Array<[string, unknown]>,
    touched: 0,
  };

  const client: any = {
    from(table: string) {
      if (table === "chat_messages") {
        return {
          insert(values: Record<string, unknown>) {
            state.inserted.push(values);
            const builder: any = {
              select: () => builder,
              single: async () => options.insertResult,
            };
            return builder;
          },
          select() {
            const builder: any = {
              eq(column: string, value: unknown) {
                state.replayFilters.push([column, value]);
                return builder;
              },
              maybeSingle: async () => ({
                data: options.replayRow ?? null,
                error: null,
              }),
            };
            return builder;
          },
        };
      }

      // chat_sessions touch is awaited directly after `.eq(...)`.
      const touch: any = {
        update() {
          state.touched += 1;
          return touch;
        },
        eq: () => touch,
        then(onFulfilled: any, onRejected: any) {
          return Promise.resolve({ data: null, error: null }).then(
            onFulfilled,
            onRejected,
          );
        },
      };
      return touch;
    },
    rpc: vi.fn(),
    auth: {},
    storage: {},
  };

  return { client: client as DataClient, state };
}

function createService(client: DataClient) {
  return createChatService({
    createUserClient: () => client,
    threadService: { createThreadId: () => "thread-1" },
  });
}

describe("createChatService.createMessage idempotency", () => {
  it("inserts a new message and returns it", async () => {
    const { client, state } = createFakeClient({
      insertResult: { data: messageRow(), error: null },
    });
    const service = createService(client);

    const message = await service.createMessage(user, "session-1", {
      role: "user",
      content: "hello",
      clientMessageId: "client-1",
    });

    expect(message.id).toBe("message-1");
    expect(message.contentBlocks).toEqual([{ type: "text", text: "hello" }]);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]?.client_message_id).toBe("client-1");
    expect(state.touched).toBe(1);
  });

  it("returns the existing message when a retry hits a unique violation", async () => {
    const { client, state } = createFakeClient({
      insertResult: {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "chat_messages_session_client_message_idx"',
        },
      },
      replayRow: messageRow({ id: "existing-message" }),
    });
    const service = createService(client);

    const message = await service.createMessage(user, "session-1", {
      role: "user",
      content: "hello",
      clientMessageId: "client-1",
    });

    expect(message.id).toBe("existing-message");
    expect(state.replayFilters).toEqual([
      ["session_id", "session-1"],
      ["client_message_id", "client-1"],
    ]);
    // A replayed message must not re-touch the session timestamp.
    expect(state.touched).toBe(0);
  });

  it("inserts normally for a different clientMessageId", async () => {
    const { client, state } = createFakeClient({
      insertResult: { data: messageRow({ id: "message-2" }), error: null },
    });
    const service = createService(client);

    const message = await service.createMessage(user, "session-1", {
      role: "user",
      content: "second",
      clientMessageId: "client-2",
    });

    expect(message.id).toBe("message-2");
    expect(state.inserted[0]?.client_message_id).toBe("client-2");
  });
});
