// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { WorkflowDialogs } from "@/components/workflow/dialogs";
import { useWorkflowPreflight } from "@/components/workflow/use-preflight";
import { inspectCanvasWorkflow } from "@/lib/canvas-workflow-api";
import { type WorkflowPreflight, websiteWorkflow } from "@helstera/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/canvas-workflow-api", () => ({
  inspectCanvasWorkflow: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const ready: WorkflowPreflight = {
  revision: 1,
  ready: true,
  issues: [],
  quotes: [],
};
const options = {
  open: true,
  token: "token",
  canvasId: "canvas",
  workflowId: "flow",
  revision: 1,
  graph: websiteWorkflow(),
};

it("ignores late checks after changing the graph or execution scope", async () => {
  let finishOld: (report: WorkflowPreflight) => void = () => {
    throw new Error("Request was not started");
  };
  vi.mocked(inspectCanvasWorkflow)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockResolvedValue(ready);
  const hook = renderHook((props) => useWorkflowPreflight(props), {
    initialProps: { ...options, targetNodeId: "first" },
  });
  expect(hook.result.current.report).toBeNull();
  hook.rerender({ ...options, targetNodeId: "second" });
  await waitFor(() => expect(hook.result.current.report).toEqual(ready));
  await act(async () => {
    finishOld({
      ...ready,
      ready: false,
      issues: [
        {
          nodeId: "first",
          title: "old",
          code: "model",
          message: "old failure",
          action: "change",
        },
      ],
    });
  });
  expect(hook.result.current.report).toEqual(ready);
});
it("clears a failed check and retries without retaining an old success", async () => {
  vi.mocked(inspectCanvasWorkflow)
    .mockRejectedValueOnce(new Error("检查服务暂时不可用"))
    .mockResolvedValue(ready);
  const hook = renderHook(() => useWorkflowPreflight(options));
  await waitFor(() =>
    expect(hook.result.current.error).toBe("检查服务暂时不可用"),
  );
  expect(hook.result.current.report).toBeNull();
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.report).toEqual(ready));
  expect(hook.result.current.error).toBe("");
});
it("blocks confirmation for loading/errors/issues and exposes node repair actions", () => {
  const run = vi.fn();
  const locate = vi.fn();
  const props = {
    proposal: null,
    title: "检查流程",
    revision: 1,
    plan: null,
    confirmRun: true,
    busy: false,
    discard: vi.fn(),
    apply: vi.fn(),
    setConfirmRun: vi.fn(),
    run,
    budget: "0",
    setBudget: vi.fn(),
    locateIssue: locate,
  };
  const { rerender } = render(
    <WorkflowDialogs
      {...props}
      preflight={{ report: null, checking: true, error: "", retry: vi.fn() }}
    />,
  );
  expect(
    screen.getByRole("button", { name: "确认运行已保存版本" }),
  ).toBeDisabled();
  const blocked: WorkflowPreflight = {
    ...ready,
    ready: false,
    issues: [
      {
        nodeId: "image",
        title: "图片生成",
        code: "model",
        message: "所选模型不可用",
        action: "更换模型",
      },
    ],
  };
  rerender(
    <WorkflowDialogs
      {...props}
      preflight={{
        report: blocked,
        checking: false,
        error: "",
        retry: vi.fn(),
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "更换模型 · 定位节点" }));
  expect(locate).toHaveBeenCalledWith("image");
  expect(run).not.toHaveBeenCalled();
  rerender(
    <WorkflowDialogs
      {...props}
      preflight={{
        report: null,
        checking: false,
        error: "检查失败",
        retry: vi.fn(),
      }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("检查失败");
  expect(
    screen.getByRole("button", { name: "确认运行已保存版本" }),
  ).toBeDisabled();
  rerender(
    <WorkflowDialogs
      {...props}
      preflight={{ report: ready, checking: false, error: "", retry: vi.fn() }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认运行已保存版本" }));
  expect(run).toHaveBeenCalledOnce();
});
