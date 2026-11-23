// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ generate: vi.fn(), confirm: vi.fn(), scene: vi.fn(), update: vi.fn() }));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "token" } }) }));
vi.mock("../src/lib/server-api", async original => ({ ...await original<object>(),
  fetchImageModels: async () => ({ models: [{ id: "gpt-image-2.6-flare", displayName: "GPT Image 2.6 Flare", imageRates: [{ quality: "hd", resolution: "2K", priceCredits: 0.32 }] }] }),
  generateImageDirect: api.generate, confirmGenerationApproval: api.confirm,
  fetchGenerationApprovalStatus: async () => ({ approvalStatus: "pending" }),
  fetchJob: async () => ({ job: { status: "succeeded", result: { signed_url: "/image.png", mime_type: "image/png" } } }),
}));
vi.mock("../src/lib/canvas-image-generator", () => ({ updateImageGeneratorElement: api.update, resizeImageGeneratorElement: vi.fn() }));
vi.mock("../src/lib/canvas-elements", () => ({ fetchAsDataURL: async () => "data:image/png;base64,cGlj", createExcalidrawImageElement: (props: object) => ({ type: "image", ...props }) }));
vi.mock("../src/hooks/use-generation-error-handler", () => ({ useGenerationErrorHandler: () => ({ handleGenerationError: () => false }) }));
import { ApiApplicationError } from "../src/lib/server-api";
import { ImageGeneratorPanel } from "../src/components/canvas/image-generator-panel";
afterEach(cleanup);
it("keeps the selected size through confirmation and inserts the completed paid image once", async () => {
  api.generate.mockRejectedValue(new ApiApplicationError("generation_confirmation_required", "Confirmation", {
    approvalId: "image-quote", jobType: "image_generation", model: "gpt-image-2.6-flare", estimatedCredits: 0.32,
    resolution: "2K", hasReferenceImage: false, expiresAt: "2030-01-01T00:00:00Z",
  }));
  api.confirm.mockResolvedValue({ data: { jobId: "image-job" } });
  render(<ImageGeneratorPanel elementId="generator" elementBounds={{ x: 0, y: 0, width: 400, height: 400 }}
    data={{ type: "image-generator", status: "idle", prompt: "A cup", model: "gpt-image-2.6-flare", quality: "hd", aspectRatio: "1:1" }}
    excalidrawApi={{ getSceneElements: () => [{ id: "generator" }], updateScene: api.scene, addFiles: vi.fn() }}
    accessToken="token" canvasScrollZoom={{ scrollX: 0, scrollY: 0, zoom: 1 }} onClose={vi.fn()} />);
  expect(await screen.findByText("2K · 0.32 积分/张")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(await screen.findByRole("region", { name: "Generation confirmation" })).toHaveTextContent("0.32 credits");
  fireEvent.click(screen.getByRole("button", { name: "确认生成" }));
  await waitFor(() => expect(api.scene).toHaveBeenCalledWith(expect.objectContaining({ elements: expect.arrayContaining([expect.objectContaining({ type: "image" })]) })));
  expect(api.generate).toHaveBeenCalledWith("token", "A cup", expect.objectContaining({ quality: "hd", model: "gpt-image-2.6-flare" }));
  expect(api.confirm).toHaveBeenCalledTimes(1);
});
