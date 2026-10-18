import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerFeedOperationRoutes } from "./feed-operations.js";

const packageId = "11111111-1111-4111-8111-111111111111";

const structure = {
  title: "测试结构",
  audience: "通勤用户",
  painPoint: "收纳麻烦",
  angle: "用真实场景展示解决方案",
  hypothesis: "清晰展示使用过程更容易转化",
  hook: "三秒看懂解决方案",
  evidence: ["展示真实使用步骤"],
  cta: "点击了解详情",
  riskNotes: ["不虚构参数"],
  imagePrompt: "一张产品图",
  videoPrompt: "一段产品视频",
  shots: [{
    id: "shot-1",
    startSecond: 0,
    endSecond: 5,
    visual: "展示产品",
    voiceover: "介绍产品",
    subtitle: "解决收纳问题",
  }],
};

function buildApp(db: { query: ReturnType<typeof vi.fn> }) {
  const app = Fastify();
  registerFeedOperationRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) },
    db,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) },
  } as never);
  return app;
}

describe("feed workflow HTTP routes", () => {
  it("saves a validated structure draft without approving it", async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ status: "structured", structure }] })
        .mockResolvedValueOnce({ rows: [{ id: packageId, status: "structured", structure }] }),
    };
    const response = await buildApp(db).inject({
      method: "PATCH",
      url: `/api/feed/packages/${packageId}/draft`,
      payload: structure,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("structured");
    expect(db.query).toHaveBeenCalledTimes(2);
    const updateQuery = db.query.mock.calls[1]?.[0];
    expect(updateQuery).toContain("version=version+1");
  });

  it("returns per-job progress and failure details for polling", async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: packageId, status: "failed" }] })
        .mockResolvedValueOnce({ rows: [{ id: "job-1", job_type: "video_generation", status: "failed", error_code: "provider_timeout", error_message: "Provider timeout", progress: 42, stage: "provider_request", attempt_count: 2, max_attempts: 3 }] }),
    };
    const response = await buildApp(db).inject({ method: "GET", url: `/api/feed/packages/${packageId}/render-status` });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      packageId,
      status: "failed",
      jobs: [{ status: "failed", error_code: "provider_timeout", progress: 42 }],
    });
  });
});
