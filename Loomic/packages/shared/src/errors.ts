import { z } from "zod";

export const errorCodeValues = [
  "invalid_request",
  "run_not_found",
  "run_conflict",
  "run_failed",
  "tool_failed",
] as const;

export const errorCodeSchema = z.enum(errorCodeValues);

export const helsteraErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type HelsteraErrorCode = z.infer<typeof errorCodeSchema>;
export type HelsteraError = z.infer<typeof helsteraErrorSchema>;
