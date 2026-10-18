import type { Pool } from "pg";

export type ModelCallMetricRow = {
  model_id: string;
  media_type: "image" | "video";
  total: number;
  succeeded: number;
  failed: number;
  timed_out: number;
  success_rate: number;
  timeout_rate: number;
  p95_latency_ms: number | null;
  last_called_at: string | null;
};

export type ModelCallAlert = {
  severity: "warning" | "critical";
  metric: "success_rate" | "timeout_rate" | "p95_latency_ms";
  modelId: string;
  mediaType: "image" | "video";
  value: number;
  threshold: number;
  message: string;
};

export type ModelCallMetrics = {
  windowHours: number;
  sampleMinimum: number;
  metrics: ModelCallMetricRow[];
  alerts: ModelCallAlert[];
  checkedAt: string;
};

const SAMPLE_MINIMUM = 5;
const SUCCESS_RATE_WARNING = 0.8;
const SUCCESS_RATE_CRITICAL = 0.5;
const TIMEOUT_RATE_WARNING = 0.2;
const TIMEOUT_RATE_CRITICAL = 0.5;
const P95_IMAGE_WARNING_MS = 120_000;
const P95_IMAGE_CRITICAL_MS = 180_000;
const P95_VIDEO_WARNING_MS = 600_000;
const P95_VIDEO_CRITICAL_MS = 900_000;

type CallRow = {
  model_id: string | null;
  media_type: "image" | "video";
  status: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
};

export async function loadModelCallMetrics(db: Pool, requestedHours = 24): Promise<ModelCallMetrics> {
  const windowHours = Math.min(Math.max(Math.floor(requestedHours), 1), 168);
  const { rows } = await db.query<CallRow>(
    `select payload->>'model' as model_id,
            case when job_type='image_generation' then 'image' else 'video' end as media_type,
            status, error_code, error_message, created_at, started_at, completed_at, failed_at
       from background_jobs
      where created_at >= now() - ($1::int * interval '1 hour')
        and job_type in ('image_generation', 'video_generation')
        and payload->>'model' is not null
      order by created_at desc`,
    [windowHours],
  );

  return summarizeModelCallRows(rows, windowHours);
}

export function summarizeModelCallRows(rows: CallRow[], windowHours: number): ModelCallMetrics {
  const groups = new Map<string, CallRow[]>();
  for (const row of rows) {
    if (!row.model_id) continue;
    const key = `${row.media_type}:${row.model_id}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const metrics = [...groups.entries()].map(([key, group]) => {
    const [mediaType, modelId] = key.split(":", 2) as ["image" | "video", string];
    const succeeded = group.filter((row) => row.status === "succeeded").length;
    const failed = group.filter((row) => ["failed", "dead_letter", "sync_failed", "canceled"].includes(row.status)).length;
    const timedOut = group.filter(isTimeout).length;
    const durations = group.map(durationMs).filter((value): value is number => value !== null).sort((a, b) => a - b);
    const p95Index = durations.length ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1) : -1;
    const total = group.length;
    const lastCalledAt = group.map((row) => row.created_at).sort().at(-1) ?? null;
    return {
      model_id: modelId,
      media_type: mediaType,
      total,
      succeeded,
      failed,
      timed_out: timedOut,
      success_rate: total ? round(succeeded / total) : 0,
      timeout_rate: total ? round(timedOut / total) : 0,
      p95_latency_ms: p95Index >= 0 ? durations[p95Index]! : null,
      last_called_at: lastCalledAt,
    } satisfies ModelCallMetricRow;
  }).sort((a, b) => a.media_type.localeCompare(b.media_type) || a.model_id.localeCompare(b.model_id));

  return {
    windowHours,
    sampleMinimum: SAMPLE_MINIMUM,
    metrics,
    alerts: metrics.flatMap(buildAlerts),
    checkedAt: new Date().toISOString(),
  };
}

function buildAlerts(metric: ModelCallMetricRow): ModelCallAlert[] {
  if (metric.total < SAMPLE_MINIMUM) return [];
  const alerts: ModelCallAlert[] = [];
  if (metric.success_rate < SUCCESS_RATE_CRITICAL) {
    alerts.push(alert(metric, "critical", "success_rate", metric.success_rate, SUCCESS_RATE_CRITICAL, "成功率低于严重阈值"));
  } else if (metric.success_rate < SUCCESS_RATE_WARNING) {
    alerts.push(alert(metric, "warning", "success_rate", metric.success_rate, SUCCESS_RATE_WARNING, "成功率低于告警阈值"));
  }
  if (metric.timeout_rate >= TIMEOUT_RATE_CRITICAL) {
    alerts.push(alert(metric, "critical", "timeout_rate", metric.timeout_rate, TIMEOUT_RATE_CRITICAL, "超时率达到严重阈值"));
  } else if (metric.timeout_rate >= TIMEOUT_RATE_WARNING) {
    alerts.push(alert(metric, "warning", "timeout_rate", metric.timeout_rate, TIMEOUT_RATE_WARNING, "超时率达到告警阈值"));
  }
  const [warningThreshold, criticalThreshold] = metric.media_type === "image"
    ? [P95_IMAGE_WARNING_MS, P95_IMAGE_CRITICAL_MS]
    : [P95_VIDEO_WARNING_MS, P95_VIDEO_CRITICAL_MS];
  if (metric.p95_latency_ms !== null && metric.p95_latency_ms >= criticalThreshold) {
    alerts.push(alert(metric, "critical", "p95_latency_ms", metric.p95_latency_ms, criticalThreshold, "P95 延迟达到严重阈值"));
  } else if (metric.p95_latency_ms !== null && metric.p95_latency_ms >= warningThreshold) {
    alerts.push(alert(metric, "warning", "p95_latency_ms", metric.p95_latency_ms, warningThreshold, "P95 延迟达到告警阈值"));
  }
  return alerts;
}

function alert(metric: ModelCallMetricRow, severity: ModelCallAlert["severity"], metricName: ModelCallAlert["metric"], value: number, threshold: number, message: string): ModelCallAlert {
  return { severity, metric: metricName, modelId: metric.model_id, mediaType: metric.media_type, value: round(value), threshold, message };
}

function isTimeout(row: CallRow): boolean {
  return /timeout|timed out|aborted|upstream_outcome_unknown/i.test(`${row.error_code ?? ""} ${row.error_message ?? ""}`);
}

function durationMs(row: CallRow): number | null {
  const end = row.completed_at ?? row.failed_at;
  if (!row.started_at || !end) return null;
  const value = new Date(end).getTime() - new Date(row.started_at).getTime();
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
