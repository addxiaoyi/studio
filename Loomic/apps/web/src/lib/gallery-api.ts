export type GalleryItem = {
  id: string;
  asset_id: string;
  title: string | null;
  description: string | null;
  prompt: string | null;
  author_name: string;
  model: string | null;
  resolution: string | null;
  generation_type: string | null;
  source_job_id: string | null;
  width: number | null;
  height: number | null;
  media_type: "image" | "video";
  mime_type: string | null;
  object_url: string;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  caption?: { url: string; language: string; label: string } | null;
};

export type GalleryComment = {
  id: string;
  gallery_id: string;
  user_id: string;
  body: string;
  author_name: string;
  created_at: string;
  can_delete: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("作品数据格式无效，请重试。");
  return value;
}
function dimension(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function parseGallery(value: unknown): GalleryItem[] {
  if (!Array.isArray(value)) throw new Error("作品列表格式无效，请重试。");
  return value.map((entry) => {
    if (
      !record(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.asset_id !== "string" ||
      !["image", "video"].includes(String(entry.media_type)) ||
      typeof entry.object_url !== "string" ||
      !entry.object_url.startsWith("/") ||
      entry.object_url.startsWith("//") ||
      entry.object_url.includes("\\")
    ) {
      throw new Error("作品内容格式无效，请重试。");
    }
    return {
      id: entry.id,
      asset_id: entry.asset_id,
      title: text(entry.title),
      description: text(entry.description),
      prompt: text(entry.prompt),
      author_name: text(entry.author_name) ?? "创作者",
      model: text(entry.model),
      resolution: text(entry.resolution),
      generation_type: text(entry.generation_type),
      source_job_id: text(entry.source_job_id),
      width: dimension(entry.width),
      height: dimension(entry.height),
      media_type: entry.media_type as "image" | "video",
      mime_type: text(entry.mime_type),
      object_url: entry.object_url,
      like_count: count(entry.like_count),
      comment_count: count(entry.comment_count),
      published_at: text(entry.published_at),
      ...(entry.caption &&
      record(entry.caption) &&
      entry.caption.url === `/api/gallery/${entry.id}/captions.vtt` &&
      typeof entry.caption.language === "string" &&
      typeof entry.caption.label === "string"
        ? {
            caption: {
              url: entry.caption.url,
              language: entry.caption.language,
              label: entry.caption.label,
            },
          }
        : {}),
    };
  });
}

export function parseGalleryComment(
  value: unknown,
  galleryId: string,
): GalleryComment {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    value.gallery_id !== galleryId ||
    typeof value.user_id !== "string" ||
    typeof value.body !== "string" ||
    typeof value.author_name !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.can_delete !== "boolean"
  ) {
    throw new Error("评论内容格式无效，请重试。");
  }
  return {
    id: value.id,
    gallery_id: galleryId,
    user_id: value.user_id,
    body: value.body,
    author_name: value.author_name,
    created_at: value.created_at,
    can_delete: value.can_delete,
  };
}

export function parseGalleryComments(
  value: unknown,
  galleryId: string,
): GalleryComment[] {
  if (!Array.isArray(value)) throw new Error("评论列表格式无效，请重试。");
  return [
    ...new Map(
      value.map((entry) => {
        const comment = parseGalleryComment(entry, galleryId);
        return [comment.id, comment] as const;
      }),
    ).values(),
  ];
}

export function parseLikeCount(value: unknown): number {
  if (!record(value) || typeof value.liked !== "boolean")
    throw new Error("点赞结果格式无效，请重试。");
  return count(value.likeCount);
}

export function commentCount(value: unknown): number | null {
  if (!record(value) || value.comment_count === undefined) return null;
  return count(value.comment_count);
}

export async function galleryRequest(
  url: string,
  init: RequestInit,
  fallback: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include", ...init });
  } catch (cause) {
    throw new Error(fallback, { cause });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error(fallback, { cause });
  }
  if (!response.ok) {
    throw new Error(
      record(body) &&
        record(body.error) &&
        typeof body.error.message === "string"
        ? body.error.message
        : fallback,
    );
  }
  if (!record(body) || body.ok !== true || !("data" in body))
    throw new Error(fallback);
  return body.data;
}
