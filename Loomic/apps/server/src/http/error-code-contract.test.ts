import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { DataAdminClient } from "../auth/types.js";
import { registerContactSalesRoutes } from "./contact-sales.js";

import {
  applicationErrorCodeSchema,
  applicationErrorCodeSchemaLoose,
  applicationErrorCodeValues,
  applicationErrorResponseSchemaLoose,
} from "@helstera/shared";

/**
 * P0 回归护栏：错误码契约的"封闭枚举"曾经装不下服务端实际抛出的 code，
 * `applicationErrorResponseSchema.parse(...)` 在发送点抛 ZodError，
 * Fastify 于是回 500 通用错误，客户端拿不到可读 code。
 *
 * 这里用"静态扫描发送点 + 表驱动校验"把这件事钉死：
 * - 发送点必须使用宽松契约（`applicationErrorResponseSchemaLoose`）；
 * - 任何写在发送点的 code 都必须能过校验；
 * - 垃圾 code 仍然必须被拒绝（校验没有退化成 `z.string()`）。
 */

const HTTP_DIR = dirname(fileURLToPath(import.meta.url));

type SourceFile = { file: string; text: string };

function readHttpSources(): SourceFile[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });

  return walk(HTTP_DIR)
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
    .map((path) => ({
      file: relative(HTTP_DIR, path).split("\\").join("/"),
      text: readFileSync(path, "utf8"),
    }));
}

/** 取 `(` 起始的括号平衡片段，避免把邻近的另一个对象误算成发送点。 */
function balancedSlice(text: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(openParenIndex, i + 1);
    }
  }
  return text.slice(openParenIndex);
}

type SendSite = {
  file: string;
  line: number;
  callee: string;
  /** 字面量 code；动态表达式（如 `error.code`）为 `null`。 */
  literalCode: string | null;
};

function collectSendSites(sources: SourceFile[]): SendSite[] {
  const sites: SendSite[] = [];
  for (const { file, text } of sources) {
    const call =
      /(applicationErrorResponseSchema(?:Loose)?)\.(?:parse|safeParse)\(/g;
    for (const match of text.matchAll(call)) {
      const openParen = (match.index ?? 0) + match[0].length - 1;
      const body = balancedSlice(text, openParen);
      const literal = body.match(/code:\s*"([^"]*)"/);
      sites.push({
        file,
        line: text.slice(0, match.index ?? 0).split("\n").length,
        callee: match[1] ?? "<unknown>",
        literalCode: literal ? (literal[1] ?? "") : null,
      });
    }
  }
  return sites;
}

/** 所有发送出去的 code 字面量（含未经 parse、直接 reply.send 的错误体）。 */
function collectLiteralCodes(
  sources: SourceFile[],
): { file: string; code: string }[] {
  const found: { file: string; code: string }[] = [];
  for (const { file, text } of sources) {
    for (const match of text.matchAll(/code:\s*"([^"]+)"/g)) {
      found.push({ file, code: match[1] ?? "" });
    }
  }
  return found;
}

const SOURCES = readHttpSources();
const SEND_SITES = collectSendSites(SOURCES);
const LITERAL_CODES = collectLiteralCodes(SOURCES);

/** 会流经发送点的服务层 code（类型上不在 shared 白名单里，运行时真的会发）。 */
const SERVICE_LAYER_CODES = [
  "topup_failed",
  "topup_activate_failed",
  "settings_read_failed",
  "payment_not_configured",
  "subscription_not_found",
  "subscription_update_failed",
  "webhook_processing_failed",
] as const;

/** 已知会以 4xx/5xx 错误体出现、但不在旧封闭枚举里的码。 */
const PREVIOUSLY_UNENUMERATED_CODES = [
  "invalid_request",
  "invalid_input",
  "submission_failed",
  "query_failed",
  "provider_not_configured",
  "service_unavailable",
  "model_retired",
  "canvas_version_conflict",
  "invalid_if_match",
] as const;

const INVALID_CODES = [
  "",
  " ",
  "a",
  "ab",
  "A",
  "UPPER_CASE",
  "MixedCase",
  "has space",
  " leading_space",
  "trailing_space ",
  "with-dash",
  "dot.separated",
  "1leading_digit",
  "upper_lower_Mix",
  "x".repeat(65),
  "中文错误码",
] as const;

