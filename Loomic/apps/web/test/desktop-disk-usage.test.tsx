// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopDiskUsage } from "@/components/desktop-disk-usage";
import { DesktopMediaCard } from "@/components/desktop-media-card";
import { DesktopDirectoryRelink } from "@/components/desktop-directory-relink";
import { DesktopThumbnailSettings } from "@/components/desktop-thumbnail-settings";
import { DesktopMediaMerge } from "@/components/desktop-media-merge";
import { DesktopScanRate } from "@/components/desktop-scan-rate";
import type { DesktopStorageApi } from "@/lib/desktop-storage";
afterEach(cleanup);

it("restores directory choices without executing and saves changed selections", async () => {
  const api = { chooseRelinkDirectory: vi.fn(), resumeRelinkDirectory: vi.fn().mockResolvedValue({ id: "draft", folder: "D:/moved", warnings: [], items: [{ assetId: "photo", name: "照片", status: "matched", candidates: [{ id: "a", relativePath: "a.png" }] }], selections: [{ assetId: "photo", candidateId: "a" }], savedAt: "2026-11-10T00:00:00Z" }), saveRelinkSelection: vi.fn().mockResolvedValue(undefined), applyRelinkDirectory: vi.fn() };
  render(<DesktopDirectoryRelink api={api as unknown as DesktopStorageApi} accountId="owner" disabled={false}/>);
  expect(await screen.findByRole("button", { name: "确认关联所选 1 项" })).toBeEnabled();
  expect(api.applyRelinkDirectory).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("combobox", { name: "匹配位置：照片" }));
  await userEvent.click(await screen.findByRole("option", { name: "跳过此素材" }));
  expect(api.saveRelinkSelection).toHaveBeenCalledWith("draft", []);
});

it("requires a file selection, reference preview and explicit consent before merging", async () => {
  const api = { previewMediaMerge: vi.fn().mockResolvedValue({ id: "merge", keep: "a.mp4", files: ["b.mp4"], assets: 2, projects: [{ id: "project", name: "我的短片", kind: "video" }], bytes: 100 }), applyMediaMerge: vi.fn().mockResolvedValue({ mergedFiles: 1, releasedBytes: 100, errors: [] }) };
  const group = { bytes: 100, extraBytes: 100, files: [{ id: "a", name: "a.mp4", relativePath: "Media/owner/a.mp4", bytes: 100 }, { id: "b", name: "b.mp4", relativePath: "Media/owner/b.mp4", bytes: 100 }] };
  render(<DesktopMediaMerge api={api as unknown as DesktopStorageApi} accountId="owner" group={group} disabled={false} onComplete={vi.fn()}/>);
  expect(screen.getByRole("button", { name: "核对工程引用与合并范围" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", { name: "Media/owner/b.mp4" }));
  await userEvent.click(screen.getByRole("button", { name: "核对工程引用与合并范围" }));
  expect(await screen.findByText(/我的短片/)).toBeVisible();
  expect(screen.getByRole("button", { name: "确认合并并释放重复内容" })).toBeDisabled();
  expect(api.applyMediaMerge).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox", { name: /我已核对工程引用/ }));
  await userEvent.click(screen.getByRole("button", { name: "确认合并并释放重复内容" }));
  expect(api.applyMediaMerge).toHaveBeenCalledWith("merge", true);
});

it("loads saved scan speed and persists a lower limit explicitly", async () => {
  const api = { getWorkspaceScanSettings: vi.fn().mockResolvedValue({ rateMiB: 32 }), configureWorkspaceScan: vi.fn().mockResolvedValue({ rateMiB: 8 }) };
  render(<DesktopScanRate api={api as unknown as DesktopStorageApi}/>);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "扫描读取速度上限" })).toBeEnabled());
  await userEvent.click(screen.getByRole("combobox", { name: "扫描读取速度上限" }));
  await userEvent.click(await screen.findByRole("option", { name: "8 MiB/s" }));
  expect(api.configureWorkspaceScan).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "保存扫描速度" }));
  expect(api.configureWorkspaceScan).toHaveBeenCalledWith({ rateMiB: 8 });
});

