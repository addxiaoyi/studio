type ApprovalToolBlock = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
};

type ApprovalMessage = {
  contentBlocks: readonly ApprovalToolBlock[];
};

export function uniqueGenerationApprovals(messages: readonly ApprovalMessage[]) {
  const visibleIds = new Set<string>();
  const hiddenToolCallIds = new Set<string>();
  const visibleJobIds = new Set<string>();
  const hiddenJobToolCallIds = new Set<string>();

  for (const message of messages) {
    for (const block of message.contentBlocks) {
      if (block.type !== "tool" || !block.toolCallId) continue;
      const output = block.output && typeof block.output === "object" ? block.output as Record<string, unknown> : {};
      const input = block.input && typeof block.input === "object" ? block.input as Record<string, unknown> : {};
      const approvalId = output.approvalId;
      if (typeof approvalId === "string" && approvalId.length > 0) {
        if (visibleIds.has(approvalId)) hiddenToolCallIds.add(block.toolCallId);
        else visibleIds.add(approvalId);
      }

      if (block.toolName !== "generate_image" && block.toolName !== "generate_video") continue;
      const jobId = [output.jobId, output.job_id, input.jobId, input.job_id]
        .find((value): value is string => typeof value === "string" && value.length > 0);
      if (!jobId) continue;
      if (visibleJobIds.has(jobId)) hiddenJobToolCallIds.add(block.toolCallId);
      else visibleJobIds.add(jobId);
    }
  }

  return { visibleIds, hiddenToolCallIds, hiddenJobToolCallIds };
}
