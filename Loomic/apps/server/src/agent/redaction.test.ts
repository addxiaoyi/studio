import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  countHits,
  promptRedactionMiddleware,
  redactContent,
  redactMessages,
  redactSensitive,
  summarizeHits,
  REDACTED,
} from "./redaction.js";

describe("redactSensitive — 私钥块", () => {
  it("替换完整 PEM 私钥块（含块体），不残留 base64 行", () => {
    const input = [
      "配置如下：",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234567890abcdefGHIJKLMNOP",
      "qrstuvwxyz+/ABCDEF==",
      "-----END RSA PRIVATE KEY-----",
      "结束",
    ].join("\n");

    const { text, hits } = redactSensitive(input);

    expect(text).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(text).not.toContain("MIIEowIBAAKCAQEA");
    expect(text).toContain(REDACTED);
    expect(text).toContain("结束");
    expect(hits).toEqual([{ type: "private_key", count: 1 }]);
  });

  it("替换被截断、没有 END 的私钥块", () => {
    const input = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA";

    const { text } = redactSensitive(input);

    expect(text).not.toContain("OPENSSH PRIVATE KEY");
    expect(text).not.toContain("b3BlbnNzaC1rZXktdjEAAAAA");
  });
});

describe("redactSensitive — 平台令牌", () => {
  it("命中 sk- 令牌", () => {
    const { text, hits } = redactSensitive("key=sk-abcdefghijklmnopqrstuvwxyz0123 done");

    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(summarizeHits(hits)).toEqual({ provider_token: 1 });
  });

  it("命中 AWS AKIA / GitHub ghp_ / Slack xoxb- 令牌", () => {
    const input = [
      "AKIA IOSFODNN7EXAMPLE".replace(" ", ""),
      "ghp_0123456789abcdefghijklmnopqrstuvwx",
      "xoxb-FAKEWORKSPACE12",
    ].join(" ");

    const { text, hits } = redactSensitive(input);

    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).not.toContain("ghp_0123456789abcdefghijklmnopqrstuvwx");
    expect(text).not.toContain("xoxb-FAKEWORKSPACE12");
    expect(hits).toEqual([{ type: "provider_token", count: 3 }]);
  });

  it("命中 JWT（eyJ 三段 base64url）", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

    const { text, hits } = redactSensitive(`token ${jwt} end`);

    expect(text).not.toContain(jwt);
    expect(text).toContain(REDACTED);
    expect(hits).toEqual([{ type: "jwt", count: 1 }]);
  });
});

describe("redactSensitive — .env 行", () => {
  it("替换敏感键的值，保留键名", () => {
    const input = [
      "POSTGRES_PASSWORD=hunter2",
      "JWT_SECRET: s3cr3t-value",
      "DATABASE_URL=postgres://user:pw@db.internal:5432/app",
      "SUPABASE_ACCESS_TOKEN=abc123def456",
    ].join("\n");

    const { text, hits } = redactSensitive(input);

    expect(text).toContain(`POSTGRES_PASSWORD=${REDACTED}`);
    expect(text).toContain(`JWT_SECRET: ${REDACTED}`);
    expect(text).toContain(`DATABASE_URL=${REDACTED}`);
    expect(text).toContain(`SUPABASE_ACCESS_TOKEN=${REDACTED}`);
    for (const leaked of ["hunter2", "s3cr3t-value", "pw@db.internal", "abc123def456"]) {
      expect(text).not.toContain(leaked);
    }
    expect(hits).toEqual([{ type: "env_assignment", count: 4 }]);
  });

  it("保留引号，使脱敏后的 JSON 仍然可解析", () => {
    const input = JSON.stringify({ OPENAI_SECRET: "sk-should-not-leak-value", keep: 1 });

    const { text } = redactSensitive(input);

    expect(text).not.toContain("sk-should-not-leak-value");
    expect(JSON.parse(text)).toEqual({ OPENAI_SECRET: REDACTED, keep: 1 });
  });

  it("不误伤对密钥的引用（process.env 等）", () => {
    const input = "const API_KEY = process.env.OPENAI_KEY;";

    const { text, hits } = redactSensitive(input);

    expect(text).toBe(input);
    expect(hits).toEqual([]);
  });
});

