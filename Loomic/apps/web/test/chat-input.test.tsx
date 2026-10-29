// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Profiler, memo, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// 只隔离模型选择器：它自带网络请求，与本文件要验证的输入框行为无关
vi.mock("../src/components/agent-model-selector", () => ({
  AgentModelSelector: () => null,
}));

import type { ImageAttachmentState } from "../src/hooks/use-image-attachments";
import {
  ChatInput,
  MAX_INPUT_LENGTH,
  REMAINING_LENGTH_PROMPT_RATIO,
} from "../src/components/chat-input";

const uploadingAttachment: ImageAttachmentState = {
  id: "attachment-uploading",
  preview: "blob:pending",
  uploading: true,
  mimeType: "image/png",
  source: "upload",
  name: "pending.png",
};

const failedAttachment: ImageAttachmentState = {
  id: "attachment-failed",
  preview: "blob:failed",
  uploading: false,
  error: "上传失败",
  retryable: true,
  mimeType: "image/png",
  source: "upload",
  name: "failed.png",
};

function getComposer() {
  return screen.getByLabelText("输入消息") as HTMLTextAreaElement;
}

function getSendButton() {
  return screen.getByRole("button", { name: "发送消息" });
}

/** 断言按钮上的 title 与 aria-describedby 指向同一句可见原因 */
function expectDisabledReason(expected: string) {
  const button = getSendButton();
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", expected);

  const describedBy = button.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  const reasonNode = document.getElementById(describedBy as string);
  expect(reasonNode).not.toBeNull();
  expect(reasonNode).toHaveTextContent(expected);
  expect(reasonNode).toBeVisible();
}

describe("ChatInput #8 发送失败不丢输入", () => {
  afterEach(cleanup);

  it("onSend 同步抛错时回填文本、恢复光标位置并重新聚焦", async () => {
    const onSend = vi.fn(() => {
      throw new Error("network down");
    });
    render(<ChatInput onSend={onSend} />);

    const input = getComposer();
    await userEvent.type(input, "帮我生成一张海报");

    // 把光标停在中间，失败回填后必须还原到同一段选区
    input.setSelectionRange(3, 7);
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(7);

    await userEvent.click(getSendButton());

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("帮我生成一张海报");
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(7);
  });

  it("onSend 返回的 Promise 成功才清空，失败则保留草稿并重新聚焦", async () => {
    let resolveSend: (value: unknown) => void = () => {};
    let rejectSend: (reason?: unknown) => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          resolveSend = resolve;
          rejectSend = reject;
        }),
    );
    render(<ChatInput onSend={onSend} />);

    const input = getComposer();
    await userEvent.type(input, "写一段产品文案");
    await userEvent.click(getSendButton());

    // 成功信号还没到，草稿不能先被清空
    expect(input).toHaveValue("写一段产品文案");

    rejectSend(new Error("500"));
    await vi.waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("写一段产品文案");

    // 再把同样的文本发一次，这次成功 —— 只有成功才清空
    await userEvent.click(getSendButton());
    expect(onSend).toHaveBeenCalledTimes(2);
    resolveSend(undefined);
    await vi.waitFor(() => expect(input).toHaveValue(""));
  });
});

describe("ChatInput #26 禁用要有原因", () => {
  afterEach(cleanup);

  it("空内容时禁用并显示「请输入内容」", () => {
    render(<ChatInput onSend={vi.fn()} />);
    expectDisabledReason("请输入内容");
  });

  it("上传附件时显示「正在上传附件，请稍候」", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        isUploading
        attachments={[uploadingAttachment]}
        onRemoveAttachment={vi.fn()}
      />,
    );
    expectDisabledReason("正在上传附件，请稍候");
  });

  it("附件上传失败时提示先处理失败附件", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        attachments={[failedAttachment]}
        onRemoveAttachment={vi.fn()}
        onRetryAttachment={vi.fn()}
      />,
    );
    expectDisabledReason("请先重试或移除上传失败的附件");
  });

  it("生成中且可停止时按钮变成停止按钮，原因说明「生成中，可先停止」", () => {
    render(<ChatInput onSend={vi.fn()} disabled onCancel={vi.fn()} />);

    const stopButton = screen.getByRole("button", { name: "停止生成" });
    expect(stopButton).toBeEnabled();
    expect(stopButton).toHaveAttribute("title", "生成中，可先停止");

    const describedBy = stopButton.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent("生成中，可先停止");
  });

  it("生成中且不可停止时禁用并显示「生成中，请稍候」", () => {
    render(<ChatInput onSend={vi.fn()} disabled />);
    expectDisabledReason("生成中，请稍候");
  });

  it("可以发送时不再挂原因，按钮可点击", async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    await userEvent.type(getComposer(), "你好");

    const button = getSendButton();
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(button).toHaveAttribute("title", "发送消息");
    expect(screen.queryByText("请输入内容")).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(onSend).toHaveBeenCalledWith("你好");
  });
});

