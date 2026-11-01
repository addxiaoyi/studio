import { describe, expect, it } from "vitest";
import { assistantReconnectDelay, interruptedApprovalRequiresReview, nativeResumeIsReadOnly, shouldReconnectAssistant, verifyNativeResumeAction } from "./assistant-reconnect.js";
import { matchesUiaWindow } from "./windows-uia.js";

describe("desktop assistant reconnect policy", () => {
  it("uses capped exponential backoff with jitter", () => {
    expect(assistantReconnectDelay(0, () => 0.5)).toBe(500);
    expect(assistantReconnectDelay(2, () => 0)).toBe(1_600);
    expect(assistantReconnectDelay(50, () => 1)).toBe(30_000);
  });

  it("stops retrying after server authentication rejection", () => {
    expect(shouldReconnectAssistant(4001)).toBe(false);
    expect(shouldReconnectAssistant(4003)).toBe(false);
    expect(shouldReconnectAssistant(1006)).toBe(true);
  });

  it("requires review of approvals whose page context was interrupted", () => {
    expect(interruptedApprovalRequiresReview(0)).toBe(false);
    expect(interruptedApprovalRequiresReview(1)).toBe(true);
    expect(interruptedApprovalRequiresReview(2)).toBe(true);
  });

  it("resumes only explicitly read-only native actions", () => {
    expect(nativeResumeIsReadOnly([{ kind: "read_page" }, { kind: "capture_screen" }])).toBe(true);
    expect(nativeResumeIsReadOnly([{ kind: "native_wait_for_text" }])).toBe(false);
    expect(nativeResumeIsReadOnly([{ kind: "native_scroll" }])).toBe(false);
    expect(nativeResumeIsReadOnly([{ kind: "focus_window" }])).toBe(false);
    expect(nativeResumeIsReadOnly([{ kind: "native_click" }])).toBe(false);
    expect(nativeResumeIsReadOnly([{ kind: "unknown" }])).toBe(false);
  });

  it("checks the active window again before every resumed action", async () => {
    const original = { windowId: "abc", pid: 42, processStarted: "123", title: "Test", controls: [] };
    const inspect = async () => original;
    expect(await verifyNativeResumeAction({ kind: "read_page" }, original, inspect, matchesUiaWindow, () => true)).toBe(true);
    expect(await verifyNativeResumeAction({ kind: "capture_screen" }, original, async () => ({ ...original, pid: 43 }), matchesUiaWindow, () => true)).toBe(false);
    expect(await verifyNativeResumeAction({ kind: "read_page" }, original, async () => null, matchesUiaWindow, () => true)).toBe(false);
    let inspected = false;
    expect(await verifyNativeResumeAction({ kind: "native_click" }, original, async () => { inspected = true; return original; }, matchesUiaWindow, () => true)).toBe(false);
    expect(inspected).toBe(false);
    await expect(verifyNativeResumeAction({ kind: "read_page" }, original, async () => { throw new Error("helper unavailable"); }, matchesUiaWindow, () => true)).rejects.toThrow("helper unavailable");
    let active = true;
    const canceledDuringInspect = async () => { active = false; return original; };
    expect(await verifyNativeResumeAction({ kind: "read_page" }, original, canceledDuringInspect, matchesUiaWindow, () => active)).toBe(false);
    active = true;
    const disconnectedDuringFailure = async () => { active = false; throw new Error("helper unavailable"); };
    expect(await verifyNativeResumeAction({ kind: "read_page" }, original, disconnectedDuringFailure, matchesUiaWindow, () => active)).toBe(false);
  });
});
