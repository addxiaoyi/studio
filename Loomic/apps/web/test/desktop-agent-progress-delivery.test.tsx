// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopAgentProgressCard } from "@/components/chat/desktop-agent-progress-card";

const mocks = vi.hoisted(() => ({ fetchDesktopAgentTask: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "token" } }) }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => "en-US" }));
vi.mock("@/lib/server-api", () => ({ ...mocks, cancelDesktopAgentTask: vi.fn(), resolveDesktopAgentApproval: vi.fn() }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("desktop task result delivery", () => {
  it("waits for chat delivery before refreshing and then stops polling", async () => {
    vi.useFakeTimers();
    const task = { taskId: "task-1", chatSessionId: "session-1", goal: "Test", role: "operator", capabilities: [], status: "succeeded", result: null, error: null, events: [], pendingApprovals: [] };
    mocks.fetchDesktopAgentTask.mockResolvedValueOnce({ ...task, chatDeliveryPending: true }).mockResolvedValue({ ...task, chatDeliveryPending: false });
    const listener = vi.fn();
    window.addEventListener("helstera:desktop-agent-result", listener);
    try {
      await act(async () => { render(<DesktopAgentProgressCard taskId="task-1" />); });
      expect(listener).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(listener).toHaveBeenCalledOnce();
      expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ sessionId: "session-1" });
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(mocks.fetchDesktopAgentTask).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener("helstera:desktop-agent-result", listener); }
  });
});
