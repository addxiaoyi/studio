// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopStoragePanel, DesktopBackupBridge } from "@/components/desktop-storage-panel";
import { saveAssetToLocalFolder } from "@/lib/local-asset-storage";
const accountId = "123e4567-e89b-42d3-a456-426614174000";
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "private-token", user: { id: accountId } } }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(window, "electronAPI"); vi.unstubAllGlobals(); });
function bridge() {
  const api = {
    getDesktopSetup: vi.fn().mockResolvedValue({ root: "D:\\Creative", available: true, autoBackup: true, agentAccess: false }),
    getCloudBackup: vi.fn().mockResolvedValue({ status: "partial", account: accountId, completed: 1, skipped: 0, failed: 1, items: [{ key: "x", name: "视频", state: "failed", error: "网络中断" }] }),
    onCloudBackup: vi.fn(() => vi.fn()), runCloudBackup: vi.fn().mockResolvedValue({ status: "completed" }),
    saveCloudAsset: vi.fn().mockResolvedValue({ status: "completed" }),
    openDesktopSetup: vi.fn().mockResolvedValue(undefined), openDesktopWorkspaceFolder: vi.fn().mockResolvedValue(undefined), cancelCloudBackup: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, "electronAPI", { configurable: true, value: api }); return api;
}
it("offers retry and a real workspace folder action with persistent failure details", async () => {
  const api = bridge(); render(<DesktopStoragePanel/>);
  expect(await screen.findByText("D:\\Creative")).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "重试未完成项" }));
  expect(api.runCloudBackup).toHaveBeenCalledWith({ accountId, accessToken: "private-token" });
  await userEvent.click(screen.getByRole("button", { name: "打开工作区" }));
  expect(api.openDesktopWorkspaceFolder).toHaveBeenCalledOnce();
  expect(screen.getByText("视频：网络中断")).toBeInTheDocument();
});
it("uses streamed native saving instead of buffering private video in the renderer", async () => {
  const api = bridge(); const fetch = vi.fn();vi.stubGlobal("fetch",fetch);
  await saveAssetToLocalFolder({ accountId, accessToken: "private-token", url: `/api/uploads/${accountId}/file`, fileName: "录像", mediaType: "video" });
  expect(api.saveCloudAsset).toHaveBeenCalledWith({ accountId, accessToken: "private-token" }, { assetId: accountId, name: "录像", mediaType: "video" });
  expect(fetch).not.toHaveBeenCalled();
  api.saveCloudAsset.mockResolvedValueOnce({ status: "failed", error: "磁盘空间不足" });
  await expect(saveAssetToLocalFolder({ accountId, accessToken: "private-token", url: `/api/uploads/${accountId}/file`, fileName: "录像", mediaType: "video" })).rejects.toThrow("磁盘空间不足");
});
it("only starts automatic copies after the user enables them and cancels on unmount", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const api = bridge();
  api.getDesktopSetup.mockResolvedValueOnce({ root: "D:\\Creative", available: true, autoBackup: false, agentAccess: false });
  const disabled = render(<DesktopBackupBridge/>);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
  expect(api.runCloudBackup).not.toHaveBeenCalled();
  disabled.unmount();
  const enabled = render(<DesktopBackupBridge/>);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(api.runCloudBackup).toHaveBeenCalledOnce();
  enabled.unmount();
  expect(api.cancelCloudBackup).toHaveBeenCalledOnce();
});
