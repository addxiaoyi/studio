import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalWorkspace } from "./local-workspace.js";

const temporaryRoots: string[] = [];

async function createWorkspace() {
  const parent = await mkdtemp(join(tmpdir(), "helstera-workspace-test-"));
  const root = join(parent, "project");
  const snapshots = join(parent, "snapshots");
  await mkdir(root);
  temporaryRoots.push(parent);
  return { root, snapshots, workspace: await LocalWorkspace.open(root, snapshots) };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("LocalWorkspace", () => {
  it("writes files with an external snapshot and restores the previous content", async () => {
    const { root, workspace } = await createWorkspace();
    await writeFile(join(root, "app.ts"), "export const value = 1;\n");

    const saved = await workspace.write("app.ts", "export const value = 2;\n");

    expect((await workspace.read("app.ts")).content).toContain("value = 2");
    expect(await workspace.restore(saved.snapshotId)).toEqual({ path: "app.ts", restored: true });
    expect((await workspace.read("app.ts")).content).toContain("value = 1");
  });

  it("removes a newly created file when its snapshot is restored", async () => {
    const { root, workspace } = await createWorkspace();
    const saved = await workspace.write("new.ts", "export {};\n");

    await workspace.restore(saved.snapshotId);

    await expect(readFile(join(root, "new.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversal, secret files and binary editor reads", async () => {
    const { root, workspace } = await createWorkspace();
    await writeFile(join(root, ".env.local"), "SECRET=value");
    await writeFile(join(root, "image.png"), Buffer.from([0, 1, 2, 3]));

    await expect(workspace.read("../outside.txt")).rejects.toThrow("traversal");
    await expect(workspace.read(".env.local")).rejects.toThrow("Credential and secret");
    await expect(workspace.write(".ssh/id_rsa", "key")).rejects.toThrow("Credential and secret");
    await expect(workspace.read("image.png")).rejects.toThrow("Binary files");
  });

  it("hides dependency and git internals from the project tree", async () => {
    const { root, workspace } = await createWorkspace();
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "src", "main.ts"), "export {};\n");
    await writeFile(join(root, "node_modules", "dependency", "index.js"), "hidden");

    const tree = await workspace.tree();

    expect(tree.map((entry) => entry.path)).toEqual(["src", join("src", "main.ts")]);
  });

  it("exposes only project-declared safe script names", async () => {
    const { root, workspace } = await createWorkspace();
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: {
      test: "vitest run",
      build: "vite build",
      typecheck: "tsc --noEmit",
      deploy: "node publish.js",
      "test:unit": "vitest run unit",
    } }));

    expect(await workspace.scripts()).toEqual([
      { name: "test", manager: "pnpm" },
      { name: "build", manager: "pnpm" },
      { name: "typecheck", manager: "pnpm" },
      { name: "test:unit", manager: "pnpm" },
    ]);
  });
});