describe("ChatInput #27 字数上限与剩余量", () => {
  afterEach(cleanup);

  const promptThreshold = MAX_INPUT_LENGTH * REMAINING_LENGTH_PROMPT_RATIO;

  it("textarea 使用原生 maxLength 拦住超限输入", () => {
    render(<ChatInput onSend={vi.fn()} />);
    expect(getComposer()).toHaveAttribute("maxLength", String(MAX_INPUT_LENGTH));
  });

  it("未达 90% 不提示，达到 90% 起显示剩余字数", () => {
    render(<ChatInput onSend={vi.fn()} />);
    const input = getComposer();

    fireEvent.change(input, { target: { value: "字".repeat(promptThreshold - 1) } });
    expect(input).toHaveValue("字".repeat(promptThreshold - 1));
    expect(screen.queryByText(/剩余 \d+ 字/)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "字".repeat(promptThreshold) } });
    expect(screen.getByText(`剩余 ${MAX_INPUT_LENGTH - promptThreshold} 字`)).toBeInTheDocument();
  });

  it("粘贴到上限时原样保留，不额外截断，剩余 0 字", () => {
    render(<ChatInput onSend={vi.fn()} />);
    const input = getComposer();
    const atLimit = "字".repeat(MAX_INPUT_LENGTH);

    fireEvent.change(input, { target: { value: atLimit } });

    // 受控值必须原样落地（实现里不许再 slice，否则会跳变/丢字）
    expect(input).toHaveValue(atLimit);
    expect(input.value.length).toBe(MAX_INPUT_LENGTH);
    expect(screen.getByText("剩余 0 字")).toBeInTheDocument();
  });
});

describe("ChatInput #4 长文本输入不卡顿", () => {
  afterEach(cleanup);

  it("输入与长文本粘贴都不会把父级/兄弟节点一起重渲染", async () => {
    let siblingRenders = 0;
    const ExpensiveSibling = memo(function ExpensiveSibling() {
      siblingRenders += 1;
      return <div data-testid="expensive-sibling" />;
    });

    function Host() {
      const [sends, setSends] = useState(0);
      return (
        <div>
          <ExpensiveSibling />
          <span data-testid="send-count">{sends}</span>
          <ChatInput onSend={() => setSends((prev) => prev + 1)} />
        </div>
      );
    }

    render(<Host />);
    const baseline = siblingRenders;
    expect(baseline).toBe(1);

    const input = getComposer();
    await userEvent.type(input, "逐个字符输入");
    expect(siblingRenders).toBe(baseline);
    expect(input).toHaveValue("逐个字符输入");

    const longText = "长".repeat(MAX_INPUT_LENGTH);
    fireEvent.change(input, { target: { value: longText } });
    expect(input).toHaveValue(longText);
    expect(siblingRenders).toBe(baseline);
  });

  it("@ 解析与父级通知发生在提交之后，不在按键同步路径上", () => {
    const events: string[] = [];
    const onRender = () => {
      events.push("commit");
    };
    const onAtQuery = vi.fn((query: string | null) => {
      events.push(`atQuery:${query}`);
    });

    render(
      <Profiler id="composer" onRender={onRender}>
        <ChatInput onSend={vi.fn()} onAtQuery={onAtQuery} />
      </Profiler>,
    );

    // 丢掉挂载期记录，只看这一次输入变化
    events.length = 0;
    fireEvent.change(getComposer(), { target: { value: "@ab" } });

    const firstCommit = events.indexOf("commit");
    const queryIndex = events.indexOf("atQuery:ab");
    expect(firstCommit).toBeGreaterThanOrEqual(0);
    expect(queryIndex).toBeGreaterThan(firstCommit);
    expect(onAtQuery).toHaveBeenLastCalledWith("ab");
  });
});
