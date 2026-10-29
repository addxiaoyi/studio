import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PERSIST_ATTEMPTS,
  describeError,
  persistFailureEvent,
  persistWithRetry,
  spoolFailedPersistence,
  type FailedPersistenceRecord,
} from "./persistence-retry.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "helstera-spool-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("persistWithRetry", () => {
  it("retries a failing write and succeeds without losing the reply", async () => {
    const sleeps: number[] = [];
    const attempts: number[] = [];
    let calls = 0;

    const outcome = await persistWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error(`db unavailable #${calls}`);
      },
      {
        delayMs: 10,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        onAttemptFailed: (attempt) => attempts.push(attempt),
      },
    );

    expect(outcome).toEqual({ ok: true, attempts: 3 });
    expect(calls).toBe(3);
    expect(attempts).toEqual([1, 2]);
    expect(sleeps).toEqual([10, 20]);
  });

  it("reports the last error after exhausting the attempt budget instead of throwing", async () => {
    let calls = 0;
    const outcome = await persistWithRetry(
      async () => {
        calls += 1;
        throw new Error(`write failed #${calls}`);
      },
      { attempts: 2, delayMs: 0, sleep: async () => undefined },
    );

    expect(calls).toBe(2);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure outcome");
    expect(outcome.attempts).toBe(2);
    expect(describeError(outcome.error)).toBe("write failed #2");
  });

  it("defaults to three attempts and tolerates non-Error throwables", async () => {
    let calls = 0;
    const outcome = await persistWithRetry(
      async () => {
        calls += 1;
        throw "row conflict";
      },
      { delayMs: 0, sleep: async () => undefined },
    );

    expect(calls).toBe(DEFAULT_PERSIST_ATTEMPTS);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure outcome");
    expect(describeError(outcome.error)).toBe("row conflict");
  });
});

describe("spoolFailedPersistence", () => {
  const record: FailedPersistenceRecord = {
    kind: "assistant_message_persist_failed",
    recordedAt: "2026-10-28T00:00:00.000Z",
    runId: "run-1",
    sessionId: "session-1",
    userId: "user-1",
    canvasId: "canvas-1",
    role: "assistant",
    content: "hello",
    contentBlocks: [{ type: "text", text: "hello" }],
    attempts: 3,
    error: "db unavailable",
  };

  it("appends a replayable JSONL record", () => {
    const dir = makeTempDir();
    const file = spoolFailedPersistence(record, { dir });

    expect(file).toBe(join(dir, "assistant-message-spool.jsonl"));
    const lines = readFileSync(file!, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "assistant_message_persist_failed",
      runId: "run-1",
      content: "hello",
      attempts: 3,
    });
  });

  it("appends subsequent failures instead of overwriting the spool", () => {
    const dir = makeTempDir();
    spoolFailedPersistence(record, { dir });
    spoolFailedPersistence({ ...record, runId: "run-2" }, { dir });

    const content = readFileSync(join(dir, "assistant-message-spool.jsonl"), "utf8");
    expect(content.trim().split("\n")).toHaveLength(2);
    expect(content).toContain("run-2");
  });

  it("returns null instead of throwing when the spool location is unusable", () => {
    const dir = makeTempDir();
    const blocked = join(dir, "not-a-directory");
    writeFileSync(blocked, "x");

    expect(spoolFailedPersistence(record, { dir: blocked })).toBeNull();
  });
});

describe("persistFailureEvent", () => {
  it("emits a retryable run.failed event the existing client renders", () => {
    const event = persistFailureEvent("run-1", new Date("2026-10-28T00:00:00.000Z"));
    expect(event).toEqual({
      type: "run.failed",
      runId: "run-1",
      error: {
        code: "run_failed",
        message: expect.stringContaining("未能保存"),
        retryable: true,
      },
      timestamp: "2026-10-28T00:00:00.000Z",
    });
  });
});
