import { expect, it, vi } from "vitest";
import { abortMcpServer, mcpSyncChanges } from "./extension-sync.js";

it("disconnects disabled or removed MCPs and reconnects explicitly enabled MCPs", () => {
  const extension = { itemId: "one", kind: "mcp", enabled: true, localServerId: "server-1" } as never;
  const disabled = { itemId: "one", kind: "mcp", enabled: false, localServerId: "server-1" } as never;
  expect(mcpSyncChanges([extension], [disabled])).toEqual({ disconnect: ["server-1"], connect: [] });
  expect(mcpSyncChanges([extension], [])).toEqual({ disconnect: ["server-1"], connect: [] });
  expect(mcpSyncChanges([disabled], [extension])).toEqual({ disconnect: [], connect: ["server-1"] });
});

it("aborts only the revoked server's in-flight calls", () => {
  const first = new AbortController();
  const second = new AbortController();
  const abort = vi.fn();
  first.signal.addEventListener("abort", abort);
  abortMcpServer(new Map([["a", first], ["b", second]]), new Map([["a", "server-1"], ["b", "server-2"]]), "server-1");
  expect(abort).toHaveBeenCalledOnce();
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
});
