"use client";

import {
  type GalleryComment,
  type GalleryItem,
  commentCount,
  galleryRequest,
  parseGallery,
  parseGalleryComment,
  parseGalleryComments,
  parseLikeCount,
} from "@/lib/gallery-api";
import { useCallback, useEffect, useRef, useState } from "react";

export function useGallery(userId: string | undefined) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [comments, setComments] = useState<Record<string, GalleryComment[]>>(
    {},
  );
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>(
    {},
  );
  const locks = useRef(new Set<string>());
  const receipts = useRef(
    new Map<string, { body: string; requestId: string }>(),
  );
  const lifetime = useRef<AbortController | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const listPending = useRef(true);

  const loadGallery = useCallback(async () => {
    if (locks.current.size) {
      setError("请等待当前操作完成后再刷新作品。");
      return;
    }
    listRequest.current?.abort();
    listPending.current = true;
    const abort = new AbortController();
    listRequest.current = abort;
    setLoading(true);
    setLoadError(null);
    setError(null);
    try {
      const next = parseGallery(
        await galleryRequest(
          "/api/gallery?limit=60",
          { signal: abort.signal },
          "作品加载失败，请稍后重试。",
        ),
      );
      if (!abort.signal.aborted) setItems(next);
    } catch (cause) {
      if (!abort.signal.aborted)
        setLoadError(
          cause instanceof Error ? cause.message : "作品加载失败，请稍后重试。",
        );
    } finally {
      if (!abort.signal.aborted) {
        listPending.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    lifetime.current = abort;
    void loadGallery();
    return () => {
      abort.abort();
      listRequest.current?.abort();
    };
  }, [loadGallery]);

  async function actOnItem(
    item: GalleryItem,
    action: string,
    work: (signal: AbortSignal) => Promise<void>,
  ) {
    const signal = lifetime.current?.signal;
    if (
      !signal ||
      signal.aborted ||
      listPending.current ||
      locks.current.has(item.id)
    )
      return;
    locks.current.add(item.id);
    setBusy((current) => ({ ...current, [item.id]: action }));
    setError(null);
    try {
      await work(signal);
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      locks.current.delete(item.id);
      if (!signal.aborted)
        setBusy((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
    }
  }

  function storeComments(id: string, entries: GalleryComment[]) {
    commentsRef.current = { ...commentsRef.current, [id]: entries };
    setComments(commentsRef.current);
  }

  const loadComments = (item: GalleryItem) =>
    actOnItem(item, "comments", async (signal) => {
      setCommentErrors((current) => ({ ...current, [item.id]: "" }));
      try {
        const next = parseGalleryComments(
          await galleryRequest(
            `/api/gallery/${item.id}/comments`,
            { signal },
            "评论加载失败，请重试。",
          ),
          item.id,
        );
        if (!signal.aborted) storeComments(item.id, next);
      } catch (cause) {
        if (!signal.aborted)
          setCommentErrors((current) => ({
            ...current,
            [item.id]:
              cause instanceof Error ? cause.message : "评论加载失败，请重试。",
          }));
      }
    });

  async function toggleComments(item: GalleryItem) {
    const next = !expanded[item.id];
    setExpanded((current) => ({ ...current, [item.id]: next }));
    if (next && !commentsRef.current[item.id]) await loadComments(item);
  }

  const toggleLike = (item: GalleryItem) =>
    actOnItem(item, "like", async (signal) => {
      const likeCount = parseLikeCount(
        await galleryRequest(
          `/api/gallery/${item.id}/like`,
          { method: "POST", signal },
          "点赞结果未确认，请刷新作品后核对。",
        ),
      );
      if (!signal.aborted)
        setItems((current) =>
          current.map((value) =>
            value.id === item.id ? { ...value, like_count: likeCount } : value,
          ),
        );
    });

  async function updateCommentCount(
    item: GalleryItem,
    payload: unknown,
    signal: AbortSignal,
  ) {
    let total = commentCount(payload);
    if (total === null) {
      // Older servers omit the count; never infer it from a possibly replayed mutation.
      const fresh = parseGallery(
        await galleryRequest(
          "/api/gallery?limit=60",
          { signal },
          "评论已保存，但讨论数量刷新失败，请重新加载作品。",
        ),
      );
      total =
        fresh.find((entry) => entry.id === item.id)?.comment_count ?? null;
    }
    if (total !== null && !signal.aborted) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, comment_count: total } : entry,
        ),
      );
    }
  }

  async function submitComment(item: GalleryItem) {
    const body = drafts[item.id]?.trim();
    if (!body || !userId) return;
    await actOnItem(item, "submit", async (signal) => {
      let receipt = receipts.current.get(item.id);
      if (!receipt || receipt.body !== body) {
        receipt = { body, requestId: crypto.randomUUID() };
        receipts.current.set(item.id, receipt);
      }
      const payload = await galleryRequest(
        `/api/gallery/${item.id}/comments`,
        {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(receipt),
        },
        "评论结果未确认，请重试；原内容已保留。",
      );
      const comment = parseGalleryComment(payload, item.id);
      if (signal.aborted) return;
      const current = commentsRef.current[item.id] ?? [];
      const exists = current.some((entry) => entry.id === comment.id);
      storeComments(
        item.id,
        exists
          ? current.map((entry) => (entry.id === comment.id ? comment : entry))
          : [...current, comment],
      );
      receipts.current.delete(item.id);
      setDrafts((currentDrafts) =>
        currentDrafts[item.id]?.trim() === body
          ? { ...currentDrafts, [item.id]: "" }
          : currentDrafts,
      );
      setExpanded((currentExpanded) => ({
        ...currentExpanded,
        [item.id]: true,
      }));
      await updateCommentCount(item, payload, signal);
    });
  }

  const removeComment = (item: GalleryItem, entry: GalleryComment) =>
    actOnItem(item, `delete:${entry.id}`, async (signal) => {
      const payload = await galleryRequest(
        `/api/gallery/comments/${entry.id}`,
        { method: "DELETE", signal },
        "删除评论结果未确认，请刷新讨论后核对。",
      );
      if (signal.aborted) return;
      storeComments(
        item.id,
        (commentsRef.current[item.id] ?? []).filter(
          (value) => value.id !== entry.id,
        ),
      );
      await updateCommentCount(item, payload, signal);
    });

  return {
    items,
    comments,
    expanded,
    drafts,
    setDrafts,
    busy,
    loading,
    error,
    setError,
    loadError,
    commentErrors,
    loadGallery,
    loadComments,
    toggleComments,
    toggleLike,
    submitComment,
    removeComment,
  };
}
