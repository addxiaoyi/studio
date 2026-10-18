import { describe, expect, it, vi } from "vitest";

import {
  buildFeedRenderPlan,
  collectFeedReferenceAssetIds,
  configureFeedRenderQueue,
  enqueueFeedRenderJobs,
  resolveFeedInputImages,
  isFeedRenderPayload,
} from "./feed-render.js";

describe("feed render jobs", () => {
  it("builds one idempotent image job and one video job", () => {
    const plan = buildFeedRenderPlan({
      id: "pkg-1",
      workspace_id: "workspace-1",
      created_by: "user-1",
      status: "approved",
      structure: {
        imagePrompt: "商品首帧",
        videoPrompt: "商品视频",
        referenceImageUrls: ["/api/uploads/asset-1/file"],
      },
      model_id: "model-1",
      duration_seconds: 15,
    });

    expect(plan).toHaveLength(2);
    expect(plan.map((step) => step.artifactType)).toEqual(["feed_image", "feed_video"]);
    expect(plan[0]!.payload).toMatchObject({
      feed_package_id: "pkg-1",
      feed_artifact_type: "feed_image",
      input_images: ["/api/uploads/asset-1/file"],
    });
    expect(plan[1]!.payload).toMatchObject({
      feed_package_id: "pkg-1",
      feed_artifact_type: "feed_video",
      duration: 15,
    });
  });

  it("only accepts complete feed render payloads", () => {
    expect(isFeedRenderPayload({
      feed_package_id: "pkg-1",
      feed_workspace_id: "workspace-1",
      feed_artifact_type: "feed_image",
    })).toBe(true);
    expect(isFeedRenderPayload({
      feed_package_id: "pkg-1",
      feed_artifact_type: "feed_image",
    })).toBe(false);
  });

  it("collects explicit asset ids and legacy upload urls without duplicates", () => {
    const assetId = "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7";
    expect(collectFeedReferenceAssetIds({
      referenceAssetIds: [assetId],
      referenceImageUrls: [`/api/uploads/${assetId}/file`],
    })).toEqual([assetId]);
  });

  it("resolves local asset ids to data URIs after workspace validation", async () => {
    const assetId = "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7";
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const ctx = {
      localDb: {
        query: vi.fn().mockResolvedValue({ rows: [{ id: assetId, bucket: "project-assets", object_path: "workspace/reference.png", mime_type: "image/png" }] }),
      },
      storage: { download: vi.fn().mockResolvedValue({ data: png, error: null }) },
    };

    const [resolved] = await resolveFeedInputImages(ctx as never, [assetId], [], "workspace-1");

    expect(resolved).toMatch(/^data:image\/jpeg;base64,/);
    expect(ctx.localDb.query).toHaveBeenCalledWith(expect.stringContaining("workspace_id=$1"), ["workspace-1", [assetId]]);
  });

  it("does not append a legacy inline duplicate when an asset ID is present", async () => {
    const assetId = "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7";
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const ctx = {
      localDb: {
        query: vi.fn().mockResolvedValue({ rows: [{ id: assetId, bucket: "project-assets", object_path: "workspace/reference.png", mime_type: "image/png" }] }),
      },
      storage: { download: vi.fn().mockResolvedValue({ data: png, error: null }) },
    };

    const resolved = await resolveFeedInputImages(
      ctx as never,
      [assetId],
      ["data:image/png;base64,Zmlyc3QtZnJhbWU="],
      "workspace-1",
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("uses a signed HTTP URL for local assets when a provider requires URL input", async () => {
    const assetId = "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7";
    vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const ctx = {
      env: { webOrigin: "https://studio.example" },
      localDb: { query: vi.fn().mockResolvedValue({ rows: [{ id: assetId, bucket: "project-assets", object_path: "workspace/reference.png", mime_type: "image/png" }] }) },
      storage: { download: vi.fn() },
    };

    const [url] = await resolveFeedInputImages(ctx as never, [assetId], [], "workspace-1", { localAssetFormat: "signed_url" });

    expect(url).toMatch(/^https:\/\/studio\.example\/api\/provider-assets\//);
    expect(url).not.toContain("base64");
    expect(ctx.storage.download).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("can resolve local asset ids to a short-lived HTTP URL for URL-only video providers", async () => {
    const assetId = "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7";
    vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const ctx = {
      env: { webOrigin: "https://studio.example" },
      localDb: {
        query: vi.fn().mockResolvedValue({ rows: [{ id: assetId, bucket: "project-assets", object_path: "workspace/reference.png", mime_type: "image/png" }] }),
      },
      storage: { download: vi.fn() },
    };

    const [url] = await resolveFeedInputImages(ctx as never, [assetId], [], "workspace-1", { localAssetFormat: "signed_url" });

    expect(url).toMatch(/^https:\/\/studio\.example\/api\/provider-assets\/3184dbec-d00b-4f1a-a8dc-4f63f4262ab7\?/);
    expect(url).not.toContain("base64");
    expect(ctx.storage.download).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("prefers asset URLs and drops duplicate inline copies for URL-only providers", async () => {
    const assetId = "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7";
    vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const ctx = {
      env: { webOrigin: "https://studio.example" },
      localDb: {
        query: vi.fn().mockResolvedValue({ rows: [{ id: assetId, bucket: "project-assets", object_path: "workspace/reference.png", mime_type: "image/png" }] }),
      },
      storage: { download: vi.fn() },
    };

    const resolved = await resolveFeedInputImages(
      ctx as never,
      [assetId],
      ["data:image/png;base64,Zmlyc3QtZnJhbWU=", `/api/uploads/${assetId}/file`],
      "workspace-1",
      { localAssetFormat: "signed_url" },
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatch(/^https:\/\/studio\.example\/api\/provider-assets\//);
    expect(resolved.join(" ")).not.toContain("data:");
    vi.unstubAllEnvs();
  });

  it("fails before provider submission when a URL-only request has only inline images", async () => {
    const ctx = {
      localDb: { query: vi.fn() },
      storage: { download: vi.fn() },
    };

    await expect(resolveFeedInputImages(
      ctx as never,
      [],
      ["data:image/png;base64,Zmlyc3QtZnJhbWU="],
      "workspace-1",
      { localAssetFormat: "signed_url" },
    )).rejects.toThrow("public URLs or asset IDs");
  });

  it("resolves Supabase asset ids to signed URLs and rejects assets outside the workspace", async () => {
    const assetId = "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7";
    const ctx = {
      getAdminClient: () => ({ from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ id: assetId, bucket: "project-assets", object_path: "workspace/reference.png", mime_type: "image/png" }], error: null }),
          }),
        }),
      }) }),
      storage: { getPublicUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.example/reference.png" }, error: null }) },
    };

    await expect(resolveFeedInputImages(ctx as never, [assetId], [], "workspace-1"))
      .resolves.toEqual(["https://storage.example/reference.png"]);

    const missingCtx = {
      getAdminClient: () => ({ from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }),
      }) }),
      storage: ctx.storage,
    };
    await expect(resolveFeedInputImages(missingCtx as never, [assetId], [], "workspace-2"))
      .rejects.toThrow("不存在或不属于当前工作区");
  });

  it("enqueues new feed jobs through PGMQ in the same transaction", async () => {
    configureFeedRenderQueue("pgmq");
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: "pkg-1",
        workspace_id: "workspace-1",
        created_by: "user-1",
        status: "approved",
        structure: { imagePrompt: "首帧", videoPrompt: "视频" },
        model_id: "model-1",
        duration_seconds: 15,
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "job-image", job_type: "image_generation", status: "queued", payload: {} }] })
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [{ msg_id: "101" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "job-video", job_type: "video_generation", status: "queued", payload: {} }] })
      .mockResolvedValueOnce({ rows: [{ msg_id: "102" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query, release: vi.fn() };
    const db = { connect: vi.fn().mockResolvedValue(client) };

    const result = await enqueueFeedRenderJobs(db as never, "pkg-1", "workspace-1", "user-1");

    expect(result.jobs.map((job) => job.id)).toEqual(["job-image", "job-video"]);
    const sendCalls = query.mock.calls.filter(([sql]) => String(sql).includes("select pgmq.send("));
    expect(sendCalls).toHaveLength(2);
    expect(JSON.parse(sendCalls[0]![1][1])).toMatchObject({ job_id: "job-image", job_type: "image_generation" });
    expect(JSON.parse(sendCalls[1]![1][1])).toMatchObject({ job_id: "job-video", job_type: "video_generation" });
    expect(query.mock.calls.at(-1)?.[0]).toBe("commit");
    expect(client.release).toHaveBeenCalledOnce();
    configureFeedRenderQueue("auto");
  });

  it("rolls back the database insert when PGMQ is unavailable in production mode", async () => {
    configureFeedRenderQueue("pgmq");
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: "pkg-1",
        workspace_id: "workspace-1",
        created_by: "user-1",
        status: "approved",
        structure: { imagePrompt: "首帧", videoPrompt: "视频" },
        model_id: null,
        duration_seconds: 15,
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "job-image", job_type: "image_generation", status: "queued", payload: {} }] })
      .mockResolvedValueOnce({ rows: [{ available: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query, release: vi.fn() };
    const db = { connect: vi.fn().mockResolvedValue(client) };

    await expect(enqueueFeedRenderJobs(db as never, "pkg-1", "workspace-1", "user-1"))
      .rejects.toThrow("生产队列未配置 PGMQ");

    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
    configureFeedRenderQueue("auto");
  });
});
