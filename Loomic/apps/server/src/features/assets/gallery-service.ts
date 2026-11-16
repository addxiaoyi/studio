import type { Pool, PoolClient } from "pg";
import type { GalleryCaptionSnapshot } from "@helstera/shared";

export class GalleryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export const activeGalleryAsset = `ga.deleted_at is null and ga.retention_state='active'
  and coalesce(ga.retention_until,ga.created_at+interval '3 days')>now()`;
export const publishedGallery = `gi.status='published' and gi.deleted_at is null and ${activeGalleryAsset}
  and ga.created_by=gi.owner_id and exists(select 1 from workspace_members published_owner
    where published_owner.workspace_id=gi.workspace_id and published_owner.user_id=gi.owner_id)`;

async function galleryTransaction<T>(
  db: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const value = await work(client);
    await client.query("commit");
    return value;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}

async function lockPublishedGallery(client: PoolClient, id: string) {
  // Publication takes the asset lock before the gallery row; use that order everywhere.
  const asset = await client.query<{ id: string }>(
    `select ga.id from generated_assets ga
    join gallery_items gi on gi.asset_id=ga.id and gi.workspace_id=ga.workspace_id
    where gi.id=$1 and ${publishedGallery} for update of ga`,
    [id],
  );
  if (!asset.rows[0])
    throw new GalleryError(
      "gallery_not_found",
      "公开作品不存在或已不可用。",
      404,
    );
  const item = await client.query<{ id: string }>(
    `select gi.id from gallery_items gi
    join generated_assets ga on ga.id=gi.asset_id and ga.workspace_id=gi.workspace_id
    where gi.id=$1 and ${publishedGallery} for update of gi`,
    [id],
  );
  if (!item.rows[0])
    throw new GalleryError(
      "gallery_not_found",
      "公开作品不存在或已不可用。",
      404,
    );
}

export async function publishGalleryAsset(
  db: Pool,
  input: {
    assetId: string;
    workspaceId: string;
    userId: string;
    title?: string | undefined;
    description?: string | undefined;
    caption?: GalleryCaptionSnapshot | undefined;
  },
) {
  return galleryTransaction(db, async (client) => {
    // Upload publication may create metadata, but must never revive an existing deleted asset.
    const owned = await client.query<{ id: string }>(
      `select ga.id from generated_assets ga
      where ga.workspace_id=$2 and ga.created_by=$3 and ${activeGalleryAsset}
        and (ga.id=$1 or exists(select 1 from asset_objects ao where ao.id=$1 and ao.workspace_id=ga.workspace_id
          and ao.object_path=ga.object_path and ao.created_by=$3)) for update`,
      [input.assetId, input.workspaceId, input.userId],
    );
    let generatedId = owned.rows[0]?.id;
    if (!generatedId) {
      const upload = await client.query<{ object_path: string }>(
        `select object_path from asset_objects
        where id=$1 and workspace_id=$2 and created_by=$3
          and (mime_type like 'image/%' or mime_type like 'video/%') and created_at>now()-interval '3 days' for update`,
        [input.assetId, input.workspaceId, input.userId],
      );
      if (upload.rows[0]) {
        const created = await client.query<{ id: string }>(
          `insert into generated_assets(workspace_id,object_path,mime_type,media_type,created_by,title,description,prompt,retention_until)
          select workspace_id,object_path,mime_type,case when mime_type like 'video/%' then 'video' else 'image' end,created_by,'','','',created_at+interval '3 days'
          from asset_objects where id=$1 and workspace_id=$2 and created_by=$3
          on conflict(workspace_id,object_path) do nothing returning id`,
          [input.assetId, input.workspaceId, input.userId],
        );
        generatedId = created.rows[0]?.id;
        if (!generatedId) {
          const existing = await client.query<{ id: string }>(
            `select ga.id from generated_assets ga
            where ga.workspace_id=$1 and ga.object_path=$2 and ga.created_by=$3 and ${activeGalleryAsset} for update`,
            [input.workspaceId, upload.rows[0].object_path, input.userId],
          );
          generatedId = existing.rows[0]?.id;
        }
      }
    }
    if (!generatedId)
      throw new GalleryError(
        "asset_not_found",
        "素材不存在、已到期、已删除或不属于当前账户。",
        404,
      );
    if (input.caption) {
      const video = await client.query<{ media_type: string }>("select media_type from generated_assets where id=$1", [generatedId]);
      if (video.rows[0]?.media_type !== "video") throw new GalleryError("invalid_caption_asset", "只有视频作品可以附带字幕。", 400);
    }
    await client.query(
      "update generated_assets set title=coalesce($1,title),description=coalesce($2,description),updated_at=now() where id=$3",
      [input.title ?? null, input.description ?? null, generatedId],
    );
    const published = await client.query<{
      id: string;
      asset_id: string;
      status: string;
      published_at: Date;
    }>(
      `insert into gallery_items(asset_id,workspace_id,owner_id,status,published_at,caption_snapshot)
      values($1,$2,$3,'published',now(),$4::jsonb) on conflict(asset_id) do update set status='published',deleted_at=null,published_at=now(),updated_at=now(),caption_snapshot=excluded.caption_snapshot
      where gallery_items.workspace_id=excluded.workspace_id and gallery_items.owner_id=excluded.owner_id
      returning id,asset_id,status,published_at`,
      [generatedId, input.workspaceId, input.userId, input.caption ? JSON.stringify(input.caption) : null],
    );
    if (!published.rows[0])
      throw new GalleryError(
        "asset_not_owned",
        "公开作品不属于当前账户。",
        404,
      );
    return published.rows[0];
  });
}

