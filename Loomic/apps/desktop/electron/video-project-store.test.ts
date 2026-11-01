import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { VideoProjectStore } from "./video-project-store.js";

it("writes and updates projects inside the chosen user data directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "helstera-video-test-"));
  try {
    const store = new VideoProjectStore(root);
    const project = { projectId: "00000000-0000-4000-8000-000000000001", title: "Draft", assets: [], clips: [], actions: [], revision: 0, updatedAt: "2026-11-01T00:00:00.000Z" };
    await store.save(project);
    await store.save({ ...project, revision: 1 });
    expect(await store.load(project.projectId)).toMatchObject({ title: "Draft", revision: 1 });
    expect(JSON.parse(await readFile(join(root, "video-projects", project.projectId, "project.json"), "utf8"))).toMatchObject({ revision: 1 });
    expect(await store.list()).toHaveLength(1);
    await expect(store.load("../other")).rejects.toThrow("Invalid video project id");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
