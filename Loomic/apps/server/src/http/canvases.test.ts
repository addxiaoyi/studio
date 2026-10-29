import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { createLocalCanvasService } from "../local-db/canvas-service.js";
import {
  formatCanvasEtag,
  parseIfMatchVersion,
  registerCanvasRoutes,
} from "./canvases.js";

const user = {
  id: "user-1",
  accessToken: "token",
  email: "user@example.test",
  userMetadata: {},
};

type CanvasRow = {
  id: string;
  name: string;
  project_id: string;
  content: unknown;
  version: number;
};

/**
 * 一个「只认识 canvases 表这几条 SQL」的有状态假库。
 * 关键点：它真的会在版本不匹配时**不写 content**，所以「数据库未变」是可以断言的，
 * 而不是靠断言 mock 调用次数假装。
 */
function createFakeDb(input: { version?: number; content?: unknown } = {}) {
  const state: { row: CanvasRow | null } = {
    row: {
      id: "canvas-1",
      name: "Canvas",
      project_id: "project-1",
      content: input.content ?? {
        elements: [{ id: "original", type: "rectangle" }],
        appState: {},
        files: {},
      },
      version: input.version ?? 1,
    },
  };
  let beforeUpdate: (() => void) | null = null;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("select c.version from canvases c")) {
      return state.row
        ? { rows: [{ version: state.row.version }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (
      sql.includes("select c.id, c.name, c.project_id, c.content, c.version")
    ) {
      return state.row
        ? { rows: [{ ...state.row }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes("set content = $1, version = c.version + 1")) {
      const [json, , , expectedVersion] = params;
      // 模拟「读版本」与「写回」之间被另一个窗口抢先落库。
      beforeUpdate?.();
      if (!state.row) return { rows: [], rowCount: 0 };
      // 假库只按 SQL 文本执行它真正写下的条件：SQL 里没有 `c.version = $4`，
      // 就当作无条件覆盖。否则「把 CAS 条件删掉」这种回退不会被测出来。
      const guardsVersion = /c\.version = \$4/u.test(sql);
      if (guardsVersion && state.row.version !== expectedVersion) {
        return { rows: [], rowCount: 0 };
      }
      state.row = {
        ...state.row,
        content: JSON.parse(String(json)),
        version: state.row.version + 1,
      };
      return { rows: [{ version: state.row.version }], rowCount: 1 };
    }
    throw new Error(`fake db: unexpected SQL: ${sql}`);
  });

  return {
    db: { query } as never,
    query,
    state,
    setBeforeUpdate(next: (() => void) | null) {
      beforeUpdate = next;
    },
    get row(): CanvasRow | null {
      return state.row;
    },
    setVersion(version: number) {
      if (state.row) state.row = { ...state.row, version };
    },
  };
}

async function buildApi(options: { version?: number; content?: unknown } = {}) {
  const fake = createFakeDb(options);
  const app = Fastify();
  const canvasService = createLocalCanvasService(fake.db);
  await registerCanvasRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue(user) } as never,
    canvasService,
  });
  return { app, fake, canvasService };
}

const baseUrl = "/api/canvases/canvas-1";
const authHeaders = { authorization: "Bearer session" };

const mergedContent = {
  elements: [{ id: "local-shape", type: "rectangle" }],
  appState: { zoom: 1 },
  files: {},
};

describe("canvas version parse", () => {
  it("accepts weak and strong ETag forms and rejects garbage", () => {
    expect(parseIfMatchVersion('W/"3"')).toEqual({ kind: "match", version: 3 });
    expect(parseIfMatchVersion('"3"')).toEqual({ kind: "match", version: 3 });
    expect(parseIfMatchVersion("*")).toEqual({ kind: "match", version: null });
    expect(parseIfMatchVersion(undefined)).toEqual({ kind: "absent" });
    expect(parseIfMatchVersion("")).toEqual({ kind: "absent" });
    // 反证：乱写的 If-Match 不能被悄悄当成「老客户端」放行。
    expect(parseIfMatchVersion("v3")).toEqual({ kind: "invalid" });
    expect(parseIfMatchVersion('W/"0"')).toEqual({ kind: "invalid" });
    expect(formatCanvasEtag(4)).toBe('W/"4"');
  });
});

