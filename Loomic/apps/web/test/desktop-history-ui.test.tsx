import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopAgentHistoryPage } from "@/components/desktop-agent-history-page";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  session: { access_token: "token", user: { id: "user" } },
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: mocks.session }),
}));
vi.mock("@/lib/server-api", () => ({ fetchDesktopAgentTasks: mocks.fetch }));
vi.mock("@/components/chat/desktop-agent-progress-card", () => ({
  DesktopAgentProgressCard: ({ taskId }: { taskId: string }) => (
    <p>详情 {taskId}</p>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const task = {
  taskId: "one",
  goal: "录制首页",
  status: "failed",
  executionMode: "isolated_browser",
  role: "operator",
  createdAt: "2026-11-09T00:00:00Z",
};
it("labels task states, keeps usable history after refresh failure and clears unmatched search", async () => {
  mocks.fetch
    .mockResolvedValueOnce([task])
    .mockRejectedValueOnce(new Error("连接暂不可用"));
  render(<DesktopAgentHistoryPage />);
  await screen.findByText("录制首页");
  expect(screen.getByText(/失败待处理/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "刷新记录" }));
  await screen.findByRole("alert");
  expect(screen.getByText("录制首页")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "找不到" },
  });
  expect(screen.getByText("没有符合筛选条件的任务")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getByText("录制首页")).toBeInTheDocument();
});
it("blocks overlapping refresh requests", async () => {
  let resolve!: (value: unknown) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<DesktopAgentHistoryPage />);
  expect(screen.getByRole("button", { name: "正在刷新…" })).toBeDisabled();
  await act(async () => resolve([task]));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "刷新记录" })).toBeEnabled(),
  );
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
