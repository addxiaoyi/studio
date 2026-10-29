import { describe, expect, it, vi } from "vitest";

import { createLocalProjectService, resolveProjectSource } from "./project-service.js";

const user = {
  id: "user-1",
  accessToken: "token",
  email: "user@example.com",
  userMetadata: {},
};

type ClientCall = { sql: string; params: unknown[] | undefined };

function buildCreateDb(projectRow: Record<string, unknown>) {
  const clientCalls: ClientCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      clientCalls.push({ sql, params });
      if (sql.startsWith("insert into projects")) return { rows: [projectRow] };
      if (sql.startsWith("insert into canvases")) {
        return { rows: [{ id: "canvas-1", name: "Main Canvas", is_primary: true }] };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("select id, name from workspaces")) {
        return { rows: [{ id: "workspace-1", name: "Personal Workspace" }] };
      }
      return { rows: [], rowCount: 1 };
    }),
    connect: vi.fn(async () => client),
  };
  return { db, clientCalls };
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Goal",
    slug: "goal",
    description: null,
    source: "manual",
    brand_kit_id: null,
    created_at: new Date("2026-10-28T00:00:00.000Z"),
    updated_at: new Date("2026-10-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("local project source", () => {
  it("persists source='home' for the home auto-create path and returns it", async () => {
    const { db, clientCalls } = buildCreateDb(projectRow({ source: "home" }));
    const service = createLocalProjectService(db as never);

    const project = await service.createProject(user, { name: "Goal", source: "home" });

    const insert = clientCalls.find((call) => call.sql.startsWith("insert into projects"));
    expect(insert).toBeDefined();
    expect(insert?.sql).toContain("source");
    // The value must travel as a bound parameter, in the column order used by
    // the insert: workspace, user, name, slug, description, source.
    expect(insert?.params?.[5]).toBe("home");
    expect(project.source).toBe("home");
  });

  it("falls back to 'manual' for every caller that does not state a source", async () => {
    const { db, clientCalls } = buildCreateDb(projectRow());
    const service = createLocalProjectService(db as never);

    const project = await service.createProject(user, { name: "Untitled" });

    const insert = clientCalls.find((call) => call.sql.startsWith("insert into projects"));
    expect(insert?.params?.[5]).toBe("manual");
    expect(project.source).toBe("manual");
  });

  it("never upgrades an unknown source into 'home'", async () => {
    const { db, clientCalls } = buildCreateDb(projectRow());
    const service = createLocalProjectService(db as never);

    // A stale/typo'd caller value must be normalized, not stored raw.
    const project = await service.createProject(user, {
      name: "Goal",
      source: "legacy" as never,
    });

    const insert = clientCalls.find((call) => call.sql.startsWith("insert into projects"));
    expect(insert?.params?.[5]).toBe("manual");
    expect(project.source).toBe("manual");
  });

  it("reads source back for listed projects and defaults missing rows to 'manual'", async () => {
    const rows = [
      { ...projectRow({ id: "project-home", source: "home" }), thumbnail_path: null, canvas_id: "canvas-1", canvas_name: "Main Canvas", is_primary: true },
      // A row read from a database that predates the column (or an older
      // payload replayed from cache) must not render as an empty badge.
      { ...projectRow({ id: "project-legacy", source: undefined }), thumbnail_path: null, canvas_id: "canvas-2", canvas_name: "Main Canvas", is_primary: true },
    ];
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("select id, name from workspaces")) {
          return { rows: [{ id: "workspace-1", name: "Personal Workspace" }] };
        }
        if (sql.includes("from projects p join canvases c")) return { rows };
        return { rows: [], rowCount: 1 };
      }),
    };
    const service = createLocalProjectService(db as never, "C:/uploads");

    const projects = await service.listProjects(user);

    expect(projects.map((project) => project.source)).toEqual(["home", "manual"]);
    // Guard against a listing query that forgets the column: mapping would then
    // silently report every project as 'manual'.
    const listSql = String(db.query.mock.calls[2]?.[0]);
    expect(listSql).toContain("p.source");
  });
});

describe("resolveProjectSource", () => {
  it("maps known values through and everything else to manual", () => {
    expect(resolveProjectSource("home")).toBe("home");
    expect(resolveProjectSource("import")).toBe("import");
    expect(resolveProjectSource("manual")).toBe("manual");
    expect(resolveProjectSource(undefined)).toBe("manual");
    expect(resolveProjectSource(null)).toBe("manual");
    expect(resolveProjectSource("HOME")).toBe("manual");
    expect(resolveProjectSource(42)).toBe("manual");
  });
});
