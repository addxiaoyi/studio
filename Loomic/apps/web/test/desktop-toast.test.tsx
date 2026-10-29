// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopToastProvider, useDesktopToast } from "@/components/desktop-toast";

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useDesktopToast>) => void }) {
  const api = useDesktopToast();
  onReady(api);
  return <button type="button" onClick={() => api.push({ tone: "success", message: "已保存" })}>触发</button>;
}

function mount() {
  let api: ReturnType<typeof useDesktopToast> | null = null;
  render(
    <DesktopToastProvider>
      <Harness onReady={(next) => { api = next; }} />
    </DesktopToastProvider>,
  );
  return () => api!;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DesktopToast", () => {
  it("renders success, error and info toasts and exposes a live region", async () => {
    const api = mount();
    act(() => {
      api().push({ tone: "success", message: "安装完成" });
      api().push({ tone: "error", message: "连接失败" });
      api().push({ tone: "info", message: "正在检查更新" });
    });
    expect(await screen.findByText("安装完成")).toBeTruthy();
    expect(screen.getByText("连接失败")).toBeTruthy();
    expect(screen.getByText("正在检查更新")).toBeTruthy();
    const region = document.querySelector(".desktop-toast-viewport");
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });

  it("collapses repeated informational chatter inside the de-duplication window", async () => {
    const api = mount();
    act(() => {
      api().push({ tone: "info", message: "正在检查更新" });
      api().push({ tone: "info", message: "正在检查更新" });
    });
    expect(await screen.findAllByText("正在检查更新")).toHaveLength(1);
  });

  it("never swallows repeated errors — a second failure must look like a failure", async () => {
    const api = mount();
    act(() => {
      api().push({ tone: "error", message: "保存失败" });
      api().push({ tone: "error", message: "保存失败" });
    });
    expect(await screen.findAllByText("保存失败")).toHaveLength(2);
  });

  it("keeps distinct keys side by side and lets the user dismiss one", async () => {
    const user = userEvent.setup();
    const api = mount();
    act(() => {
      api().push({ key: "a", tone: "info", message: "提示 A" });
      api().push({ key: "b", tone: "info", message: "提示 B" });
    });
    expect(await screen.findByText("提示 A")).toBeTruthy();
    expect(screen.getByText("提示 B")).toBeTruthy();
    const dismissButtons = screen.getAllByRole("button", { name: "关闭提示" });
    await user.click(dismissButtons[0]!);
    expect(screen.queryByText("提示 A")).toBeNull();
    expect(screen.getByText("提示 B")).toBeTruthy();
  });

  it("auto-dismisses after the configured duration", async () => {
    vi.useFakeTimers();
    const api = mount();
    act(() => {
      api().push({ tone: "info", message: "自动消失", durationMs: 1000 });
    });
    expect(screen.getByText("自动消失")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.queryByText("自动消失")).toBeNull();
  });

  it("degrades to a no-op outside the provider instead of throwing", () => {
    function Bare() {
      const api = useDesktopToast();
      return <button type="button" onClick={() => api.push("x")}>裸调用</button>;
    }
    render(<Bare />);
    expect(() => screen.getByRole("button", { name: "裸调用" }).click()).not.toThrow();
  });
});
