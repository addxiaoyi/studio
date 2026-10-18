import type { Pool } from "pg";

export type HomeOverviewRange = 7 | 14 | 30;

export type HomeOverview = {
  periodDays: HomeOverviewRange;
  activeProjects: number;
  monthlyGenerations: number;
  teamMembers: number;
  daily: Array<{
    date: string;
    imageRequests: number;
    videoRequests: number;
    completed: number;
    failed: number;
    creditsSpent: number;
  }>;
};

type SummaryRow = {
  active_projects: number;
  monthly_generations: number;
  team_members: number;
};

type DailyRow = {
  date: string;
  image_requests: number;
  video_requests: number;
  completed: number;
  failed: number;
  credits_spent: number | string;
};

export async function loadHomeOverview(
  db: Pool,
  workspaceId: string,
  periodDays: HomeOverviewRange,
): Promise<HomeOverview> {
  const [summary, daily] = await Promise.all([
    db.query<SummaryRow>(
      `select
         (select count(*)::int from projects where workspace_id = $1 and archived_at is null) as active_projects,
         (select count(*)::int from background_jobs
           where workspace_id = $1 and job_type in ('image_generation', 'video_generation')
             and status = 'succeeded' and created_at >= date_trunc('month', now())) as monthly_generations,
         (select count(*)::int from workspace_members where workspace_id = $1) as team_members`,
      [workspaceId],
    ),
    db.query<DailyRow>(
      `with days as (
         select series.day::date as date
         from generate_series(current_date - ($2::int - 1), current_date, interval '1 day') as series(day)
       ), jobs as (
         select created_at::date as date,
                count(*) filter (where job_type = 'image_generation')::int as image_requests,
                count(*) filter (where job_type = 'video_generation')::int as video_requests,
                count(*) filter (where status = 'succeeded')::int as completed,
                count(*) filter (where status in ('failed', 'dead_letter', 'sync_failed'))::int as failed
         from background_jobs
         where workspace_id = $1 and created_at >= current_date - ($2::int - 1)
           and job_type in ('image_generation', 'video_generation')
         group by created_at::date
       ), credits as (
         select created_at::date as date, sum(-amount) as spent
         from credit_transactions
         where workspace_id = $1 and created_at >= current_date - ($2::int - 1)
           and transaction_type = 'generation_deduct' and amount < 0
         group by created_at::date
       )
       select to_char(days.date, 'YYYY-MM-DD') as date,
              coalesce(jobs.image_requests, 0)::int as image_requests,
              coalesce(jobs.video_requests, 0)::int as video_requests,
              coalesce(jobs.completed, 0)::int as completed,
              coalesce(jobs.failed, 0)::int as failed,
              coalesce(credits.spent, 0)::numeric as credits_spent
       from days
       left join jobs using (date)
       left join credits using (date)
       order by days.date`,
      [workspaceId, periodDays],
    ),
  ]);

  const summaryRow = summary.rows[0];
  if (!summaryRow) throw new Error("Home overview aggregation returned no summary row.");

  return {
    periodDays,
    activeProjects: summaryRow.active_projects,
    monthlyGenerations: summaryRow.monthly_generations,
    teamMembers: summaryRow.team_members,
    daily: daily.rows.map((row) => ({
      date: row.date,
      imageRequests: row.image_requests,
      videoRequests: row.video_requests,
      completed: row.completed,
      failed: row.failed,
      creditsSpent: Number(row.credits_spent),
    })),
  };
}
