import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const runtimePath = fileURLToPath(new URL("./runtime.ts", import.meta.url));

/**
 * `adaptDeepAgentStream` can only retry an upstream 5xx before the first token if it is given
 * `createStream` — a factory, because the `stream` it also receives is a one-shot iterable that
 * cannot be restarted once consumed.
 *
 * Forgetting that factory leaves the retry logic dead in production while every unit test of the
 * adapter still passes. That is the exact failure mode this session kept hitting, so it gets a
 * guard: if the wiring is removed, this test fails instead of the retry silently disappearing.
 */
describe("agent runtime retry wiring", () => {
  it("passes a stream factory so before-first-token retry can actually fire", () => {
    const source = readFileSync(runtimePath, "utf8");

    expect(source).toContain("createEventStream = () => agent.streamEvents(");
    expect(source).toContain("stream = createEventStream();");
    expect(source).toContain("...(createEventStream ? { createStream: createEventStream } : {})");
  });
});
