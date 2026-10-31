import { describe, expect, it } from "vitest";
import { DesktopActionApprovals } from "./desktop-action-approval.js";
import { classifyDesktopAction, type DesktopAgentAction } from "@helstera/shared";

const taskId = "00000000-0000-4000-8000-000000000001";
const approvalId = "00000000-0000-4000-8000-000000000002";
const action: DesktopAgentAction = { taskId, requestId: "request", kind: "native_click", x: 10, y: 20 };
const approved = { ...action, approvalId, approvalToken: "0123456789abcdef" };

describe("desktop action approvals", () => {
  it.each(["native_double_click", "native_right_click", "start_recording", "stop_recording"] as const)("requires approval for %s", (kind) => {
    expect(classifyDesktopAction({ ...action, kind })).toBe("deny");
    expect(classifyDesktopAction({ ...approved, kind })).toBe("confirm");
  });
  it("binds every action field and consumes approval only once", () => {
    const approvals = new DesktopActionApprovals();
    approvals.register(approvalId, action, "2030-01-01T00:00:00Z");
    expect(approvals.consume({ ...approved, x: 11 }, 1)).toBe(false);
    expect(approvals.consume(approved, 1)).toBe(true);
    expect(approvals.consume(approved, 1)).toBe(false);
  });

  it("rejects expired, missing and cleared approvals", () => {
    const approvals = new DesktopActionApprovals();
    approvals.register(approvalId, action, "2026-01-01T00:00:00Z");
    expect(approvals.consume(approved, Date.parse("2026-01-01T00:00:00Z"))).toBe(false);
    expect(approvals.consume({ ...approved, approvalId: undefined }, 1)).toBe(false);
    approvals.clearTask(taskId);
    expect(approvals.consume(approved, 1)).toBe(false);
  });
});