export async function toggleGalleryLike(db: Pool, id: string, userId: string) {
  return galleryTransaction(db, async (client) => {
    await lockPublishedGallery(client, id);
    const inserted = await client.query<{ gallery_id: string }>(
      "insert into gallery_likes(gallery_id,user_id) values($1,$2) on conflict do nothing returning gallery_id",
      [id, userId],
    );
    const liked = inserted.rows.length > 0;
    if (!liked)
      await client.query(
        "delete from gallery_likes where gallery_id=$1 and user_id=$2",
        [id, userId],
      );
    const count = await client.query<{ like_count: number }>(
      "update gallery_items set like_count=(select count(*) from gallery_likes where gallery_id=$1),updated_at=now() where id=$1 returning like_count",
      [id],
    );
    const savedCount = count.rows[0];
    if (!savedCount)
      throw new Error(
        "Gallery like count could not be persisted after locking the item.",
      );
    return { liked, likeCount: savedCount.like_count };
  });
}

type Comment = {
  id: string;
  gallery_id: string;
  user_id: string;
  body: string;
  status: string;
  created_at: Date;
  author_name: string;
  can_delete: boolean;
};
const commentColumns = `c.id,c.gallery_id,c.user_id,c.body,c.status,c.created_at,
  coalesce(nullif(u.display_name,''),split_part(u.email,'@',1),'匿名用户') as author_name`;

export async function saveGalleryComment(
  db: Pool,
  input: { galleryId: string; userId: string; body: string; requestId: string },
) {
  return galleryTransaction(db, async (client) => {
    await lockPublishedGallery(client, input.galleryId);
    await client.query(
      `insert into gallery_comments(gallery_id,user_id,body,request_id) values($1,$2,$3,$4)
      on conflict(user_id,request_id) do nothing`,
      [input.galleryId, input.userId, input.body, input.requestId],
    );
    const comment = (
      await client.query<Comment>(
        `select ${commentColumns},true as can_delete
      from gallery_comments c join app_users u on u.id=c.user_id where c.user_id=$1 and c.request_id=$2 for update of c`,
        [input.userId, input.requestId],
      )
    ).rows[0];
    if (
      !comment ||
      comment.gallery_id !== input.galleryId ||
      comment.body !== input.body ||
      comment.status !== "visible"
    ) {
      throw new GalleryError(
        "comment_request_conflict",
        "此评论请求已用于不同内容或已删除，请重新提交。",
        409,
      );
    }
    const count = await client.query<{ comment_count: number }>(
      "update gallery_items set comment_count=(select count(*) from gallery_comments where gallery_id=$1 and status='visible'),updated_at=now() where id=$1 returning comment_count",
      [input.galleryId],
    );
    if (!count.rows[0])
      throw new Error(
        "Gallery comment count could not be persisted after locking the item.",
      );
    return { ...comment, comment_count: count.rows[0].comment_count };
  });
}

export async function listGalleryComments(
  db: Pool,
  id: string,
  userId: string | null,
) {
  return galleryTransaction(db, async (client) => {
    await lockPublishedGallery(client, id);
    return (
      await client.query<Comment>(
        `select ${commentColumns},coalesce(c.user_id=$2::uuid,false) as can_delete
      from gallery_comments c join app_users u on u.id=c.user_id where c.gallery_id=$1 and c.status='visible'
      order by c.created_at asc,c.id asc limit 100`,
        [id, userId],
      )
    ).rows;
  });
}

export async function removeGalleryComment(
  db: Pool,
  id: string,
  userId: string,
) {
  return galleryTransaction(db, async (client) => {
    const comment = (
      await client.query<{ gallery_id: string }>(
        "select gallery_id from gallery_comments where id=$1 and user_id=$2 and status='visible'",
        [id, userId],
      )
    ).rows[0];
    if (!comment)
      throw new GalleryError(
        "comment_not_found",
        "评论不存在或无权删除。",
        404,
      );
    // The owner can still remove their own comment after a publication is hidden.
    await client.query("select id from gallery_items where id=$1 for update", [
      comment.gallery_id,
    ]);
    const removed = await client.query(
      "update gallery_comments set status='removed' where id=$1 and user_id=$2 and status='visible' returning id",
      [id, userId],
    );
    if (!removed.rows[0])
      throw new GalleryError("comment_not_found", "评论不存在或已删除。", 404);
    const count = await client.query<{ comment_count: number }>(
      "update gallery_items set comment_count=(select count(*) from gallery_comments where gallery_id=$1 and status='visible'),updated_at=now() where id=$1 returning comment_count",
      [comment.gallery_id],
    );
    if (!count.rows[0])
      throw new Error(
        "Gallery comment count could not be persisted after locking the item.",
      );
    return { id, comment_count: count.rows[0].comment_count };
  });
}

export async function toggleAssetFavorite(
  db: Pool,
  input: { id: string; workspaceId: string; userId: string },
) {
  return galleryTransaction(db, async (client) => {
    const asset = await client.query(
      `select ga.id from generated_assets ga where ga.id=$1 and ga.workspace_id=$2 and ${activeGalleryAsset}
      and (ga.created_by=$3 or not exists(select 1 from asset_objects ao where ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path and ao.bucket in ('private-video','private-try-on'))) for update`,
      [input.id, input.workspaceId, input.userId],
    );
    if (!asset.rows[0])
      throw new GalleryError(
        "asset_not_found",
        "素材不存在、已到期或无权访问。",
        404,
      );
    const inserted = await client.query(
      "insert into asset_favorites(asset_id,user_id) values($1,$2) on conflict do nothing returning asset_id",
      [input.id, input.userId],
    );
    const favorited = inserted.rows.length > 0;
    if (!favorited)
      await client.query(
        "delete from asset_favorites where asset_id=$1 and user_id=$2",
        [input.id, input.userId],
      );
    return { favorited };
  });
}
