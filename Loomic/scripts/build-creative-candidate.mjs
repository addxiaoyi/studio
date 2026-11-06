import { cp, mkdir, mkdtemp, readdir, realpath, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (!["web", "desktop"].includes(mode)) throw new Error("Choose web or desktop candidate.");
const base = join(root, "release-candidates");
await mkdir(base, { recursive: true });
const stage = await mkdtemp(join(base, `full-${mode}-`));
console.log("BUILD_ROOT " + stage);

async function copy(relative) {
  await cp(join(root, relative), join(stage, relative), {
    recursive: true,
    filter: path => !path.startsWith(join(root, "apps/web/public/downloads")),
  });
}

async function linkDependencies(relative) {
  const source = join(root, relative, "node_modules");
  const destination = join(stage, relative, "node_modules");
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(source)) {
    if (name === ".bin") continue;
    if (name.startsWith("@")) {
      await mkdir(join(destination, name), { recursive: true });
      for (const packageName of await readdir(join(source, name))) {
        if (packageName.endsWith(".audit-stale")) continue;
        const target = name === "@helstera" && packageName === "shared"
          ? join(stage, "packages/shared") : await realpath(join(source, name, packageName));
        await symlink(target, join(destination, name, packageName), "junction");
      }
    } else {
      if (name.endsWith(".audit-stale")) continue;
      await symlink(await realpath(join(source, name)), join(destination, name), "junction");
    }
  }
}

const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(env)) if (key.startsWith("NEXT_PUBLIC_") || /^(HELT_DEPLOY_|QINIU_)/.test(key)) delete env[key];
env.NEXT_PUBLIC_SERVER_BASE_URL = "";
const run = (script, args, cwd) => execFileSync(process.execPath, [script, ...args], { cwd, env, stdio: "inherit", windowsHide: true });
for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "packages/shared/src", "packages/shared/package.json", "packages/shared/tsconfig.json"]) await copy(path);
await linkDependencies("");
await linkDependencies("packages/shared");
run(join(root, "node_modules/typescript/bin/tsc"), ["--build", "tsconfig.json", "--force"], join(stage, "packages/shared"));

if (mode === "web") {
  for (const path of ["src", "public", "package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "next-env.d.ts"]) await copy("apps/web/" + path);
  await linkDependencies("apps/web");
  run(join(root, "apps/web/node_modules/next/dist/bin/next"), ["build"], join(stage, "apps/web"));
} else {
  for (const path of ["electron", "src", "scripts", "index.html", "package.json", "tsconfig.electron.json", "vite.config.ts", "electron-builder.yml"]) await copy("apps/desktop/" + path);
  await linkDependencies("apps/desktop");
  await symlink(join(root, "apps/desktop/resources"), join(stage, "apps/desktop/resources"), "junction");
  run(join(root, "node_modules/typescript/bin/tsc"), ["-p", "tsconfig.electron.json"], join(stage, "apps/desktop"));
  run(join(root, "apps/desktop/node_modules/vite/bin/vite.js"), ["build"], join(stage, "apps/desktop"));
  run(join(root, "apps/desktop/node_modules/electron-builder/cli.js"), ["--win", "nsis", "portable", "--x64", "--publish", "never"], join(stage, "apps/desktop"));
}
console.log("CANDIDATE_BUILT " + stage);
