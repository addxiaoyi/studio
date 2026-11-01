import { expect, it } from "vitest";
import { DesktopActionReceipts } from "./desktop-action-receipts.js";

it("advances only after the matching persisted approval receipt, once", () => {
  const receipts = new DesktopActionReceipts();
  receipts.register("task", "approval", "request");
  expect(receipts.consume("task", "other", "request")).toBe(false);
  expect(receipts.consume("task", "approval", "other")).toBe(false);
  expect(receipts.consume("other", "approval", "request")).toBe(false);
  expect(receipts.consume("task", "approval", "request")).toBe(true);
  expect(receipts.consume("task", "approval", "request")).toBe(false);
});

it("discards pending receipts when a task stops", () => {
  const receipts = new DesktopActionReceipts();
  receipts.register("task", "approval", "request");
  receipts.clear("task");
  expect(receipts.consume("task", "approval", "request")).toBe(false);
});
