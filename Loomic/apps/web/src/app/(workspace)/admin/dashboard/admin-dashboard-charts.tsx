"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AdminOverviewCharts, AdminOverviewRange } from "@/lib/server-api";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const RANGE_OPTIONS: AdminOverviewRange[] = [14, 30, 90];
const SERIES_COLORS = {
  requested: "#2563eb",
  succeeded: "#15803d",
  failed: "#be123c",
  credits: "#0e7490",
};
const PROJECT_COLORS = ["#15803d", "#0e7490", "#b45309", "#be123c", "#52525b"];

const PROJECT_LABELS: Record<keyof AdminOverviewCharts["projects"], string> = {
  activeReady: "有内容与预览",
  activeNoPreview: "有内容，缺预览",
  blankCanvas: "空白主画布",
  missingCanvas: "缺少主画布",
  archived: "已归档",
};

type Props = {
  data: AdminOverviewCharts;
  rangeDays: AdminOverviewRange;
  onRangeChange: (days: AdminOverviewRange) => void;
};

export function AdminDashboardCharts({ data, rangeDays, onRangeChange }: Props) {
  const root = useRef<HTMLElement>(null);
  const activity = data.daily.some((point) => point.requested > 0);
  const credits = data.daily.some((point) => point.creditsSpent > 0);
  const projectRows = (Object.keys(PROJECT_LABELS) as Array<keyof AdminOverviewCharts["projects"]>)
    .map((key, index) => ({ name: PROJECT_LABELS[key] ?? key, value: data.projects[key], color: PROJECT_COLORS[index]! }))
    .filter((row) => row.value > 0);
  const projectsTotal = projectRows.reduce((sum, row) => sum + row.value, 0);
  const efficiency = data.delivery.assetSaved > 0
    ? Math.round(data.daily.reduce((sum, point) => sum + point.creditsSpent, 0) / data.delivery.assetSaved)
    : null;

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({
        scrollTrigger: { trigger: root.current, start: "top 90%", once: true },
      }).fromTo(
        "[data-chart-plot]",
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.58, stagger: 0.07, ease: "elastic.out(0.5, 0.82)" },
      );
    });
    return () => media.revert();
  }, { scope: root, dependencies: [rangeDays], revertOnUpdate: true });

  const formatDate = (value: string) => {
    const [, month, day] = value.split("-");
    return `${Number(month)}/${Number(day)}`;
  };

  const formatNumber = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

  return (
    <section ref={root} className="mt-8 border-y border-border/60 py-6 sm:py-7" aria-labelledby="dashboard-insights-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">业务变化</p>
          <h2 id="dashboard-insights-title" className="mt-2 text-xl font-semibold">生成与交付</h2>
          <p className="mt-1 text-sm text-muted-foreground">任务、额度与项目状态</p>
        </div>
        <div role="group" aria-label="统计周期" className="inline-flex items-center gap-1 rounded-lg border border-border/70 p-1">
          {RANGE_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={rangeDays === days}
              onClick={() => onRangeChange(days)}
              className={`min-h-9 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${rangeDays === days ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {days} 天
            </button>
          ))}
        </div>
      </header>

      <div className="mt-7 grid gap-x-10 gap-y-9 xl:grid-cols-[1.55fr_.85fr]">
        <ChartSection title="任务走势" description="请求、成功和失败任务按日变化">
          {activity ? (
            <div data-chart-plot className="h-[260px] min-w-0 sm:h-[300px]" role="group" aria-label={`最近${rangeDays}天任务走势，共${data.daily.reduce((sum, point) => sum + point.requested, 0)}个请求`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.daily} accessibilityLayer>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
                  <XAxis dataKey="date" tickFormatter={formatDate} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false} />
                  <Tooltip labelFormatter={(value) => formatDate(String(value))} formatter={(value, name) => [formatNumber(Number(value)), String(name)]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--card-foreground)" }} />
                  <Legend verticalAlign="top" height={32} />
                  <Area name="请求" type="monotone" dataKey="requested" fill={SERIES_COLORS.requested} fillOpacity={0.08} stroke={SERIES_COLORS.requested} strokeWidth={1.5} isAnimationActive={false} />
                  <Line name="成功" type="monotone" dataKey="succeeded" stroke={SERIES_COLORS.succeeded} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  <Line name="失败/待修复" type="monotone" dataKey="failed" stroke={SERIES_COLORS.failed} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart>所选周期暂无生成任务</EmptyChart>}
          <DataTable rows={data.daily.map((point) => ({
            日期: point.date,
            请求: point.requested,
            成功: point.succeeded,
            失败或同步未完成: point.failed,
          }))} label="查看任务走势数据表" />
        </ChartSection>

        <ChartSection title="额度效率" description={efficiency === null ? "生成扣费按日汇总" : `每个已保存资产平均消耗 ${formatNumber(efficiency)} credits`}>
          {credits ? (
            <div data-chart-plot className="h-[260px] min-w-0 sm:h-[300px]" role="group" aria-label={`最近${rangeDays}天生成额度消耗趋势`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
                  <XAxis dataKey="date" tickFormatter={formatDate} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} width={42} tickLine={false} axisLine={false} />
                  <Tooltip labelFormatter={(value) => formatDate(String(value))} formatter={(value) => [`${formatNumber(Number(value))} credits`, "生成消耗"]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--card-foreground)" }} />
                  <Bar name="生成消耗" dataKey="creditsSpent" fill={SERIES_COLORS.credits} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart>所选周期暂无生成扣费</EmptyChart>}
          <DataTable rows={data.daily.map((point) => ({ 日期: point.date, "credits 消耗": point.creditsSpent }))} label="查看额度效率数据表" />
        </ChartSection>

        <ChartSection title="交付链路" description="从任务请求到资产保存与画布写回">
          {data.delivery.requested > 0 ? (
            <div data-chart-plot className="h-[235px] min-w-0" role="group" aria-label="生成任务交付链路，显示任务请求、Provider 结果、资产保存和画布写回数量">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[
                  { stage: "任务请求", count: data.delivery.requested },
                  { stage: "Provider 结果", count: data.delivery.providerResultSaved },
                  { stage: "资产保存", count: data.delivery.assetSaved },
                  { stage: "画布写回", count: data.delivery.canvasWritten },
                ]} layout="vertical" margin={{ left: 12, right: 12, top: 6, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 6" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="stage" width={88} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => [formatNumber(Number(value)), "任务"]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--card-foreground)" }} />
                  <Bar dataKey="count" fill={SERIES_COLORS.requested} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart>所选周期暂无生成任务</EmptyChart>}
          <p className="mt-2 text-xs text-muted-foreground">{formatNumber(data.delivery.canvasWritten)} / {formatNumber(data.delivery.canvasRequested)} 个绑定画布的任务已写回画布。</p>
          <DataTable rows={[
            { 阶段: "任务请求", 数量: data.delivery.requested },
            { 阶段: "Provider 结果", 数量: data.delivery.providerResultSaved },
            { 阶段: "资产保存", 数量: data.delivery.assetSaved },
            { 阶段: "绑定画布任务", 数量: data.delivery.canvasRequested },
            { 阶段: "画布写回", 数量: data.delivery.canvasWritten },
          ]} label="查看交付链路数据表" />
        </ChartSection>

        <ChartSection title="项目健康度" description={`${formatNumber(projectsTotal)} 个项目，按当前状态归类`}>
          {projectsTotal > 0 ? (
            <div data-chart-plot className="flex h-[235px] min-w-0 items-center gap-4" role="group" aria-label={`项目健康度，共${projectsTotal}个项目`}>
              <div className="h-full min-w-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart accessibilityLayer>
                    <Pie data={projectRows} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="84%" paddingAngle={2} isAnimationActive={false}>
                      {projectRows.map((row) => <Cell key={row.name} fill={row.color} stroke="var(--card)" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip formatter={(value, name) => [formatNumber(Number(value)), String(name)]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--card-foreground)" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 space-y-2 text-xs">
                {projectRows.map((row) => <li key={row.name} className="flex items-center gap-2"><span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} /><span className="min-w-0 flex-1 text-muted-foreground">{row.name}</span><span className="font-semibold tabular-nums">{formatNumber(row.value)}</span></li>)}
              </ul>
            </div>
          ) : <EmptyChart>暂无项目数据</EmptyChart>}
          <DataTable rows={projectRows.map((row) => ({ 状态: row.name, 项目数: row.value }))} label="查看项目健康度数据表" />
        </ChartSection>
      </div>
    </section>
  );
}

function ChartSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="min-w-0 border-t border-border/50 pt-4 first:border-0 first:pt-0">
    <h3 className="text-sm font-semibold">{title}</h3>
    <p className="mt-1 min-h-5 text-xs text-muted-foreground">{description}</p>
    {children}
  </section>;
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[235px] items-center justify-center text-sm text-muted-foreground">{children}</div>;
}

function DataTable({ rows, label }: { rows: Array<Record<string, string | number>>; label: string }) {
  if (!rows.length) return null;
  const columns = Object.keys(rows[0]!);
  return <details className="mt-2 text-xs">
    <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground underline decoration-border underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</summary>
    <div className="mt-3 max-h-52 overflow-auto">
      <table className="w-full text-left">
        <thead><tr>{columns.map((column) => <th key={column} scope="col" className="border-b border-border/50 px-2 py-1.5 font-medium text-muted-foreground">{column}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} className="border-b border-border/30 px-2 py-1.5 tabular-nums">{row[column]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </details>;
}
