export const TIMELINE_UI_TICK_MS = 80;
const SEEK_UPDATE_SECONDS = 0.5;

export type TimelineUiClock = {
  lastAt: number;
  lastTime: number;
};

export function publishTimelineTime(
  clock: TimelineUiClock,
  nextTime: number,
  now: number,
  force = false,
): boolean {
  if (!Number.isFinite(nextTime) || !Number.isFinite(now)) return false;

  const isFirstUpdate = clock.lastTime < 0;
  const isLargeSeek =
    Math.abs(nextTime - clock.lastTime) >= SEEK_UPDATE_SECONDS;
  const isDue = now - clock.lastAt >= TIMELINE_UI_TICK_MS;
  if (!force && !isFirstUpdate && !isLargeSeek && !isDue) return false;

  clock.lastAt = now;
  clock.lastTime = nextTime;
  return true;
}
