import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OperationStatus } from "./operation-status";

const states = [
  "loading",
  "saving",
  "saved",
  "running",
  "success",
  "error-retryable",
  "error-blocked",
] as const;

describe("OperationStatus", () => {
  it("renders each non-idle state with the correct live region", () => {
    for (const status of states) {
      const { unmount } = render(<OperationStatus status={status} label="项目" />);
        expect(screen.getByRole(status.startsWith("error") ? "alert" : "status").textContent).toContain("项目");
      unmount();
    }
  });

  it("renders nothing while idle", () => {
    const { container } = render(<OperationStatus status="idle" label="项目" />);
    expect(container.innerHTML).toBe("");
  });

  it("invokes a retry action and disables it while busy", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <OperationStatus
        status="error-retryable"
        label="导出"
        actionLabel="重试"
        onAction={onAction}
        busy
      />,
    );
    const button = screen.getByRole("button", { name: "重试" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });
});
