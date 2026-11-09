// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CaptureCanvasActions } from "@/components/chat/capture-canvas-actions";
import { CaptureRecordingProgress } from "@/components/chat/capture-recording-progress";
import { CaptureSkippedPages } from "@/components/chat/capture-skipped-pages";

const api = vi.hoisted(() => ({ addWebsiteCaptureToCanvas: vi.fn(), openAgentBrowser: vi.fn(), fetchCanvas: vi.fn(async()=>({canvas:{name:"原录制画布"}})) }));
vi.mock("@/lib/server-api", () => api);
vi.mock("@/lib/agent-browser-api", () => api);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("recovers pending canvas delivery and publishes a scoped refresh event", async () => {
  const completed = { status: "succeeded", canvasId: "canvas-one", elementIds: ["video-one"] };
  api.addWebsiteCaptureToCanvas.mockResolvedValue(completed);
  const events: unknown[] = [];
  const receive = (event: Event) => events.push((event as CustomEvent).detail);
  window.addEventListener("loomic:capture-canvas", receive);
  const result = { canvasDelivery: { status: "pending", elementIds: [] } } as never;
  const view = render(<CaptureCanvasActions taskId="task-one" token="token" result={result} />);
  expect(await screen.findByText(/截图与录像已添加到原任务画布/)).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "打开原画布素材" })).toBeEnabled();
  view.rerender(<CaptureCanvasActions taskId="task-one" token="token" result={result} />);
  await waitFor(() => expect(api.addWebsiteCaptureToCanvas).toHaveBeenCalledTimes(1));
  expect(events).toContainEqual({ ...completed, focus: true });
  window.removeEventListener("loomic:capture-canvas", receive);
});

it("keeps a recoverable error and does not claim delivery success", async () => {
  api.addWebsiteCaptureToCanvas.mockRejectedValue(new Error("素材已到期"));
  render(<CaptureCanvasActions taskId="task-one" token="token" result={{} as never} />);
  fireEvent.click(screen.getByRole("button", { name: "添加截图与录像到画布" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("素材已到期");
  expect(screen.queryByText("截图与录像已添加到画布")).not.toBeInTheDocument();
});

it("shows elapsed output and estimated wait without exposing JSON", () => {
  render(<CaptureRecordingProgress task={{ status: "running", recordingProgress: { renderedSeconds: 3.5, totalSeconds: 12, elapsedSeconds: 10, remainingSeconds: 25, pageIndex: 1, pageCount: 2 } } as never} />);
  expect(screen.getByLabelText("录像生成进度")).toHaveTextContent("已生成 3.5 / 12 秒 · 第 1/2 页 · 预计还需 25 秒");
});

it("lists skipped pages and opens a new confirmation path for the specific page", () => {
  const retry = vi.fn(); window.addEventListener("loomic:website-retry-page", retry);
  render(<CaptureSkippedPages taskId="task-one" result={{ skippedPages: [{ url: "https://example.com/assets", reason: "网页仍在加载" }] } as never} />);
  expect(screen.getByLabelText("未完成的页面")).toHaveTextContent("网页仍在加载");
  fireEvent.click(screen.getByRole("button", { name: "重新准备此页录制" }));
  expect(api.openAgentBrowser).toHaveBeenCalledWith("task-one");
  expect(retry.mock.calls[0]![0].detail.url).toBe("https://example.com/assets");
  window.removeEventListener("loomic:website-retry-page", retry);
});
