// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAssets: vi.fn(),
  preparePrivateMedia: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "session-token", user: { id: "user-1" } } }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/assets/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/gradual-blur", () => ({ GradualBlur: () => null }));
vi.mock("@/lib/server-api", () => ({
  fetchGeneratedAssets: mocks.fetchAssets,
  createProject: vi.fn(),
  deleteGeneratedAssets: vi.fn(),
  publishAsset: vi.fn(),
  unpublishAsset: vi.fn(),
  restoreGeneratedAsset: vi.fn(),
}));
vi.mock("@/lib/local-asset-storage", () => ({
  chooseLocalAssetFolder: vi.fn(),
  getLocalAssetFolderName: vi.fn().mockResolvedValue(null),
  saveAssetToLocalFolder: vi.fn(),
}));
vi.mock("@/lib/private-media", () => ({ preparePrivateMedia: mocks.preparePrivateMedia }));

import AssetsPage from "@/app/(workspace)/assets/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("retries a broken thumbnail and opens the original private video", async () => {
  mocks.fetchAssets.mockResolvedValue({
    assets: [
      {
        id: "asset-1",
        assetObjectId: "123e4567-e89b-42d3-a456-426614174012",
        mediaType: "video",
        title: "Launch film",
        description: null,
        prompt: null,
        mimeType: "video/webm",
        createdAt: "2026-11-13T00:00:00.000Z",
        url: "https://api.test/api/uploads/123e4567-e89b-42d3-a456-426614174012/file",
        published: false,
      },
      {
        id: "asset-2",
        assetObjectId: "123e4567-e89b-42d3-a456-426614174013",
        mediaType: "image",
        title: "Campaign still",
        description: null,
        prompt: null,
        mimeType: "image/jpeg",
        createdAt: "2026-11-12T00:00:00.000Z",
        url: "https://api.test/api/uploads/123e4567-e89b-42d3-a456-426614174013/file",
        published: false,
      },
    ],
    pagination: { page: 1, pageSize: 12, total: 1, hasMore: false },
  });
  mocks.fetch.mockImplementation(() => Promise.resolve(new Response(new Blob(["frame"]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  })));
  mocks.preparePrivateMedia.mockResolvedValue({
    path: "https://api.test/api/uploads/123e4567-e89b-42d3-a456-426614174012/file",
    mimeType: "video/webm",
    byteSize: 2_000_000,
    expiresAt: null,
    grantSeconds: 300,
  });
  vi.stubGlobal("fetch", mocks.fetch);
  const NativeURL = URL;
  let thumbnailIndex = 0;
  const TestURL = Object.assign(class extends NativeURL {}, {
    createObjectURL: vi.fn(() => `blob:asset-thumbnail-${++thumbnailIndex}`),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal("URL", TestURL);
  render(<AssetsPage />);

  let previewButton = await screen.findByRole("button", { name: "预览 Launch film" });
  fireEvent.error(previewButton.querySelector("img")!);
  expect(await screen.findByText("预览图解码失败，请重试")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试加载 Launch film" }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
  expect(String(mocks.fetch.mock.calls[2]?.[0])).toContain("123e4567-e89b-42d3-a456-426614174012");
  previewButton = await screen.findByRole("button", { name: "预览 Launch film" });
  fireEvent.click(previewButton);

  const dialog = await screen.findByRole("dialog");
  const player = await waitFor(() => {
    const video = dialog.querySelector("video");
    expect(video).toHaveAttribute("src", expect.stringContaining("/api/uploads/"));
    return video;
  });
  if (!player) throw new Error("The private video preview did not mount.");
  expect(player.tagName).toBe("VIDEO");
  expect(player).toHaveAttribute("controls");
  expect(player).toHaveAttribute("src", expect.stringContaining("/api/uploads/"));
  expect(mocks.preparePrivateMedia).toHaveBeenCalledWith(
    "123e4567-e89b-42d3-a456-426614174012",
    "session-token",
    expect.any(AbortSignal),
  );
});
