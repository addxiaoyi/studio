import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/error-boundary";
import { ToastProvider, useToast } from "@/components/toast";
function Broken(): never {
  throw new Error("fixture render failure");
}
function Notice() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.error("保存失败，内容已保留")}>
        失败
      </button>
      <button type="button" onClick={() => toast.success("已保存")}>
        成功
      </button>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset.helsteraDesktop;
});
it("links recovery to the actual web or desktop workspace instead of a hash", () => {
  const { unmount } = render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
    "href",
    "/home/",
  );
  unmount();
  document.documentElement.dataset.helsteraDesktop = "true";
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
    "href",
    "/desktop-app/",
  );
});
it("keeps errors readable until dismissed and pauses success expiry while reading", async () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Notice />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "失败" }));
  await act(async () => vi.advanceTimersByTime(12000));
  expect(screen.getByRole("alert")).toHaveTextContent("内容已保留");
  fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
  fireEvent.click(screen.getByRole("button", { name: "成功" }));
  fireEvent.mouseEnter(screen.getByRole("status"));
  await act(async () => vi.advanceTimersByTime(12000));
  expect(screen.getByRole("status")).toHaveTextContent("已保存");
  fireEvent.mouseLeave(screen.getByRole("status"));
  await act(async () => vi.advanceTimersByTime(6000));
  expect(screen.queryByRole("status")).toBeNull();
});
