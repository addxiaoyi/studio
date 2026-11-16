"use client";

import { PromptLibraryCard } from "@/components/prompt-library-card";
import { StyledSelect } from "@/components/ui/styled-select";
import { usePromptLibrary } from "@/hooks/use-prompt-library";
import type { LibraryPrompt } from "@/lib/prompt-library";
import { PromptSelectionError, selectPrompt } from "@/lib/prompt-selection";
import { Search, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent, useState } from "react";

export default function PromptsPage() {
  const router = useRouter();
  const picking = useSearchParams()?.get("pick") === "1";
  const library = usePromptLibrary();
  const [selectionError, setSelectionError] = useState("");

  function changeSearch(event: ChangeEvent<HTMLInputElement>) {
    library.search(event.target.value);
  }

  function choosePrompt(prompt: LibraryPrompt) {
    setSelectionError("");
    try {
      const destination = selectPrompt(
        window.sessionStorage,
        prompt.prompt,
        window.location.origin,
      );
      router.push(destination);
    } catch (cause) {
      setSelectionError(
        cause instanceof PromptSelectionError
          ? cause.message
          : "无法保存选中的提示词，请允许浏览器存储后重试，或直接复制内容。",
      );
    }
  }

  return (
    <main className="mx-auto min-h-full max-w-6xl p-6 md:p-10">
      <header>
        <p className="text-sm text-muted-foreground">
          图片、视频与电商创作模板
        </p>
        <h1 className="mt-1 text-3xl font-semibold">提示词库</h1>
      </header>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">搜索提示词</span>
          <Search
            className="absolute left-3 top-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            value={library.query}
            onChange={changeSearch}
            placeholder="搜索标题、内容或标签"
            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
          />
        </label>
        <StyledSelect
          value={library.category}
          onChange={library.filter}
          aria-label="提示词分类"
          options={[
            { value: "", label: "全部分类" },
            ...library.categories
              .filter((category) => category.category)
              .map((category) => ({
                value: category.category,
                label: category.category,
                note: `${category.count} 条`,
              })),
          ]}
        />
      </div>
      {selectionError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {selectionError}
        </p>
      ) : null}
      {library.error ? (
        <div
          role="alert"
          className="mt-8 rounded-lg border border-destructive/30 p-5 text-sm"
        >
          <p>{library.error}</p>
          <button
            type="button"
            onClick={library.retry}
            disabled={library.loading}
            className="mt-3 rounded-md border px-3 py-2 hover:bg-muted"
          >
            重试加载
          </button>
        </div>
      ) : null}
      {library.loading ? (
        <output className="mt-8 block text-sm text-muted-foreground">
          加载中...
        </output>
      ) : null}
      {!library.loading && !library.error && library.items.length === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed p-16">
          <Sparkles
            className="size-9 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm">没有匹配的提示词</p>
        </div>
      ) : null}
      {library.items.length > 0 ? (
        <div
          className="mt-8 grid gap-4 md:grid-cols-2"
          aria-busy={library.loading}
        >
          {library.items.map((prompt) => (
            <PromptLibraryCard
              key={prompt.id}
              prompt={prompt}
              onSelect={choosePrompt}
            />
          ))}
        </div>
      ) : null}
      {library.hasMore && !library.error ? (
        <button
          type="button"
          onClick={library.loadMore}
          disabled={library.loading}
          className="mt-6 rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          加载更多提示词
        </button>
      ) : null}
      {picking ? (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          点击魔法棒后返回画布并填入聊天输入框
        </p>
      ) : null}
    </main>
  );
}
