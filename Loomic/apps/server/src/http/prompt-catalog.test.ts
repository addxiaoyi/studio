import Fastify from "fastify";
import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { registerLocalGrowthRoutes } from "./local-growth.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function catalog(bodyLimit?: number) {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const app = Fastify({ ...(bodyLimit === undefined ? {} : { bodyLimit }) });
  apps.push(app);
  registerLocalGrowthRoutes(app, {
    db: { query } as unknown as Pool,
    auth: {
      authenticate: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        email: "test@example.invalid",
        accessToken: "fixture",
        userMetadata: {},
      }),
    },
    viewerService: { ensureViewer: vi.fn() },
  });
  return { app, query };
}

it.each([
  { type: "application/json", body: "{", status: 400 },
  { type: "application/xml", body: "<prompt />", status: 415 },
  {
    type: "application/json",
    body: JSON.stringify({ text: "x".repeat(150) }),
    status: 413,
  },
])(
  "preserves HTTP $status for an invalid request body",
  async ({ type, body, status }) => {
    const { app, query } = catalog(128);
    const reply = await app.inject({
      method: "POST",
      url: "/api/prompts/22222222-2222-4222-8222-222222222222/view",
      headers: { "content-type": type },
      payload: body,
    });
    expect(reply.statusCode).toBe(status);
    expect(reply.json()).toMatchObject({
      ok: false,
      error: { code: "invalid_prompt_request" },
    });
    expect(query).not.toHaveBeenCalled();
  },
);

it.each([
  "limit=NaN",
  "limit=Infinity",
  "limit=1.5",
  "limit=0",
  "limit=101",
  "offset=-1",
  "offset=Infinity",
  "offset=1.2",
  "limit=1&limit=2",
  "q=one&q=two",
])("rejects invalid prompt query %s before database access", async (search) => {
  const { app, query } = catalog();
  const reply = await app.inject(`/api/prompts?${search}`);
  expect(reply.statusCode).toBe(400);
  expect(reply.json()).toMatchObject({
    ok: false,
    error: { code: "invalid_prompt_query" },
  });
  expect(query).not.toHaveBeenCalled();
});

it("does not claim another page exists when the last page is exactly full", async () => {
  const { app, query } = catalog();
  query
    .mockResolvedValueOnce({ rows: [{ id: "last" }] })
    .mockResolvedValueOnce({ rows: [] });
  const reply = await app.inject("/api/prompts?limit=1&offset=2");
  expect(reply.statusCode).toBe(200);
  expect(reply.json().pagination).toEqual({
    limit: 1,
    offset: 2,
    hasMore: false,
  });
});

it("returns only the page while reporting a real additional row", async () => {
  const { app, query } = catalog();
  query
    .mockResolvedValueOnce({ rows: [{ id: "current" }, { id: "next" }] })
    .mockResolvedValueOnce({ rows: [] });
  const reply = await app.inject(
    "/api/prompts?limit=1&q=%20coat%20&category=photo",
  );
  expect(reply.statusCode).toBe(200);
  expect(reply.json()).toMatchObject({
    ok: true,
    data: [{ id: "current" }],
    pagination: { hasMore: true },
  });
  expect(query.mock.calls[0]?.[1]).toEqual(["coat", "photo", 2, 0]);
});

it.each(["view", "favorite"])(
  "rejects malformed prompt ids for %s",
  async (operation) => {
    const { app, query } = catalog();
    const reply = await app.inject({
      method: "POST",
      url: `/api/prompts/not-a-uuid/${operation}`,
    });
    expect(reply.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  },
);

it("returns not found when a viewed prompt is unpublished, deleted or missing", async () => {
  const { app } = catalog();
  const reply = await app.inject({
    method: "POST",
    url: "/api/prompts/22222222-2222-4222-8222-222222222222/view",
  });
  expect(reply.statusCode).toBe(404);
});
