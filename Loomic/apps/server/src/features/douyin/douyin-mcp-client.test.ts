import { describe, expect, it, vi } from "vitest";
import { DouyinMcpClient } from "./douyin-mcp-client.js";

describe("DouyinMcpClient", () => {
  it("initializes over SSE, lists tools, and calls a tool", async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { id?: number; method?: string };
        const result = body.method === "tools/list"
          ? { tools: [{ name: "/api/douyin/v1/schema/get_share", description: "share link" }] }
          : body.method === "tools/call"
            ? { content: [{ type: "text", text: "https://v.douyin.com/example" }] }
            : {};
        queueMicrotask(() => streamController?.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`)));
        return new Response(null, { status: 202 });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(encoder.encode("event: endpoint\ndata: /messages?session=test\n\n"));
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    const client = new DouyinMcpClient({ serverUrl: "https://open.douyin.com/sse", token: "client-token", toolGroupAid: "tool-1", fetchImpl, timeoutMs: 500 });

    await expect(client.listTools()).resolves.toEqual({ tools: [{ name: "/api/douyin/v1/schema/get_share", description: "share link" }] });
    await expect(client.callTool("/api/douyin/v1/schema/get_share", { url: "https://studio.0st.top" })).resolves.toEqual({ content: [{ type: "text", text: "https://v.douyin.com/example" }] });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("token=client-token");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("tool_group_aid=tool-1");
    client.close();
  });
});