it("restores a paused scan and only starts hashing when the user continues", async () => {
  const api = { getWorkspaceScanState: vi.fn().mockResolvedValue({ accountId: "owner", phase: "paused", fileName: "movie.mp4", verifiedBytes: 64 * 1024 ** 2, totalBytes: 5 * 1024 ** 3, reusedBytes: 0 }), getWorkspaceUsage: vi.fn().mockRejectedValue(new Error("扫描已暂停")), clearWorkspaceScan: vi.fn().mockResolvedValue(undefined) };
  render(<DesktopDiskUsage api={api as unknown as DesktopStorageApi} accountId="owner"/>);
  await screen.findByRole("button", { name: "继续校验重复素材" });
  expect(api.getWorkspaceUsage).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "继续校验重复素材" }));
  expect(api.getWorkspaceUsage).toHaveBeenCalledWith("owner", true);
  await userEvent.click(await screen.findByRole("button", { name: "清除扫描进度" }));
  expect(api.clearWorkspaceScan).toHaveBeenCalledWith("owner");
});

it("keeps directory matches unselected until each choice and reports partial failures", async () => {
  const api = { chooseRelinkDirectory: vi.fn().mockResolvedValue({ id: "batch", folder: "D:/moved", warnings: [], truncated: false, items: [{ assetId: "photo", name: "照片", status: "ambiguous", candidates: [{ id: "a", relativePath: "a.png", willCopy: true }, { id: "b", relativePath: "b.png", willCopy: false }] }] }), applyRelinkDirectory: vi.fn().mockResolvedValue({ items: [{ assetId: "photo", ok: false, error: "原文件已改变" }] }) };
  render(<DesktopDirectoryRelink api={api as unknown as DesktopStorageApi} accountId="owner" disabled={false}/>);
  await userEvent.click(screen.getByRole("button", { name: "核对素材目录" }));
  expect(await screen.findByRole("button", { name: "确认关联所选 0 项" })).toBeDisabled();
  expect(api.applyRelinkDirectory).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("combobox", { name: "匹配位置：照片" }));
  await userEvent.click(await screen.findByRole("option", { name: /b.png/ }));
  await userEvent.click(screen.getByRole("button", { name: "确认关联所选 1 项" }));
  expect(api.applyRelinkDirectory).toHaveBeenCalledWith("batch", [{ assetId: "photo", candidateId: "b" }]);
  expect(await screen.findByText(/失败 1 项/)).toBeVisible();
  expect(screen.getByText(/原文件已改变/)).toBeVisible();
});

it("saves cache capacity only after confirmation and displays automatic cleanup state", async () => {
  const usage = { bytes: 0, files: 0, workspaceBytes: 0, limitBytes: 128 * 1024 ** 2, limitFiles: 1000, retentionDays: 30, enabled: true };
  const api = { getThumbnailUsage: vi.fn().mockResolvedValue(usage), configureThumbnailCache: vi.fn().mockResolvedValue({ ...usage, limitBytes: 0, enabled: false, lastCleanup: { at: "2026-11-10T00:00:00Z", bytes: 1000, files: 2, reason: "settings" } }) };
  render(<DesktopThumbnailSettings api={api as unknown as DesktopStorageApi} accountId="owner" disabled={false}/>);
  await screen.findByText(/整个工作区/);
  await userEvent.click(screen.getByRole("combobox", { name: "封面缓存容量" }));
  await userEvent.click(await screen.findByRole("option", { name: "关闭封面缓存" }));
  expect(api.configureThumbnailCache).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "保存缓存设置" }));
  expect(api.configureThumbnailCache).toHaveBeenCalledWith("owner", { capacityMiB: 0 });
  expect(await screen.findByText(/上次调整容量/)).toBeVisible();
});

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
  expect(screen.getByText("打开本地原文件")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "重新关联原文件" }));
  expect(await screen.findByText(/renamed.mp4 内容校验一致/)).toBeVisible();
  expect(api.applyMediaRelink).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "确认关联" }));
  await waitFor(() => expect(api.applyMediaRelink).toHaveBeenCalledWith("plan"));
  expect(await screen.findByText(/已关联并通过校验/)).toBeVisible();
});
