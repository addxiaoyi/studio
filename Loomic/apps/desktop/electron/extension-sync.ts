import type { DesktopMarketplaceExtension } from "@helstera/shared";

export function mcpSyncChanges(previous: DesktopMarketplaceExtension[], current: DesktopMarketplaceExtension[]) {
  const after = new Map(current.map((extension) => [extension.itemId, extension]));
  const before = new Map(previous.map((extension) => [extension.itemId, extension]));
  const disconnect = previous.flatMap((extension) => {
    if (extension.kind !== "mcp" || !extension.localServerId) return [];
    const next = after.get(extension.itemId);
    return !next || !next.enabled || next.localServerId !== extension.localServerId ? [extension.localServerId] : [];
  });
  disconnect.push(...current.flatMap((extension) =>
    extension.kind === "mcp" && !extension.enabled && extension.localServerId ? [extension.localServerId] : [],
  ));
  const connect = current.flatMap((extension) => {
    const old = before.get(extension.itemId);
    return extension.kind === "mcp" && extension.enabled && extension.localServerId && old && !old.enabled
      ? [extension.localServerId]
      : [];
  });
  return { disconnect: [...new Set(disconnect)], connect: [...new Set(connect)] };
}

export function abortMcpServer(calls: ReadonlyMap<string, AbortController>, servers: ReadonlyMap<string, string>, serverId: string) {
  for (const [requestId, activeServer] of servers) {
    if (activeServer === serverId) calls.get(requestId)?.abort();
  }
}
