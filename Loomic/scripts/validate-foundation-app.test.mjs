import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(
  new URL("./validate-foundation-app.mjs", import.meta.url),
);

async function workspace(t, source) {
  const root = await mkdtemp(join(tmpdir(), "helstera-build-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@helstera/server",
      private: true,
      type: "module",
    }),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        types: [],
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  await mkdir(join(root, "src"));
  if (source !== null) await writeFile(join(root, "src/server.ts"), source);
  return root;
}

function build(root) {
  return spawnSync(process.execPath, [validator, "build"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
}

test("rejects a source type error and removes a stale successful build marker", async (t) => {
  const root = await workspace(t, 'export const port: number = "invalid";');
  await mkdir(join(root, "dist"));
  const marker = join(root, "dist/.helstera-build");
  await writeFile(marker, "previous success");
  const run = build(root);
  assert.equal(run.error, undefined);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /TS2322/);
  assert.equal(existsSync(marker), false);
});

test("rejects unresolved runtime imports", async (t) => {
  const root = await workspace(
    t,
    'import { start } from "./missing.js"; start();',
  );
  const run = build(root);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /TS2307/);
  assert.equal(existsSync(join(root, "dist/.helstera-build")), false);
});

test("rejects a source tree with no TypeScript input", async (t) => {
  const root = await workspace(t, null);
  const run = build(root);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /TS18003/);
});

test("validates the no-emit runtime and writes a marker only after success", async (t) => {
  const root = await workspace(t, "export const port: number = 3000;");
  const run = build(root);
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(join(root, "dist/.helstera-build")), true);
  assert.equal(existsSync(join(root, "src/server.js")), false);
});
