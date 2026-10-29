// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopTitlebar } from "@/components/desktop-titlebar";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/desktop-app",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mockPush, replace: mockPush }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "desktop-titlebar-test-user" } }),
}));

type NavigationState = { canGoBack: boolean; canGoForward: boolean };
const canvasStorageValues = new Map<string, string>();
const canvasStorage = {
  getItem: (key: string) => canvasStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { canvasStorageValues.set(key, value); },
  removeItem: (key: string) => { canvasStorageValues.delete(key); },
  clear: () => canvasStorageValues.clear(),
};
type TitlebarApi = {
  onNavigate: (callback: (path: string) => void) => () => void;
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
  windowFullscreen?: () => Promise<{ isFullScreen: boolean }>;
  getFullscreenState?: () => Promise<{ isFullScreen: boolean }>;
  onFullscreenState?: (
    callback: (state: { isFullScreen: boolean }) => void,
  ) => () => void;
};

function setDesktopApi(api: TitlebarApi | undefined) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: api,
  });
}

beforeEach(() => {
  canvasStorage.clear();
  Object.defineProperty(window, "localStorage", { configurable: true, value: canvasStorage });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  canvasStorage.clear();
  Reflect.deleteProperty(window, "electronAPI");
  Reflect.deleteProperty(document.documentElement.dataset, "sidebarCollapsed");
  document.documentElement.style.removeProperty("--desktop-sidebar-expanded-width");
  document.documentElement.style.removeProperty("--desktop-sidebar-collapsed-width");
});

function makeApi(overrides: Partial<TitlebarApi> = {}): TitlebarApi {
  return {
    onNavigate: vi.fn().mockImplementation(() => vi.fn()),
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
    ...overrides,
  };
}

