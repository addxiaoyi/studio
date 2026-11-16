import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 2_147_483_647;
const pageQuery = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .default("50")
    .transform(Number)
    .pipe(z.number().int().min(1).max(MAX_PAGE_SIZE)),
  offset: z
    .string()
    .regex(/^\d+$/)
    .default("0")
    .transform(Number)
    .pipe(z.number().int().min(0).max(MAX_OFFSET)),
  q: z.string().trim().max(1000).default(""),
  category: z.string().trim().max(200).default(""),
});
const promptId = z.string().uuid();

type CatalogOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
};

type PublishedPrompt = {
  id: string;
  title: string;
  prompt: string;
  category: string;
  tags: string[];
  favorite_count: number;
  view_count: number;
  source: string | null;
  source_url: string | null;
  license: string | null;
};

function missingPrompt(reply: FastifyReply) {
  return reply.code(404).send({
    ok: false,
    error: { code: "prompt_not_found", message: "提示词不存在或尚未发布。" },
  });
}

function promptFailure(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (
    error.code?.startsWith("FST_ERR_CTP_") &&
    error.statusCode &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    request.log.warn({ code: error.code }, "invalid prompt request body");
    return reply.code(error.statusCode).send({
      ok: false,
      error: {
        code: "invalid_prompt_request",
        message: "请求内容或格式无效，请检查后重试。",
      },
    });
  }
  request.log.error({ err: error }, "prompt catalog request failed");
  return reply.code(500).send({
    ok: false,
    error: {
      code: "prompt_unavailable",
      message: "提示词服务暂不可用，请稍后重试。",
    },
  });
}

async function toggleFavorite(
  db: Pool,
  id: string,
  userId: string,
): Promise<boolean | null> {
  const client = await db.connect();
  try {
    await client.query("begin");
    // Serialize toggles with publication changes and the denormalized counter.
    const prompt = await client.query<{ id: string }>(
      "select id from prompt_entries where id=$1 and published=true and deleted_at is null for update",
      [id],
    );
    if (!prompt.rows[0]) {
      await client.query("rollback");
      return null;
    }
    const inserted = await client.query<{ prompt_id: string }>(
      "insert into prompt_favorites(prompt_id,user_id) values($1,$2) on conflict do nothing returning prompt_id",
      [id, userId],
    );
    const favorited = inserted.rows.length > 0;
    if (!favorited)
      await client.query(
        "delete from prompt_favorites where prompt_id=$1 and user_id=$2",
        [id, userId],
      );
    await client.query(
      "update prompt_entries set favorite_count=(select count(*) from prompt_favorites where prompt_id=$1) where id=$1",
      [id],
    );
    await client.query("commit");
    return favorited;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}

export function registerPromptCatalogRoutes(
  app: FastifyInstance,
  options: CatalogOptions,
) {
  app.get(
    "/api/prompts",
    { errorHandler: promptFailure },
    async (request, reply) => {
      const query = pageQuery.safeParse(request.query);
      if (!query.success)
        return reply.code(400).send({
          ok: false,
          error: {
            code: "invalid_prompt_query",
            message: "提示词查询参数无效，请检查分页和筛选条件。",
          },
        });
      const { q, category, limit, offset } = query.data;
      const { rows } = await options.db.query<PublishedPrompt>(
        `select id,title,prompt,category,tags,favorite_count,view_count,source,source_url,license from prompt_entries
       where published=true and deleted_at is null
         and ($1::text is null or title ilike '%' || $1 || '%' or prompt ilike '%' || $1 || '%' or $1 = any(tags))
         and ($2::text is null or category=$2)
       order by favorite_count desc,created_at desc,id desc limit $3 offset $4`,
        [q || null, category || null, limit + 1, offset],
      );
      const categories = await options.db.query<{
        category: string;
        count: number;
      }>(
        "select category,count(*)::int as count from prompt_entries where published=true and deleted_at is null group by category order by count(*) desc,category",
      );
      return {
        ok: true,
        data: rows.slice(0, limit),
        pagination: { offset, limit, hasMore: rows.length > limit },
        categories: categories.rows,
      };
    },
  );

  app.post<{ Params: { promptId: string } }>(
    "/api/prompts/:promptId/view",
    { errorHandler: promptFailure },
    async (request, reply) => {
      const user = await options.auth.authenticate(request);
      if (!user)
        return reply.code(401).send({
          ok: false,
          error: { code: "unauthorized", message: "请先登录。" },
        });
      const id = promptId.safeParse(request.params.promptId);
      if (!id.success)
        return reply.code(400).send({
          ok: false,
          error: { code: "invalid_prompt_id", message: "提示词标识无效。" },
        });
      await options.viewerService.ensureViewer(user);
      const updated = await options.db.query(
        "update prompt_entries set view_count=view_count+1 where id=$1 and published=true and deleted_at is null returning id",
        [id.data],
      );
      if (!updated.rows[0]) return missingPrompt(reply);
      return { ok: true };
    },
  );

  app.post<{ Params: { promptId: string } }>(
    "/api/prompts/:promptId/favorite",
    { errorHandler: promptFailure },
    async (request, reply) => {
      const user = await options.auth.authenticate(request);
      if (!user)
        return reply.code(401).send({
          ok: false,
          error: { code: "unauthorized", message: "请先登录。" },
        });
      const id = promptId.safeParse(request.params.promptId);
      if (!id.success)
        return reply.code(400).send({
          ok: false,
          error: { code: "invalid_prompt_id", message: "提示词标识无效。" },
        });
      await options.viewerService.ensureViewer(user);
      const favorited = await toggleFavorite(options.db, id.data, user.id);
      if (favorited === null) return missingPrompt(reply);
      return { ok: true, data: { favorited } };
    },
  );
}
