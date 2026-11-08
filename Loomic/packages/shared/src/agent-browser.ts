import { z } from "zod";

export const agentBrowserCursorSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  visible: z.boolean(),
  kind: z.enum([
    "navigate",
    "read",
    "click",
    "type",
    "scroll",
    "capture",
    "waiting",
  ]),
  label: z.string().max(120),
});
export const agentBrowserSessionSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  engine: z.enum(["chromix", "chromium"]),
  name: z.string().max(160),
  url: z.string().max(2048),
  title: z.string().max(200),
  state: z.enum([
    "starting",
    "running",
    "paused",
    "completed",
    "failed",
    "interrupted",
  ]),
  control: z.enum(["agent", "paused"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRevision: z.number().int().nonnegative(),
  cursor: agentBrowserCursorSchema.nullable(),
  detail: z.string().max(500),
  handoff:z.boolean().optional(),
  updatedAt: z.string(),
  expiresAt: z.string(),
});
export const agentBrowserSessionsSchema = z.object({
  enabled: z.boolean(),
  sessions: z.array(agentBrowserSessionSchema),
});
export const agentBrowserControlSchema = z
  .object({
    control: z.enum(["agent", "paused"]),
  })
  .strict();
export type AgentBrowserCursor = z.infer<typeof agentBrowserCursorSchema>;
export type AgentBrowserSession = z.infer<typeof agentBrowserSessionSchema>;
