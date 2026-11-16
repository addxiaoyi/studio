"use client";

import {
  type LibraryPrompt,
  PROMPT_PAGE_SIZE,
  type PromptCategory,
  fetchPromptPage,
} from "@/lib/prompt-library";
import { useEffect, useRef, useState } from "react";

const SEARCH_DELAY_MS = 200;

export function usePromptLibrary() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<LibraryPrompt[]>([]);
  const [categories, setCategories] = useState<PromptCategory[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(true);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    request.current = abort;
    pending.current = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(
      async () => {
        try {
          const page = await fetchPromptPage(
            query,
            category,
            offset,
            abort.signal,
          );
          if (abort.signal.aborted) return;
          setItems((previous) =>
            offset === 0
              ? page.items
              : [
                  ...new Map(
                    [...previous, ...page.items].map((prompt) => [
                      prompt.id,
                      prompt,
                    ]),
                  ).values(),
                ],
          );
          setCategories(page.categories);
          setHasMore(page.hasMore);
        } catch (cause) {
          if (!abort.signal.aborted)
            setError(
              cause instanceof Error
                ? cause.message
                : "暂时无法加载提示词，请重试。",
            );
        } finally {
          if (!abort.signal.aborted) {
            pending.current = false;
            setLoading(false);
          }
        }
      },
      offset === 0 && attempt === 0 ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [query, category, offset, attempt]);

  function search(text: string) {
    if (text === query) return;
    request.current?.abort();
    pending.current = true;
    setLoading(true);
    setQuery(text);
    setOffset(0);
    setAttempt(0);
    setItems([]);
    setHasMore(false);
  }

  function filter(value: string) {
    if (value === category) return;
    request.current?.abort();
    pending.current = true;
    setLoading(true);
    setCategory(value);
    setOffset(0);
    setAttempt(0);
    setItems([]);
    setHasMore(false);
  }

  function loadMore() {
    if (pending.current || !hasMore || error) return;
    pending.current = true;
    setOffset((value) => value + PROMPT_PAGE_SIZE);
  }

  function retry() {
    if (pending.current) return;
    pending.current = true;
    setAttempt((value) => value + 1);
  }

  return {
    query,
    category,
    items,
    categories,
    hasMore,
    loading,
    error,
    search,
    filter,
    loadMore,
    retry,
  };
}
