import type { GenerationApprovalCardProps } from "../components/chat/generation-approval-card";

export type CreationApproval = GenerationApprovalCardProps & { approvalId: string };

export function parseCreationApproval(details: Record<string, unknown> | undefined): CreationApproval {
  if (!details || typeof details.approvalId !== "string" || !details.approvalId
    || !["image_generation", "video_generation"].includes(String(details.jobType))
    || typeof details.model !== "string" || typeof details.estimatedCredits !== "number"
    || !Number.isFinite(details.estimatedCredits) || details.estimatedCredits < 0
    || typeof details.expiresAt !== "string" || !Number.isFinite(Date.parse(details.expiresAt))) {
    throw new Error("费用确认信息不完整，请重新获取报价。");
  }
  return {
    approvalId: details.approvalId, jobType: details.jobType as CreationApproval["jobType"],
    model: details.model, estimatedCredits: details.estimatedCredits, expiresAt: details.expiresAt,
    hasReferenceImage: details.hasReferenceImage === true,
    ...(typeof details.duration === "number" ? { duration: details.duration } : {}),
    ...(typeof details.resolution === "string" ? { resolution: details.resolution } : {}),
  };
}
