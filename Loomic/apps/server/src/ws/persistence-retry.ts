import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Durability helpers for server-side assistant message persistence.
 *
 * The WebSocket handler accumulates the assistant reply and writes it to the
 * chat store after the run finishes. That write used to be a single attempt
 * whose failure was swallowed by `log.warn`, so a transient database error
 * could leave a reply visible in the browser but absent from the database.
 *
 * Two guards live here:
 * 1. `persistWithRetry` retries the write with exponential backoff.
 * 2. `spoolFailedPersistence` appends the never-persisted reply to a JSONL
 *    spool file so it can be replayed by an operator instead of being lost.
 */

export const DEFAULT_PERSIST_ATTEMPTS = 3;
export const DEFAULT_PERSIST_DELAY_MS = 250;
export const PERSIST_SPOOL_FILENAME = "assistant-message-spool.jsonl";

export type PersistOutcome =
  | { ok: true; attempts: number }
  | { ok: false; attempts: number; error: unknown };

export type PersistRetryOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onAttemptFailed?: (attempt: number, error: unknown) => void;
};

export type FailedPersistenceRecord = {
  kind: "assistant_message_persist_failed";
  recordedAt: string;
  runId: string;
  sessionId: string;
  userId: string;
  canvasId: string;
  role: "assistant";
  content: string;
  contentBlocks: unknown[];
  attempts: number;
  error: string;
};

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `operation`, retrying with exponential backoff until it succeeds or the
 * attempt budget is exhausted. Never throws: the outcome carries the last error.
 */
export async function persistWithRetry(
  operation: () => Promise<unknown>,
  options: PersistRetryOptions = {},
): Promise<PersistOutcome> {
  const maxAttempts = Math.max(
    1,
    Math.trunc(options.attempts ?? DEFAULT_PERSIST_ATTEMPTS),
  );
  const baseDelay = Math.max(0, options.delayMs ?? DEFAULT_PERSIST_DELAY_MS);
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await operation();
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      options.onAttemptFailed?.(attempt, error);
      if (attempt < maxAttempts) {
        await sleep(baseDelay * 2 ** (attempt - 1));
      }
    }
  }

  return { ok: false, attempts: maxAttempts, error: lastError };
}

/** Directory holding the recovery spool. Overridable for tests/ops. */
export function persistSpoolDir(): string {
  const configured = process.env.HELSTERA_PERSIST_SPOOL_DIR?.trim();
  if (configured) return configured;
  return join(import.meta.dirname ?? ".", "..", "..", "logs");
}

/**
 * Appends one failed reply to the recovery spool. Best effort: returns the
 * spool path on success and `null` when the spool itself is unwritable, so the
 * caller can still surface the failure through logs/events.
 */
export function spoolFailedPersistence(
  record: FailedPersistenceRecord,
  options: { dir?: string } = {},
): string | null {
  const dir = options.dir ?? persistSpoolDir();
  const file = join(dir, PERSIST_SPOOL_FILENAME);
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
    return file;
  } catch {
    return null;
  }
}

/** Builds the visible run.failed event used when persistence is unrecoverable. */
export function persistFailureEvent(runId: string, now = new Date()) {
  return {
    type: "run.failed" as const,
    runId,
    error: {
      code: "run_failed" as const,
      message: "回复已生成，但未能保存到服务器。请重新发送这条消息。",
      retryable: true,
    },
    timestamp: now.toISOString(),
  };
}
