// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkspacePanel } from "../src/components/agent-workspace-panel";

const api = vi.hoisted(() => ({
  fetchAgentGoals: vi.fn(), fetchAgentGoal: vi.fn(), fetchAgentSuggestions: vi.fn(),
  fetchAgentMemories: vi.fn(), fetchAgentConnectors: vi.fn(), setAgentConnectorEnabled: vi.fn(),
  reviewAgentGoalAction: vi.fn(),
}));
vi.mock("../src/lib/server-api", () => api);
vi.mock("../src/lib/i18n", () => ({ useLocale: () => "en-US" }));

const goal = (id: string, canvasId = "canvas") => ({
  id, canvasId, goal: `Goal ${id}`, status: "completed", executionMode: "automatic", outputKind: "auto",
  plan: { steps: [] }, activities: [], approvals: [], tasks: [], result: { summary: `Result ${id}` },
  updatedAt: "2026-11-01T00:00:00.000Z",
});

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  api.fetchAgentGoals.mockResolvedValue([goal("first"), goal("second"), goal("foreign", "other-canvas")]);
  api.fetchAgentSuggestions.mockResolvedValue([]);
  api.fetchAgentMemories.mockResolvedValue([]);
  api.fetchAgentConnectors.mockResolvedValue([]);
});
afterEach(cleanup);

describe("Agent workspace state", () => {
  it("reviews an interrupted action without exposing typed values or replaying it", async () => {
    const user = userEvent.setup();
    const interrupted = {
      ...goal("review"), status: "failed", tasks: [{ taskId: "task", reviewAvailable: true,
        checkpoint: { action: { approvalId: "approval", state: "uncertain" } },
        result: { screenshotAsset: { url: "/evidence.png" } } }],
      approvals: [{ approvalId: "approval", taskId: "task", status: "executed",
        action: { kind: "native_type", target: "Search", value: "private text" } }],
    };
    api.fetchAgentGoals.mockResolvedValue([interrupted]);
    api.reviewAgentGoalAction.mockResolvedValue({ replayed: false });
    api.fetchAgentGoal.mockResolvedValue({ ...interrupted, tasks: [{ ...interrupted.tasks[0], checkpoint: { action: { approvalId: "approval", state: "observed_completed" } } }] });
    render(<AgentWorkspacePanel accessToken="test" canvasId="canvas" />);
    await user.click(screen.getByRole("button", { name: "Agent workspace" }));
    expect(await screen.findByText("native_type")).toBeInTheDocument();
    expect(screen.queryByText("private text")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View saved screenshot" })).toHaveAttribute("href", "/evidence.png");
    await user.click(screen.getByRole("button", { name: "Observed completed" }));
    expect(api.reviewAgentGoalAction).toHaveBeenCalledWith("test", "review", "approval", "observed_completed");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Observed completed" })).not.toBeInTheDocument());
  });

  it("does not allow review while the desktop is still connected", async () => {
    api.fetchAgentGoals.mockResolvedValue([{ ...goal("review"), status: "failed",
      tasks: [{ taskId: "task", reviewAvailable: false, checkpoint: { action: { approvalId: "approval", state: "dispatched" } } }],
      approvals: [{ approvalId: "approval", taskId: "task", status: "approved", action: { kind: "native_click" } }],
    }]);
    render(<AgentWorkspacePanel accessToken="test" canvasId="canvas" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Agent workspace" }));
    expect(await screen.findByText(/only after the desktop connection is disconnected/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Observed completed" })).not.toBeInTheDocument();
    expect(api.reviewAgentGoalAction).not.toHaveBeenCalled();
  });

  it("restores the document download from the server result after remount", async () => {
    api.fetchAgentGoals.mockResolvedValue([{
      ...goal("report"), result: { summary: "Website evidence", documents: [{
        id: "report-doc", title: "Website report", fileName: "report.md", mimeType: "text/markdown",
        content: "# Evidence", sourceUrls: ["https://example.com/"],
      }] },
    }]);
    const mounted = render(<AgentWorkspacePanel accessToken="test" canvasId="canvas" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Agent workspace" }));
    expect(await screen.findByRole("button", { name: "Download Markdown" })).toBeInTheDocument();
    mounted.unmount();
    render(<AgentWorkspacePanel accessToken="test" canvasId="canvas" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Agent workspace" }));
    expect(await screen.findByRole("button", { name: "Download Markdown" })).toBeInTheDocument();
    expect(screen.getByText(/Not automatically saved/)).toBeInTheDocument();
  });

  it("keeps goals canvas-scoped and restores the selected goal after remount", async () => {
    const user = userEvent.setup();
    const mounted = render(<AgentWorkspacePanel accessToken="test" canvasId="canvas" />);
    await user.click(screen.getByRole("button", { name: "Agent workspace" }));
    await screen.findByRole("heading", { name: "Goal first" });
    await user.click(screen.getByRole("combobox", { name: "Recent goals" }));
    expect(screen.queryByRole("option", { name: "Goal foreign" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Goal second" }));
    expect(screen.getByText("Result second")).toBeInTheDocument();
    expect(sessionStorage.getItem("agent-goal:canvas")).toBe("second");
    mounted.unmount();

    render(<AgentWorkspacePanel accessToken="test" canvasId="canvas" />);
    await user.click(screen.getByRole("button", { name: "Agent workspace" }));
    expect(await screen.findByRole("heading", { name: "Goal second" })).toBeInTheDocument();
  });

  it("shows API failures rather than silently treating them as empty lists", async () => {
    api.fetchAgentConnectors.mockRejectedValue(new Error("Connector service unavailable"));
    render(<AgentWorkspacePanel accessToken="test" canvasId="canvas" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Agent workspace" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Connector service unavailable"));
  });

  it("deduplicates replayed goal events and keeps the newest refresh", async () => {
    let onEvent: ((event: { type: "agent.goal"; goalId: string; canvasId: string; eventType: string; status: string; timestamp: string; payload: Record<string, unknown>; detail: null }) => void) | undefined;
    const ws = {
      onEvent: (listener: typeof onEvent) => {
        onEvent = listener;
        return () => { onEvent = undefined; };
      },
    };
    const newer = { ...goal("live"), status: "completed", updatedAt: "2026-11-01T00:00:02.000Z" };
    api.fetchAgentGoal.mockResolvedValue(newer);
    render(<AgentWorkspacePanel accessToken="test" canvasId="canvas" ws={ws} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Agent workspace" }));
    await waitFor(() => expect(onEvent).toBeTypeOf("function"));

    const event = {
      type: "agent.goal" as const,
      goalId: "live",
      canvasId: "canvas",
      eventType: "goal.completed",
      status: "completed",
      timestamp: "2026-11-01T00:00:02.000Z",
      payload: {},
      detail: null,
    };
    onEvent?.(event);
    onEvent?.(event);

    await waitFor(() => expect(api.fetchAgentGoal).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("Goal live").length).toBeGreaterThan(0);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
});
