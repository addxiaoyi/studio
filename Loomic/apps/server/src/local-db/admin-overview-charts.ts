import type { Pool } from "pg";

export type AdminOverviewCharts = {
  periodDays: 14 | 30 | 90;
  daily: Array<{
    date: string;
    requested: number;
    succeeded: number;
    failed: number;
    creditsSpent: number;
  }>;
  delivery: {
    requested: number;
    providerResultSaved: number;
    assetSaved: number;
    canvasRequested: number;
    canvasWritten: number;
  };
  projects: {
    activeReady: number;
    activeNoPreview: number;
    blankCanvas: number;
    missingCanvas: number;
    archived: number;
  };
};

type DailyRow = {
  date: string;
  requested: number;
  succeeded: number;
  failed: number;
  credits_spent: number | string;
};

type DeliveryRow = {
  requested: number;
  provider_result_saved: number;
  asset_saved: number;
  canvas_requested: number;
  canvas_written: number;
};

type ProjectRow = AdminOverviewCharts["projects"];

export async function loadAdminOverviewCharts(
  db: Pool,
  periodDays: 14 | 30 | 90,
  workspaceId: string | null,
): Promise<AdminOverviewCharts> {
  const [daily, delivery, projects] = await Promise.all([
    db.query<DailyRow>(
      `with days as (
         select series.day::date as date
         from generate_series(current_date - ($1::int - 1), current_date, interval '1 day') as series(day)
       ), jobs as (
         select created_at::date as date,
                count(*)::int as requested,
                count(*) filter (where status = 'succeeded')::int as succeeded,
                count(*) filter (where status in ('failed', 'dead_letter', 'sync_failed'))::int as failed
         from background_jobs
         where created_at >= current_date - ($1::int - 1)
           and job_type in ('image_generation', 'video_generation')
           and ($2::uuid is null or workspace_id = $2)
         group by created_at::date
       ), credits as (
         select created_at::date as date, sum(-amount)::int as spent
         from credit_transactions
         where created_at >= current_date - ($1::int - 1)
           and transaction_type = 'generation_deduct' and amount < 0
           and ($2::uuid is null or workspace_id = $2)
         group by created_at::date
       )
       select to_char(days.date, 'YYYY-MM-DD') as date,
              coalesce(jobs.requested, 0)::int as requested,
              coalesce(jobs.succeeded, 0)::int as succeeded,
              coalesce(jobs.failed, 0)::int as failed,
              coalesce(credits.spent, 0)::int as credits_spent
       from days
       left join jobs using (date)
       left join credits using (date)
       order by days.date`,
      [periodDays, workspaceId],
    ),
    db.query<DeliveryRow>(
      `select count(*)::int as requested,
              count(*) filter (where provider_result->>'url' is not null or result->>'asset_id' is not null)::int as provider_result_saved,
              count(*) filter (where result->>'asset_id' is not null)::int as asset_saved,
              count(*) filter (where canvas_id is not null)::int as canvas_requested,
              count(*) filter (where canvas_id is not null and (
                result->>'canvas_element_id' is not null or exists (
                  select 1
                  from canvases c,
                       lateral jsonb_array_elements(
                         case when jsonb_typeof(c.content->'elements') = 'array'
                           then c.content->'elements' else '[]'::jsonb end
                       ) element
                  where c.id = background_jobs.canvas_id
                    and element->'customData'->>'jobId' = background_jobs.id::text
                )
              ))::int as canvas_written
       from background_jobs
       where created_at >= current_date - ($1::int - 1)
         and job_type in ('image_generation', 'video_generation')
         and ($2::uuid is null or workspace_id = $2)`,
      [periodDays, workspaceId],
    ),
    db.query<ProjectRow>(
      `with project_state as (
         select p.archived_at, p.thumbnail_path, c.id as canvas_id,
                case when jsonb_typeof(c.content->'elements') = 'array'
                  then jsonb_array_length(c.content->'elements') else 0 end = 0
                  and coalesce(c.content->'files', '{}'::jsonb) = '{}'::jsonb as is_blank_canvas
         from projects p
         left join canvases c on c.project_id = p.id and c.is_primary
         where ($1::uuid is null or p.workspace_id = $1)
       )
       select count(*) filter (where archived_at is null and canvas_id is not null and not is_blank_canvas and thumbnail_path is not null)::int as "activeReady",
              count(*) filter (where archived_at is null and canvas_id is not null and not is_blank_canvas and thumbnail_path is null)::int as "activeNoPreview",
              count(*) filter (where archived_at is null and canvas_id is not null and is_blank_canvas)::int as "blankCanvas",
              count(*) filter (where archived_at is null and canvas_id is null)::int as "missingCanvas",
              count(*) filter (where archived_at is not null)::int as archived
       from project_state`,
      [workspaceId],
    ),
  ]);

  const deliveryRow = delivery.rows[0];
  const projectRow = projects.rows[0];
  if (!deliveryRow || !projectRow) throw new Error("Admin chart aggregation returned no summary row.");

  return {
    periodDays,
    daily: daily.rows.map((row) => ({
      date: row.date,
      requested: row.requested,
      succeeded: row.succeeded,
      failed: row.failed,
      creditsSpent: Number(row.credits_spent),
    })),
    delivery: {
      requested: deliveryRow.requested,
      providerResultSaved: deliveryRow.provider_result_saved,
      assetSaved: deliveryRow.asset_saved,
      canvasRequested: deliveryRow.canvas_requested,
      canvasWritten: deliveryRow.canvas_written,
    },
    projects: projectRow,
  };
}
