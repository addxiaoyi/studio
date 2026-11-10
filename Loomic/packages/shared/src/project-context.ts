import { z } from "zod";

export const projectViewSchema = z.enum(["canvas", "workflow", "timeline", "video", "conversation"]);
export const projectContextQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  canvasId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
}).strict();
export const projectContextUpdateSchema = z.object({
  projectId: z.string().uuid(),
  canvasId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  view: projectViewSchema,
  compositionId: z.string().trim().min(1).max(200).nullable(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export const projectContextSchema = z.object({
  project: z.object({ id: z.string().uuid(), name: z.string(), workspaceId: z.string().uuid() }),
  canvas: z.object({ id: z.string().uuid(), name: z.string() }),
  session: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  view: projectViewSchema,
  compositionId: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type ProjectView = z.infer<typeof projectViewSchema>;
export type ProjectContext = z.infer<typeof projectContextSchema>;
export type ProjectContextQuery = z.infer<typeof projectContextQuerySchema>;
export type ProjectContextUpdate = z.infer<typeof projectContextUpdateSchema>;

export function projectViewHref(context: ProjectContext, view: ProjectView, desktop = false) {
  const query: Record<string, string> = { projectId: context.project.id, canvasId: context.canvas.id };
  if (context.session) query.session = context.session.id;
  const search = () => Object.entries(query).map(([key,value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  if (view === "video") {
    if (context.compositionId) query.composition = context.compositionId;
    const identity = `projectId=${context.project.id}&canvasId=${context.canvas.id}`;
    return `/video/?${search()}#${identity}`;
  }
  query.id = context.canvas.id;
  query.view = view;
  return `${desktop ? "/desktop-app" : ""}/canvas/?${search()}`;
}
