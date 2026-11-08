import type { WebsiteCaptureTask } from "@helstera/shared";

export function presentationProgress(duration: number, events: Array<{ stage: string; detail: string; created_at: string | Date }>): WebsiteCaptureTask["recordingProgress"] {
  const samples = events.filter(event => event.stage === "presentation_recording" && /\d+%/.test(event.detail));
  const first = samples[0], last = samples.at(-1);
  if (!first || !last || !Number.isFinite(duration) || duration <= 0) return;
  const percent = Math.min(100, Number(last.detail.match(/(\d+)%/)?.[1]));
  const start = Number(first.detail.match(/(\d+)%/)?.[1]);
  const elapsed = Math.max(0, (new Date(last.created_at).getTime() - new Date(first.created_at).getTime()) / 1000);
  if (![percent, start, elapsed].every(Number.isFinite)) return;
  return { renderedSeconds: duration * percent / 100, totalSeconds: duration, elapsedSeconds: Math.round(elapsed),
    remainingSeconds: percent > start && elapsed > 0 ? Math.ceil(elapsed / (percent - start) * (100 - percent)) : null, pageIndex: 1, pageCount: 1 };
}
