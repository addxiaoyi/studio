import type { Pool, PoolClient } from "pg";
import type { FeedMetricInput } from "@helstera/shared";
import {
  buildInsightRecommendations,
  summarizeMetrics,
  type MetricSummary,
} from "./publishing-scheduler.js";

type Db = Pool | PoolClient;

export type MetricRelationError = {
  code: "package_not_found" | "variant_not_found" | "account_not_found" | "plan_not_found";
  message: string;
};

export type PersistedInsight = {
  summary: string;
  metrics: MetricSummary;
  recommendations: string[];
};

export async function validateMetricRelations(
  db: Db,
  workspaceId: string,
  input: FeedMetricInput,
): Promise<MetricRelationError | null> {
  const packageResult = await db.query(
    `select id
     from content_packages
     where id=$1 and workspace_id=$2 and $3 = any(platforms)`,
    [input.packageId, workspaceId, input.platform],
  );
  if (!packageResult.rows[0]) {
    return { code: "package_not_found", message: "内容包不存在、不属于当前工作区或未包含该平台" };
  }

  if (input.variantId) {
    const variantResult = await db.query(
      `select cv.id
       from content_variants cv
       join content_packages cp on cp.id=cv.package_id
       where cv.id=$1 and cv.package_id=$2 and cv.platform=$3 and cp.workspace_id=$4`,
      [input.variantId, input.packageId, input.platform, workspaceId],
    );
    if (!variantResult.rows[0]) {
      return { code: "variant_not_found", message: "内容版本不存在、平台不匹配或不属于当前内容包" };
    }
  }

  if (input.planId) {
    const planResult = await db.query(
      `select p.id
       from publishing_plans p
       join publishing_accounts a on a.id=p.account_id
       where p.id=$1 and p.workspace_id=$2 and p.package_id=$3
         and p.platform=$4 and p.account_alias=$5
         and a.status='active' and p.status in ('waiting_publish','published')`,
      [input.planId, workspaceId, input.packageId, input.platform, input.accountAlias],
    );
    if (!planResult.rows[0]) {
      return { code: "plan_not_found", message: "发布计划不存在、平台或账号不匹配，或尚未进入可回流状态" };
    }
  }
  const accountResult = await db.query(
    `select id
     from publishing_accounts
     where workspace_id=$1 and platform=$2 and alias=$3 and status='active'`,
    [workspaceId, input.platform, input.accountAlias],
  );
  if (!accountResult.rows[0]) {
    return { code: "account_not_found", message: "发布账号不存在、平台不匹配或不属于当前工作区" };
  }

  return null;
}

export function buildInsightSummary(summary: MetricSummary): string {
  return [
    `曝光 ${summary.impressions}`,
    `播放 ${summary.views}`,
    `互动 ${summary.engagements}`,
    `点击 ${summary.clicks}`,
    `转化 ${summary.conversions}`,
    `互动率 ${(summary.engagementRate * 100).toFixed(2)}%`,
    `完播率 ${(summary.completionRate * 100).toFixed(2)}%`,
    `点击率 ${(summary.clickRate * 100).toFixed(2)}%`,
    `转化率 ${(summary.conversionRate * 100).toFixed(2)}%`,
    `ROAS ${summary.roas.toFixed(2)}`,
  ].join("，");
}

export async function persistContentInsight(db: Db, packageId: string): Promise<PersistedInsight> {
  const metricResult = await db.query(
    `select impressions,views,completions,likes,comments,shares,saves,
            clicks,leads,conversions,spend_cny,revenue_cny
     from post_metrics
     where package_id=$1
     order by published_at desc`,
    [packageId],
  );
  const metrics = summarizeMetrics(metricResult.rows);
  const insight = {
    summary: buildInsightSummary(metrics),
    metrics,
    recommendations: buildInsightRecommendations(metrics),
  } satisfies PersistedInsight;

  const updateResult = await db.query(
    `with latest as (
       select id from content_insights where package_id=$1 order by created_at desc limit 1
     )
     update content_insights
     set summary=$2, metrics=$3::jsonb, recommendations=$4::jsonb, created_at=now()
     where id in (select id from latest)
     returning id`,
    [
      packageId,
      insight.summary,
      JSON.stringify(insight.metrics),
      JSON.stringify(insight.recommendations),
    ],
  );
  if (!updateResult.rows[0]) {
    await db.query(
      `insert into content_insights(package_id,summary,metrics,recommendations)
       values($1,$2,$3::jsonb,$4::jsonb)`,
      [
        packageId,
        insight.summary,
        JSON.stringify(insight.metrics),
        JSON.stringify(insight.recommendations),
      ],
    );
  }

  return insight;
}
