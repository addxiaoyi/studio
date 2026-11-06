// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef, useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatSelectionActions } from "../src/components/chat/selection-actions";
import { ChatInput, MAX_INPUT_LENGTH, type ChatInputHandle } from "../src/components/chat-input";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/components/agent-model-selector", () => ({ AgentModelSelector: () => null }));
vi.mock("../src/lib/i18n", () => ({ useLocale: () => "zh-CN" }));
const send = vi.fn();
const phrase = "请选择这部分文字继续讨论";

function Harness() {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<ChatInputHandle>(null);
  return <><div ref={root}><p data-chat-text>{phrase}</p><button>不能引用的按钮</button></div>
    <ChatSelectionActions rootRef={root} onQuote={text => input.current?.addQuote(text) ?? false} />
    <ChatInput ref={input} onSend={send} /></>;
}

function selectText(element: Element, start: number, end: number) {
  const range = document.createRange();range.setStart(element.firstChild!, start);range.setEnd(element.firstChild!, end);
  const selection = window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));fireEvent.pointerUp(document);
}

beforeEach(() => {
  send.mockClear();
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 100, right: 260, top: 100, bottom: 120, width: 160, height: 20 }) });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { cleanup();window.getSelection()?.removeAllRanges();vi.restoreAllMocks(); });

it("copies only the selected passage and keeps both selection actions available", async () => {
  render(<Harness />);selectText(screen.getByText(phrase), 3, 7);
  fireEvent.click(screen.getByRole("button", { name: "复制选中文字" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(phrase.slice(3, 7)));
  expect(screen.getByRole("button", { name: "添加到对话" })).toBeVisible();
  expect(send).not.toHaveBeenCalled();
});

it("adds the passage as a draft quote without replacing or sending existing text", async () => {
  render(<Harness />);const input = screen.getByRole("textbox", { name: "输入消息" });
  fireEvent.change(input, { target: { value: "我的问题" } });
  selectText(screen.getByText(phrase), 3, 7);
  fireEvent.click(screen.getByRole("button", { name: "添加到对话" }));
  await waitFor(() => expect(input).toHaveValue("我的问题\n\n> " + phrase.slice(3, 7) + "\n\n"));
  expect(input).toHaveFocus();expect(send).not.toHaveBeenCalled();
  expect(screen.queryByRole("group", { name: "选中文字操作" })).not.toBeInTheDocument();
});

it("ignores controls and dismisses text actions with Escape", () => {
  render(<Harness />);selectText(screen.getByRole("button", { name: "不能引用的按钮" }), 0, 3);
  expect(screen.queryByRole("group", { name: "选中文字操作" })).not.toBeInTheDocument();
  selectText(screen.getByText(phrase), 0, 5);
  fireEvent.keyDown(document, { key: "Tab" });
  expect(screen.getByRole("button", { name: "复制选中文字" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "选中文字操作" })).not.toBeInTheDocument();
});

it("refuses an oversized quote without truncating the draft", async () => {
  const inputRef = createRef<ChatInputHandle>();render(<ChatInput ref={inputRef} onSend={send} />);
  const input = screen.getByRole("textbox", { name: "输入消息" });
  const draft = "字".repeat(MAX_INPUT_LENGTH - 2);fireEvent.change(input, { target: { value: draft } });
  act(() => expect(inputRef.current?.addQuote("追加引用")).toBe(false));
  expect(input).toHaveValue(draft);expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("超过");
});

it("preserves multiline indentation and cancels an old queued send when adding context", () => {
  const inputRef = createRef<ChatInputHandle>();
  const { rerender } = render(<ChatInput ref={inputRef} onSend={send} isUploading />);
  const input = screen.getByRole("textbox", { name: "输入消息" });
  fireEvent.change(input, { target: { value: "已有草稿" } });fireEvent.keyDown(input, { key: "Enter" });
  act(() => expect(inputRef.current?.addQuote("  第一行\n    第二行")).toBe(true));
  rerender(<ChatInput ref={inputRef} onSend={send} isUploading={false} />);
  expect(input).toHaveValue("已有草稿\n\n>   第一行\n>     第二行\n\n");
  expect(send).not.toHaveBeenCalled();
});

it("restores the quoted draft when a responsive layout remounts the composer", () => {
  const draftStore = { current: "" };
  const inputRef = createRef<ChatInputHandle>();
  const mounted = render(<ChatInput draftStore={draftStore} ref={inputRef} onSend={send} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "保留我的问题" } });
  act(() => inputRef.current?.addQuote("引用片段"));
  mounted.unmount();
  render(<ChatInput draftStore={draftStore} onSend={send} />);
  expect(screen.getByRole("textbox")).toHaveValue("保留我的问题\n\n> 引用片段\n\n");
  expect(send).not.toHaveBeenCalled();
});