describe("DesktopTitlebar", () => {
  it("stays absent in a regular browser", () => {
    setDesktopApi(undefined);
    const { container } = render(<DesktopTitlebar />);

    expect(container.firstChild).toBeNull();
  });

  it("provides native history, quick navigation, and window controls", async () => {
    const user = userEvent.setup();
    const api: TitlebarApi = {
      onNavigate: vi.fn().mockImplementation(() => vi.fn()),
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
    expect(screen.getByRole("link", { name: "扩展市场" }).getAttribute("href")).toBe("/desktop-app/marketplace");
    expect(screen.getByRole("link", { name: "设置" }).getAttribute("href")).toBe("/desktop-app/settings");
    expect(
      (screen.getByRole("button", { name: "后退" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "后退" }));
    expect(api.navigateHistory).toHaveBeenCalledWith("back");

    localStorage.setItem("helstera.desktop.last-canvas.desktop-titlebar-test-user", "canvas-123");
    await user.click(screen.getByRole("link", { name: "画布" }));
    expect(mockPush).toHaveBeenCalledWith("/desktop-app/canvas/?id=canvas-123");
    mockPush.mockClear();

    await user.click(screen.getByRole("button", { name: /跳转到工作区或功能/ }));
    await user.type(
      screen.getByRole("textbox", { name: "搜索页面和工作区" }),
      "本地开发",
    );
    await user.click(screen.getByRole("button", { name: /本地开发/ }));
    expect(mockPush).toHaveBeenCalledWith("/desktop-app/development/");

    await user.click(screen.getByRole("button", { name: "最小化" }));
    await user.click(screen.getByRole("button", { name: "最大化" }));
    await user.click(screen.getByRole("button", { name: "关闭" }));

    expect(api.minimizeWindow).toHaveBeenCalledOnce();
    expect(api.maximizeWindow).toHaveBeenCalledOnce();
    expect(api.closeWindow).toHaveBeenCalledOnce();
  });

  it("toggles the workspace sidebar and persists the choice", async () => {
    const user = userEvent.setup();
    setDesktopApi(makeApi());
    render(<DesktopTitlebar />);

    const collapse = await screen.findByRole("button", { name: "展开侧栏" });
    expect(collapse.getAttribute("aria-expanded")).toBe("false");

    await user.click(collapse);

    const expand = screen.getByRole("button", { name: "折叠侧栏" });
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("false");
    expect(
      JSON.parse(
        localStorage.getItem("helstera.desktop.sidebar") as string,
      ),
    ).toEqual({ collapsed: false, expandedWidth: 216 });

    await user.click(expand);

    expect(
      screen.getByRole("button", { name: "展开侧栏" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("true");
    expect(
      JSON.parse(
        localStorage.getItem("helstera.desktop.sidebar") as string,
      ),
    ).toEqual({ collapsed: true, expandedWidth: 216 });
  });

  it("restores the sidebar state and expanded width after a reload", async () => {
    localStorage.setItem(
      "helstera.desktop.sidebar",
      JSON.stringify({ collapsed: false, expandedWidth: 244 }),
    );
    setDesktopApi(makeApi());
    render(<DesktopTitlebar />);

    expect(
      (await screen.findByRole("button", { name: "折叠侧栏" })).getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("false");
    expect(
      document.documentElement.style.getPropertyValue(
        "--desktop-sidebar-expanded-width",
      ),
    ).toBe("244px");
  });

  it("falls back to the collapsed default when stored preferences are unusable", async () => {
    localStorage.setItem("helstera.desktop.sidebar", "{not-json");
    setDesktopApi(makeApi());
    render(<DesktopTitlebar />);

    expect(
      (await screen.findByRole("button", { name: "展开侧栏" })).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("true");
    expect(
      document.documentElement.style.getPropertyValue(
        "--desktop-sidebar-expanded-width",
      ),
    ).toBe("216px");
  });

  it("does not fire history commands from disabled buttons", async () => {
    const user = userEvent.setup();
    const api = makeApi({
      getNavigationState: vi
        .fn()
        .mockResolvedValue({ canGoBack: false, canGoForward: false }),
    });
    setDesktopApi(api);
    render(<DesktopTitlebar />);

    const back = (await screen.findByRole("button", {
      name: "后退",
    })) as HTMLButtonElement;
    const forward = screen.getByRole("button", {
      name: "前进",
    }) as HTMLButtonElement;

    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);

    fireEvent.click(back);
    fireEvent.click(forward);
    await user.click(back);

    expect(api.navigateHistory).not.toHaveBeenCalled();
  });

  it("locks the window controls while a command is in flight", async () => {
    const user = userEvent.setup();
    let finishClose: () => void = () => {};
    const closeWindow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = () => resolve();
        }),
    );
    const api = makeApi({ closeWindow });
    setDesktopApi(api);
    render(<DesktopTitlebar />);

    const close = (await screen.findByRole("button", {
      name: "关闭",
    })) as HTMLButtonElement;
    await user.click(close);

    expect(closeWindow).toHaveBeenCalledOnce();
    expect(close.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "最小化" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(close);
    await user.click(close);
    expect(closeWindow).toHaveBeenCalledOnce();

    finishClose();
    await screen.findByRole("button", { name: "关闭" });

    expect(close.disabled).toBe(false);
    await user.click(close);
    expect(closeWindow).toHaveBeenCalledTimes(2);
  });

  it("hides the fullscreen control on desktop builds that do not expose it", async () => {
    setDesktopApi(makeApi());
    render(<DesktopTitlebar />);
    await screen.findByRole("button", { name: "最大化" });
    expect(screen.queryByRole("button", { name: "进入全屏" })).toBeNull();
  });

  it("toggles fullscreen and disables maximize while full screen", async () => {
    const user = userEvent.setup();
    const windowFullscreen = vi.fn().mockResolvedValue({ isFullScreen: true });
    setDesktopApi(
      makeApi({
        windowFullscreen,
        getFullscreenState: vi.fn().mockResolvedValue({ isFullScreen: false }),
        onFullscreenState: vi.fn().mockReturnValue(vi.fn()),
      }),
    );
    render(<DesktopTitlebar />);

    const enter = await screen.findByRole("button", { name: "进入全屏" });
    expect(enter.getAttribute("aria-pressed")).toBe("false");
    expect(
      (screen.getByRole("button", { name: "最大化" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await user.click(enter);

    expect(windowFullscreen).toHaveBeenCalledOnce();
    const exit = await screen.findByRole("button", { name: "退出全屏" });
    expect(exit.getAttribute("aria-pressed")).toBe("true");
    expect(
      (screen.getByRole("button", { name: "最大化" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("打开快速跳转后把焦点放进搜索框", async () => {
    const user = userEvent.setup();
    setDesktopApi(makeApi());
    render(<DesktopTitlebar />);

    const trigger = await screen.findByRole("button", {
      name: /跳转到工作区或功能/,
    });
    await user.click(trigger);

    const dialog = getSwitcherDialog();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "搜索页面和工作区" }),
    );
  });

  it("沿浏览器原生 Escape→close 路径关闭，并把焦点还给触发按钮", async () => {
    const user = userEvent.setup();
    setDesktopApi(makeApi());
    render(<DesktopTitlebar />);

    const trigger = await screen.findByRole("button", {
      name: /跳转到工作区或功能/,
    });
    await user.click(trigger);

    const dialog = getSwitcherDialog();
    // jsdom 不实现 Escape 的 dialog 关闭协议，这里直接投递浏览器在 Escape 后派发的 close 事件；
    // 若 onClose 没有接到 setQuickOpen(false)，open 属性不会被清掉，本用例必红。
    fireEvent(dialog, new Event("close"));

    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
  });

  it("用 Ctrl+K 打开时，关闭后焦点回到原来的焦点元素", async () => {
    const user = userEvent.setup();
    setDesktopApi(makeApi());
    render(<DesktopTitlebar />);

    const back = await screen.findByRole("button", { name: "后退" });
    back.focus();
    expect(document.activeElement).toBe(back);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const dialog = getSwitcherDialog();
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(true));
    const search = screen.getByRole("textbox", { name: "搜索页面和工作区" });
    expect(document.activeElement).toBe(search);

    fireEvent(dialog, new Event("close"));

    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(back);
    await user.tab();
  });

});

function getSwitcherDialog(): HTMLDialogElement {
  const dialog = document.querySelector<HTMLDialogElement>(
    "dialog.helstera-desktop-switcher",
  );
  if (!dialog) throw new Error("未找到快速跳转 dialog");
  return dialog;
}
