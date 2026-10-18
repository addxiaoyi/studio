// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cancelMock, confirmMock, statusMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  confirmMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "test-token" } }),
}));

vi.mock("../src/lib/server-api", () => ({
  cancelGenerationApproval: cancelMock,
  confirmGenerationApproval: confirmMock,
  confirmLatestGenerationApproval: vi.fn(),
  fetchGenerationApprovalStatus: statusMock,
}));

import { GenerationApprovalCard } from "../src/components/chat/generation-approval-card";

describe("GenerationApprovalCard", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    statusMock.mockReset().mockResolvedValue({ approvalStatus: "pending" });
  });

  afterEach(() => {
    cleanup();
  });

  it("submits only once when confirmation is clicked twice before state refresh", async () => {
    let finishConfirmation!: (value: { data: { jobId: string } }) => void;
    const confirmation = new Promise<{ data: { jobId: string } }>((resolve) => {
      finishConfirmation = resolve;
    });
    confirmMock.mockReturnValue(confirmation);

    render(
      <GenerationApprovalCard
        approvalId="approval-1"
        jobType="image_generation"
        model="image-model"
        estimatedCredits={1}
        hasReferenceImage={false}
        expiresAt="2030-01-01T00:00:00.000Z"
      />,
    );

    const card = screen.getByRole("region", { name: "Generation confirmation" });
    const confirm = within(card).getAllByRole("button")[0]!;
    act(() => {
      confirm.click();
      confirm.click();
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishConfirmation({ data: { jobId: "job-1" } });
      await confirmation;
    });
  });

  it("replaces an expired confirmation with a terminal status and stops polling", async () => {
    statusMock.mockResolvedValue({ approvalStatus: "expired" });

    render(
      <GenerationApprovalCard
        approvalId="approval-expired"
        jobType="image_generation"
        model="image-model"
        estimatedCredits={1}
        hasReferenceImage={false}
        expiresAt="2030-01-01T00:00:00.000Z"
      />,
    );

    expect(await screen.findByRole("status", { name: "Generation confirmation status" })).toHaveTextContent("确认已过期");
    expect(screen.queryByRole("button", { name: /确认生成/ })).not.toBeInTheDocument();
    expect(statusMock).toHaveBeenCalledTimes(1);
  });
});
