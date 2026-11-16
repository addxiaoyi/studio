import {
  type TimelineUiClock,
  publishTimelineTime,
} from "@/lib/timeline-clock";
import { describe, expect, it } from "vitest";

function clock(): TimelineUiClock {
  return { lastAt: 0, lastTime: -1 };
}

describe("timeline UI clock", () => {
  it("publishes the first frame and then throttles repaint work", () => {
    const state = clock();

    expect(publishTimelineTime(state, 0, 10)).toBe(true);
    expect(publishTimelineTime(state, 0.02, 30)).toBe(false);
    expect(publishTimelineTime(state, 0.1, 100)).toBe(true);
  });

  it("publishes a seek immediately inside the throttle window", () => {
    const state = clock();
    publishTimelineTime(state, 1, 100);

    expect(publishTimelineTime(state, 8, 110)).toBe(true);
    expect(state.lastTime).toBe(8);
  });

  it("rejects invalid clock values without mutating state", () => {
    const state = clock();

    expect(publishTimelineTime(state, Number.NaN, 100)).toBe(false);
    expect(state).toEqual(clock());
  });
});
