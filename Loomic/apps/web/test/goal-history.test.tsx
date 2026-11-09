import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GoalHistory, goalCanvasLink } from "@/components/goal-history";
const fixture = vi.hoisted(() => ({
	goal: {
		id: "goal",
		canvasId: "canvas",
		chatSessionId: "chat",
		goal: "Switch 批量验收",
		status: "completed",
		updatedAt: "2026-11-09T00:00:00Z",
	},
	fetch: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({
	useAuth: () => ({ session: { access_token: "token" } }),
}));
vi.mock("@/lib/server-api", () => ({ fetchAgentGoals: fixture.fetch }));
vi.mock("@/components/workflow/run-panel", () => ({
	useWorkflowRun: () => ({ goal: fixture.goal, error: "", refresh: vi.fn() }),
	WorkflowRunPanel: () => <p>已完成的执行步骤</p>,
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("shows canvas workflow runs and links directly to their goal and conversation", async () => {
	fixture.fetch.mockResolvedValue([fixture.goal]);
	render(<GoalHistory />);
	await screen.findByText("Switch 批量验收");
	expect(
		screen.getByRole("link", { name: "打开对应画布与任务" }),
	).toHaveAttribute("href", "/canvas?id=canvas&goalId=goal&session=chat");
	expect(screen.getByText("已完成的执行步骤")).toBeVisible();
	expect(goalCanvasLink(fixture.goal as never, true)).toBe(
		"/desktop-app/canvas/?id=canvas&goalId=goal&session=chat",
	);
});
