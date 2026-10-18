import type { Pool, PoolClient } from "pg";

export type PublishingPlanStatus =
  | "waiting_confirm"
  | "scheduled"
  | "ready"
  | "waiting_publish"
  | "canceled"
  | "published";

export type MetricRow = {
  impressions?: unknown;
  views?: unknown;
  completions?: unknown;
  likes?: unknown;
  comments?: unknown;
  shares?: unknown;
  saves?: unknown;
  clicks?: unknown;
  leads?: unknown;
  conversions?: unknown;
  spend_cny?: unknown;
  revenue_cny?: unknown;
};

export type MetricSummary = {
  impressions: number;
  views: number;
  completions: number;
  engagements: number;
  clicks: number;
  leads: number;
  conversions: number;
  spendCny: number;
  revenueCny: number;
  engagementRate: number;
  completionRate: number;
  clickRate: number;
  conversionRate: number;
  cpa: number;
  roas: number;
};

const asNumber = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sum = (rows: MetricRow[], key: keyof MetricRow): number =>
  rows.reduce((total, row) => total + asNumber(row[key]), 0);

export function summarizeMetrics(rows: MetricRow[]): MetricSummary {
  const impressions = sum(rows, "impressions");
  const views = sum(rows, "views");
  const completions = sum(rows, "completions");
  const engagements =
    sum(rows, "likes") + sum(rows, "comments") + sum(rows, "shares") + sum(rows, "saves");
  const clicks = sum(rows, "clicks");
  const leads = sum(rows, "leads");
  const conversions = sum(rows, "conversions");
  const spendCny = sum(rows, "spend_cny");
  const revenueCny = sum(rows, "revenue_cny");

  return {
    impressions,
    views,
    completions,
    engagements,
    clicks,
    leads,
    conversions,
    spendCny,
    revenueCny,
    engagementRate: views > 0 ? engagements / views : 0,
    completionRate: views > 0 ? completions / views : 0,
    clickRate: impressions > 0 ? clicks / impressions : 0,
    conversionRate: clicks > 0 ? conversions / clicks : 0,
    cpa: conversions > 0 ? spendCny / conversions : 0,
    roas: spendCny > 0 ? revenueCny / spendCny : 0,
  };
}

export function scheduledPlanStatus(
  publishMode: string,
  scheduledAt: string | Date,
  now = new Date(),
): PublishingPlanStatus {
  if (publishMode === "scan_confirm") return "waiting_confirm";
  return new Date(scheduledAt).getTime() <= now.getTime() ? "waiting_publish" : "scheduled";
}

export function confirmPlanStatus(
  currentStatus: string,
  scheduledAt: string | Date,
  now = new Date(),
): PublishingPlanStatus | null {
  if (currentStatus !== "waiting_confirm") return null;
  return new Date(scheduledAt).getTime() <= now.getTime() ? "waiting_publish" : "scheduled";
}

export function isValidPlanTransition(action: "confirm" | "cancel" | "mark_published", status: string): boolean {
  if (action === "confirm") return status === "waiting_confirm";
  if (action === "cancel") return ["waiting_confirm", "scheduled", "ready", "waiting_publish"].includes(status);
  return status === "waiting_publish";
}

export function buildInsightRecommendations(summary: MetricSummary): string[] {
  const recommendations: string[] = [];
  if (summary.completionRate < 0.25) recommendations.push("前3秒需要更快给出问题或结果，并缩短铺垫。");
  if (summary.engagementRate < 0.03) recommendations.push("增加可验证细节和单一互动问题，减少泛化卖点。");
  if (summary.clickRate < 0.01) recommendations.push("强化封面利益点和单一 CTA，确保用户知道下一步动作。");
  if (summary.roas > 1) recommendations.push("优先复用当前平台、钩子和时长组合，再扩大测试量。");
  if (!recommendations.length) recommendations.push("继续保持当前结构，下一轮只调整一个变量进行 A/B 测试。");
  return recommendations;
}

async function notifyDuePlan(client: PoolClient, plan: { id: string; workspace_id: string; created_by: string; platform: string; account_alias: string; scheduled_at: string }) {
  await client.query(
    `insert into notifications(workspace_id,user_id,type,title,body,metadata)
     values($1,$2,'publishing_due',$3,$4,$5::jsonb)`,
    [
      plan.workspace_id,
      plan.created_by,
      `${plan.platform} 发布任务已到时间`,
      `账号「${plan.account_alias}」的内容已准备好，请打开平台完成人工发布并回填公开链接。`,
      JSON.stringify({ planId: plan.id, scheduledAt: plan.scheduled_at, manualOnly: true }),
    ],
  );
}

export async function processDuePublishingPlans(db: Pool, now = new Date()): Promise<number> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select id,workspace_id,created_by,account_id,platform,account_alias,scheduled_at,status
       from publishing_plans
       where scheduled_at <= $1
         and status in ('scheduled','ready')
         and notification_sent_at is null
       order by scheduled_at asc
       for update skip locked
       limit 100`,
      [now.toISOString()],
    );

    let notifiedCount = 0;
    for (const plan of rows) {
      const updated = await client.query(
        `update publishing_plans
         set status='waiting_publish', notification_sent_at=now(),
             result_json = coalesce(result_json,'{}'::jsonb) || $2::jsonb,
             updated_at=now()
         where id=$1 and status in ('scheduled','ready') and notification_sent_at is null`,
        [plan.id, JSON.stringify({ manualPublishRequired: true, dueAt: now.toISOString() })],
      );
      if (updated.rowCount !== 1) continue;
      await notifyDuePlan(client, plan);
      await client.query(
        `insert into publishing_audit_logs(workspace_id,plan_id,account_id,action,before_status,after_status,metadata)
         values($1,$2,$3,'due_notification',$4,'waiting_publish',$5::jsonb)`,
        [
          plan.workspace_id,
          plan.id,
          plan.account_id,
          plan.status,
          JSON.stringify({ manualOnly: true }),
        ],
      );
      notifiedCount += 1;
    }
    await client.query("commit");
    return notifiedCount;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
