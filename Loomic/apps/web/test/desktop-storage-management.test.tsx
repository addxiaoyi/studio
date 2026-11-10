// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopStorageManagement } from "@/components/desktop-storage-management";
import type { DesktopStorageApi } from "@/lib/desktop-storage";
vi.mock("@/hooks/use-surface-entry", () => ({ useSurfaceEntry: () => undefined }));
afterEach(cleanup);

it("shows low space and requires explicit confirmation for the scoped local cleanup", async () => {
  const setup = { root: "D:/Work", available: true, completed: true, autoBackup: false, agentAccess: false, availableBytes: 100 * 1024 ** 2, diskWarning: "critical" as const };
  const api = { getDesktopSetup: vi.fn().mockResolvedValue(setup), getLocalProjects: vi.fn().mockResolvedValue([{ id: "project", name: "本地工程", snapshots: 2, snapshotBytes: 100, mediaBytes: 1024 }]), previewLocalCleanup: vi.fn().mockResolvedValue({ id: "plan", name: "本地工程", snapshots: 2, mediaFiles: 1, sharedMedia: 1, bytes: 1124, files: ["old.json", "video.mp4"] }), applyLocalCleanup: vi.fn().mockResolvedValue({ removedFiles: 3, removedBytes: 1124, errors: [] }) };
  render(<DesktopStorageManagement api={api as unknown as DesktopStorageApi} accountId="owner" disabled={false} setup={setup}/>);
  expect(screen.getByRole("alert")).toHaveTextContent("严重不足");
  await userEvent.click(screen.getByRole("button", { name: "管理本地空间与云端副本" }));
  await userEvent.click(await screen.findByRole("button", { name: "检查清理范围" }));
  const confirm = await screen.findByRole("button", { name: "确认清理本地文件" });
  expect(confirm).toBeDisabled(); expect(api.applyLocalCleanup).not.toHaveBeenCalled();
  expect(screen.getByText(/保留其他工程共用的 1 个素材/)).toBeVisible();
  await userEvent.click(screen.getByRole("checkbox")); await userEvent.click(confirm);
  await waitFor(() => expect(api.applyLocalCleanup).toHaveBeenCalledWith("plan"));
  expect(await screen.findByText(/已清理 3 个本地文件/)).toBeVisible();
});

it("explains cross-device impact and leaves the cloud copy untouched until confirmation", async () => {
  const api = { getDesktopSetup: vi.fn().mockResolvedValue({}), getLocalProjects: vi.fn().mockResolvedValue([]), previewLocalCleanup: vi.fn(), applyLocalCleanup: vi.fn(), getLocalCloudCopies: vi.fn().mockResolvedValue([{ assetId: "asset", name: "本地原片", bytes: 1024, cloudState: "unknown" }]), previewCloudRelease: vi.fn().mockResolvedValue({ id: "release", name: "本地原片", bytes: 1024, filename: "local.mp4" }), applyCloudRelease: vi.fn().mockResolvedValue({ state: "released", bytes: 1024 }) };
  render(<DesktopStorageManagement api={api as unknown as DesktopStorageApi} accountId="owner" accessToken="token" disabled={false} setup={null}/>);
  await userEvent.click(screen.getByRole("button", { name: "管理本地空间与云端副本" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "释放云端副本" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "释放云端副本" }));
  await userEvent.click(await screen.findByRole("button", { name: "校验并检查释放影响" }));
  expect(await screen.findByText(/网站、其他设备/)).toBeVisible();
  expect(screen.getByRole("button", { name: "确认释放云端副本" })).toBeDisabled();
  expect(api.applyCloudRelease).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox")); await userEvent.click(screen.getByRole("button", { name: "确认释放云端副本" }));
  await waitFor(() => expect(api.applyCloudRelease).toHaveBeenCalledWith("release", { accountId: "owner", accessToken: "token" }));
});
