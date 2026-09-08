// @observability — Lightweight performance metrics
// Captures Core Web Vitals via native PerformanceObserver (no extra dep).
// Falls back gracefully if API is unavailable.

type WebVitalName = "LCP" | "CLS" | "FCP" | "TTFB" | "INP" | "FID";

type WebVitalRating = "good" | "needs-improvement" | "poor";

interface WebVitalMetric {
  name: WebVitalName;
  value: number;
  rating: WebVitalRating;
  id: string;
  url: string;
  timestamp: number;
  connectionType?: string | undefined;
  devicePixelRatio?: number | undefined;
}

const API_ENDPOINT = "/api/metrics";
let installed = false;

/** LCP thresholds per https://web.dev/lcp/ */
const LCP_THRESHOLDS = { good: 2500, poor: 4000 } as const;
/** CLS thresholds per https://web.dev/cls/ */
const CLS_THRESHOLDS = { good: 0.1, poor: 0.25 } as const;
/** FCP thresholds per https://web.dev/fcp/ */
const FCP_THRESHOLDS = { good: 1800, poor: 3000 } as const;
/** TTFB thresholds per https://web.dev/ttfb/ */
const TTFB_THRESHOLDS = { good: 800, poor: 1800 } as const;
/** INP thresholds per https://web.dev/inp/ */
const INP_THRESHOLDS = { good: 200, poor: 500 } as const;

function rate(
  value: number,
  thresholds: { good: number; poor: number },
): WebVitalRating {
  if (value <= thresholds.good) return "good";
  if (value <= thresholds.poor) return "needs-improvement";
  return "poor";
}

/**
 * Install lightweight PerformanceObserver-based web vitals reporter.
 * Native browser API — no external dependency.
 */
export function installWebVitals(): void {
  if (typeof window === "undefined" || installed) return;
  if (typeof PerformanceObserver === "undefined") return;
  installed = true;

  // LCP — Largest Contentful Paint
  try {
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const last = entries[entries.length - 1];
      if (!last) return;
      sendMetric({
        name: "LCP",
        value: last.startTime,
        rating: rate(last.startTime, LCP_THRESHOLDS),
        id: last.entryType,
      });
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // Browser doesn't support LCP observation
  }

  // FCP — First Contentful Paint
  try {
    const fcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const fcp = entries.find((e) => e.name === "first-contentful-paint");
      if (!fcp) return;
      sendMetric({
        name: "FCP",
        value: fcp.startTime,
        rating: rate(fcp.startTime, FCP_THRESHOLDS),
        id: fcp.entryType,
      });
    });
    fcpObserver.observe({ type: "paint", buffered: true });
  } catch {
    // ignore
  }

  // TTFB — Time to First Byte (via Navigation Timing)
  try {
    const navEntry = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    if (navEntry) {
      const ttfb = navEntry.responseStart - navEntry.startTime;
      sendMetric({
        name: "TTFB",
        value: ttfb,
        rating: rate(ttfb, TTFB_THRESHOLDS),
        id: "navigation",
      });
    }
  } catch {
    // ignore
  }

  // CLS — Cumulative Layout Shift
  let clsValue = 0;
  try {
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput?: boolean;
          value?: number;
        };
        if (!shift.hadRecentInput) {
          clsValue += shift.value ?? 0;
        }
      }
      sendMetric({
        name: "CLS",
        value: clsValue,
        rating: rate(clsValue, CLS_THRESHOLDS),
        id: "layout-shift",
      });
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
  } catch {
    // ignore
  }

  // INP — Interaction to Next Paint (replaces FID)
  try {
    let inpValue = 0;
    const inpObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const interaction = entry as PerformanceEntry & {
          duration?: number;
        };
        if ((interaction.duration ?? 0) > inpValue) {
          inpValue = interaction.duration ?? 0;
        }
      }
      sendMetric({
        name: "INP",
        value: inpValue,
        rating: rate(inpValue, INP_THRESHOLDS),
        id: "interaction",
      });
    });
    inpObserver.observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
  } catch {
    // ignore
  }
}

function sendMetric(metric: {
  name: WebVitalName;
  value: number;
  rating: WebVitalRating;
  id: string;
}) {
  const conn = (
    navigator as unknown as { connection?: { effectiveType?: string } }
  ).connection;

  const report: WebVitalMetric = {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    url: window.location.href,
    timestamp: Date.now(),
    connectionType: conn?.effectiveType,
    devicePixelRatio: window.devicePixelRatio,
  };
  void sendReport(report);
}

async function sendReport(metric: WebVitalMetric): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(metric)], {
        type: "application/json",
      });
      const ok = navigator.sendBeacon(API_ENDPOINT, blob);
      if (ok) return;
    }
    await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metric),
      keepalive: true,
    });
  } catch {
    // Silently swallow
  }
}
