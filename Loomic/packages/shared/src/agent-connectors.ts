import { z } from "zod";

export const agentConnectorKindSchema = z.enum([
  "canvas",
  "local_files",
  "browser",
  "desktop",
  "mcp",
  "skill",
  "plugin",
  "media",
]);

export const agentConnectorStatusSchema = z.enum([
  "available",
  "connected",
  "needs_permission",
  "disconnected",
  "blocked",
]);

export const agentConnectorSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  description: z.string().max(1_000),
  kind: agentConnectorKindSchema,
  capabilities: z.array(z.string().min(1).max(120)).max(32),
  permissions: z.array(z.string().min(1).max(120)).max(32),
  status: agentConnectorStatusSchema,
  supportsBackground: z.boolean(),
  supportsDesktop: z.boolean(),
  requiresApproval: z.boolean(),
  enabled: z.boolean(),
});

export type AgentConnectorKind = z.infer<typeof agentConnectorKindSchema>;
export type AgentConnectorStatus = z.infer<typeof agentConnectorStatusSchema>;
export type AgentConnector = z.infer<typeof agentConnectorSchema>;
