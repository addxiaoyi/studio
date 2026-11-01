import { expect, it } from "vitest";
import { matchesUiaWindow, parseUiaSnapshot } from "./windows-uia.js";

it("validates a process-instance identity and remains compatible with older helpers", () => {
  const snapshot = { ok: true, protocol: 1, windowId: "ab12", pid: 42, title: "Document", controls: [] };
  expect(parseUiaSnapshot(snapshot).processStarted).toBeUndefined();
  expect(parseUiaSnapshot({ ...snapshot, processStarted: "133000000000000000" }).processStarted).toBe("133000000000000000");
  expect(() => parseUiaSnapshot({ ...snapshot, processStarted: "not-a-time" })).toThrow("Invalid Windows accessibility response");
  expect(() => parseUiaSnapshot({ ...snapshot, windowId: "0x123" })).toThrow("Invalid Windows accessibility response");
});

it("matches the same window and process instance and fails closed without a creation time", () => {
  const current = { windowId: "ab12", pid: 42, processStarted: "133000000000000000", title: "Document", controls: [] };
  expect(matchesUiaWindow(current, { windowId: "ab12", pid: 42, processStarted: "133000000000000000" })).toBe(true);
  expect(matchesUiaWindow(current, { windowId: "ab12", pid: 42, processStarted: "133000000000000001" })).toBe(false);
  expect(matchesUiaWindow(current, { windowId: "ab12", pid: 43, processStarted: "133000000000000000" })).toBe(false);
  expect(matchesUiaWindow({ ...current, processStarted: undefined }, current)).toBe(false);
});