describe("canvas optimistic concurrency", () => {
  it("serves the current version and bumps it on every accepted save", async () => {
    const { app, fake } = await buildApi();
    const first = await app.inject({
      method: "GET",
      url: baseUrl,
      headers: authHeaders,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(1);
    expect(first.headers.etag).toBe('W/"1"');

    const saved = await app.inject({
      method: "PUT",
      url: baseUrl,
      headers: { ...authHeaders, "if-match": first.headers.etag as string },
      payload: { content: mergedContent },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ ok: true, version: 2 });
    expect(saved.headers.etag).toBe('W/"2"');
    expect(fake.row?.version).toBe(2);
    expect(fake.row?.content).toEqual(mergedContent);

    const second = await app.inject({
      method: "GET",
      url: baseUrl,
      headers: authHeaders,
    });
    expect(second.json().version).toBe(2);
    expect(second.json().canvas.content).toEqual(mergedContent);

    await app.close();
  });

  it("rejects a stale version with 409 and leaves the stored content untouched", async () => {
    const { app, fake } = await buildApi();
    const staleEtag = (
      await app.inject({ method: "GET", url: baseUrl, headers: authHeaders })
    ).headers.etag as string;

    // 另一个标签页先存了一次：数据库已经走到 version 2。
    fake.setVersion(2);
    const originalContent = fake.row?.content;

    const response = await app.inject({
      method: "PUT",
      url: baseUrl,
      headers: { ...authHeaders, "if-match": staleEtag },
      payload: { content: mergedContent },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "canvas_version_conflict",
        message:
          "Canvas was modified in another window. Reload or overwrite explicitly to continue.",
      },
      version: 2,
    });
    expect(response.headers.etag).toBe('W/"2"');

    // 数据库未变：版本没涨，内容还是别人的。
    expect(fake.row?.version).toBe(2);
    expect(fake.row?.content).toEqual(originalContent);
    expect(fake.row?.content).not.toEqual(mergedContent);

    // 再读一次确认读回的就是旧值。
    const reread = await app.inject({
      method: "GET",
      url: baseUrl,
      headers: authHeaders,
    });
    expect(reread.json().version).toBe(2);
    expect(reread.json().canvas.content).toEqual(originalContent);

    await app.close();
  });

  it("detects a writer that lands between the version read and the update", async () => {
    const { app, fake } = await buildApi();
    // 读到 version 1 之后、写回之前，另一个窗口把版本推到 7：
    // 只有 SQL 里的 `and c.version = $4` 能挡住这次写入。
    fake.setBeforeUpdate(() => {
      fake.setBeforeUpdate(null);
      fake.setVersion(7);
    });
    const originalContent = fake.row?.content;

    const response = await app.inject({
      method: "PUT",
      url: baseUrl,
      headers: { ...authHeaders, "if-match": 'W/"1"' },
      payload: { content: mergedContent },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().version).toBe(7);
    expect(fake.row?.version).toBe(7);
    expect(fake.row?.content).toEqual(originalContent);

    await app.close();
  });

  it("still saves for legacy clients that send no version at all", async () => {
    const { app, fake } = await buildApi();

    const response = await app.inject({
      method: "PUT",
      url: baseUrl,
      headers: authHeaders,
      payload: { content: mergedContent },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, version: 2 });
    expect(fake.row?.version).toBe(2);
    expect(fake.row?.content).toEqual(mergedContent);

    await app.close();
  });

  it("returns 400 for a malformed If-Match instead of silently saving", async () => {
    const { app, fake } = await buildApi();

    const response = await app.inject({
      method: "PUT",
      url: baseUrl,
      headers: { ...authHeaders, "if-match": "not-a-version" },
      payload: { content: mergedContent },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_if_match");
    expect(fake.row?.version).toBe(1);
    expect(fake.row?.content).not.toEqual(mergedContent);

    await app.close();
  });

  it("404s for a canvas the user cannot see, without inventing a version", async () => {
    const { app, fake } = await buildApi();
    fake.state.row = null;

    const get = await app.inject({
      method: "GET",
      url: baseUrl,
      headers: authHeaders,
    });
    expect(get.statusCode).toBe(404);

    const put = await app.inject({
      method: "PUT",
      url: baseUrl,
      headers: { ...authHeaders, "if-match": 'W/"1"' },
      payload: { content: mergedContent },
    });
    expect(put.statusCode).toBe(404);

    await app.close();
  });
});
