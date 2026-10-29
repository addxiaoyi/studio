// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopSettingsPage } from "@/components/desktop-settings-page";
import { DesktopToastProvider } from "@/components/desktop-toast";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  signOut: vi.fn(),
  setTheme: vi.fn(),
  chooseLocalAssetFolder: vi.fn(),
  clearLocalAssetFolder: vi.fn(),
  getLocalAssetFolderState: vi.fn(),
  getAppVersion: vi.fn(),
  getUpdateState: vi.fn(),
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
  onUpdateState: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: mocks.setTheme }) }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { email: "desktop@example.test" }, signOut: mocks.signOut }) }));
vi.mock("@/lib/local-asset-storage", () => ({
  chooseLocalAssetFolder: mocks.chooseLocalAssetFolder,
  clearLocalAssetFolder: mocks.clearLocalAssetFolder,
  getLocalAssetFolderState: mocks.getLocalAssetFolderState,
}));

type UpdateState = { status: string; currentVersion: string; version?: string; message?: string };

const electronApi = {
  getAppVersion: mocks.getAppVersion,
  getPlatform: () => "win32",
  getUpdateState: mocks.getUpdateState,
  checkForUpdates: mocks.checkForUpdates,
  installUpdate: mocks.installUpdate,
  onUpdateState: mocks.onUpdateState,
};

function renderPage() {
  return render(
    <DesktopToastProvider>
      <DesktopSettingsPage />
    </DesktopToastProvider>,
  );
}

function toastByClassName(tone: "success" | "error" | "info") {
  return document.querySelector(`.desktop-toast--${tone}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue(undefined);
  mocks.getLocalAssetFolderState.mockResolvedValue({ name: null, permission: "unselected" });
  mocks.chooseLocalAssetFolder.mockResolvedValue("Design Exports");
  mocks.clearLocalAssetFolder.mockResolvedValue(undefined);
  mocks.getAppVersion.mockResolvedValue("0.2.14");
  mocks.getUpdateState.mockResolvedValue({ status: "idle", currentVersion: "0.2.14" });
  mocks.checkForUpdates.mockResolvedValue({ status: "not-available", currentVersion: "0.2.14" });
  mocks.installUpdate.mockResolvedValue({ ok: true });
  mocks.onUpdateState.mockReturnValue(() => {});
  Object.defineProperty(window, "electronAPI", { configurable: true, value: electronApi });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "electronAPI");
});

describe("DesktopSettingsPage feedback", () => {
  it("confirms a saved local folder with a success toast and no error toast", async () => {
    const user = userEvent.setup();
    mocks.getLocalAssetFolderState
      .mockResolvedValueOnce({ name: null, permission: "unselected" })
      .mockResolvedValueOnce({ name: "Design Exports", permission: "granted" });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /选择文件夹/ }));

    expect(await screen.findByText("已更新本地保存位置")).toBeTruthy();
    expect(toastByClassName("success")).not.toBeNull();
    expect(toastByClassName("error")).toBeNull();
    // The row itself still reflects the new folder, so the toast adds to the state, not replaces it.
    await waitFor(() => expect(screen.getByText("Design Exports · 已授权")).toBeInTheDocument());
  });

  it("surfaces the underlying reason on a failed save through both a toast and the inline alert", async () => {
    const user = userEvent.setup();
    mocks.chooseLocalAssetFolder.mockRejectedValueOnce(new Error("磁盘写保护，无法写入"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: /选择文件夹/ }));

    // The failure must reach the user through both channels with the *same* sentence:
    // one transient toast plus one persistent inline alert, not two different wordings.
    const matches = await screen.findAllByText(/保存本地保存位置失败/);
    expect(matches).toHaveLength(2);
    for (const node of matches) {
      expect(node.textContent).toBe("保存本地保存位置失败：磁盘写保护，无法写入");
    }
    expect(toastByClassName("error")?.textContent).toBe("保存本地保存位置失败：磁盘写保护，无法写入");
    expect(toastByClassName("success")).toBeNull();

    const inline = document.querySelector(".desktop-settings__error");
    expect(inline?.getAttribute("role")).toBe("alert");
    expect(inline?.textContent).toBe("保存本地保存位置失败：磁盘写保护，无法写入");
  });

  it("reports a folder-state read failure instead of only mutating state silently", async () => {
    mocks.getLocalAssetFolderState.mockRejectedValueOnce(new Error("IndexedDB 已被浏览器禁用"));
    renderPage();

    const matches = await screen.findAllByText(/读取本地保存位置失败/);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const node of matches) {
      expect(node.textContent).toBe("读取本地保存位置失败：IndexedDB 已被浏览器禁用");
    }
    expect(toastByClassName("error")).not.toBeNull();
  });

  it("tells the user a downloaded update needs a client restart", async () => {
    const listeners: Array<(state: UpdateState) => void> = [];
    mocks.onUpdateState.mockImplementation((callback: (state: UpdateState) => void) => {
      listeners.push(callback);
      return () => {};
    });
    renderPage();

    await waitFor(() => expect(listeners).toHaveLength(1));
    act(() => listeners[0]!({ status: "downloaded", currentVersion: "0.2.14", version: "0.2.15" }));

    const toastMessage = await screen.findByText("更新已下载，重启客户端后生效");
    expect(toastMessage.textContent).toBe("更新已下载，重启客户端后生效");
    expect(toastByClassName("info")).not.toBeNull();
  });

  it("confirms a completed update check without claiming an error", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("更新检查完成，当前已是最新版本")).toBeTruthy();
    expect(toastByClassName("success")).not.toBeNull();
    expect(toastByClassName("error")).toBeNull();
  });

  it("reports an update-check rejection with its reason", async () => {
    const user = userEvent.setup();
    mocks.checkForUpdates.mockRejectedValueOnce(new Error("更新服务返回 503"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "检查更新" }));

    const toastMessage = await screen.findByText(/检查更新失败/);
    expect(toastMessage.textContent).toBe("检查更新失败：更新服务返回 503");
    expect(toastByClassName("error")).not.toBeNull();
  });
});
