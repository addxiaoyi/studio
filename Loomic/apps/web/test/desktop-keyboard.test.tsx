// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopWorkspaceSidebar } from "@/components/desktop-workspace-sidebar";

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/desktop-app/canvas",
  useRouter: () => ({ replace: mockReplace, push: mockReplace }),
}));

const scrollIntoView = vi.fn();

beforeEach(() => {
  mockReplace.mockClear();
  scrollIntoView.mockClear();
  // jsdom 不实现 scrollIntoView，这里装一个探针，既避免真实调用也用来断言调用参数。
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  Reflect.deleteProperty(document.documentElement.dataset, "sidebarCollapsed");
});

function item(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

function tabbableItems(): HTMLButtonElement[] {
  return screen
    .getAllByRole("button")
    .filter((element): element is HTMLButtonElement => element.tabIndex === 0);
}

describe("DesktopWorkspaceSidebar 键盘导航", () => {
  it("把容器声明为 navigation 并只让一项进入 Tab 序列", () => {
    render(<DesktopWorkspaceSidebar />);

    expect(screen.getByRole("navigation", { name: "桌面模块" })).not.toBeNull();
    expect(item("画布").getAttribute("aria-current")).toBe("page");
    expect(item("画布").title).toBe("画布");
    expect(item("高级能力").getAttribute("aria-expanded")).toBe("false");
    expect(item("画布").tabIndex).toBe(0);
    expect(item("高级能力").tabIndex).toBe(-1);
    expect(item("设置").tabIndex).toBe(-1);
    expect(tabbableItems()).toHaveLength(1);
  });

  it("用方向键在可见项之间移动焦点并同步 roving tabindex", async () => {
    const user = userEvent.setup();
    render(<DesktopWorkspaceSidebar />);

    const canvas = item("画布");
    const advancedToggle = item("高级能力");
    canvas.focus();
    expect(document.activeElement).toBe(canvas);

    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(advancedToggle);
    expect(advancedToggle.tabIndex).toBe(0);
    expect(canvas.tabIndex).toBe(-1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    await user.keyboard("{ArrowUp}");

    expect(document.activeElement).toBe(canvas);
    expect(canvas.tabIndex).toBe(0);
    expect(advancedToggle.tabIndex).toBe(-1);
    expect(tabbableItems()).toHaveLength(1);
  });

  it("用 Home/End 跳到首尾，且两端不回绕", async () => {
    const user = userEvent.setup();
    render(<DesktopWorkspaceSidebar />);

    item("画布").focus();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(item("设置"));
    expect(item("设置").tabIndex).toBe(0);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("设置"));

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(item("画布"));

    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(item("画布"));
  });

  it("展开进阶项后方向键能走完全部可见项", async () => {
    const user = userEvent.setup();
    render(<DesktopWorkspaceSidebar />);

    await user.click(item("高级能力"));

    expect(item("高级能力").getAttribute("aria-expanded")).toBe("true");
    expect(item("项目")).not.toBeNull();
    expect(tabbableItems()).toHaveLength(1);

    item("高级能力").focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("项目"));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("素材"));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("MCP 工具"));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("本地开发"));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("设置"));
    expect(tabbableItems()).toHaveLength(1);
  });

  it("焦点停在进阶项上时折叠，roving tabindex 收敛到最后一项而不是整组失效", async () => {
    const user = userEvent.setup();
    render(<DesktopWorkspaceSidebar />);

    await user.click(item("高级能力"));
    await user.click(item("本地开发"));
    expect(item("本地开发").tabIndex).toBe(0);

    fireEvent.click(item("高级能力"));

    expect(screen.queryByRole("button", { name: "本地开发" })).toBeNull();
    expect(tabbableItems()).toHaveLength(1);
    expect(item("设置").tabIndex).toBe(0);
  });

  it("折叠态下（根元素标记 collapsed）键盘行为不变", async () => {
    const user = userEvent.setup();
    document.documentElement.dataset.sidebarCollapsed = "true";
    render(<DesktopWorkspaceSidebar />);

    item("画布").focus();
    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(item("高级能力"));
    expect(item("高级能力").tabIndex).toBe(0);
    // 折叠态仍保留原按钮与既有可访问属性，只是视觉上只显示图标。
    expect(item("高级能力").title).toBe("高级能力");
    expect(item("高级能力").getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter/Space 仍走原生 button 激活，不被键盘导航吞掉", async () => {
    const user = userEvent.setup();
    render(<DesktopWorkspaceSidebar />);

    item("设置").focus();
    await user.keyboard("{Enter}");
    expect(mockReplace).toHaveBeenCalledWith("/settings/");

    mockReplace.mockClear();
    item("画布").focus();
    await user.keyboard(" ");
    expect(mockReplace).toHaveBeenCalledWith("/desktop-app/canvas/");
  });
});
