import { z } from "zod";

export const desktopMcpToolSchema = z.object({
  serverId: z.string().uuid(),
  serverName: z.string().min(1).max(80),
  name: z.string().min(1).max(128),
  description: z.string().max(2_000).optional(),
  inputSchema: z.record(z.unknown()),
});

export const desktopMcpToolCatalogSchema = z
  .object({
    type: z.literal("desktop.mcp.tools"),
    connectionId: z.string().uuid(),
    tools: z.array(desktopMcpToolSchema).max(128),
  })
  .strict();

export const desktopMcpToolCallSchema = z
  .object({
    type: z.literal("desktop.mcp.call"),
    requestId: z.string().uuid(),
    connectionId: z.string().uuid(),
    serverId: z.string().uuid(),
    toolName: z.string().min(1).max(128),
    arguments: z.record(z.unknown()),
  })
  .strict();

export const desktopMcpToolResultSchema = z
  .object({
    type: z.literal("desktop.mcp.result"),
    requestId: z.string().uuid(),
    connectionId: z.string().uuid(),
    ok: z.boolean(),
    result: z.string().max(128_000).optional(),
    error: z.string().max(2_000).optional(),
  })
  .strict();

export type DesktopMcpTool = z.infer<typeof desktopMcpToolSchema>;
export type DesktopMcpToolCatalog = z.infer<typeof desktopMcpToolCatalogSchema>;
export type DesktopMcpToolCall = z.infer<typeof desktopMcpToolCallSchema>;
export type DesktopMcpToolResult = z.infer<typeof desktopMcpToolResultSchema>;
