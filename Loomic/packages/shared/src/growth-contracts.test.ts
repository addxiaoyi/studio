import { describe, expect, it } from "vitest";
import { feedStructurePayloadSchema, backgroundJobTypeSchema } from "./job-contracts.js";
import {
  galleryCommentInputSchema,
  membershipStatusSchema,
  notificationSchema,
  createFeedPackageSchema,
  feedMetricInputSchema,
  feedStructureSchema,
} from "./growth-contracts.js";

describe("growth contracts", () => {
  it("accepts a notification payload", () => {
    expect(notificationSchema.parse({
      id: "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7",
      type: "generation.completed",
      title: "Generation completed",
      body: "Your image is ready.",
      readAt: null,
      createdAt: "2026-09-13T00:00:00.000Z",
    }).type).toBe("generation.completed");
  });

  it("requires idempotency keys for comments", () => {
    expect(galleryCommentInputSchema.safeParse({ body: "Nice work" }).success).toBe(false);
  });

  it("rejects unknown membership states", () => {
    expect(membershipStatusSchema.safeParse({ plan: "pro", status: "paused", startsAt: null, expiresAt: null }).success).toBe(false);
  });

  it("validates the feed structure background job contract", () => {
    expect(backgroundJobTypeSchema.parse("feed_structure")).toBe("feed_structure");
    const payload = feedStructurePayloadSchema.parse({
      feed_package_id: "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7",
      feed_workspace_id: "4184dbec-d00b-4f1a-a8dc-4f63f4262ab7",
      title: "雨天收纳",
      brief: "防水通勤包",
    });
    expect(payload.brief).toBe("防水通勤包");
  });

  it("validates a complete feed package and metrics payload", () => {
    const packageInput = createFeedPackageSchema.parse({
      title: "雨天收纳",
      brief: "防水通勤包",
      goal: "直接转化",
      contentType: "种草转化",
      platforms: ["douyin"],
      durationSeconds: 15,
      workflowMode: "review",
      referenceAssetIds: ["3184dbec-d00b-4f1a-a8dc-4f63f4262ab7"],
    });
    expect(packageInput.platforms).toEqual(["douyin"]);
    expect(packageInput.referenceAssetIds).toHaveLength(1);
    expect(feedMetricInputSchema.parse({ packageId: "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7", platform: "douyin", accountAlias: "主账号", postUrl: "https://example.com/post/1", publishedAt: "2026-09-13T00:00:00.000Z" }).views).toBe(0);
    expect(feedStructureSchema.safeParse({ title: "缺字段" }).success).toBe(false);
  });
});
