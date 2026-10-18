import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
  createFeedPackageSchema,
  feedAutomationRequestSchema,
  feedMetricInputSchema,
  feedScheduleInputSchema,
  feedStructureSchema,
  publishingAccountInputSchema,
  publishingPlanActionSchema,
  type FeedStructure,
} from "@helstera/shared";
import type { Pool } from "pg";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { StorageProvider } from "../storage/storage-provider.js";
import { syncTrendSource } from "../features/feed/trend-sync.js";
import { buildFeedTimeline, buildSubtitleSrt, mediaExtension } from "../features/feed/feed-timeline.js";
import {
  buildInsightRecommendations,
  confirmPlanStatus,
  isValidPlanTransition,
  scheduledPlanStatus,
  summarizeMetrics,
} from "../features/feed/publishing-scheduler.js";
import {
  persistContentInsight,
  validateMetricRelations,
} from "../features/feed/metrics.js";
import {
  collectFeedReferenceAssetIds,
  enqueueFeedRenderJobs,
  findMissingFeedReferenceAssets,
} from "../features/jobs/executors/feed-render.js";
import { enqueueFeedStructureJob } from "../features/jobs/executors/feed-structure.js";
import { canTransitionFeedPackage, nextFeedPackageStatus } from "../features/feed/feed-state.js";
import { parseMetricsCsv } from "../features/feed/metrics-csv.js";

type FeedOptions = { auth: RequestAuthenticator; db: Pool; viewerService: ViewerService; storage?: StorageProvider };

const DEFAULT_TREND_SOURCE = {
  name: "系统中文热点",
  platform: "google-news",
  sourceType: "rss",
  url: "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  refreshMinutes: 30,
} as const;