describe("redactSensitive — Cookie 头", () => {
  it("整行替换 Cookie: 与 Set-Cookie:", () => {
    const input = [
      "GET / HTTP/1.1",
      "Cookie: session=abc123; csrftoken=zzz",
      "Set-Cookie: session=abc123; HttpOnly; Secure",
      "Host: example.com",
    ].join("\n");

    const { text, hits } = redactSensitive(input);

    expect(text).not.toContain("session=abc123");
    expect(text).not.toContain("csrftoken=zzz");
    expect(text).toContain(`Cookie: ${REDACTED}`);
    expect(text).toContain(`Set-Cookie: ${REDACTED}`);
    // 非敏感行必须原样保留
    expect(text).toContain("GET / HTTP/1.1");
    expect(text).toContain("Host: example.com");
    expect(hits).toEqual([{ type: "cookie_header", count: 2 }]);
  });

  it("整行替换 Authorization: Bearer 头", () => {
    const input = "Authorization: Bearer abc.def.ghi\nX-Trace: 1";

    const { text, hits } = redactSensitive(input);

    expect(text).not.toContain("abc.def.ghi");
    expect(text).toContain(`Authorization: Bearer ${REDACTED}`);
    expect(text).toContain("X-Trace: 1");
    expect(hits).toEqual([{ type: "authorization_header", count: 1 }]);
  });
});

describe("redactSensitive — 6 位验证码只在明确上下文里遮", () => {
  it("上下文词在前时遮住数字", () => {
    const input = "您的验证码是 483920，5 分钟内有效";

    const { text, hits } = redactSensitive(input);

    expect(text).not.toContain("483920");
    expect(text).toContain(`验证码是 ${REDACTED}`);
    expect(hits).toEqual([{ type: "otp_code", count: 1 }]);
  });

  it("英文 code / OTP 上下文同样命中", () => {
    expect(redactSensitive("Your OTP is 730451").text).not.toContain("730451");
    expect(redactSensitive("verification code: 918273").text).not.toContain("918273");
    expect(redactSensitive("code 445566").text).not.toContain("445566");
  });

  it("没有上下文词的普通 6 位数字不遮", () => {
    const input = "订单号 123456 已发货，金额 3000 元，时间 2026-10-29";

    const { text, hits } = redactSensitive(input);

    expect(text).toBe(input);
    expect(hits).toEqual([]);
  });
});

describe("redactSensitive — 普通文本零误伤", () => {
  it("普通数字、日期、URL、代码片段、中文散文均原样保留", () => {
    const samples = [
      "编号 123456，端口 8080，比例 3.1415926",
      "见 https://example.com/v1/items/987654321?page=2&tokenizer=off",
      "const token = await getToken();\nconst OTP_LENGTH = 6;\nfor (let i = 0; i < 6; i++) {}",
      "把 README 里的 DATABASE_URL 环境变量解释一下",
      "会议定在 2026-10-29 14:30，参会 45 人",
      "sk-short is not a token",
    ];

    for (const sample of samples) {
      const { text, hits } = redactSensitive(sample);
      expect(text).toBe(sample);
      expect(hits).toEqual([]);
    }
  });
});

describe("redactSensitive — 幂等", () => {
  it("重复处理不重复膨胀，第二次无命中", () => {
    const input = [
      "PASSWORD=hunter2",
      "Cookie: session=abc123",
      "key sk-abcdefghijklmnopqrstuvwxyz0123",
      "验证码 483920",
    ].join("\n");

    const first = redactSensitive(input);
    const second = redactSensitive(first.text);

    expect(first.hits.length).toBeGreaterThan(0);
    expect(second.text).toBe(first.text);
    expect(second.hits).toEqual([]);
    // 三次处理仍然稳定
    expect(redactSensitive(second.text).text).toBe(first.text);
  });
});

