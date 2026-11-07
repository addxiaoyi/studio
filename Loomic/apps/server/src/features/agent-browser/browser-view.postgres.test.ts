import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserViewStore } from "./store.js";
import { registerAgentBrowserRoutes } from "../../http/agent-browser.js";

const url = process.env.HELT_TEST_DATABASE_URL;
const schema = `browser_view_${randomUUID().replaceAll("-", "")}`;
let admin: Pool, db: Pool, root: string;
const userId = randomUUID(),
  workspaceId = randomUUID(),
  stranger = randomUUID();
const owner = { userId, workspaceId };
const app = Fastify();

describe.skipIf(!url)("private Agent browser sessions", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url!).hostname))
      throw new Error("Browser tests require a local database.");
    admin = new Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    db = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    root = await mkdtemp(join(tmpdir(), "loomic-browser-view-"));
    await db.query(`create table workspaces(id uuid primary key);create table app_users(id uuid primary key);
      create table agent_connector_permissions(workspace_id uuid,user_id uuid,connector_id text,enabled boolean);`);
    await db.query("insert into workspaces values($1)", [workspaceId]);
    await db.query("insert into app_users values($1),($2)", [userId, stranger]);
    const sql = await readFile(
      new URL(
        "../../local-db/migrations/20261107000001_agent_browser_views.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(sql);
    await db.query(sql);
    registerAgentBrowserRoutes(app, {
      db,
      storageRoot: root,
      enabled: true,
      auth: {
        authenticate: async (request: FastifyRequest) => {
          const token = request.headers.authorization;
          return token === `Bearer ${userId}`
            ? { id: userId }
            : token === `Bearer ${stranger}`
              ? { id: stranger }
              : null;
        },
      } as never,
      viewerService: {
        ensureViewer: async () => ({ workspace: { id: workspaceId } }),
      } as never,
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db?.end();
    if (admin) {
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function create() {
    const store = browserViewStore(db, root);
    const id = await store.create({
      ...owner,
      taskId: randomUUID(),
      engine: "chromix",
      name: "Browser test",
    });
    return { id, store };
  }
  const auth = { authorization: `Bearer ${userId}` },
    foreign = { authorization: `Bearer ${stranger}` };

  it("limits previews and controls to their owner and omits URL secrets", async () => {
    const { id, store } = await create();
    const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 255, 217]);
    await store.writeFrame(id, bytes, {
      url: "https://example.test/path?token=secret#fragment",
      title: "A page",
      width: 1280,
      height: 720,
    });
    expect((await app.inject("/api/agent/browser/sessions")).statusCode).toBe(
      401,
    );
    const list = await app.inject({
      url: "/api/agent/browser/sessions",
      headers: auth,
    });
    expect(list.json().sessions[0]).toMatchObject({
      url: "https://example.test/path",
      engine: "chromix",
      frameRevision: 1,
    });
    expect(
      (
        await app.inject({
          url: "/api/agent/browser/sessions",
          headers: foreign,
        })
      ).json().sessions,
    ).toEqual([]);
    const frame = await app.inject({
      url: `/api/agent/browser/sessions/${id}/frame`,
      headers: auth,
    });
    expect(frame.rawPayload).toEqual(bytes);
    expect(frame.headers["cache-control"]).toBe("private, no-store");
    expect(
      (
        await app.inject({
          url: `/api/agent/browser/sessions/${id}/frame`,
          headers: foreign,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/agent/browser/sessions/${id}/control`,
          method: "POST",
          headers: foreign,
          payload: { control: "paused" },
        })
      ).statusCode,
    ).toBe(404);
  });
  it("pauses only a live session and refuses stale or completed resumes", async () => {
    const { id, store } = await create();
    const control = (value: string) =>
      app.inject({
        url: `/api/agent/browser/sessions/${id}/control`,
        method: "POST",
        headers: auth,
        payload: { control: value },
      });
    expect((await control("paused")).statusCode).toBe(200);
    expect(await store.checkpoint(id)).toBe("paused");
    expect((await control("agent")).statusCode).toBe(200);
    expect(await store.checkpoint(id)).toBe("agent");
    await db.query(
      "update agent_browser_views set heartbeat_at=now()-interval '20 seconds' where id=$1",
      [id],
    );
    expect((await store.get(id, owner))?.state).toBe("interrupted");
    expect((await control("agent")).statusCode).toBe(409);
    await store.finish(id, "completed", "Finished");
    expect((await control("agent")).statusCode).toBe(409);
    expect((await control("click")).statusCode).toBe(400);
  });
  it("revoking the connector stops preview reads and control requests", async () => {
    const { id } = await create();
    await db.query(
      "insert into agent_connector_permissions values($1,$2,'isolated-browser',false)",
      [workspaceId, userId],
    );
    try {
      expect(
        (
          await app.inject({
            url: "/api/agent/browser/sessions",
            headers: auth,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: `/api/agent/browser/sessions/${id}/frame`,
            headers: auth,
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await db.query(
        "delete from agent_connector_permissions where user_id=$1",
        [userId],
      );
    }
  });
  it("expires the private preview file without touching unrelated assets", async () => {
    const { id, store } = await create();
    await store.writeFrame(id, Buffer.from([255, 216, 255]), {
      url: "https://example.test",
      title: "Page",
      width: 1280,
      height: 720,
    });
    await db.query(
      "update agent_browser_views set expires_at=now()-interval '1 second' where id=$1",
      [id],
    );
    expect(await store.get(id, owner)).toBeNull();
    expect(await store.prune()).toBe(1);
    await expect(
      stat(join(root, "agent-browser-views", id)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await store.list(owner)).not.toHaveLength(0);
  });
});
