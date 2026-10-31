import { z } from "zod";
import { agentGoalOutputKindSchema, desktopAgentExecutionModeSchema } from "@helstera/shared";

const preferenceValues: Record<string, { safeParse(value: unknown): { success: boolean } }> = {
  preferred_execution_mode: desktopAgentExecutionModeSchema,
  preferred_output_kind: agentGoalOutputKindSchema,
  preferred_locale: z.enum(["zh-CN", "en-US"]),
};

// Free-form memory edits can retain credentials. Add new structured preferences explicitly.
export function validateMemoryPreference(key: string, value: string): boolean {
  return preferenceValues[key]?.safeParse(value).success === true;
}
