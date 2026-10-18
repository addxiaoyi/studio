"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HomeOverview, HomeOverviewRange } from "@/lib/server-api";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const RANGE_OPTIONS: HomeOverviewRange[] = [7, 14, 30];
const SERIES_LABELS: Record<string, string> = {
  imageRequests: "图片",
  videoRequests: "视频",
  creditsSpent: "Credits",
};

type Props = {
  data: HomeOverview | null;
  rangeDays: HomeOverviewRange;
  loading: boolean;
  error: string | null;
  onRangeChange: (days: HomeOverviewRange) => void;
  onRetry: () => void;
};

export function HomeActivityChart({
  data,
  rangeDays,
  loading,
  error,
  onRangeChange,
  onRetry,
}: Props) {
  const root = useRef<HTMLElement>(null);
  const visibleData = data?.periodDays === rangeDays ? data : null;
  const totals = (visibleData?.daily ?? []).reduce(
    (sum, point) => ({
      requests: sum.requests + point.imageRequests + point.videoRequests,
      completed: sum.completed + point.completed,
      credits: sum.credits + point.creditsSpent,
    }),
    { requests: 0, completed: 0, credits: 0 },
  );
  const hasActivity = totals.requests > 0 || totals.credits > 0;

  useGSAP(
    () => {
      const trigger = root.current;
      if (!trigger) return;
      const media = gsap.matchMedia();
      const scroller = trigger.closest<HTMLElement>("[data-home-scroll]");
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          trigger,
          { autoAlpha: 0, y: 20, scale: 0.99 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.9,
            ease: "elastic.out(1, 0.78)",
            scrollTrigger: {
              trigger,
              ...(scroller ? { scroller } : {}),
              start: "top 88%",
              once: true,
            },
          },
        );
      });
      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(trigger, { autoAlpha: 1, y: 0, scale: 1 });
      });
      return () => media.revert();
    },
    { scope: root, dependencies: [rangeDays], revertOnUpdate: true },
  );

  function selectRange(days: HomeOverviewRange) {
    onRangeChange(days);
  }

  return (
    <section
      ref={root}
      aria-labelledby="home-activity-title"
      className="my-12 w-full rounded-xl border border-border/70 bg-card/70 p-5 shadow-sm sm:my-16 sm:p-7"
    >
      <header>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            WORKSPACE PULSE
          </p>
          <h2 id="home-activity-title" className="mt-2 text-xl font-medium tracking-tight text-foreground">
            创作节奏
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            图片、视频生成与积分消耗
          </p>
        </div>
      </header>

      <div className="mt-4 flex justify-end">
        <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-background p-1" aria-label="趋势周期">
          {RANGE_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={rangeDays === days}
              disabled={loading}
              onClick={() => selectRange(days)}
              className={`min-w-12 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait ${rangeDays === days ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {days} 天
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 border-y border-border/60 py-4 sm:mt-5">
        <Summary label="生成请求" value={loading && !visibleData ? "--" : totals.requests.toLocaleString("zh-CN")} />
        <Summary label="成功交付" value={loading && !visibleData ? "--" : totals.completed.toLocaleString("zh-CN")} />
        <Summary label="消耗积分" value={loading && !visibleData ? "--" : formatCredits(totals.credits)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-[11px] text-muted-foreground" aria-label="图表图例">
        <LegendItem color="#0f766e" label="图片" />
        <LegendItem color="#d97706" label="视频" />
        <LegendItem color="#2563eb" label="Credits" line />
      </div>

      <div className="relative mt-2 h-[220px] min-w-0 overflow-hidden sm:h-[270px]" aria-busy={loading}>
        {visibleData && !error ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visibleData.daily} accessibilityLayer margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatAxisDate}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <YAxis yAxisId="jobs" domain={[0, (max: number) => max || 1]} tickCount={hasActivity ? 5 : 2} allowDecimals={false} width={32} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <YAxis yAxisId="credits" orientation="right" domain={[0, (max: number) => max || 1]} tickCount={hasActivity ? 5 : 2} allowDecimals width={36} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(label) => formatTooltipDate(String(label))}
                  formatter={(value, name) => [
                    name === "creditsSpent" ? formatCredits(Number(value)) : Number(value).toLocaleString("zh-CN"),
                    SERIES_LABELS[String(name)] ?? String(name),
                  ]}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--card-foreground)", boxShadow: "0 12px 32px rgb(15 23 42 / 0.10)" }}
                  cursor={{ fill: "var(--muted)", opacity: 0.55 }}
                />
                <Bar yAxisId="jobs" dataKey="imageRequests" name="imageRequests" stackId="requests" fill="#0f766e" maxBarSize={22} isAnimationActive={false} />
                <Bar yAxisId="jobs" dataKey="videoRequests" name="videoRequests" stackId="requests" fill="#d97706" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                <Line yAxisId="credits" dataKey="creditsSpent" name="creditsSpent" type="monotone" stroke="#2563eb" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            {!hasActivity && (
              <div className="pointer-events-none absolute inset-x-0 bottom-8 top-10 flex items-center justify-center">
                <p className="rounded-md border border-border/70 bg-background/90 px-4 py-2 text-sm text-muted-foreground shadow-sm">
                  完成第一次生成后，趋势会显示在这里
                </p>
              </div>
            )}
          </>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">趋势数据暂时无法加载</p>
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <RefreshCw className="size-4" aria-hidden="true" />
              重试
            </button>
          </div>
        ) : (
          <div className="grid h-full grid-cols-7 items-end gap-3 px-6 pb-8 pt-12" aria-label="正在加载创作趋势">
            {[35, 58, 42, 76, 48, 66, 38].map((height, index) => (
              <span key={index} className="block rounded-t-sm bg-muted" style={{ height: `${height}%` }} />
            ))}
          </div>
        )}
      </div>

      <footer className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          {visibleData ? `${rangeDays} 天内完成 ${totals.completed} 次生成` : "数据按当前工作区汇总"}
        </p>
        <Link href="/assets/" className="inline-flex w-fit items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
          查看生成资产
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </footer>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 first:pl-0 last:pr-0 sm:px-4">
      <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{label}</p>
      <p className="mt-1 truncate text-lg font-medium tabular-nums text-foreground sm:text-xl">{value}</p>
    </div>
  );
}

function LegendItem({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={line ? "h-0.5 w-3 rounded-full" : "size-2 rounded-[2px]"} style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function formatCredits(value: number) {
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} cr`;
}

function formatAxisDate(value: string) {
  return value.slice(5).replace("-", "/");
}

function formatTooltipDate(value: string) {
  return `${value.slice(5, 7)}月${value.slice(8, 10)}日`;
}
