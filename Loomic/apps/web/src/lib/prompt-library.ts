export const PROMPT_PAGE_SIZE = 100;

export type LibraryPrompt = {
  id: string;
  title: string;
  prompt: string;
  category: string;
  tags: string[];
  source: string;
  license: string;
};

export type PromptCategory = { category: string; count: number };
export type PromptPage = {
  items: LibraryPrompt[];
  categories: PromptCategory[];
  hasMore: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePromptPage(value: unknown): PromptPage {
  if (
    !record(value) ||
    value.ok !== true ||
    !Array.isArray(value.data) ||
    !Array.isArray(value.categories)
  ) {
    throw new Error("提示词列表格式无效，请重试。");
  }
  const items = value.data.map((entry: unknown): LibraryPrompt => {
    if (
      !record(entry) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      typeof entry.title !== "string" ||
      typeof entry.prompt !== "string" ||
      (entry.tags != null &&
        (!Array.isArray(entry.tags) ||
          !entry.tags.every((tag) => typeof tag === "string")))
    ) {
      throw new Error("提示词内容格式无效，请重试。");
    }
    return {
      id: entry.id,
      title: entry.title,
      prompt: entry.prompt,
      category: typeof entry.category === "string" ? entry.category : "",
      tags: (entry.tags as string[] | null | undefined) ?? [],
      source: typeof entry.source === "string" ? entry.source : "",
      license: typeof entry.license === "string" ? entry.license : "",
    };
  });
  const categories = value.categories.map((entry: unknown): PromptCategory => {
    if (
      !record(entry) ||
      (entry.category != null && typeof entry.category !== "string") ||
      typeof entry.count !== "number" ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 0
    ) {
      throw new Error("提示词分类格式无效，请重试。");
    }
    return {
      category: typeof entry.category === "string" ? entry.category : "",
      count: entry.count,
    };
  });
  if (
    !record(value.pagination) ||
    typeof value.pagination.hasMore !== "boolean"
  ) {
    throw new Error("提示词分页格式无效，请重试。");
  }
  return { items, categories, hasMore: value.pagination.hasMore };
}

export async function fetchPromptPage(
  query: string,
  category: string,
  offset: number,
  signal: AbortSignal,
): Promise<PromptPage> {
  const params = new URLSearchParams({
    limit: String(PROMPT_PAGE_SIZE),
    offset: String(offset),
  });
  if (query.trim()) params.set("q", query.trim());
  if (category) params.set("category", category);
  let response: Response;
  try {
    response = await fetch(`/api/prompts?${params}`, {
      credentials: "include",
      signal,
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error("网络连接失败，请检查网络后重试。", { cause });
  }
  if (!response.ok)
    throw new Error(`提示词读取失败（${response.status}），请重试。`);
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error("提示词响应格式无效，请重试。", { cause });
  }
  return parsePromptPage(body);
}
