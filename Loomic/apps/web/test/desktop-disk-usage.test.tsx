// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopDiskUsage } from "@/components/desktop-disk-usage";
import { DesktopMediaCard } from "@/components/desktop-media-card";
import type { DesktopStorageApi } from "@/lib/desktop-storage";
afterEach(cleanup);

it("scans locally on request, shows verified duplicate paths and clears only the thumbnail cache", async () => {
  const api = { getWorkspaceUsage: vi.fn().mockResolvedValue({ categories: [{ id: "media", bytes: 2000, files: 2 }], totalBytes: 2000, totalFiles: 2, duplicates: [{ bytes: 1000, extraBytes: 1000, files: [{ id: "one", relativePath: "Media/one.mp4" }, { id: "two", relativePath: "Media/two.mp4" }] }], duplicateGroups: 1, duplicateBytes: 1000, hashedBytes: 2000, truncated: false, warnings: [] }), getThumbnailUsage: vi.fn().mockResolvedValue({ bytes: 1024, files: 1, workspaceBytes: 1024, limitBytes: 134217728, limitFiles: 1000, retentionDays: 30 }), clearThumbnailCache: vi.fn().mockResolvedValue({ bytes: 1024, files: 1 }), revealWorkspaceFile: vi.fn().mockResolvedValue(undefined) };
  render(<DesktopDiskUsage api={api as unknown as DesktopStorageApi} accountId="owner"/>);
  expect(api.getWorkspaceUsage).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "校验重复素材" }));
  expect(await screen.findByText(/发现 1 组相同内容/)).toBeVisible();
  expect(api.getWorkspaceUsage).toHaveBeenCalledWith("owner", true);
  await userEvent.click(screen.getByText(/2 个相同文件/));
  await userEvent.click(screen.getAllByRole("button", { name: "定位文件" })[0]!);
  expect(api.revealWorkspaceFile).toHaveBeenCalledWith("one");
  await userEvent.click(screen.getByRole("button", { name: "清理我的预览缓存" }));
  await waitFor(() => expect(api.clearThumbnailCache).toHaveBeenCalledWith("owner"));
  expect(await screen.findByText(/原文件保留/)).toBeVisible();
});

it("previews a renamed source but only updates its link after confirmation", async () => {
  const api = { chooseRelinkMedia: vi.fn().mockResolvedValue({ id: "plan", filename: "renamed.mp4", willCopy: false, bytes: 100 }), applyMediaRelink: vi.fn().mockResolvedValue({ filename: "renamed.mp4", copied: false, bytes: 100 }) };
  render(<DesktopMediaCard api={api as unknown as DesktopStorageApi} snapshotId="snapshot" accountId="owner" item={{ assetId: "asset", name: "录像" }} disabled={false} onPreview={vi.fn()}/>);
  await userEvent.click(screen.getByRole("button", { name: "重新关联原文件" }));
  expect(await screen.findByText(/renamed.mp4 内容校验一致/)).toBeVisible();
  expect(api.applyMediaRelink).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "确认关联" }));
  await waitFor(() => expect(api.applyMediaRelink).toHaveBeenCalledWith("plan"));
  expect(await screen.findByText(/已关联并通过校验/)).toBeVisible();
});
