// P0 defense-in-depth: keep passwords, OTPs, cookies, tokens and .env lines out
// of model context.
//
// IMPORTANT: this is *defense in depth*, not the only barrier. It must never be
// used as a reason to remove the existing `accessToken` stripping in runtime.ts
// (see runtime.ts `const { accessToken: _ignoredAccessToken, ...runInput }`),
// which prevents credentials from reaching tool/configurable state at all.
//
// The single enforcement point is `promptRedactionMiddleware` (registered once
// in deep-agent.ts). Every model call in the agent graph passes through its
// `wrapModelCall` hook, so user prompts, pasted text, fetched page content and
// tool results are all scrubbed before they reach the provider.

import type { BaseMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { createPipelineLogger } from "../ws/logger.js";

/** Replacement marker. Contains no digits, so it can never re-trigger a pattern. */
export const REDACTED = "[REDACTED]";

export type RedactionHitType =
  | "private_key"
  | "cookie_header"
  | "authorization_header"
  | "env_assignment"
  | "provider_token"
  | "jwt"
  | "otp_code";

export type RedactionHit = {
  type: RedactionHitType;
  count: number;
};

export type RedactionResult = {
  text: string;
  hits: RedactionHit[];
};

// ---------------------------------------------------------------------------
// Patterns. Each one is explicit on purpose: no fuzzy/entropy heuristics, so a
// false positive is traceable back to a named rule.
// ---------------------------------------------------------------------------

/** PEM private key blocks, including the body. */
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
/** Unterminated private key block (truncated capture / copy-paste cut off). */
const PRIVATE_KEY_OPEN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*$/g;

/** `Cookie:` / `Set-Cookie:` header lines — whole line, including attributes. */
const COOKIE_HEADER = /^([ \t]*(?:set-)?cookie\s*):[^\n]*$/gim;

/**
 * Same header captured mid-line, e.g. inside a JSON tool result
 * (`"Cookie": "session=..."`). Quoting is preserved so JSON stays parseable.
 */
const COOKIE_PAIR =
  /((?:"|')?(?<![A-Za-z0-9_])(?:set-)?cookie(?:"|')?\s*:\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;}"']+)/gi;

/** `Authorization: Bearer <token>` header lines. */
const AUTHORIZATION_HEADER = /^([ \t]*authorization\s*:\s*bearer\s+)\S+/gim;

/**
 * `KEY=VALUE` / `KEY: VALUE` for sensitive key names.
 *
 * The key must be upper-snake-case (env/JSON style), which is what keeps prose
 * and ordinary code such as `const token = getToken()` out of scope. Quoting is
 * preserved so a redacted JSON payload (tool result) stays parseable.
 */
const ENV_ASSIGNMENT =
  /((?:"|')?(?<![A-Za-z0-9_])[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|DATABASE_URL|CONNECTION_STRING)[A-Z0-9_]*)((?:"|')?\s*[:=]\s*)("([^"\n]*)"|'([^'\n]*)'|[^\s"'#\n,;}]+)/g;

/** Values that are references to a secret, not the secret itself. */
const REFERENCE_VALUE =
  /^(?:process\.env|os\.environ|os\.getenv|env\(|env\.|\$\{|\$[A-Z_])/;

/** Well-known platform tokens. Each entry needs a real, verifiable shape. */
const PLATFORM_TOKENS: Array<{ type: RedactionHitType; pattern: RegExp }> = [
  { type: "provider_token", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { type: "provider_token", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "provider_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { type: "provider_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { type: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
];

/**
 * A bare 6-digit code is only redacted when an OTP context word sits next to
 * it (before or after, within 16 non-digit characters). Ordinary numbers such
 * as prices, ids, ports and dates must survive untouched.
 */
const OTP_CONTEXT_BEFORE =
  /(验证码|校验码|动态码|短信码|verification code|verify code|security code|one-time code|confirmation code|\bcodes?\b|\botp\b)([^\d\n]{0,16})(?<!\d)(\d{6})(?!\d)/gi;
const OTP_CONTEXT_AFTER =
  /(?<!\d)(\d{6})(?!\d)([^\d\n]{0,16})(验证码|verification code|\botp\b)/gi;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

type Counts = Map<RedactionHitType, number>;

/**
 * Apply one pattern, counting hits. If a match already renders to its own
 * replacement it is skipped, which is what makes repeated passes idempotent
 * (no growth, no phantom hits).
 */
function applyPattern(
  text: string,
  pattern: RegExp,
  type: RedactionHitType,
  counts: Counts,
  replacer: (full: string, captures: string[]) => string,
): string {
  return text.replace(pattern, (...args: unknown[]) => {
    const hasNamedGroups = typeof args[args.length - 1] === "object";
    const full = args[0] as string;
    const captures = args.slice(
      1,
      args.length - (hasNamedGroups ? 3 : 2),
    ) as string[];
    const replacement = replacer(full, captures);
    if (replacement === full) return full;
    counts.set(type, (counts.get(type) ?? 0) + 1);
    return replacement;
  });
}

/** Replace the `digits` substring inside `full` with the redaction marker. */
function replaceDigits(full: string, digits: string): string {
  const at = full.indexOf(digits);
  if (at < 0) return full;
  return `${full.slice(0, at)}${REDACTED}${full.slice(at + digits.length)}`;
}

function toHits(counts: Counts): RedactionHit[] {
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

/**
 * Redact sensitive material from a string.
 *
 * Idempotent: running it twice yields identical text and no hits the second
 * time. Returns hit metadata (type + count) for logging and tests — never the
 * matched values themselves.
 */
export function redactSensitive(text: string): RedactionResult {
  if (!text) return { text, hits: [] };

  const counts: Counts = new Map();
  let out = text;

  // 1. Private key material first: it must not be partially matched by later rules.
  out = applyPattern(out, PRIVATE_KEY_BLOCK, "private_key", counts, () => REDACTED);
  out = applyPattern(out, PRIVATE_KEY_OPEN, "private_key", counts, () => REDACTED);

  // 2. Whole header lines.
  out = applyPattern(
    out,
    COOKIE_HEADER,
    "cookie_header",
    counts,
    (_full, captures) => `${captures[0]}: ${REDACTED}`,
  );
  out = applyPattern(out, COOKIE_PAIR, "cookie_header", counts, (full, captures) => {
    const value = captures[1] ?? "";
    if (REFERENCE_VALUE.test(value.replace(/^["']|["']$/g, ""))) return full;
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
    return `${captures[0] ?? ""}${quote}${REDACTED}${quote}`;
  });
  out = applyPattern(
    out,
    AUTHORIZATION_HEADER,
    "authorization_header",
    counts,
    (_full, captures) => `${captures[0]}${REDACTED}`,
  );

  // 3. KEY=VALUE / KEY: VALUE with a sensitive key.
  out = applyPattern(out, ENV_ASSIGNMENT, "env_assignment", counts, (full, captures) => {
    const key = captures[0] ?? "";
    const separator = captures[1] ?? "";
    const rawValue = captures[2] ?? "";
    const inner = rawValue.replace(/^["']|["']$/g, "");
    if (REFERENCE_VALUE.test(inner)) return full;
    const quote = captures[3] !== undefined ? '"' : captures[4] !== undefined ? "'" : "";
    return `${key}${separator}${quote}${REDACTED}${quote}`;
  });

  // 4. Platform tokens.
  for (const { type, pattern } of PLATFORM_TOKENS) {
    out = applyPattern(out, pattern, type, counts, () => REDACTED);
  }

  // 5. OTP digits, only when an explicit context word is adjacent.
  out = applyPattern(out, OTP_CONTEXT_BEFORE, "otp_code", counts, (full, captures) =>
    replaceDigits(full, captures[2] ?? ""),
  );
  out = applyPattern(out, OTP_CONTEXT_AFTER, "otp_code", counts, (full, captures) =>
    replaceDigits(full, captures[0] ?? ""),
  );

  return { text: out, hits: toHits(counts) };
}

/** Flat `{ type: totalCount }` view for logs (never contains matched values). */
export function summarizeHits(hits: RedactionHit[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const hit of hits) {
    summary[hit.type] = (summary[hit.type] ?? 0) + hit.count;
  }
  return summary;
}

/** Total hit count across types. */
export function countHits(hits: RedactionHit[]): number {
  return hits.reduce((sum, hit) => sum + hit.count, 0);
}

type ContentNode = string | number | boolean | null | ContentNode[] | { [key: string]: unknown };

/**
 * Deep-redact any string leaf of a message content value (plain string, content
 * block array, or tool-result object). Structure is preserved so JSON payloads
 * stay parseable.
 */
export function redactContent<T>(content: T): { content: T; hits: RedactionHit[] } {
  const counts: Counts = new Map();

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      const result = redactSensitive(value);
      for (const hit of result.hits) {
        counts.set(hit.type, (counts.get(hit.type) ?? 0) + hit.count);
      }
      return result.text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      const next: Record<string, unknown> = {};
      let changed = false;
      for (const [key, entry] of entries) {
        const walked = walk(entry);
        if (walked !== entry) changed = true;
        next[key] = walked;
      }
      return changed ? next : value;
    }
    return value;
  };

  const walked = walk(content as ContentNode);
  return { content: walked as T, hits: toHits(counts) };
}

/** Redact every message's content in place, returning the aggregate hits. */
export function redactMessages(messages: BaseMessage[]): RedactionHit[] {
  const totals: Counts = new Map();

  for (const message of messages) {
    const result = redactContent(message.content);
    for (const hit of result.hits) {
      totals.set(hit.type, (totals.get(hit.type) ?? 0) + hit.count);
    }
    if (result.hits.length > 0) {
      (message as { content: unknown }).content = result.content;
    }
  }

  return toHits(totals);
}

const redactionLog = createPipelineLogger("prompt-redaction");

/**
 * The single enforcement point for model input.
 *
 * Registered exactly once in `createHelsteraAgent` (deep-agent.ts). LangChain's
 * `wrapModelCall` runs for *every* model invocation in the graph — first turn,
 * after each tool call, and after compaction — so there is no second path to
 * keep in sync.
 */
export const promptRedactionMiddleware = createMiddleware({
  name: "PromptSensitiveRedaction",
  wrapModelCall: async (request, handler) => {
    const messages = request.messages ?? [];
    const hits = redactMessages(messages);
    const summary = summarizeHits(hits);

    let nextRequest = request;
    if (request.systemPrompt) {
      const system = redactSensitive(request.systemPrompt);
      if (system.hits.length > 0) {
        for (const hit of system.hits) {
          summary[hit.type] = (summary[hit.type] ?? 0) + hit.count;
        }
        nextRequest = { ...request, systemPrompt: system.text };
      }
    }

    // Log hit types + counts only. Never the matched text.
    if (Object.keys(summary).length > 0) {
      redactionLog.warn("prompt_redaction_applied", {
        ...summary,
        total: Object.values(summary).reduce((sum, n) => sum + n, 0),
      });
    }

    return handler(nextRequest);
  },
});
