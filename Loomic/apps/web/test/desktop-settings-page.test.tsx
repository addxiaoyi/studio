// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopSettingsPage } from "@/components/desktop-settings-page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  signOut: vi.fn(),
  setTheme: vi.fn(),
  chooseLocalAssetFolder: vi.fn(),
  clearLocalAssetFolder: vi.fn(),
  getLocalAssetFolderState: vi.fn(),
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
  updateListener: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: mocks.setTheme }) }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { email: "desktop@example.test" }, signOut: mocks.signOut }) }));
vi.mock("@/lib/local-asset-storage", () => ({
  chooseLocalAssetFolder: mocks.chooseLocalAssetFolder,
  clearLocalAssetFolder: mocks.clearLocalAssetFolder,
  getLocalAssetFolderState: mocks.getLocalAssetFolderState,
}));

const electronApi = {
  getAppVersion: vi.fn().mockResolvedValue("0.2.14"),
  getPlatform: vi.fn().mockReturnValue("win32"),
  getUpdateState: vi.fn().mockResolvedValue({ status: "idle", currentVersion: "0.2.14" }),
  checkForUpdates: mocks.checkForUpdates,
  installUpdate: mocks.installUpdate,
  onUpdateState: (callback: (state: unknown) => void) => {
    mocks.updateListener.mockImplementation(callback);
    return vi.fn();
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue(undefined);
  mocks.getLocalAssetFolderState.mockResolvedValue({ name: null, permission: "unselected" });
  mocks.checkForUpdates.mockResolvedValue({ status: "not-available", currentVersion: "0.2.14" });
  mocks.chooseLocalAssetFolder.mockResolvedValue("Design Exports");
  Object.defineProperty(window, "electronAPI", { configurable: true, value: electronApi });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "electronAPI");
});

describe("DesktopSettingsPage", () => {
  it("shows account, platform, version, and operating local-save controls", async () => {
    const user = userEvent.setup();
    mocks.getLocalAssetFolderState
      .mockResolvedValueOnce({ name: null, permission: "unselected" })
      .mockResolvedValueOnce({ name: "Design Exports", permission: "granted" });
    render(<DesktopSettingsPage />);

    expect(await screen.findByText("v0.2.14 · Windows")).toBeInTheDocument();
    expect(screen.getByText("desktop@example.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /选择文件夹/ }));
    await waitFor(() => expect(screen.getByText("Design Exports · 已授权")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "解除本地保存文件夹" }));
    expect(mocks.clearLocalAssetFolder).toHaveBeenCalledOnce();
  });

  it("changes theme, checks updates, and signs out to the desktop entry", async () => {
    const user = userEvent.setup();
    render(<DesktopSettingsPage />);

    await user.click(screen.getByRole("button", { name: "深色" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");

    await user.click(await screen.findByRole("button", { name: "检查更新" }));
    await waitFor(() => expect(screen.getByText("当前已是最新版本")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/desktop-app/"));
  });
});
