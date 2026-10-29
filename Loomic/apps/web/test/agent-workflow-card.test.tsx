import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { AgentWorkflowCard } from "../src/components/chat/agent-workflow-card";

const api = vi.hoisted(() => ({
  approveAgentWorkflow: vi.fn(),
  fetchAgentWorkflow: vi.fn(),
  fetchJob: vi.fn(),
  retryAgentWorkflow: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "test" } }) }));
vi.mock("../src/lib/server-api", () => api);

const paused = {
  id: "workflow-1",
  goal: "Generate a launch image",
  status: "paused" as const,
  plan: {
    approvalGate: { required: true, stepId: "generate", reason: "Generation requires confirmation." },
    steps: [
      { id: "draft", title: "Prepare draft", status: "completed", retryable: true },
      { id: "generate", title: "Generate media", status: "awaiting_approval", retryable: true },
    ],
  },
};

const completed = {
  ...paused,
  status: "completed" as const,
  plan: {
    approvalGate: { required: false },
    steps: [
      { id: "draft", title: "Prepare draft", status: "completed", retryable: true },
      { id: "generate", title: "Generate media", status: "completed", retryable: true, output: { jobId: "job-1" } },
    ],
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("approves a paused workflow and refreshes the generated job state", async () => {
  api.fetchAgentWorkflow.mockResolvedValueOnce(paused).mockResolvedValue(completed);
  api.approveAgentWorkflow.mockResolvedValue(completed);
  api.fetchJob.mockResolvedValue({ job: { id: "job-1", status: "succeeded", progress: 100 } });

  render(<AgentWorkflowCard workflowId="workflow-1" />);
  expect(await screen.findByRole("button", { name: "确认并继续" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "确认并继续" }));

  expect(api.approveAgentWorkflow).toHaveBeenCalledWith("test", "workflow-1");
  expect(await screen.findByText("已完成")).toBeInTheDocument();
  expect(await screen.findByText("succeeded")).toBeInTheDocument();
});

it("exposes retry for a failed retryable workflow step", async () => {
  const failed = {
    ...paused,
    status: "failed" as const,
    plan: {
      approvalGate: { required: false },
      steps: [{ id: "draft", title: "Prepare draft", status: "failed", retryable: true, error: "temporary failure" }],
    },
  };
  api.fetchAgentWorkflow.mockResolvedValue(failed);
  api.retryAgentWorkflow.mockResolvedValue(completed);

  render(<AgentWorkflowCard workflowId="workflow-1" />);
  expect(await screen.findByRole("button", { name: "重试步骤" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重试步骤" }));
  expect(api.retryAgentWorkflow).toHaveBeenCalledWith("test", "workflow-1");
});

// Batch-1 audit items 17/18: the workflow card is rendered inside the dark chat
// drawer, so its status surfaces must use shared design tokens. Hardcoded
// palette classes plus `dark:` overrides diverge from the token theme; this test
// pins the token contract (not a specific hue) for the card.
it("uses shared theme tokens instead of hardcoded palette colors", async () => {
  api.fetchAgentWorkflow.mockResolvedValue(paused);

  const { container } = render(<AgentWorkflowCard workflowId="workflow-1" />);
  expect(await screen.findByRole("button", { name: "确认并继续" })).toBeInTheDocument();

  const html = container.innerHTML;
  expect(html).not.toMatch(/\bdark:/);
  expect(html).not.toMatch(/-(amber|emerald|sky|red|green|blue)-\d{3}/);
  expect(html).toContain("bg-warning/10");
  expect(html).toContain("border-info/30");
});