describe("application error code contract", () => {
  it("每个发送点都使用宽松契约（不再用封闭枚举校验出站响应）", () => {
    expect(SEND_SITES.length).toBeGreaterThan(0);
    const strict = SEND_SITES.filter(
      (site) => site.callee !== "applicationErrorResponseSchemaLoose",
    ).map((site) => `${site.file}:${site.line}`);

    expect(strict).toEqual([]);
  });

  it("发送点里每一个字面量 code 都能成功 parse", () => {
    const literalSites = SEND_SITES.filter((site) => site.literalCode !== null);
    expect(literalSites.length).toBeGreaterThan(0);

    const failures = literalSites
      .filter(
        (site) =>
          !applicationErrorResponseSchemaLoose.safeParse({
            error: { code: site.literalCode, message: "boom" },
          }).success,
      )
      .map((site) => `${site.file}:${site.line} -> ${site.literalCode}`);

    expect(failures).toEqual([]);
  });

  it("发送出去的 code 原样回显，不被改写", () => {
    for (const site of SEND_SITES) {
      if (site.literalCode === null) continue;
      const parsed = applicationErrorResponseSchemaLoose.parse({
        error: { code: site.literalCode, message: "boom" },
      });
      expect(parsed.error.code).toBe(site.literalCode);
    }
  });

  it.each(SERVICE_LAYER_CODES)("服务层动态 code %s 能成功 parse", (code) => {
    const parsed = applicationErrorResponseSchemaLoose.parse({
      error: { code, message: "service failure" },
    });
    expect(parsed.error.code).toBe(code);
  });

  it.each(PREVIOUSLY_UNENUMERATED_CODES)(
    "旧封闭枚举外的实际 code %s 能成功 parse",
    (code) => {
      const parsed = applicationErrorResponseSchemaLoose.parse({
        error: { code, message: "boom" },
      });
      expect(parsed.error.code).toBe(code);
    },
  );

  it("http 目录下所有字面量 code（含直接 send 的）都通过格式校验", () => {
    expect(LITERAL_CODES.length).toBeGreaterThan(0);
    const failures = LITERAL_CODES.filter(
      (item) => !applicationErrorCodeSchemaLoose.safeParse(item.code).success,
    ).map((item) => `${item.file} -> ${item.code}`);

    expect(failures).toEqual([]);
  });

  it("发送点用到的 code 全部登记在已知码白名单里", () => {
    const known = new Set<string>(applicationErrorCodeValues);
    const unregistered = [
      ...new Set(
        SEND_SITES.flatMap((site) =>
          site.literalCode !== null ? [site.literalCode] : [],
        ),
      ),
    ]
      .filter((code) => !known.has(code))
      .sort();

    expect(unregistered).toEqual([]);
  });

  it("白名单是封闭枚举：未登记的码仍被判为未知", () => {
    expect(
      applicationErrorCodeSchema.safeParse("database_exploded").success,
    ).toBe(false);
    // 封闭枚举说"没约定过"，宽松契约说"格式合法、可发送" —— 两者分工，不冲突。
    expect(
      applicationErrorCodeSchemaLoose.safeParse("database_exploded").success,
    ).toBe(true);
    expect(
      applicationErrorCodeSchema.safeParse("project_create_failed").success,
    ).toBe(true);
    // 白名单里每个码都必须能过宽松校验（否则前端分支与出站格式会打架）。
    for (const code of applicationErrorCodeValues) {
      expect(applicationErrorCodeSchemaLoose.safeParse(code).success).toBe(
        true,
      );
    }
  });

  it.each(INVALID_CODES)("垃圾 code %j 仍被拒绝", (code) => {
    expect(applicationErrorCodeSchemaLoose.safeParse(code).success).toBe(false);
    expect(
      applicationErrorResponseSchemaLoose.safeParse({
        error: { code, message: "boom" },
      }).success,
    ).toBe(false);
  });

  it("校验没有退化：message 仍必须非空，error 包装仍必须存在", () => {
    expect(
      applicationErrorResponseSchemaLoose.safeParse({
        error: { code: "submission_failed", message: "" },
      }).success,
    ).toBe(false);
    expect(
      applicationErrorResponseSchemaLoose.safeParse({
        code: "submission_failed",
      }).success,
    ).toBe(false);
  });
});

/**
 * 端到端部分：证明"接口不再把可读错误变成 500 通用错误"。
 * 修复前这三个用例拿到的是 Fastify 默认 500（`error.code` 缺失）。
 */
describe("contact-sales 错误响应（真实路由）", () => {
  const okAdmin = (data: unknown) =>
    ({
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data, error: null }) }),
        }),
        select: () => ({
          order: () => ({ limit: async () => ({ data, error: null }) }),
        }),
      }),
    }) as unknown as DataAdminClient;

  const brokenAdmin = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { message: "insert boom" },
          }),
        }),
      }),
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: null,
            error: { message: "select boom" },
          }),
        }),
      }),
    }),
  } as unknown as DataAdminClient;

  const buildApp = (admin: DataAdminClient) => {
    const app = Fastify({ logger: false });
    void registerContactSalesRoutes(app, { getAdminClient: () => admin });
    return app;
  };

  it("非法 body 返回 400 + code=invalid_request（不是 500）", async () => {
    const app = buildApp(brokenAdmin);
    const response = await app.inject({
      method: "POST",
      url: "/api/contact-sales",
      payload: { name: "", email: "not-an-email", message: "短" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    await app.close();
  });

  it("写库失败返回 500 + code=submission_failed（不是通用 500）", async () => {
    const app = buildApp(brokenAdmin);
    const response = await app.inject({
      method: "POST",
      url: "/api/contact-sales",
      payload: {
        name: "张三",
        email: "zhangsan@example.com",
        message: "我们团队需要企业版方案与发票支持。",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("submission_failed");
    await app.close();
  });

  it("查询失败返回 500 + code=query_failed（不是通用 500）", async () => {
    const app = buildApp(brokenAdmin);
    const response = await app.inject({
      method: "GET",
      url: "/api/contact-sales/inquiries",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("query_failed");
    await app.close();
  });

  it("成功路径仍是 201，错误码修复没有动正常返回", async () => {
    const app = buildApp(okAdmin({ id: "inquiry_1" }));
    const response = await app.inject({
      method: "POST",
      url: "/api/contact-sales",
      payload: {
        name: "李四",
        email: "lisi@example.com",
        message: "希望了解企业版报价与部署方式。",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().success).toBe(true);
    await app.close();
  });
});
