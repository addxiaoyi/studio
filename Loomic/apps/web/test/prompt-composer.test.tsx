import "@testing-library/jest-dom/vitest";
import { ChatInput } from "@/components/chat-input";
import type { ImageAttachmentState } from "@/hooks/use-image-attachments";
import { PROMPT_RETURN_KEY, SELECTED_PROMPT_KEY } from "@/lib/prompt-selection";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/agent-model-selector", () => ({
  AgentModelSelector: () => null,
}));

beforeEach(() => {
  sessionStorage.clear();
  push.mockReset();
  document.documentElement.lang = "zh-CN";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("lang");
});

it("restores a selected prompt without sending and consumes it only once", () => {
  const send = vi.fn();
  sessionStorage.setItem(SELECTED_PROMPT_KEY, "选择的提示词");
  render(<ChatInput onSend={send} />);
  expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveValue(
    "选择的提示词",
  );
  expect(send).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(SELECTED_PROMPT_KEY)).toBeNull();
});

it("preserves the current draft when restoring the selection is denied", () => {
  const read = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
    this: Storage,
    key,
  ) {
    if (key === SELECTED_PROMPT_KEY)
      throw new DOMException("Blocked", "SecurityError");
    return read.call(this, key);
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  render(
    <ChatInput onSend={vi.fn()} draftStore={{ current: "还没写完的草稿" }} />,
  );
  expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveValue(
    "还没写完的草稿",
  );
  expect(screen.getByRole("status")).toHaveTextContent("当前草稿已保留");
});

it("does not submit a prompt command or lose it when its return position cannot be saved", () => {
  const send = vi.fn();
  const write = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === PROMPT_RETURN_KEY)
      throw new DOMException("Blocked", "SecurityError");
    return write.call(this, key, value);
  });
  render(<ChatInput onSend={send} draftStore={{ current: "/prompts" }} />);
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveValue(
    "/prompts",
  );
  expect(screen.getByRole("status")).toHaveTextContent("草稿已保留");
  expect(send).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

it("never queues a prompt command as a model message while attachments upload", () => {
  const send = vi.fn();
  const attachment: ImageAttachmentState = {
    id: "upload-1",
    preview: "blob:pending",
    uploading: true,
    mimeType: "image/png",
    source: "upload",
    name: "photo.png",
  };
  const draft = { current: "/prompts" };
  const { rerender } = render(
    <ChatInput
      onSend={send}
      draftStore={draft}
      isUploading
      attachments={[attachment]}
    />,
  );
  fireEvent.keyDown(screen.getByRole("textbox", { name: "输入消息" }), {
    key: "Enter",
  });
  rerender(
    <ChatInput
      onSend={send}
      draftStore={draft}
      isUploading={false}
      attachments={[{ ...attachment, uploading: false }]}
    />,
  );
  expect(send).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveValue(
    "/prompts",
  );
  fireEvent.keyDown(screen.getByRole("textbox", { name: "输入消息" }), {
    key: "Enter",
  });
  expect(push).toHaveBeenCalledWith("/prompts?pick=1");
  expect(send).not.toHaveBeenCalled();
});
