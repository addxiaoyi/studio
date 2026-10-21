import { describe, expect, it } from "vitest";

import { classifyDesktopAction, desktopAgentActionSchema, desktopAgentEventSchema, desktopAgentTaskRequestSchema, isDesktopActionAuthorized } from "./desktop-control.js";

describe("desktop control policy", () => {
  it("limits tasks to declared roles and capabilities", () => {
    const task = desktopAgentTaskRequestSchema.parse({
      goal: "读取当前网站页面",
      role: "researcher",
      capabilities: ["browser.read", "browser.capture"],
    });
    expect(task.role).toBe("researcher");
    expect(task.maxDurationSeconds).toBe(300);
  });

  it("denies credentials and requires a token for side effects", () => {
    expect(classifyDesktopAction({ requestId: "a", taskId: "00000000-0000-0000-0000-000000000001", kind: "read_page" })).toBe("allow");
    expect(classifyDesktopAction({ requestId: "b", taskId: "00000000-0000-0000-0000-000000000001", kind: "click", target: "#buy" })).toBe("deny");
    expect(classifyDesktopAction({ requestId: "c", taskId: "00000000-0000-0000-0000-000000000001", kind: "type", fieldType: "password", value: "secret", approvalToken: "abcdefghijklmnop" })).toBe("deny");
    expect(classifyDesktopAction({ requestId: "d", taskId: "00000000-0000-0000-0000-000000000001", kind: "click", target: "#buy", approvalToken: "abcdefghijklmnop" })).toBe("confirm");
  });

  it("only accepts bounded HTTP page evidence without URL credentials", () => {
    const base = { taskId: "00000000-0000-0000-0000-000000000001", eventType: "page" as const };
    expect(desktopAgentEventSchema.safeParse({ ...base, result: { page: { url: "javascript:alert(1)" } } }).success).toBe(false);
    expect(desktopAgentEventSchema.safeParse({ ...base, result: { page: { url: "https://user:pass@example.test/" } } }).success).toBe(false);
    expect(desktopAgentEventSchema.safeParse({ ...base, result: { screenshotBase64: "a".repeat(11_200_001) } }).success).toBe(false);
    expect(desktopAgentEventSchema.safeParse({ ...base, result: { page: { url: "https://example.test/", title: "Site" } } }).success).toBe(true);
  });

  it("preserves the approval id on the one-time execution action", () => {
    const action = desktopAgentActionSchema.parse({
      requestId: "request-1",
      taskId: "00000000-0000-0000-0000-000000000001",
      approvalId: "00000000-0000-0000-0000-000000000002",
      kind: "click",
      target: "#continue",
      approvalToken: "abcdefghijklmnop",
    });
    expect(action.approvalId).toBe("00000000-0000-0000-0000-000000000002");
  });

  it("rejects actions outside a task's declared capabilities", () => {
    const action = desktopAgentActionSchema.parse({
      requestId: "request-2",
      taskId: "00000000-0000-0000-0000-000000000001",
      kind: "type",
      target: "#search",
      value: "query",
    });
    expect(isDesktopActionAuthorized(action, ["browser.read"])).toBe(false);
    expect(isDesktopActionAuthorized(action, ["browser.type"])).toBe(true);
  });
});
