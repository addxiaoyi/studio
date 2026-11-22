import { z } from "zod";

export const workflowPreflightSchema = z
  .object({
    revision: z.number().int().positive(),
    ready: z.boolean(),
    issues: z
      .array(
        z
          .object({
            nodeId: z.string().nullable(),
            title: z.string(),
    code: z.enum(["structure", "material", "pin", "model", "price", "author"]),
            message: z.string(),
            action: z.string(),
          })
          .strict(),
      )
      .max(512),
    quotes: z
      .array(
        z
          .object({
            nodeId: z.string(),
            title: z.string(),
            model: z.string(),
            credits: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
export type WorkflowPreflight = z.infer<typeof workflowPreflightSchema>;
