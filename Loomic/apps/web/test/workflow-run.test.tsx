import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentGoal } from "@helstera/shared";
import { fetchAgentGoal } from "@/lib/server-api";
import { useWorkflowRun } from "@/components/workflow/run-panel";

vi.mock("@/lib/server-api", () => ({ fetchAgentGoal: vi.fn(), updateAgentGoal: vi.fn() }));
vi.mock("@/components/chat/markdown-renderer", () => ({ MarkdownRenderer: () => null }));
vi.mock("@/components/chat/authenticated-recording", () => ({ AuthenticatedRecording: () => null }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it("refreshes the matching chat after completion and stops polling terminal runs", async () => {
  vi.useFakeTimers();
  const pending = { id: "goal", status: "running", chatSessionId: "session" } as AgentGoal;
  vi.mocked(fetchAgentGoal).mockResolvedValueOnce(pending).mockResolvedValue({ ...pending, status: "completed" });
  const sync = vi.fn(), notified = vi.fn();
  window.addEventListener("helstera:desktop-agent-result", notified);
  try {
    renderHook(() => useWorkflowRun("token", "goal", sync));
    await act(async () => { await Promise.resolve(); });
    expect(notified).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(sync).toHaveBeenCalledOnce();
    expect(notified).toHaveBeenCalledOnce();
    expect((notified.mock.calls[0]![0] as CustomEvent).detail).toEqual({ sessionId: "session" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetchAgentGoal).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener("helstera:desktop-agent-result", notified);
  }
});

it("ignores a completed response after switching to another run", async () => {
  let finish!: (goal: AgentGoal) => void;
  vi.mocked(fetchAgentGoal).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const sync = vi.fn(), notified = vi.fn();
  window.addEventListener("helstera:desktop-agent-result", notified);
  try {
    const hook = renderHook(({ goalId }: { goalId: string | null }) => useWorkflowRun("token", goalId, sync), { initialProps: { goalId: "old" as string | null } });
    hook.rerender({ goalId: null });
    await act(async () => { finish({ id: "old", status: "completed", chatSessionId: "old-session" } as AgentGoal); });
    expect(sync).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
    expect(hook.result.current.goal).toBeNull();
  } finally {
    window.removeEventListener("helstera:desktop-agent-result", notified);
  }
});