describe("redactSensitive — 命中元数据", () => {
  it("按类型聚合计数，且不含原文片段", () => {
    const input = [
      "PASSWORD=hunter2",
      "API_KEY=abcd1234",
      "Cookie: session=abc123",
      "sk-abcdefghijklmnopqrstuvwxyz0123",
    ].join("\n");

    const { hits } = redactSensitive(input);

    expect(hits).toEqual([
      { type: "cookie_header", count: 1 },
      { type: "env_assignment", count: 2 },
      { type: "provider_token", count: 1 },
    ]);
    expect(countHits(hits)).toBe(4);
    // 元数据本身不得携带任何密钥原文
    const serialized = JSON.stringify(hits);
    for (const leaked of ["hunter2", "abcd1234", "abc123", "sk-abcdef"]) {
      expect(serialized).not.toContain(leaked);
    }
  });
});

describe("redactContent / redactMessages", () => {
  it("处理多段内容块时保留结构，只替换文本", () => {
    const content = [
      { type: "text", text: "SECRET=xyz789" },
      { type: "image", source_type: "base64", data: "AAAA" },
    ];

    const result = redactContent(content);

    expect(result.content).toEqual([
      { type: "text", text: `SECRET=${REDACTED}` },
      { type: "image", source_type: "base64", data: "AAAA" },
    ]);
    expect(result.hits).toEqual([{ type: "env_assignment", count: 1 }]);
  });

  it("工具返回的 JSON 字符串被脱敏后仍可解析", () => {
    const toolPayload = JSON.stringify({
      ok: true,
      headers: { "content-type": "application/json" },
      ACCESS_TOKEN: "tok_live_123456",
      note: "Cookie: session=abc123",
    });

    const result = redactContent(toolPayload);

    expect(result.content).not.toContain("tok_live_123456");
    expect(result.content).not.toContain("session=abc123");
    expect(JSON.parse(result.content as string).ok).toBe(true);
  });

  it("redactMessages 就地脱敏并汇总命中", () => {
    const messages = [
      new SystemMessage("system prompt with PASSWORD=leet"),
      new HumanMessage("我的验证码是 552201"),
    ];

    const hits = redactMessages(messages);

    expect(String(messages[0]!.content)).toContain(`PASSWORD=${REDACTED}`);
    expect(String(messages[1]!.content)).not.toContain("552201");
    expect(summarizeHits(hits)).toEqual({ env_assignment: 1, otp_code: 1 });
  });
});

describe("promptRedactionMiddleware — 模型输入收口点", () => {
  it("在交给模型前脱敏 messages 与 systemPrompt（只含类型与计数日志）", async () => {
    const received: { messages: unknown[]; systemPrompt?: string }[] = [];
    const handler = async (request: {
      messages: unknown[];
      systemPrompt?: string;
    }) => {
      received.push(request);
      return new HumanMessage("ok");
    };

    const request = {
      messages: [new HumanMessage("DB_PASSWORD=hunter2 请帮我看看")],
      systemPrompt: "You are helpful. Use COOKIE_TOKEN=abc to call the api.",
    };

    await (
      promptRedactionMiddleware as unknown as {
        wrapModelCall: (req: unknown, fn: unknown) => Promise<unknown>;
      }
    ).wrapModelCall(request, handler);

    expect(received).toHaveLength(1);
    const forwarded = received[0]!;
    expect(String((forwarded.messages[0] as { content: unknown }).content)).not.toContain(
      "hunter2",
    );
    expect(String((forwarded.messages[0] as { content: unknown }).content)).toContain(
      REDACTED,
    );
    expect(forwarded.systemPrompt).not.toContain("abc to call");
    expect(forwarded.systemPrompt).toContain(REDACTED);
  });

  it("无命中的请求原样透传（不改写内容）", async () => {
    const message = new HumanMessage("帮我画一张海报");
    const received: unknown[] = [];
    const handler = async (request: unknown) => {
      received.push(request);
      return new HumanMessage("ok");
    };

    await (
      promptRedactionMiddleware as unknown as {
        wrapModelCall: (req: unknown, fn: unknown) => Promise<unknown>;
      }
    ).wrapModelCall({ messages: [message] }, handler);

    expect(received).toHaveLength(1);
    expect(String(message.content)).toBe("帮我画一张海报");
  });

  it("中间件确实注册进 createDeepAgent（防止接线被删掉后静默失效）", () => {
    const source = readFileSync(join(import.meta.dirname, "deep-agent.ts"), "utf8");

    expect(source).toMatch(
      /middleware:\s*\[\s*promptRedactionMiddleware/,
    );
  });
});
