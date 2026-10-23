import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopTitlebar } from "@/components/desktop-titlebar";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/desktop-app",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mockPush, replace: mockPush }),
}));

type NavigationState = { canGoBack: boolean; canGoForward: boolean };
type TitlebarApi = {
  getWindowState: () => Promise<{ isMaximized: boolean }>;
  getNavigationState: () => Promise<NavigationState>;
  navigateHistory: (direction: "back" | "forward") => Promise<NavigationState>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<{ isMaximized: boolean }>;
  closeWindow: () => Promise<void>;
  onWindowState: (
    callback: (state: { isMaximized: boolean }) => void,
  ) => () => void;
  onNavigationState: (callback: (state: NavigationState) => void) => () => void;
};

function setDesktopApi(api: TitlebarApi | undefined) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: api,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

describe("DesktopTitlebar", () => {
  it("stays absent in a regular browser", () => {
    setDesktopApi(undefined);
    const { container } = render(<DesktopTitlebar />);

    expect(container.firstChild).toBeNull();
  });

  it("provides native history, quick navigation, and window controls", async () => {
    const user = userEvent.setup();
    const api: TitlebarApi = {
      getWindowState: vi.fn().mockResolvedValue({ isMaximized: false }),
      getNavigationState: vi
        .fn()
        .mockResolvedValue({ canGoBack: true, canGoForward: false }),
      navigateHistory: vi
        .fn()
        .mockResolvedValue({ canGoBack: false, canGoForward: true }),
      minimizeWindow: vi.fn().mockResolvedValue(undefined),
      maximizeWindow: vi.fn().mockResolvedValue({ isMaximized: true }),
      closeWindow: vi.fn().mockResolvedValue(undefined),
      onWindowState: vi.fn().mockReturnValue(vi.fn()),
      onNavigationState: vi.fn().mockReturnValue(vi.fn()),
    };
    setDesktopApi(api);
    render(<DesktopTitlebar />);

    expect(
      (
        await screen.findByRole("link", { name: "Helstera Desktop Agent" })
      ).getAttribute("href"),
    ).toBe("/desktop-app");
    expect(
      screen.getByRole("link", { name: "Agent" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      (screen.getByRole("button", { name: "后退" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "后退" }));
    expect(api.navigateHistory).toHaveBeenCalledWith("back");

    await user.click(
      screen.getByRole("button", { name: /跳转到工作区或功能/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "搜索页面和工作区" }),
      "Feed",
    );
    await user.click(screen.getByRole("button", { name: /内容增长 Feed/ }));
    expect(mockPush).toHaveBeenCalledWith("/feed/");

    await user.click(screen.getByRole("button", { name: "最小化" }));
    await user.click(screen.getByRole("button", { name: "最大化" }));
    await user.click(screen.getByRole("button", { name: "关闭" }));

    expect(api.minimizeWindow).toHaveBeenCalledOnce();
    expect(api.maximizeWindow).toHaveBeenCalledOnce();
    expect(api.closeWindow).toHaveBeenCalledOnce();
  });
});
