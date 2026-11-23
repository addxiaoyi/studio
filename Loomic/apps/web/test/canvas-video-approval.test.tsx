// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ generate: vi.fn(), update: vi.fn(), confirm: vi.fn(), job: vi.fn(), close: vi.fn(), scene: vi.fn(), upload: vi.fn() }));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "token" } }) }));
vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...await importOriginal<object>(),
  fetchVideoModels: async () => ({ models: [{ id: "hailuo-h3", displayName: "Hailuo H3", billingUnit: "per_second", creditCost: 0.432, providerPriceCny: 0.432, limits: { maxDuration: 30, allowedDurations: [4, 5], maxResolution: "1080p" } }] }),
  generateVideoDirect: api.generate, confirmGenerationApproval: api.confirm,
  uploadFile: api.upload,
  fetchGenerationApprovalStatus: async () => ({ approvalStatus: "pending" }), fetchJob: api.job,
}));
vi.mock("../src/lib/canvas-video-generator", () => ({ updateVideoGeneratorElement: api.update, resizeVideoGeneratorElement: vi.fn() }));
vi.mock("../src/hooks/use-generation-error-handler", () => ({ useGenerationErrorHandler: () => ({ handleGenerationError: () => false }) }));
vi.mock("@excalidraw/excalidraw", () => ({ convertToExcalidrawElements: (elements: object[]) => elements }));

import { ApiApplicationError } from "../src/lib/server-api";
import { VideoGeneratorPanel } from "../src/components/canvas/video-generator-panel";

beforeEach(() => {
  vi.clearAllMocks();
  api.confirm.mockResolvedValue({ data: { jobId: "video-job" } });
  api.job.mockResolvedValue({ job: { status: "succeeded", result: { signed_url: "/video.mp4", mime_type: "video/mp4" } } });
  api.generate.mockRejectedValue(new ApiApplicationError("generation_confirmation_required", "Confirmation required", {
    approvalId: "video-approval", jobType: "video_generation", model: "hailuo-h3", estimatedCredits: 1.728,
    duration: 4, resolution: "720p", hasReferenceImage: false, expiresAt: "2030-01-01T00:00:00.000Z",
  }));
});
afterEach(cleanup);

it("shows the actual per-second estimate, confirms once and replaces the canvas placeholder with the video", async () => {
  render(<VideoGeneratorPanel elementId="generator" elementBounds={{ x: 0, y: 0, width: 400, height: 225 }}
    data={{ type: "video-generator", status: "idle", prompt: "A cup", model: "hailuo-h3", duration: 4, resolution: "720p", aspectRatio: "16:9" }}
    excalidrawApi={{ getSceneElements: () => [{ id: "generator" }], updateScene: api.scene }} accessToken="token"
    canvasScrollZoom={{ scrollX: 0, scrollY: 0, zoom: 1 }} onClose={api.close} />);
  fireEvent.click(await screen.findByRole("button", { name: "1.728" }));
  expect(await screen.findByRole("region", { name: "Generation confirmation" })).toHaveTextContent("1.728 credits");
  expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认生成" }));
  await waitFor(() => expect(api.scene).toHaveBeenCalledWith(expect.objectContaining({ elements: expect.arrayContaining([expect.objectContaining({ type: "embeddable", link: "/video.mp4" })]) })));
  expect(api.generate).toHaveBeenCalledTimes(1);
  expect(api.confirm).toHaveBeenCalledTimes(1);
  expect(api.update).toHaveBeenCalledWith(expect.anything(), "generator", expect.objectContaining({ jobId: "video-job" }));
});