async function ensureDefaultTrendSource(db: Pool, workspaceId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`feed-default-source:${workspaceId}`]);
    await client.query(
      `insert into trend_sources(
         workspace_id,name,platform,source_type,url,config,refresh_minutes,enabled
       )
       select $1,$2,$3,$4,$5,'{}'::jsonb,$6,true
       where not exists (
         select 1 from trend_sources where workspace_id=$1 and url=$5
       )`,
      [
        workspaceId,
        DEFAULT_TREND_SOURCE.name,
        DEFAULT_TREND_SOURCE.platform,
        DEFAULT_TREND_SOURCE.sourceType,
        DEFAULT_TREND_SOURCE.url,
        DEFAULT_TREND_SOURCE.refreshMinutes,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const platformNames: Record<string, string> = {
  douyin: "抖音", xiaohongshu: "小红书", kuaishou: "快手", zhihu: "知乎",
  bilibili: "B站", wechat_channels: "视频号", wechat_official: "公众号",
  tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", pinterest: "Pinterest", x: "X",
};

const platformRules: Record<string, { ratio: string; maxSeconds: number; title: number }> = {
  douyin: { ratio: "9:16", maxSeconds: 600, title: 55 }, xiaohongshu: { ratio: "3:4", maxSeconds: 900, title: 20 },
  kuaishou: { ratio: "9:16", maxSeconds: 600, title: 50 }, zhihu: { ratio: "16:9", maxSeconds: 900, title: 80 },
  bilibili: { ratio: "16:9", maxSeconds: 3600, title: 80 }, wechat_channels: { ratio: "9:16", maxSeconds: 180, title: 30 },
  wechat_official: { ratio: "4:3", maxSeconds: 900, title: 64 },
  tiktok: { ratio: "9:16", maxSeconds: 600, title: 220 }, instagram: { ratio: "9:16", maxSeconds: 90, title: 220 },
  facebook: { ratio: "1:1", maxSeconds: 2400, title: 255 }, youtube: { ratio: "16:9", maxSeconds: 3600, title: 100 },
  pinterest: { ratio: "2:3", maxSeconds: 300, title: 100 }, x: { ratio: "16:9", maxSeconds: 140, title: 280 },
};
const publishModes = new Set(["oauth_api", "extension", "scan_confirm", "deep_link"]);

function structureFor(input: { title: string; brief: string; contentType: string; duration: number; platform: string; referenceImageUrls: string[]; referenceAssetIds: string[] }): FeedStructure {
  const title = input.title.trim();
  const brief = input.brief.trim();
  const hook = `你是否也遇到${brief.slice(0, 36)}？${title}给出一个更直接的解决方案。`;
  const shots = [
    { id: "hook", startSecond: 0, endSecond: Math.min(3, input.duration), visual: "近景展示问题与商品主体，商品外观保持参考图一致", voiceover: hook, subtitle: hook },
    { id: "proof", startSecond: Math.min(3, input.duration), endSecond: Math.max(4, Math.round(input.duration * 0.72)), visual: "展示真实使用场景、细节和可验证卖点", voiceover: `围绕${brief}展示使用过程与证据。`, subtitle: `真实场景展示：${brief.slice(0, 60)}` },
    { id: "cta", startSecond: Math.max(4, Math.round(input.duration * 0.72)), endSecond: input.duration, visual: "回到商品主体与清晰行动指令", voiceover: "现在了解更多，选择适合你的方案。", subtitle: "现在了解更多" },
  ];
  return {
    title, audience: "对该商品有明确需求、希望快速判断是否值得购买的人群", painPoint: brief,
    angle: `${input.contentType}：先展示问题，再用商品细节和场景证明价值`,
    hypothesis: "真实商品细节与单一行动指令，比堆叠卖点更容易促成理解和点击",
    hook, evidence: ["商品外观、颜色、材质和关键结构必须以参考图为准", "只使用用户提供或可验证的商品信息"],
    cta: "现在了解更多，选择适合你的方案", riskNotes: ["未验证的参数不得写成事实", "生成前检查参考图是否已绑定"],
    imagePrompt: `商品电商首帧，严格还原参考图中的商品外观、比例、颜色、材质、纹理和标识，不添加不存在的部件，${brief}，干净构图，主体清晰。`,
    videoPrompt: `${input.duration}秒商品短视频，商品主体全程严格参考输入图，不改变形状、颜色、标识和关键细节；${brief}；0-3秒给出钩子，中段展示真实场景和证据，结尾单一CTA。`, aspectRatio: platformRules[input.platform]?.ratio ?? "9:16", referenceImageUrls: input.referenceImageUrls, referenceAssetIds: input.referenceAssetIds, shots,
  };
}

function buildPlatformVariant(input: {
  platform: string;
  title: string;
  brief: string;
  structure: FeedStructure;
  contentType: string;
}): { title: string; body: string; hashtags: string[]; coverText: string } {
  const rule = platformRules[input.platform] ?? { ratio: "9:16", maxSeconds: 300, title: 80 };
  const title = input.title.trim().slice(0, rule.title);
  const platformLead: Record<string, string> = {
    douyin: "先给结果，再展示使用过程：",
    xiaohongshu: "真实体验记录：",
    kuaishou: "实用场景分享：",
    zhihu: "问题拆解与证据：",
    bilibili: "完整测评与使用过程：",
    wechat_channels: "快速看懂：",
    wechat_official: "一篇文章说清：",
    tiktok: "前三秒给结果，再展示商品场景：",
    instagram: "视觉种草与使用场景：",
    facebook: "社群场景与购买理由：",
    youtube: "完整演示与测评：",
    pinterest: "灵感图钉与商品卖点：",
    x: "一句话讲清价值：",
  };
  const lead = platformLead[input.platform] ?? "内容要点：";
  const body = `${lead}${input.brief}\n\n${input.structure.evidence.join("；")}\n\n${input.structure.cta}`;
  const hashtags = [input.contentType, platformNames[input.platform] ?? input.platform].filter(Boolean);
  return { title, body, hashtags, coverText: input.structure.hook.slice(0, 80) };
}
async function markPublishingPlanPublished(db: Pool | any, input: { planId?: string | null; postUrl: string; publishedAt: string; packageId: string; platform: string; accountAlias: string }, workspaceId: string): Promise<void> {
  if (!input.planId) return;
  await db.query(
    "update publishing_plans set status='published',external_url=$1,published_at=$2,updated_at=now() where id=$3 and package_id=$4 and platform=$5 and account_alias=$6 and workspace_id=$7 and status in ('waiting_publish','scheduled','ready')",
    [input.postUrl, input.publishedAt, input.planId, input.packageId, input.platform, input.accountAlias, workspaceId],
  );
  await db.query("update content_packages set status='published',updated_at=now() where id=$1 and workspace_id=$2 and status in ('scheduled','exported')", [input.packageId, workspaceId]);
}function validatePlatformVariant(platform: string, input: { title: string; body: string; hashtags: string[]; coverText: string }): Record<string, string> {
  const rule = platformRules[platform] ?? { ratio: "9:16", maxSeconds: 300, title: 80 };
  const errors: Record<string, string> = {};
  if (input.title.length > rule.title) errors.title = `标题不能超过 ${rule.title} 个字符`;
  if (input.body.length > 12000) errors.body = "正文不能超过 12000 个字符";
  if (input.hashtags.length > 30) errors.hashtags = "标签最多 30 个";
  if (input.coverText.length > 120) errors.coverText = "封面文案不能超过 120 个字符";
  return errors;
}
function metricsSummary(row: any) {
  return summarizeMetrics([row]);
}

export function registerFeedOperationRoutes(app: FastifyInstance, options: FeedOptions): void {
  const session = async (request: any, reply: any) => {
    const user = await options.auth.authenticate(request);
    if (!user) { await reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "请先登录" } }); return null; }
    return { user, viewer: await options.viewerService.ensureViewer(user) };
  };
  const bad = (reply: any, message: string, details?: unknown) => reply.code(400).send({ ok: false, error: { code: "invalid_input", message, details } });

  app.get("/api/feed/platforms", async () => {
    const { rows } = await options.db.query("select platform,display_name,default_mode,supported_modes,enabled,config from publishing_platform_policies where enabled=true order by platform");
    return { ok: true, data: rows.map((row) => ({ id: row.platform, name: row.display_name, defaultMode: row.default_mode, supportedModes: row.supported_modes, config: row.config, ...platformRules[row.platform] })) };
  });

  app.get("/api/feed/accounts", async (request: any, reply) => {
    const s = await session(request, reply); if (!s) return;
    const { rows } = await options.db.query("select id,platform,alias,notes,status,connection_mode,created_at from publishing_accounts where workspace_id=$1 and owner_user_id=$2 and status='active' order by updated_at desc", [s.viewer.workspace.id, s.user.id]);
    return { ok: true, data: rows };
  });

  app.post("/api/feed/accounts", async (request: any, reply: any) => {
    const s = await session(request, reply); if (!s) return;
    const parsed = publishingAccountInputSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, "账号信息不完整", parsed.error.flatten());
    const v = parsed.data;
    const { rows: policies } = await options.db.query("select supported_modes,config from publishing_platform_policies where platform=$1 and enabled=true", [v.platform]);
    const policy = policies[0];
    if (!policy || !policy.supported_modes.includes(v.connectionMode)) return bad(reply, "该平台不支持所选发布方式");
    if (v.connectionMode === "oauth_api" && policy.config?.oauthConfigured !== true) return bad(reply, "该平台 OAuth 发布尚未开通，请选择确认发布");
    if (v.connectionMode === "extension" && policy.config?.extensionConfigured !== true) return bad(reply, "本机发布扩展尚未开通，请选择确认发布");
    const { rows } = await options.db.query(
      "insert into publishing_accounts(workspace_id,platform,alias,notes,created_by,owner_user_id,connection_mode) values($1,$2,$3,$4,$5,$5,$6) on conflict(workspace_id,platform,alias) do update set notes=excluded.notes,connection_mode=excluded.connection_mode,status='active',updated_at=now() where publishing_accounts.owner_user_id=$5 returning id,platform,alias,notes,status,connection_mode,created_at",
      [s.viewer.workspace.id,v.platform,v.alias,v.notes,s.user.id,v.connectionMode],
    );
    if (!rows[0]) return reply.code(409).send({ ok: false, error: { code: "account_alias_conflict", message: "该平台账号别名已被工作区其他成员占用" } });
    return { ok: true, data: rows[0] };
  });  app.delete("/api/feed/accounts/:id", async (request: any, reply) => {
    const s = await session(request, reply); if (!s) return;
    const { rowCount } = await options.db.query("update publishing_accounts set status='revoked',updated_at=now() where id=$1 and workspace_id=$2 and owner_user_id=$3 and status='active'", [request.params.id,s.viewer.workspace.id,s.user.id]);
    if (!rowCount) return reply.code(404).send({ ok:false,error:{code:"not_found",message:"账号不存在或不属于当前用户"} });
    return { ok: true, data: { id: request.params.id, status: "revoked" } };
  });
  app.get("/api/feed/sources", async(request:any,reply)=>{const s=await session(request,reply);if(!s)return;await ensureDefaultTrendSource(options.db,s.viewer.workspace.id);const {rows}=await options.db.query("select id,name,platform,source_type,url,enabled,refresh_minutes,last_synced_at,last_error from trend_sources where workspace_id=$1 order by created_at desc",[s.viewer.workspace.id]);return {ok:true,data:rows};});
  app.post("/api/feed/sources",async(request:any,reply)=>{const s=await session(request,reply);if(!s)return;const name=String(request.body?.name??"").trim(),url=String(request.body?.url??"").trim(),sourceType=request.body?.sourceType==="api"?"api":"rss";if(!name||!url)return bad(reply,"来源名称和 URL 不能为空");let parsed:URL;try{parsed=new URL(url);}catch{return bad(reply,"来源 URL 格式不正确");}if(!['http:','https:'].includes(parsed.protocol))return bad(reply,"仅支持 HTTP/HTTPS 来源");const {rows}=await options.db.query("insert into trend_sources(workspace_id,name,platform,source_type,url,config,refresh_minutes) values($1,$2,$3,$4,$5,$6,$7) returning *",[s.viewer.workspace.id,name,String(request.body?.platform??"custom"),sourceType,url,request.body?.config??{},Math.min(10080,Math.max(5,Number(request.body?.refreshMinutes??60)))]);return {ok:true,data:rows[0]};});
  app.post("/api/feed/sources/:id/sync",async(request:any,reply)=>{const s=await session(request,reply);if(!s)return;const {rows}=await options.db.query("select id,url,platform,source_type,config from trend_sources where id=$1 and workspace_id=$2",[request.params.id,s.viewer.workspace.id]);if(!rows[0])return reply.code(404).send({ok:false,error:{code:"not_found",message:"趋势源不存在"}});try{const count=await syncTrendSource(options.db,rows[0]);return {ok:true,data:{count}};}catch(error){const message=error instanceof Error?error.message:"同步失败";await options.db.query("update trend_sources set last_error=$2,updated_at=now() where id=$1",[request.params.id,message]);return reply.code(502).send({ok:false,error:{code:"source_sync_failed",message,retryable:true}});}});
  app.get("/api/feed/trends", async (request: any, reply) => {
    const s = await session(request, reply); if (!s) return;
    await ensureDefaultTrendSource(options.db, s.viewer.workspace.id);
    const q = String(request.query?.q ?? "").trim();
    const page = Math.max(1, Number.parseInt(String(request.query?.page ?? "1"), 10) || 1);
    const pageSize = Math.min(50, Math.max(5, Number.parseInt(String(request.query?.pageSize ?? "10"), 10) || 10));
    const sort = request.query?.sort === "latest" ? "latest" : "heat";
    const offset = (page - 1) * pageSize;
    const orderBy = sort === "latest"
      ? "coalesce(published_at, fetched_at) desc nulls last, coalesce(heat,0) desc"
      : "coalesce(heat,0) desc nulls last, coalesce(published_at, fetched_at) desc nulls last";
    // The built-in RSS source is public workspace content. User-created trends
    // remain private to the current workspace.
    const filter = `ti.ignored_at is null and (ts.url=$2 or ti.workspace_id=$1) and ($3='' or ti.title ilike '%'||$3||'%' or ti.summary ilike '%'||$3||'%')`;
    const [{ rows }, countResult] = await Promise.all([
      options.db.query(
        `select * from (select distinct on (ti.dedupe_key) ti.id,ti.platform,ti.title,ti.summary,ti.source_url,ti.heat,ti.tags,ti.published_at,ti.fetched_at,ti.favorited_at from trend_items ti left join trend_sources ts on ts.id=ti.source_id where ${filter} order by ti.dedupe_key, ${orderBy.replaceAll("published_at", "ti.published_at").replaceAll("fetched_at", "ti.fetched_at").replaceAll("heat", "ti.heat")}, ti.id desc) public_trends order by ${orderBy} limit $4 offset $5`,
        [s.viewer.workspace.id, DEFAULT_TREND_SOURCE.url, q, pageSize, offset],
      ),
      options.db.query<{ count: string }>(
        `select count(distinct ti.dedupe_key)::text as count from trend_items ti left join trend_sources ts on ts.id=ti.source_id where ${filter}`,
        [s.viewer.workspace.id, DEFAULT_TREND_SOURCE.url, q],
      ),
    ]);
    const total = Number(countResult.rows[0]?.count ?? 0);
    return {
      ok: true,
      data: { items: rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), sort, query: q },
    };
  });
  app.post("/api/feed/trends/sync", async (request: any, reply) => { const s = await session(request, reply); if (!s) return; await ensureDefaultTrendSource(options.db,s.viewer.workspace.id); const { rows: sources } = await options.db.query("select id,url,platform,source_type,config from trend_sources where workspace_id=$1 and enabled=true", [s.viewer.workspace.id]); const results = await Promise.all(sources.map(async (source: any) => { try { return { id: source.id, count: await syncTrendSource(options.db, source), error: null }; } catch (error) { return { id: source.id, count: 0, error: error instanceof Error ? error.message : "同步失败" }; } })); const failed = results.filter((item) => item.error); return { ok: failed.length < results.length, data: { sources: results, failed: failed.length }, ...(failed.length ? { error: { code: "partial_sync", message: `${failed.length} 个热点来源同步失败`, retryable: true } } : {}) }; });
  app.post("/api/feed/trends", async (request: any, reply) => {
    const s = await session(request, reply); if (!s) return;
    const title = String(request.body?.title ?? "").trim(), summary = String(request.body?.summary ?? "").trim();
    if (!title) return bad(reply, "热点标题不能为空");
    const key = createHash("sha256").update(`${request.body?.sourceUrl ?? ""}|${title}`).digest("hex");
    const { rows } = await options.db.query(`insert into trend_items(workspace_id,platform,title,summary,source_url,heat,tags,dedupe_key,published_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(workspace_id,dedupe_key) do update set title=excluded.title,summary=excluded.summary,heat=excluded.heat returning *`, [s.viewer.workspace.id, String(request.body?.platform ?? "custom"), title, summary, request.body?.sourceUrl ?? null, Number(request.body?.heat ?? 0), Array.isArray(request.body?.tags) ? request.body.tags.slice(0, 20) : [], key, request.body?.publishedAt ?? null]);
    return { ok: true, data: rows[0] };
  });
  app.get("/api/feed/packages", async (request: any, reply) => { const s = await session(request, reply); if (!s) return; const { rows } = await options.db.query("select * from content_packages where workspace_id=$1 order by updated_at desc limit 50", [s.viewer.workspace.id]); return { ok: true, data: rows }; });
  app.post("/api/feed/packages", async (request: any, reply) => {
    const s = await session(request, reply);
    if (!s) return;
    {
      const parsed = createFeedPackageSchema.safeParse(request.body);
      if (!parsed.success) return bad(reply, "内容包参数不完整", parsed.error.flatten());
      const v = parsed.data;
      if (v.workflowMode === "automatic" && v.maxCostCny === null) return bad(reply, "全自动模式必须先设置费用上限");
      if (v.workflowMode === "automatic" && v.estimatedCostCny !== null && v.maxCostCny !== null && v.estimatedCostCny > v.maxCostCny) {
        return bad(reply, "预计费用超过费用上限，请提高上限或改用审阅模式");
      }
      const referenceAssetIds = collectFeedReferenceAssetIds(v);
      if (referenceAssetIds.length > 8) return bad(reply, "最多只能绑定 8 张参考图");
      const structure = structureFor({ title: v.title, brief: v.brief, contentType: v.contentType, duration: v.durationSeconds, platform: v.platforms[0] ?? "douyin", referenceImageUrls: v.referenceImageUrls, referenceAssetIds });
      const client = await options.db.connect(); try { await client.query("begin");
        if (referenceAssetIds.length) {
          const missingAssetIds = await findMissingFeedReferenceAssets(client, s.viewer.workspace.id, referenceAssetIds);
          if (missingAssetIds.length) {
            await client.query("rollback");
            return reply.code(400).send({ ok: false, error: { code: "reference_asset_not_owned", message: `参考图必须来自当前工作区上传资产: ${missingAssetIds.join(", ")}` } });
          }
        }        if (v.trendItemId) {
          const { rows: trendRows } = await client.query("select id from trend_items where id=$1 and workspace_id=$2", [v.trendItemId, s.viewer.workspace.id]);
          if (!trendRows[0]) { await client.query("rollback"); return reply.code(404).send({ok:false,error:{code:"trend_not_found",message:"热点不存在或不属于当前工作区"}}); }
        }
        const { rows } = await client.query(`insert into content_packages(workspace_id,created_by,trend_item_id,title,topic,brief,goal,content_type,platforms,duration_seconds,workflow_mode,status,model_id,estimated_cost_cny,max_cost_cny,structure) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'structured',$12,$13,$14,$15) returning *`, [s.viewer.workspace.id,s.user.id,v.trendItemId,v.title,v.topic,v.brief,v.goal,v.contentType,v.platforms,v.durationSeconds,v.workflowMode,v.modelId,v.estimatedCostCny,v.maxCostCny,structure]);
        const pkg = rows[0];
        for (const platform of v.platforms) {
          const variant = buildPlatformVariant({ platform, title: v.title, brief: v.brief, structure, contentType: v.contentType });
          await client.query(
            "insert into content_variants(package_id,platform,title,body,hashtags,cover_text) values($1,$2,$3,$4,$5,$6)",
            [pkg.id, platform, variant.title, variant.body, variant.hashtags, variant.coverText],
          );
        }        await client.query("commit");
        if (v.workflowMode === "automatic") {
          const render = await enqueueFeedRenderJobs(options.db, pkg.id, s.viewer.workspace.id, s.user.id);
          return { ok: true, data: { ...pkg, status: "rendering", renderJobs: render.jobs } };
        }
        return { ok: true, data: pkg };
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    }
  });
  app.get("/api/feed/packages/:id", async (request: any, reply) => { const s = await session(request, reply); if (!s) return; const { rows } = await options.db.query("select * from content_packages where id=$1 and workspace_id=$2", [request.params.id,s.viewer.workspace.id]); if (!rows[0]) return reply.code(404).send({ok:false,error:{code:"not_found",message:"内容包不存在"}}); const variants=await options.db.query("select * from content_variants where package_id=$1 order by platform",[request.params.id]); const insights=await options.db.query("select * from content_insights where package_id=$1 order by created_at desc",[request.params.id]); return {ok:true,data:{...rows[0],variants:variants.rows,insights:insights.rows}}; });
  app.post("/api/feed/automation", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const parsed = feedAutomationRequestSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, "�Զ�����Ϣ��������", parsed.error.flatten());
    const input = parsed.data;
    const existing = await options.db.query("select far.*, cp.status as package_status from feed_automation_runs far join content_packages cp on cp.id=far.package_id where far.workspace_id=$1 and far.idempotency_key=$2", [s.viewer.workspace.id, input.idempotencyKey]);
    if (existing.rows[0]) return { ok: true, data: existing.rows[0] };
    let packageId = input.packageId;
    if (!packageId) {
      if (!input.title || !input.brief || !input.goal || !input.platforms?.length) return bad(reply, "���ݰ���Ҫ title��brief��goal �� platforms");
      const created = await options.db.query(`insert into content_packages(workspace_id,created_by,title,topic,brief,goal,content_type,platforms,duration_seconds,workflow_mode,status,model_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'review','draft',$10) returning id`, [s.viewer.workspace.id, s.user.id, input.title, input.topic, input.brief, input.goal, input.contentType, input.platforms, input.durationSeconds, input.modelId]);
      packageId = created.rows[0]?.id;
    }
    const { rows: packages } = await options.db.query("select id,title,topic,brief,goal,content_type,platforms,duration_seconds,structure from content_packages where id=$1 and workspace_id=$2", [packageId, s.viewer.workspace.id]);
    const pkg = packages[0];
    if (!pkg) return reply.code(404).send({ ok: false, error: { code: "package_not_found", message: "���ݰ�������" } });
    const variantCount = await options.db.query<{ count: string }>("select count(*)::text as count from content_variants where package_id=$1", [pkg.id]);
    if (Number(variantCount.rows[0]?.count ?? 0) === 0) {
      for (const platform of pkg.platforms as string[]) {
        await options.db.query("insert into content_variants(package_id,platform,title,body,hashtags,cover_text) values($1,$2,$3,$4,$5,$6)", [pkg.id, platform, pkg.title, pkg.brief, [], pkg.title]);
      }
    }
    const job = await enqueueFeedStructureJob(options.db, { feed_package_id: pkg.id, feed_workspace_id: s.viewer.workspace.id, created_by: s.user.id, title: pkg.title, topic: pkg.topic ?? "", brief: pkg.brief, goal: pkg.goal ?? "", content_type: pkg.content_type, platforms: pkg.platforms, duration_seconds: Number(pkg.duration_seconds), existing_structure: pkg.structure ?? {} });
    const run = await options.db.query(`insert into feed_automation_runs(workspace_id,created_by,package_id,structure_job_id,idempotency_key,status,current_stage) values($1,$2,$3,$4,$5,'queued','strategy') returning *`, [s.viewer.workspace.id, s.user.id, pkg.id, job.id, input.idempotencyKey]);
    return reply.code(202).send({ ok: true, data: { ...run.rows[0], packageId: pkg.id, jobId: job.id } });
  });
  app.get("/api/feed/automation/:id", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const { rows } = await options.db.query(`select far.*, cp.status as package_status, bj.status as job_status, bj.error_code as job_error_code, bj.error_message as job_error_message from feed_automation_runs far join content_packages cp on cp.id=far.package_id left join background_jobs bj on bj.id=far.structure_job_id where far.id=$1 and far.workspace_id=$2`, [request.params.id, s.viewer.workspace.id]);
    const run = rows[0];
    if (!run) return reply.code(404).send({ ok: false, error: { code: "automation_not_found", message: "�Զ�������δ�ҵ�" } });
    const status = run.package_status === "structured" || ["ready", "exported", "published", "measured", "analyzed"].includes(run.package_status) ? "draft_ready" : ["failed", "dead_letter", "canceled"].includes(run.job_status) ? "failed" : run.job_status === "running" ? "running" : run.status;
    return { ok: true, data: { ...run, status, errorCode: run.job_error_code, errorMessage: run.job_error_message } };
  });
  app.post("/api/feed/automation/:id/retry", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const { rows } = await options.db.query(`select far.*, cp.id as package_id, cp.title, cp.topic, cp.brief, cp.goal, cp.content_type, cp.platforms, cp.duration_seconds, cp.structure from feed_automation_runs far join content_packages cp on cp.id=far.package_id where far.id=$1 and far.workspace_id=$2`, [request.params.id, s.viewer.workspace.id]);
    const run = rows[0];
    if (!run) return reply.code(404).send({ ok: false, error: { code: "automation_not_found", message: "�Զ�������δ�ҵ�" } });
    const job = await enqueueFeedStructureJob(options.db, { feed_package_id: run.package_id, feed_workspace_id: s.viewer.workspace.id, created_by: s.user.id, title: run.title, topic: run.topic ?? "", brief: run.brief, goal: run.goal ?? "", content_type: run.content_type, platforms: run.platforms, duration_seconds: Number(run.duration_seconds), existing_structure: run.structure ?? {} });
    const updated = await options.db.query(`update feed_automation_runs set structure_job_id=$3,status='queued',current_stage='strategy',error_code=null,error_message=null,updated_at=now() where id=$1 and workspace_id=$2 returning *`, [request.params.id, s.viewer.workspace.id, job.id]);
    return { ok: true, data: { ...updated.rows[0], jobId: job.id } };
  });
  app.post("/api/feed/packages/:id/structure/generate", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const { rows } = await options.db.query("select id,title,topic,brief,goal,content_type,platforms,duration_seconds from content_packages where id=$1 and workspace_id=$2", [request.params.id, s.viewer.workspace.id]);
    const pkg = rows[0];
    if (!pkg) return reply.code(404).send({ ok: false, error: { code: "not_found", message: "内容包不存在" } });
    const job = await enqueueFeedStructureJob(options.db, { feed_package_id: pkg.id, feed_workspace_id: s.viewer.workspace.id, created_by: s.user.id, title: pkg.title, topic: pkg.topic ?? "", brief: pkg.brief, goal: pkg.goal ?? "", content_type: pkg.content_type, platforms: pkg.platforms, duration_seconds: Number(pkg.duration_seconds), existing_structure: {} });
    return { ok: true, data: { ...job, status: "queued", message: "结构化模型任务已进入队列" } };
  });
  app.patch("/api/feed/packages/:id/draft", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const parsed = feedStructureSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, "�ṹ�ݸ�����������", parsed.error.flatten());
    const current = await options.db.query(
      "select status,structure from content_packages where id=$1 and workspace_id=$2",
      [request.params.id, s.viewer.workspace.id],
    );
    const pkg = current.rows[0];
    if (!pkg) return reply.code(404).send({ ok: false, error: { code: "not_found", message: "���ݰ�������" } });
    if (!["draft", "structured"].includes(pkg.status)) {
      return reply.code(409).send({ ok: false, error: { code: "invalid_draft_state", message: `��ǰ״̬ ${pkg.status} �����屣���ṹ�ݸ�` } });
    }
    const merged = {
      ...(pkg.structure ?? {}),
      ...parsed.data,
      referenceImageUrls: (pkg.structure as any)?.referenceImageUrls ?? parsed.data.referenceImageUrls ?? [],
      referenceAssetIds: (pkg.structure as any)?.referenceAssetIds ?? parsed.data.referenceAssetIds ?? [],
    };
    const validated = feedStructureSchema.safeParse(merged);
    if (!validated.success) return bad(reply, "�ṹ�ݸ���ȱ�ٱ�����Ϣ", validated.error.flatten());
    const { rows } = await options.db.query(
      `update content_packages
       set structure=$1,version=version+1,updated_at=now()
       where id=$2 and workspace_id=$3 and status in ('draft','structured')
       returning *`,
      [validated.data, request.params.id, s.viewer.workspace.id],
    );
    if (!rows[0]) return reply.code(409).send({ ok: false, error: { code: "state_changed", message: "���ݰ�״̬�ѱ仯����ˢ�º�����" } });
    return { ok: true, data: rows[0] };
  });
  app.patch("/api/feed/packages/:id/structure", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const parsed = feedStructureSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, "脚本结构不合法", parsed.error.flatten());
    const current = await options.db.query("select status,structure from content_packages where id=$1 and workspace_id=$2", [request.params.id, s.viewer.workspace.id]);
    const pkg = current.rows[0];
    if (!pkg) return reply.code(404).send({ ok: false, error: { code: "not_found", message: "内容包不存在" } });
    if (!canTransitionFeedPackage(pkg.status, "structure_approved")) return reply.code(409).send({ ok: false, error: { code: "invalid_state_transition", message: `当前状态 ${pkg.status} 不能批准结构` } });
    const mergedReferenceAssetIds = (pkg.structure as any)?.referenceAssetIds ?? parsed.data.referenceAssetIds ?? [];
    const missingAssetIds = await findMissingFeedReferenceAssets(options.db, s.viewer.workspace.id, mergedReferenceAssetIds);
    if (missingAssetIds.length) return reply.code(400).send({ ok: false, error: { code: "reference_asset_not_owned", message: `参考图必须来自当前工作区上传资产: ${missingAssetIds.join(", ")}` } });
    const merged = { ...(pkg.structure ?? {}), ...parsed.data, referenceImageUrls: (pkg.structure as any)?.referenceImageUrls ?? parsed.data.referenceImageUrls ?? [], referenceAssetIds: mergedReferenceAssetIds };
    const { rows } = await options.db.query("update content_packages set structure=$1,status=$2,updated_at=now() where id=$3 and workspace_id=$4 and status=$5 returning *", [merged, nextFeedPackageStatus("structure_approved"), request.params.id, s.viewer.workspace.id, pkg.status]);
    if (!rows[0]) return reply.code(409).send({ ok: false, error: { code: "state_changed", message: "内容包状态已变化，请刷新后重试" } });
    return { ok: true, data: rows[0] };
  });
  app.get("/api/feed/packages/:id/render-status", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const packageResult = await options.db.query(
      "select id,status from content_packages where id=$1 and workspace_id=$2",
      [request.params.id, s.viewer.workspace.id],
    );
    const pkg = packageResult.rows[0];
    if (!pkg) return reply.code(404).send({ ok: false, error: { code: "not_found", message: "���ݰ�������" } });
    const jobs = await options.db.query(
      `select id,job_type,status,error_code,error_message,progress,stage,attempt_count,max_attempts
       from background_jobs
       where workspace_id=$1 and payload->>'feed_package_id'=$2
       order by created_at asc`,
      [s.viewer.workspace.id, request.params.id],
    );
    return { ok: true, data: { packageId: pkg.id, status: pkg.status, jobs: jobs.rows } };
  });
  app.patch("/api/feed/packages/:id/variants/:variantId", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const { rows } = await options.db.query(
      `select cv.*
       from content_variants cv
       join content_packages cp on cp.id=cv.package_id
       where cp.id=$1 and cv.id=$2 and cp.workspace_id=$3`,
      [request.params.id, request.params.variantId, s.viewer.workspace.id],
    );
    const current = rows[0];
    if (!current) return reply.code(404).send({ ok: false, error: { code: "variant_not_found", message: "平台变体不存在" } });
    if (current.locked && request.body?.locked !== false) return reply.code(409).send({ ok: false, error: { code: "variant_locked", message: "该平台变体已锁定，请先解锁后再修改" } });
    const title = typeof request.body?.title === "string" ? request.body.title.trim() : current.title;
    const body = typeof request.body?.body === "string" ? request.body.body.trim() : current.body;
    const coverText = typeof request.body?.coverText === "string" ? request.body.coverText.trim() : current.cover_text;
    const hashtags = Array.isArray(request.body?.hashtags) ? request.body.hashtags.filter((tag: unknown): tag is string => typeof tag === "string").map((tag: string) => tag.trim()).filter(Boolean).slice(0, 30) : current.hashtags;
    if (!title || !body) return bad(reply, "平台标题和正文不能为空");
    const variantErrors = validatePlatformVariant(current.platform, { title, body, hashtags, coverText });
    if (Object.keys(variantErrors).length) return reply.code(400).send({ ok: false, error: { code: "platform_variant_invalid", message: "平台变体不符合规格", details: variantErrors } });
    const locked = request.body?.locked === true ? true : request.body?.locked === false ? false : current.locked;
    const updated = await options.db.query(
      `update content_variants
       set title=$1,body=$2,hashtags=$3,cover_text=$4,locked=$5,updated_at=now()
       where id=$6
       returning *`,
      [title, body, hashtags, coverText, locked, current.id],
    );
    return { ok: true, data: updated.rows[0] };
  });

  app.post("/api/feed/packages/:id/variants/:variantId/readapt", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const { rows } = await options.db.query(
      `select cv.*,cp.title as package_title,cp.brief,cp.content_type,cp.structure
       from content_variants cv join content_packages cp on cp.id=cv.package_id
       where cp.id=$1 and cv.id=$2 and cp.workspace_id=$3`,
      [request.params.id, request.params.variantId, s.viewer.workspace.id],
    );
    const current = rows[0];
    if (!current) return reply.code(404).send({ ok: false, error: { code: "variant_not_found", message: "平台变体不存在" } });
    if (current.locked) return reply.code(409).send({ ok: false, error: { code: "variant_locked", message: "该平台变体已锁定，不能重新适配" } });
    const variant = buildPlatformVariant({ platform: current.platform, title: current.package_title, brief: current.brief, structure: current.structure, contentType: current.content_type });
    const variantErrors = validatePlatformVariant(current.platform, variant);
    if (Object.keys(variantErrors).length) return reply.code(400).send({ ok: false, error: { code: "platform_variant_invalid", message: "平台变体不符合规格", details: variantErrors } });
    const created = await options.db.query(
      `insert into content_variants(package_id,platform,version,title,body,hashtags,cover_text,metadata)
       select package_id,platform,coalesce(max(version),0)+1,$1,$2,$3,$4,jsonb_build_object('adapted_from',id,'adapted_at',now())
       from content_variants where package_id=$5 and platform=$6 and id=$7
       group by package_id,platform,id
       returning *`,
      [variant.title, variant.body, variant.hashtags, variant.coverText, current.package_id, current.platform, current.id],
    );
    return { ok: true, data: created.rows[0] };
  });  app.get("/api/feed/packages/:id/variants", async (request:any,reply)=>{const s=await session(request,reply);if(!s)return;const {rows}=await options.db.query("select cv.* from content_variants cv join content_packages cp on cp.id=cv.package_id where cp.id=$1 and cp.workspace_id=$2 order by cv.platform",[request.params.id,s.viewer.workspace.id]);return {ok:true,data:rows};});
  app.post("/api/feed/packages/:id/render", async (request:any,reply)=>{
    const s=await session(request,reply);if(!s)return;
    try {
      const result=await enqueueFeedRenderJobs(options.db,request.params.id,s.viewer.workspace.id,s.user.id);
      const structure=result.package.structure??{};
      return {ok:true,data:{
        id:result.package.id,
        status:"rendering",
        jobs:result.jobs,
        steps:[
          {type:"feed_image",quantity:1,jobId:result.jobs.find((job)=>job.job_type==="image_generation")?.id,prompt:structure.imagePrompt},
          {type:"feed_video",quantity:1,jobId:result.jobs.find((job)=>job.job_type==="video_generation")?.id,durationSeconds:result.package.duration_seconds,prompt:structure.videoPrompt},
        ],
        note:"已提交图片和视频后台任务；重复请求会复用已有任务，不会重复提交。",
      }};
    } catch(error) {
      const message=error instanceof Error?error.message:"内容包当前不可生成";
      return reply.code(message==="内容包不存在"?404:409).send({ok:false,error:{code:"not_renderable",message}});
    }
  });
  app.get("/api/feed/packages/:id/timeline", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const packageResult = await options.db.query(
      "select id,title,duration_seconds,structure from content_packages where id=$1 and workspace_id=$2",
      [request.params.id, s.viewer.workspace.id],
    );
    const pkg = packageResult.rows[0];
    if (!pkg) return reply.code(404).send({ ok: false, error: { code: "not_found", message: "内容包不存在" } });
    const artifactResult = await options.db.query(
      `select ca.id,ca.artifact_type,ca.asset_id,ca.metadata,
              ga.media_type,ga.object_path,ga.mime_type,ga.title,ga.metadata as asset_metadata
       from content_artifacts ca
       left join generated_assets ga on ga.id=ca.asset_id and ga.workspace_id=$2 and ga.deleted_at is null
       where ca.package_id=$1 order by ca.created_at`,
      [pkg.id, s.viewer.workspace.id],
    );
    const artifacts = artifactResult.rows
      .filter((row) => row.asset_id && row.object_path)
      .map((row) => ({
        id: row.id,
        artifactType: row.artifact_type,
        assetId: row.asset_id,
        mediaType: row.media_type === "video" ? ("video" as const) : ("image" as const),
        objectPath: row.object_path,
        bucket: "project-assets",
        mimeType: row.mime_type ?? null,
        title: row.title ?? row.artifact_type,
        metadata: { ...(row.asset_metadata ?? {}), ...(row.metadata ?? {}) },
      }));
    const timeline = buildFeedTimeline({
      packageId: pkg.id,
      durationSeconds: Number(pkg.duration_seconds),
      structure: pkg.structure,
      artifacts,
    });
    const urls = new Map<string, string>();
    if (options.storage) {
      await Promise.all(artifacts.map(async (artifact) => {
        const publicUrl = await options.storage!.getPublicUrl(artifact.bucket, artifact.objectPath, 3600);
        if (!publicUrl.error && publicUrl.data?.signedUrl) urls.set(artifact.assetId, publicUrl.data.signedUrl);
      }));
    }
    timeline.tracks = timeline.tracks.map((track) => ({
      ...track,
      items: track.items.map((item) => ({
        ...item,
        ...(typeof item.assetId === "string" ? { sourceUrl: urls.get(item.assetId) ?? null } : {}),
      })),
    }));
    reply.header("content-disposition", `attachment; filename=feed-${pkg.id}-timeline.json`).type("application/json");
    return reply.send(JSON.stringify(timeline, null, 2));
  });  app.get("/api/feed/packages/:id/export", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const packageResult = await options.db.query("select * from content_packages where id=$1 and workspace_id=$2", [request.params.id, s.viewer.workspace.id]);
    const pkg = packageResult.rows[0];
    if (!pkg) return reply.code(404).send({ ok: false, error: { code: "not_found", message: "内容包不存在" } });
    const [variantResult, artifactResult] = await Promise.all([
      options.db.query("select platform,title,body,hashtags,cover_text,metadata from content_variants where package_id=$1 order by platform", [pkg.id]),
      options.db.query(
        `select ca.id,ca.artifact_type,ca.asset_id,ca.metadata,
                ga.media_type,ga.object_path,ga.mime_type,ga.title,ga.metadata as asset_metadata
         from content_artifacts ca
         left join generated_assets ga on ga.id=ca.asset_id and ga.workspace_id=$2 and ga.deleted_at is null
         where ca.package_id=$1 order by ca.created_at`,
        [pkg.id, s.viewer.workspace.id],
      ),
    ]);
    const artifacts = artifactResult.rows.filter((row) => row.asset_id && row.object_path).map((row) => ({
      id: row.id, artifactType: row.artifact_type, assetId: row.asset_id,
      mediaType: row.media_type === "video" ? ("video" as const) : ("image" as const), objectPath: row.object_path,
      bucket: "project-assets", mimeType: row.mime_type ?? null, title: row.title ?? row.artifact_type,
      metadata: { ...(row.asset_metadata ?? {}), ...(row.metadata ?? {}) },
    }));
    const timeline = buildFeedTimeline({ packageId: pkg.id, durationSeconds: Number(pkg.duration_seconds), structure: pkg.structure, artifacts });
    if (timeline.status !== "ready" || !options.storage) {
      return reply.code(409).send({ ok: false, error: { code: "render_incomplete", message: "图片和视频尚未全部生成，暂不能导出发布包", retryable: true }, data: { timeline } });
    }
    const mediaEntries = await Promise.all(artifacts.map(async (artifact) => {
      const downloaded = await options.storage!.download(artifact.bucket, artifact.objectPath);
      if (downloaded.error || !downloaded.data) throw new Error(`素材下载失败：${artifact.title}`);
      const filename = `media/${artifact.artifactType}-${artifact.assetId}.${mediaExtension(artifact.mimeType, artifact.objectPath)}`;
      return { artifact, filename, data: downloaded.data };
    }));
    const sourceFiles = new Map(mediaEntries.map(({ artifact, filename }) => [artifact.assetId, filename]));
    timeline.tracks = timeline.tracks.map((track) => ({ ...track, items: track.items.map((item) => ({ ...item, ...(typeof item.assetId === "string" ? { sourceFile: sourceFiles.get(item.assetId) ?? null } : {}) })) }));
    const checklist = ["核对商品信息与参考图一致", "核对平台标题、正文和标签", "确认媒体时长、画幅和分辨率", "确认时间线仍是工程文件，未合成配音和 BGM", "人工发布后记录公开帖子链接并导入数据"];
    const manifest = { version: "helstera-feed-package-v1", exportedAt: new Date().toISOString(), package: pkg, variants: variantResult.rows, artifacts: mediaEntries.map(({ artifact, filename }) => ({ ...artifact, filename })), timelineStatus: timeline.status, checklist };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("timeline.json", JSON.stringify(timeline, null, 2));
    const shots = Array.isArray(pkg.structure?.shots) ? pkg.structure.shots : [];
    zip.file("subtitles.srt", buildSubtitleSrt(shots));
    for (const entry of mediaEntries) zip.file(entry.filename, entry.data);
    for (const variant of variantResult.rows) {
      const name = platformNames[variant.platform] ?? variant.platform;
      zip.file(`platforms/${name}.txt`, `${variant.title}\n\n${variant.body}\n\n${(variant.hashtags ?? []).map((tag: string) => `#${tag}`).join(" ")}\n\n封面：${variant.cover_text}`);
    }
    zip.file("发布检查清单.txt", checklist.map((item, index) => `${index + 1}. ${item}`).join("\n"));
    const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await options.db.query("update content_packages set status='exported',updated_at=now() where id=$1 and workspace_id=$2", [pkg.id, s.viewer.workspace.id]);
    reply.header("content-disposition", `attachment; filename=feed-${pkg.id}.zip`).type("application/zip");
    return reply.send(content);
  });  app.post("/api/feed/schedules", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const parsed = feedScheduleInputSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, "排程信息不完整", parsed.error.flatten());
    const v = parsed.data;
    if (!publishModes.has(v.publishMode)) return bad(reply, "发布方式无效");
    const { rows: accounts } = await options.db.query("select id,alias,platform,connection_mode from publishing_accounts where id=$1 and workspace_id=$2 and owner_user_id=$3 and status='active'", [v.accountId, s.viewer.workspace.id, s.user.id]);
    const account = accounts[0];
    if (!account) return reply.code(404).send({ ok: false, error: { code: "account_not_found", message: "账号不存在或不属于当前用户" } });
    if (account.platform !== v.platform || account.connection_mode !== v.publishMode) return bad(reply, "账号平台或发布方式不匹配");
    const { rows: packages } = await options.db.query(`select cp.id,cp.status,cv.platform as variant_platform from content_packages cp left join content_variants cv on cv.id=$3 and cv.package_id=cp.id where cp.id=$1 and cp.workspace_id=$2`, [v.packageId, s.viewer.workspace.id, v.variantId]);
    const pkg = packages[0];
    if (!pkg) return reply.code(404).send({ ok: false, error: { code: "package_or_variant_not_found", message: "内容包或平台版本不存在，或不属于当前工作区" } });
    if (v.variantId && pkg.variant_platform !== v.platform) return bad(reply, "平台版本与排程平台不匹配");
    if (!["ready", "exported", "published", "measured", "analyzed"].includes(pkg.status)) return reply.code(409).send({ ok: false, error: { code: "package_not_ready", message: "媒体尚未全部生成，完成后才能排程发布", retryable: true } });
    const client = await options.db.connect();
    try {
      await client.query("begin");
      const { rows: existing } = await client.query("select * from publishing_plans where workspace_id=$1 and idempotency_key=$2 for update", [s.viewer.workspace.id, v.idempotencyKey]);
      if (existing[0]) { await client.query("commit"); return { ok: true, data: existing[0] }; }
      const status = scheduledPlanStatus(v.publishMode, v.scheduledAt);
      const { rows } = await client.query(`insert into publishing_plans(workspace_id,package_id,variant_id,platform,account_alias,account_id,publish_mode,scheduled_at,status,created_by,idempotency_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`, [s.viewer.workspace.id, v.packageId, v.variantId, v.platform, account.alias, v.accountId, v.publishMode, v.scheduledAt, status, s.user.id, v.idempotencyKey]);
      if (!rows[0]) throw new Error("发布任务创建失败");
      await client.query("insert into publishing_audit_logs(workspace_id,actor_id,plan_id,account_id,action,after_status) values($1,$2,$3,$4,'created',$5)", [s.viewer.workspace.id, s.user.id, rows[0].id, v.accountId, status]);
      await client.query("update content_packages set status='scheduled',updated_at=now() where id=$1 and workspace_id=$2 and status in ('ready','exported')", [v.packageId, s.viewer.workspace.id]);
      await client.query("commit");
      return { ok: true, data: rows[0] };
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  });
  app.get("/api/feed/schedules", async (request: any, reply: any) => { const s = await session(request, reply); if (!s) return; const { rows } = await options.db.query("select * from publishing_plans where workspace_id=$1 order by scheduled_at desc limit 100", [s.viewer.workspace.id]); return { ok: true, data: rows }; });  app.post("/api/feed/schedules/:id/action", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const parsed = publishingPlanActionSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, "操作参数不正确", parsed.error.flatten());

    const client = await options.db.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        "select p.*,a.owner_user_id from publishing_plans p join publishing_accounts a on a.id=p.account_id where p.id=$1 and p.workspace_id=$2 and a.owner_user_id=$3 for update",
        [request.params.id, s.viewer.workspace.id, s.user.id],
      );
      const plan = rows[0];
      if (!plan) {
        await client.query("rollback");
        return reply.code(404).send({ ok: false, error: { code: "not_found", message: "发布任务不存在或无权操作" } });
      }
      if (!isValidPlanTransition(parsed.data.action, plan.status)) {
        await client.query("rollback");
        return bad(reply, "当前发布任务状态不允许执行该操作");
      }
      if (parsed.data.action === "mark_published" && !parsed.data.externalUrl) {
        await client.query("rollback");
        return bad(reply, "标记已发布时必须填写公开链接");
      }
      const next = parsed.data.action === "confirm"
        ? confirmPlanStatus(plan.status, plan.scheduled_at)
        : parsed.data.action === "cancel" ? "canceled" : "published";
      if (!next) {
        await client.query("rollback");
        return bad(reply, "当前任务无需确认");
      }
      const { rows: updated } = await client.query(
        `update publishing_plans
         set status=$1,
             confirmed_at=case when $2='confirm' then now() else confirmed_at end,
             external_url=coalesce($3,external_url),
             published_at=case when $2='mark_published' then now() else published_at end,
             updated_at=now()
         where id=$4 and workspace_id=$5 and status=$6
         returning *`,
        [next, parsed.data.action, parsed.data.externalUrl ?? null, plan.id, s.viewer.workspace.id, plan.status],
      );
      if (!updated[0]) {
        await client.query("rollback");
        return reply.code(409).send({ ok: false, error: { code: "plan_state_changed", message: "发布任务状态已变化，请刷新后重试" } });
      }
      await client.query(
        "insert into publishing_audit_logs(workspace_id,actor_id,plan_id,account_id,action,before_status,after_status,metadata) values($1,$2,$3,$4,$5,$6,$7,$8)",
        [s.viewer.workspace.id, s.user.id, plan.id, plan.account_id, parsed.data.action, plan.status, next, { externalUrl: parsed.data.externalUrl ?? null }],
      );
      await client.query("commit");
      return { ok: true, data: updated[0] };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });  app.post("/api/feed/metrics", async (request: any, reply) => {
    const s = await session(request, reply);
    if (!s) return;
    const parsed = feedMetricInputSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, "数据格式不正确", parsed.error.flatten());
    const v = parsed.data;
    const relationError = await validateMetricRelations(options.db, s.viewer.workspace.id, v);
    if (relationError) return reply.code(404).send({ ok: false, error: relationError });
    const { rows } = await options.db.query(
      `insert into post_metrics(
         workspace_id,package_id,variant_id,platform,account_alias,post_url,published_at,
         impressions,views,completions,likes,comments,shares,saves,clicks,leads,
         conversions,spend_cny,revenue_cny,raw,publishing_plan_id
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       on conflict(workspace_id,platform,account_alias,post_url) do update set
         package_id=excluded.package_id,variant_id=excluded.variant_id,publishing_plan_id=coalesce(excluded.publishing_plan_id,post_metrics.publishing_plan_id),published_at=excluded.published_at,
         impressions=excluded.impressions,views=excluded.views,completions=excluded.completions,
         likes=excluded.likes,comments=excluded.comments,shares=excluded.shares,saves=excluded.saves,
         clicks=excluded.clicks,leads=excluded.leads,conversions=excluded.conversions,
         spend_cny=excluded.spend_cny,revenue_cny=excluded.revenue_cny,raw=excluded.raw
       returning *`,
      [s.viewer.workspace.id,v.packageId,v.variantId,v.platform,v.accountAlias,v.postUrl,v.publishedAt,v.impressions,v.views,v.completions,v.likes,v.comments,v.shares,v.saves,v.clicks,v.leads,v.conversions,v.spendCny,v.revenueCny,v.rawSource ?? v,v.planId],
    );
    await markPublishingPlanPublished(options.db, { planId: v.planId ?? null, postUrl: v.postUrl, publishedAt: v.publishedAt, packageId: v.packageId, platform: v.platform, accountAlias: v.accountAlias }, s.viewer.workspace.id);
    const insight = await persistContentInsight(options.db, v.packageId);
    await options.db.query("update content_packages set status='analyzed',updated_at=now() where id=$1 and workspace_id=$2 and status in ('published','measured')", [v.packageId, s.viewer.workspace.id]);
    return { ok: true, data: { ...rows[0], summary: metricsSummary(rows[0]), insight } };
  });

  app.get("/api/feed/metrics/template", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    reply.header("content-disposition", "attachment; filename=feed-metrics-template.csv");
    reply.type("text/csv; charset=utf-8");
    return reply.send("package_id,plan_id,variant_id,platform,account_alias,post_url,published_at,impressions,views,completions,likes,comments,shares,saves,clicks,leads,conversions,spend_cny,revenue_cny\n");
  });
  app.post("/api/feed/metrics/import-csv/preview", async (request: any, reply: any) => {
    const s = await session(request, reply);
    if (!s) return;
    const file = await request.file();
    if (!file) return bad(reply, "请上传 CSV 文件");
    if (file.mimetype !== "text/csv" && file.mimetype !== "application/csv" && !file.filename.toLowerCase().endsWith(".csv")) {
      return bad(reply, "仅支持 CSV 文件");
    }
    try {
      const parsed = parseMetricsCsv(await file.toBuffer());
      return { ok: true, data: parsed };
    } catch (error) {
      return bad(reply, error instanceof Error ? error.message : "CSV 解析失败");
    }
  });
  app.post("/api/feed/metrics/import", async (request: any, reply) => {
    const s = await session(request, reply);
    if (!s) return;
    const records = Array.isArray(request.body?.records) ? request.body.records : [];
    if (!records.length || records.length > 500) return bad(reply, "每次需导入 1–500 条记录");
    const errors: Array<{ row: number; message: string; details?: unknown }> = [];
    const saved: any[] = [];
    const insightPackages = new Set<string>();
    const client = await options.db.connect();
    try {
      await client.query("begin");
      for (const [index, record] of records.entries()) {
        const rowNumber = index + 1;
        const parsed = feedMetricInputSchema.safeParse(record);
        if (!parsed.success) {
          errors.push({ row: rowNumber, message: "字段校验失败", details: parsed.error.flatten() });
          continue;
        }
        const v = parsed.data;
        const relationError = await validateMetricRelations(client, s.viewer.workspace.id, v);
        if (relationError) {
          errors.push({ row: rowNumber, message: relationError.message, details: { code: relationError.code } });
          continue;
        }
        const { rows } = await client.query(
          `insert into post_metrics(
             workspace_id,package_id,variant_id,platform,account_alias,post_url,published_at,
             impressions,views,completions,likes,comments,shares,saves,clicks,leads,
             conversions,spend_cny,revenue_cny,raw,publishing_plan_id
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           on conflict(workspace_id,platform,account_alias,post_url) do update set
             package_id=excluded.package_id,variant_id=excluded.variant_id,publishing_plan_id=coalesce(excluded.publishing_plan_id,post_metrics.publishing_plan_id),published_at=excluded.published_at,
             impressions=excluded.impressions,views=excluded.views,completions=excluded.completions,
             likes=excluded.likes,comments=excluded.comments,shares=excluded.shares,saves=excluded.saves,
             clicks=excluded.clicks,leads=excluded.leads,conversions=excluded.conversions,
             spend_cny=excluded.spend_cny,revenue_cny=excluded.revenue_cny,raw=excluded.raw
           returning *`,
          [s.viewer.workspace.id,v.packageId,v.variantId,v.platform,v.accountAlias,v.postUrl,v.publishedAt,v.impressions,v.views,v.completions,v.likes,v.comments,v.shares,v.saves,v.clicks,v.leads,v.conversions,v.spendCny,v.revenueCny,v.rawSource ?? v,v.planId],
        );
        saved.push(rows[0]);
        insightPackages.add(v.packageId);
        await markPublishingPlanPublished(client, { planId: v.planId ?? null, postUrl: v.postUrl, publishedAt: v.publishedAt, packageId: v.packageId, platform: v.platform, accountAlias: v.accountAlias }, s.viewer.workspace.id);
      }
      const insights = new Map<string, Awaited<ReturnType<typeof persistContentInsight>>>();
      for (const packageId of insightPackages) {
        insights.set(packageId, await persistContentInsight(client, packageId));
        await client.query("update content_packages set status='analyzed',updated_at=now() where id=$1 and workspace_id=$2 and status in ('published','measured')", [packageId, s.viewer.workspace.id]);
      }
      await client.query("commit");
      return {
        ok: true,
        data: {
          imported: saved.length,
          rejected: errors.length,
          records: saved.map((row) => ({ ...row, summary: metricsSummary(row) })),
          insights: Object.fromEntries(insights),
          errors,
        },
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/feed/packages/:id/insights", async (request: any, reply) => {
    const s = await session(request, reply);
    if (!s) return;
    const packageResult = await options.db.query(
      "select id from content_packages where id=$1 and workspace_id=$2",
      [request.params.id,s.viewer.workspace.id],
    );
    if (!packageResult.rows[0]) return reply.code(404).send({ ok: false, error: { code: "not_found", message: "内容包不存在" } });
    const { rows } = await options.db.query(
      "select * from post_metrics where package_id=$1 and workspace_id=$2 order by published_at desc",
      [request.params.id,s.viewer.workspace.id],
    );
    const insightResult = await options.db.query(
      "select * from content_insights where package_id=$1 order by created_at desc limit 1",
      [request.params.id],
    );
    const insight = insightResult.rows[0] ?? null;
    return {
      ok: true,
      data: {
        metrics: rows.map((row) => ({ ...row, summary: metricsSummary(row) })),
        insight,
        summary: insight?.metrics ?? null,
        recommendations: insight?.recommendations ?? [],
      },
    };
  });
}
