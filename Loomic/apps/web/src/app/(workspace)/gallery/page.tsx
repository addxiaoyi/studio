"use client";

import {
  ChevronDown,
  Heart,
  ImageIcon,
  Loader2,
  MessageCircle,
  Send,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { GalleryMediaPreview } from "@/components/gallery-media-preview";
import { Button } from "@/components/ui/button";
import { useGallery } from "@/hooks/use-gallery";
import { useAuth } from "@/lib/auth-context";
import type { GalleryItem } from "@/lib/gallery-api";

const relativeTime = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

function formatTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "时间未知";
  const elapsed = timestamp - Date.now();
  const abs = Math.abs(elapsed);
  if (abs < 60_000) return "刚刚";
  if (abs < 3_600_000)
    return relativeTime.format(Math.round(elapsed / 60_000), "minute");
  if (abs < 86_400_000)
    return relativeTime.format(Math.round(elapsed / 3_600_000), "hour");
  if (abs < 604_800_000)
    return relativeTime.format(Math.round(elapsed / 86_400_000), "day");
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function metadataLabel(item: GalleryItem): string | null {
  if (item.width && item.height) return `${item.width} × ${item.height}`;
  return item.resolution;
}

function galleryTitle(item: GalleryItem): string {
  const title = item.title?.trim();
  if (title) return title;
  const prompt = item.prompt?.trim().replace(/\s+/g, " ");
  if (prompt) return prompt.length > 32 ? `${prompt.slice(0, 32)}…` : prompt;
  const type = item.media_type === "video" ? "视频作品" : "图片作品";
  return `${type} · ${item.id.slice(0, 6)}`;
}

export default function GalleryPage() {
  const { user } = useAuth();
  return <GalleryContent key={user?.id ?? "visitor"} userId={user?.id} />;
}

function GalleryContent({ userId }: { userId: string | undefined }) {
  const {
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
  } = useGallery(userId);
  const hasItems = items.length > 0;
  const totalComments = useMemo(
    () => items.reduce((sum, item) => sum + item.comment_count, 0),
    [items],
  );

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border/60 bg-background/90 px-5 py-8 backdrop-blur md:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Community gallery
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">作品库</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                发现社区创作，点赞并留下具体、有帮助的反馈。
              </p>
            </div>
            {hasItems ? (
              <p className="text-xs text-muted-foreground">
                {items.length} 件作品 · {totalComments} 条讨论
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-full max-w-7xl px-5 py-8 md:px-8">
        {error || loadError ? (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <span>{error || loadError}</span>
            {loadError || error ? (
              <Button variant="ghost" size="sm" onClick={loadGallery}>
                重新加载作品
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setError(null)}>
                关闭
              </Button>
            )}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4" />
            正在加载作品
          </div>
        ) : null}

        {!loading && !loadError && !hasItems ? (
          <div className="flex min-h-96 flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-muted/20 px-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-background shadow-sm">
              <ImageIcon className="size-5 text-muted-foreground" />
            </span>
            <h2 className="mt-4 text-lg font-medium">还没有公开作品</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              前往资产库选择一项作品公开，社区就能看到并参与讨论。
            </p>
            <Button asChild className="mt-5">
              <Link href="/assets/">前往资产库</Link>
            </Button>
          </div>
        ) : null}

        {hasItems ? (
          <div className="columns-1 gap-5 sm:columns-2 xl:columns-3 2xl:columns-4">
            {items.map((item) => {
              const itemComments = comments[item.id] ?? [];
              const isExpanded = Boolean(expanded[item.id]);
              const isLoadingComments = busy[item.id] === "comments";
              const title = galleryTitle(item);
              return (
                <article
                  key={item.id}
                  className="mb-5 break-inside-avoid overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm hover:shadow-md"
                >
                  <div className="relative overflow-hidden bg-muted">
                    <GalleryMediaPreview
                      key={item.object_url}
                      url={item.object_url}
                      title={title}
                      type={item.media_type}
                      caption={item.caption ?? null}
                    />
                  </div>
                  <div className="p-4">
                    <h2 className="truncate text-sm font-semibold">{title}</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded-md bg-muted px-2 py-1">
                        作者：{item.author_name?.trim() || "创作者"}
                      </span>
                      {item.model ? (
                        <span className="rounded-md bg-muted px-2 py-1">
                          模型：{item.model}
                        </span>
                      ) : null}
                      {metadataLabel(item) ? (
                        <span className="rounded-md bg-muted px-2 py-1">
                          画质：{metadataLabel(item)}
                        </span>
                      ) : null}
                      {item.generation_type ? (
                        <span className="rounded-md bg-muted px-2 py-1">
                          {item.generation_type === "video"
                            ? "视频生成"
                            : "图片生成"}
                        </span>
                      ) : null}
                    </div>
                    {item.description ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                    {item.prompt ? (
                      <details className="mt-2 rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          查看生成提示词
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap break-words leading-5 text-foreground/80">
                          {item.prompt}
                        </p>
                      </details>
                    ) : null}
                    <div className="mt-3 flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`点赞 ${title}`}
                        disabled={loading || Boolean(busy[item.id]) || !userId}
                        onClick={() => void toggleLike(item)}
                      >
                        <Heart className="size-4" /> {item.like_count}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`查看${title}的评论`}
                        aria-expanded={isExpanded}
                        disabled={loading || Boolean(busy[item.id])}
                        onClick={() => void toggleComments(item)}
                      >
                        <MessageCircle className="size-4" />{" "}
                        {item.comment_count}
                        <ChevronDown
                          className={`size-3 ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </Button>
                      {item.published_at ? (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {formatTime(item.published_at)}
                        </span>
                      ) : null}
                    </div>

                    {isExpanded ? (
                      <section
                        className="mt-3 border-t border-border/60 pt-3"
                        aria-label={`${title}的评论`}
                      >
                        {isLoadingComments ? (
                          <p className="py-3 text-center text-xs text-muted-foreground">
                            正在加载讨论…
                          </p>
                        ) : null}
                        {!isLoadingComments &&
                        !commentErrors[item.id] &&
                        comments[item.id] &&
                        itemComments.length === 0 ? (
                          <p className="py-3 text-center text-xs text-muted-foreground">
                            还没有评论，来开启讨论吧
                          </p>
                        ) : null}
                        {commentErrors[item.id] ? (
                          <div
                            role="alert"
                            className="py-3 text-xs text-destructive"
                          >
                            <p>{commentErrors[item.id]}</p>
                            <button
                              type="button"
                              onClick={() => void loadComments(item)}
                              disabled={loading || Boolean(busy[item.id])}
                              className="mt-2 rounded border px-2 py-1"
                            >
                              重试加载评论
                            </button>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`刷新${title}的评论`}
                          disabled={loading || Boolean(busy[item.id])}
                          onClick={() => void loadComments(item)}
                          className="mb-2 rounded border px-2 py-1 text-xs text-muted-foreground"
                        >
                          刷新讨论
                        </button>
                        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                          {itemComments.map((entry) => (
                            <div
                              key={entry.id}
                              className="group rounded-xl bg-muted/50 px-3 py-2.5"
                            >
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  {entry.author_name}
                                </span>
                                <span>{formatTime(entry.created_at)}</span>
                                {entry.can_delete ? (
                                  <button
                                    type="button"
                                    className="ml-auto rounded p-1 opacity-60 hover:bg-background hover:text-destructive hover:opacity-100 focus-visible:opacity-100"
                                    aria-label="删除评论"
                                    disabled={loading || Boolean(busy[item.id])}
                                    onClick={() =>
                                      void removeComment(item, entry)
                                    }
                                  >
                                    {busy[item.id] === `delete:${entry.id}` ? (
                                      <Loader2 className="size-3" />
                                    ) : (
                                      <Trash2 className="size-3" />
                                    )}
                                  </button>
                                ) : null}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5">
                                {entry.body}
                              </p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-end gap-2">
                          <textarea
                            value={drafts[item.id] ?? ""}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [item.id]: event.target.value.slice(0, 1000),
                              }))
                            }
                            onKeyDown={(event) => {
                              if (
                                (event.metaKey || event.ctrlKey) &&
                                event.key === "Enter"
                              ) {
                                event.preventDefault();
                                void submitComment(item);
                              }
                            }}
                            aria-label={`给${title}评论`}
                            placeholder={
                              userId ? "写下具体反馈…" : "登录后参与讨论"
                            }
                            disabled={!userId || busy[item.id] === "submit"}
                            rows={2}
                            className="min-h-16 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
                          />
                          <Button
                            size="icon"
                            aria-label="发布评论"
                            disabled={
                              !userId ||
                              loading ||
                              !drafts[item.id]?.trim() ||
                              Boolean(busy[item.id])
                            }
                            onClick={() => void submitComment(item)}
                          >
                            {busy[item.id] === "submit" ? (
                              <Loader2 />
                            ) : (
                              <Send />
                            )}
                          </Button>
                        </div>
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                          Ctrl / ⌘ + Enter 发布 ·{" "}
                          {(drafts[item.id] ?? "").length}/1000
                        </p>
                      </section>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </main>
    </div>
  );
}
