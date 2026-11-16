const TRANSIENT_DATABASE_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "40001",
  "40P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

const TRANSIENT_DATABASE_TEXT = /connection (?:terminated|refused|reset)|too many clients|econnreset|econnrefused|etimedout|timeout|deadlock detected|temporarily unavailable/i;

export function isTransientAgentBrowserError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof value.code === "string" && TRANSIENT_DATABASE_CODES.has(value.code)) return true;
  if (typeof value.message === "string" && TRANSIENT_DATABASE_TEXT.test(value.message)) return true;
  return value.cause ? isTransientAgentBrowserError(value.cause) : false;
}
