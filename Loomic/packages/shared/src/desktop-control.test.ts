import { describe, expect, it } from "vitest";

import { classifyDesktopAction, desktopAgentActionSchema, desktopAgentEventSchema, desktopAgentTaskRequestSchema, isDesktopActionAuthorized, isReadOnlyNativeMcpTool } from "./desktop-control.js";

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

  it("allows long tasks up to 30 minutes and rejects longer deadlines", () => {
    const base = { goal: "Wait for the installer", role: "operator", capabilities: ["screen.read"] };
    expect(desktopAgentTaskRequestSchema.parse({ ...base, maxDurationSeconds: 1_800 }).maxDurationSeconds).toBe(1_800);
    expect(desktopAgentTaskRequestSchema.safeParse({ ...base, maxDurationSeconds: 1_801 }).success).toBe(false);
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

  it("classifies new native actions", () => {
    expect(classifyDesktopAction({ requestId: "n1", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_key", key: "Enter" })).toBe("deny");
    expect(classifyDesktopAction({ requestId: "n2", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_key", key: "Enter", approvalToken: "abcdefghijklmnop" })).toBe("confirm");
    expect(classifyDesktopAction({ requestId: "n3", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_key", key: "Win" })).toBe("deny");
    expect(classifyDesktopAction({ requestId: "n4", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_key", key: "F5", modifiers: ["ctrl"] })).toBe("deny");
    expect(classifyDesktopAction({ requestId: "n5", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_scroll", dx: 0, dy: -3 })).toBe("allow");
    expect(classifyDesktopAction({ requestId: "n6", taskId: "00000000-0000-0000-0000-000000000001", kind: "wait", durationMs: 500 })).toBe("allow");
    expect(classifyDesktopAction({ requestId: "n7", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_drag", x: 1, y: 2 })).toBe("deny");
    expect(classifyDesktopAction({ requestId: "n8", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_drag", x: 1, y: 2, toX: 3, toY: 4, approvalToken: "abcdefghijklmnop" })).toBe("confirm");
  });

  it("authorizes new native capabilities", () => {
    const key = desktopAgentActionSchema.parse({ requestId: "k1", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_key", key: "Tab" });
    expect(isDesktopActionAuthorized(key, ["window.key"])).toBe(true);
    const drag = desktopAgentActionSchema.parse({ requestId: "k2", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_drag", x: 1, y: 2, toX: 3, toY: 4 });
    expect(isDesktopActionAuthorized(drag, ["window.drag"])).toBe(true);
    const dbl = desktopAgentActionSchema.parse({ requestId: "k3", taskId: "00000000-0000-0000-0000-000000000001", kind: "native_double_click", x: 1, y: 2 });
    expect(isDesktopActionAuthorized(dbl, ["window.click"])).toBe(true);
  });

  it("only treats observation and visual search MCP tools as read-only", () => {
    expect(isReadOnlyNativeMcpTool("screen_observe")).toBe(true);
    expect(isReadOnlyNativeMcpTool("screen_find")).toBe(true);
    expect(isReadOnlyNativeMcpTool("screen_click")).toBe(false);
    expect(isReadOnlyNativeMcpTool("screen_clipboard_read")).toBe(false);
  });

  it("parses planned actions with coordinates, keys, and waits", () => {
    const plan = desktopAgentTaskRequestSchema.parse({
      goal: "切换窗口并发送回车",
      role: "operator",
      capabilities: ["window.focus", "window.key", "window.click", "window.scroll", "window.drag"],
      executionMode: "windows_ui",
      plannedActions: [
        { kind: "native_key", key: "Enter", modifiers: ["ctrl"] },
        { kind: "native_scroll", dx: 0, dy: -5 },
        { kind: "native_double_click", x: 120, y: 340 },
        { kind: "native_drag", x: 10, y: 10, toX: 200, toY: 220 },
        { kind: "wait", durationMs: 800 },
      ],
    });
    expect(plan.plannedActions).toHaveLength(5);
  });
});
