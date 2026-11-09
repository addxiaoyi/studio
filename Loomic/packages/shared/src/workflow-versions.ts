import { z } from "zod";
import { workflowGraphSchema } from "./canvas-workflow.js";
export const workflowVersionSchema = z.object({
  revision: z.number().int().positive(),
  graph: workflowGraphSchema,
  restoredFrom: z.number().int().positive().nullable(),
  createdAt: z.string(),
});
export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;
