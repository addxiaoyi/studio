// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatMessage } from "../src/components/chat-message";

vi.mock("framer-motion", () => ({ motion: { div: ({ initial: _initial, animate: _animate, transition: _transition, ...props }: Record<string, unknown>) => <div {...props} /> } }));

vi.mock("../src/components/chat/tool-block-view", () => ({ ToolBlockView: () => null }));
vi.mock("../src/components/chat/thinking-block-view", () => ({ ThinkingBlockView: () => null }));
vi.mock("../src/lib/i18n", () => ({ useLocale: () => "zh-CN" }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("copies answer text without thought or tool payloads", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<ChatMessage role="assistant" contentBlocks={[{ type: "text", text: "<think>private thought</think>**可复制回答**" }, { type: "thinking", thinking: "internal" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("**可复制回答**"));
  expect(await screen.findByRole("button", { name: "已复制" })).toBeVisible();
});

it("falls back when the browser clipboard API fails and preserves the draft focus", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  const exec = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
  render(<><textarea aria-label="draft" defaultValue="保留草稿" /><ChatMessage role="user" contentBlocks={[{ type: "text", text: "待复制内容" }]} /></>);
  const draft = screen.getByRole("textbox");draft.focus();
  fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
  await waitFor(() => expect(exec).toHaveBeenCalledWith("copy"));
  expect(draft).toHaveFocus();expect(draft).toHaveValue("保留草稿");
});

it("shows an actionable error when both clipboard methods fail", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
  render(<ChatMessage role="assistant" contentBlocks={[{ type: "text", text: "回答" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("选中文字");
});
