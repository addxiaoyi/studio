// @observability — In-house error reporter
// Captures uncaught errors and unhandled rejections, batches and posts to /api/errors.
// No external SDK required — minimal surface area, no bundle bloat.

type Severity = "info" | "warning" | "error" | "fatal";

interface ErrorReport {
  message: string;
  stack?: string | undefined;
  url: string;
  userAgent: string;
  severity: Severity;
  timestamp: number;
  /** Coarse breadcrumb trail of recent user actions. */
  breadcrumbs: string[];
  /** Optional component/route tag. */
  context?: string | undefined;
}

const BREADCRUMB_LIMIT = 20;
const breadcrumbs: string[] = [];

function pushBreadcrumb(label: string): void {
  if (typeof window === "undefined") return;
  const ts = new Date().toISOString().slice(11, 19);
  breadcrumbs.push(`${ts} ${label}`);
  if (breadcrumbs.length > BREADCRUMB_LIMIT) {
    breadcrumbs.shift();
  }
}

/**
 * Capture click / navigation / error events as breadcrumbs.
 * Auto-installs once; safe to call multiple times.
 */
let installed = false;
export function installErrorReporter(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  // Click breadcrumb (delegated listener — captures all)
  window.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement | null;
      const label = target?.closest("button, a, [role='button']");
      if (label) {
        const text = (label.textContent ?? "").trim().slice(0, 50);
        if (text) pushBreadcrumb(`click "${text}"`);
      }
    },
    { capture: true },
  );

  // Navigation breadcrumb (Next.js fires a popstate; for client-side transitions)
  window.addEventListener("popstate", () => {
    pushBreadcrumb(`navigate ${window.location.pathname}`);
  });

  // Uncaught JS errors
  window.addEventListener("error", (event) => {
    const report: ErrorReport = {
      message: event.message,
      stack: event.error?.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      severity: "error",
      timestamp: Date.now(),
      breadcrumbs: [...breadcrumbs],
    };
    void sendReport(report);
  });

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    const report: ErrorReport = {
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection",
      stack: reason instanceof Error ? reason.stack : undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      severity: "error",
      timestamp: Date.now(),
      breadcrumbs: [...breadcrumbs],
    };
    void sendReport(report);
  });
}

/**
 * Manually report a non-fatal error (e.g. caught API error).
 * Use this when you want to log an error without breaking user flow.
 */
export function reportError(
  error: unknown,
  context?: string | undefined,
  severity: Severity = "warning",
): void {
  if (typeof window === "undefined") return;

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const report: ErrorReport = {
    message,
    stack,
    url: window.location.href,
    userAgent: navigator.userAgent,
    severity,
    timestamp: Date.now(),
    breadcrumbs: [...breadcrumbs],
    context,
  };
  void sendReport(report);
}

async function sendReport(report: ErrorReport): Promise<void> {
  // Use sendBeacon for reliability (survives page unloads).
  // Fallback to fetch with keepalive.
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(report)], {
        type: "application/json",
      });
      const ok = navigator.sendBeacon("/api/errors", blob);
      if (ok) return;
    }
    await fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    });
  } catch {
    // Silently swallow — error reporter must never throw.
  }
}
