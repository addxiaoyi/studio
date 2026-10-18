import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { ProjectServiceError } from "../features/projects/project-service.js";
import { registerProjectRoutes } from "./projects.js";

function buildProjectService(restoreProject: ReturnType<typeof vi.fn>) {
  return {
    archiveEmptyProject: vi.fn().mockResolvedValue(false),
    archiveProject: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    listArchivedProjects: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
    restoreProject,
    saveThumbnail: vi.fn(),
    updateProject: vi.fn(),
  } as never;
}

async function createApp(projectService: never) {
  const app = Fastify();
  await registerProjectRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1", accessToken: "token", email: "user@example.com", userMetadata: {} }) },
    projectService,
  });
  await app.ready();
  return app;
}

describe("project archive routes", () => {
  it("restores an archived project", async () => {
    const restoreProject = vi.fn().mockResolvedValue(undefined);
    const app = await createApp(buildProjectService(restoreProject));

    const response = await app.inject({ method: "POST", url: "/api/projects/project-1/restore" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ restored: true });
    expect(restoreProject).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }), "project-1");
    await app.close();
  });

  it("returns not found when the archived project cannot be restored", async () => {
    const restoreProject = vi.fn().mockRejectedValue(new ProjectServiceError("project_not_found", "Archived project not found.", 404));
    const app = await createApp(buildProjectService(restoreProject));

    const response = await app.inject({ method: "POST", url: "/api/projects/project-1/restore" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "project_not_found" } });
    await app.close();
  });

  it("does not create a second restore when the project is already active", async () => {
    const restoreProject = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ProjectServiceError("project_not_found", "Archived project not found.", 404));
    const app = await createApp(buildProjectService(restoreProject));

    const first = await app.inject({ method: "POST", url: "/api/projects/project-1/restore" });
    const second = await app.inject({ method: "POST", url: "/api/projects/project-1/restore" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(404);
    expect(restoreProject).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
