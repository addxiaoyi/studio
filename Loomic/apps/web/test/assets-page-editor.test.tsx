// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  deleteGeneratedAssets: vi.fn(),
  fetchGeneratedAssets: vi.fn(),
  publishAsset: vi.fn(),
  restoreGeneratedAsset: vi.fn(),
  unpublishAsset: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  pathname: "/assets",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "test-token" } }),
}));
vi.mock("@/lib/server-api", () => api);
vi.mock("@/lib/local-asset-storage", () => ({
  chooseLocalAssetFolder: vi.fn(),
  getLocalAssetFolderName: vi.fn().mockResolvedValue(null),
  saveAssetToLocalFolder: vi.fn(),
}));

import AssetsPage from "@/app/(workspace)/assets/page";

beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = "/assets";
  api.fetchGeneratedAssets.mockResolvedValue({
    assets: [{
      id: "asset-editor",
      mediaType: "image",
      title: "编辑测试资产",
      description: null,
      prompt: "编辑",
      mimeType: "image/png",
      createdAt: "2026-10-19T00:00:00.000Z",
      url: "http://localhost/api/uploads/upload-editor/file",
      published: false,
      retentionState: "active",
    }],
    pagination: { page: 1, pageSize: 12, total: 1, hasMore: false },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("asset editor retry", () => {
  it.each([
    ["/assets", "/canvas?id=editor-canvas&assetId=asset-editor&mediaType=image"],
    ["/desktop-app/assets", "/desktop-app/canvas?id=editor-canvas&assetId=asset-editor&mediaType=image"],
  ])("retries project creation and navigates from %s", async (pathname, expectedHref) => {
    navigation.pathname = pathname;
    api.createProject
      .mockRejectedValueOnce(new Error("项目创建失败"))
      .mockResolvedValueOnce({ project: { id: "editor-project", primaryCanvas: { id: "editor-canvas" } } });
    const user = userEvent.setup();
    render(<AssetsPage />);

    const edit = await screen.findByRole("button", { name: "在画布中编辑" });
    await user.click(edit);
    expect(await screen.findByRole("alert")).toHaveTextContent("项目创建失败");

    await user.click(screen.getByRole("button", { name: "重试打开画布" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(expectedHref));
    expect(api.createProject).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
