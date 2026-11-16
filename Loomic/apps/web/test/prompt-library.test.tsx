import "@testing-library/jest-dom/vitest";
import PromptsPage from "@/app/(workspace)/prompts/page";
import { parsePromptPage } from "@/lib/prompt-library";
import {
  PROMPT_RETURN_KEY,
  SELECTED_PROMPT_KEY,
  consumeSelectedPrompt,
  promptReturnPath,
  selectPrompt,
} from "@/lib/prompt-selection";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("pick=1"),
}));
vi.mock("@/components/ui/styled-select", () => ({
  StyledSelect: ({
    value,
    onChange,
    options,
    "aria-label": label,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    "aria-label": string;
  }) => (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

function page(title: string, hasMore = false) {
  return {
    ok: true,
    data: [
      {
        id: title,
        title,
        prompt: `${title}的完整提示词`,
        category: "图片",
        tags: [],
      },
    ],
    categories: [{ category: "图片", count: 200 }],
    pagination: { hasMore },
  };
}
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
const fetchMock = vi.fn<typeof fetch>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  push.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
async function settleSearch() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(210);
  });
}

it("keeps the latest search when an old request completes after cancellation", async () => {
  const old = deferred<Response>();
  fetchMock
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(response(page("新结果")));
  render(<PromptsPage />);
  await settleSearch();
  const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal;
  fireEvent.change(screen.getByRole("textbox", { name: "搜索提示词" }), {
    target: { value: "新" },
  });
  expect(oldSignal?.aborted).toBe(true);
  await settleSearch();
  expect(screen.getByRole("heading", { name: "新结果" })).toBeInTheDocument();
  await act(async () => {
    old.resolve(response(page("旧结果")));
  });
  expect(
    screen.queryByRole("heading", { name: "旧结果" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "新结果" })).toBeInTheDocument();
});

it("keeps prior pages when the next page fails, retries its offset and locks rapid clicks", async () => {
  fetchMock
    .mockResolvedValueOnce(response(page("第一页", true)))
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response(page("第二页")));
  render(<PromptsPage />);
  await settleSearch();
  const more = screen.getByRole("button", { name: "加载更多提示词" });
  fireEvent.click(more);
  fireEvent.click(more);
  await settleSearch();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("alert")).toHaveTextContent("503");
  expect(screen.getByRole("heading", { name: "第一页" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
  await settleSearch();
  expect(String(fetchMock.mock.calls[1]?.[0])).toContain("offset=100");
  expect(fetchMock.mock.calls[2]?.[0]).toBe(fetchMock.mock.calls[1]?.[0]);
  expect(screen.getByRole("heading", { name: "第一页" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "第二页" })).toBeInTheDocument();
});

it("shows malformed payloads as retryable errors instead of an empty library", async () => {
  fetchMock
    .mockResolvedValueOnce(
      response({ ok: true, data: [{ id: "bad" }], categories: [] }),
    )
    .mockResolvedValueOnce(response(page("恢复")));
  render(<PromptsPage />);
  await settleSearch();
  expect(screen.getByRole("alert")).toHaveTextContent("格式无效");
  expect(screen.queryByText("没有匹配的提示词")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
  await settleSearch();
  expect(screen.getByRole("heading", { name: "恢复" })).toBeInTheDocument();
});

it("reports denied clipboard access and allows a successful retry", async () => {
  fetchMock.mockResolvedValue(response(page("示例")));
  writeText.mockRejectedValueOnce(
    new DOMException("Denied", "NotAllowedError"),
  );
  render(<PromptsPage />);
  await settleSearch();
  const card = within(screen.getByRole("article", { name: "示例" }));
  await act(async () => {
    fireEvent.click(card.getByRole("button", { name: "复制提示词" }));
  });
  expect(card.getByRole("alert")).toHaveTextContent("复制失败");
  await act(async () => {
    fireEvent.click(card.getByRole("button", { name: "复制提示词" }));
  });
  expect(card.getByRole("status")).toHaveTextContent("已复制");
  expect(writeText).toHaveBeenLastCalledWith("示例的完整提示词");
});

it("keeps a selected prompt visible when browser storage is blocked and never navigates", async () => {
  fetchMock.mockResolvedValue(response(page("示例")));
  render(<PromptsPage />);
  await settleSearch();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota", "QuotaExceededError");
  });
  fireEvent.click(screen.getByRole("button", { name: "使用提示词" }));
  expect(screen.getByRole("alert")).toHaveTextContent("无法保存");
  expect(screen.getByText("示例的完整提示词")).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

it("saves before returning to the same canvas, preserving its query and fragment", async () => {
  sessionStorage.setItem(
    PROMPT_RETURN_KEY,
    `${window.location.origin}/canvas/?id=canvas-1&session=chat-1#input`,
  );
  fetchMock.mockResolvedValue(response(page("示例")));
  render(<PromptsPage />);
  await settleSearch();
  fireEvent.click(screen.getByRole("button", { name: "使用提示词" }));
  expect(push).toHaveBeenCalledWith(
    "/canvas/?id=canvas-1&session=chat-1#input",
  );
  expect(consumeSelectedPrompt(sessionStorage)).toBe("示例的完整提示词");
  expect(consumeSelectedPrompt(sessionStorage)).toBeNull();
});

it.each([
  "https://outside.invalid/",
  "//outside.invalid/",
  "javascript:alert(1)",
  "https://test.invalid//outside.invalid/",
  "https://user:pass@test.invalid/",
  "/\\outside.invalid/",
])("rejects unsafe return address %s", (address) => {
  expect(promptReturnPath(address, "https://test.invalid")).toBe("/home/");
});

it("does not truncate or consume an oversized selection", () => {
  sessionStorage.setItem(SELECTED_PROMPT_KEY, "x".repeat(8001));
  expect(() => consumeSelectedPrompt(sessionStorage)).toThrow("超过 8000");
  expect(sessionStorage.getItem(SELECTED_PROMPT_KEY)).toHaveLength(8001);
  expect(() =>
    selectPrompt(sessionStorage, "x".repeat(8001), window.location.origin),
  ).toThrow("超过 8000");
});

it("normalizes nullable catalog metadata without losing the prompt", () => {
  const catalog = page("示例");
  expect(
    parsePromptPage({
      ...catalog,
      data: [{ ...catalog.data[0], tags: null, category: null }],
      categories: [{ category: null, count: 1 }],
    }).items[0],
  ).toMatchObject({ title: "示例", tags: [], category: "" });
});
