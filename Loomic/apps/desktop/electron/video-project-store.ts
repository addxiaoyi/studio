import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { videoProjectSchema, type VideoProject } from "@helstera/shared";

const PROJECTS_DIRECTORY = "video-projects";

function projectDirectory(projectsRoot: string, projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error("Invalid video project id.");
  return join(projectsRoot, projectId);
}

export class VideoProjectStore {
  private readonly root: string;

  constructor(userDataPath: string) {
    if (!userDataPath) throw new Error("A user data path is required.");
    this.root = join(userDataPath, PROJECTS_DIRECTORY);
  }

  async save(project: VideoProject) {
    const parsed = videoProjectSchema.parse(project);
    const directory = projectDirectory(this.root, parsed.projectId);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `project.${randomUUID()}.tmp`);
    const target = join(directory, "project.json");
    await writeFile(temporary, JSON.stringify(parsed, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
    return parsed;
  }

  async load(projectId: string) {
    const target = join(projectDirectory(this.root, projectId), "project.json");
    try {
      return videoProjectSchema.parse(JSON.parse(await readFile(target, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Video project was not found.", { cause: error });
      throw new Error("Video project could not be read.", { cause: error });
    }
  }

  async list() {
    let entries;
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const projects: VideoProject[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
      try { projects.push(await this.load(entry.name)); } catch { /* Ignore incomplete recovery folders. */ }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async remove(projectId: string) {
    await rm(projectDirectory(this.root, projectId), { recursive: true, force: true });
  }
}
