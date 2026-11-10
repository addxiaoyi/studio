import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installCreativeDeps } from "./install-creative-deps.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(readFileSync(resolve(root, "scripts/creative-sources.json"), "utf8"));
const selected = process.argv[2];
if (selected && !(selected in sources)) throw new Error("Unknown creative source: " + selected);
for (const source of selected ? [sources[selected]] : Object.values(sources)) {
  const directory = resolve(root, source.directory);
  if (!existsSync(directory)) {
    mkdirSync(dirname(directory), { recursive: true });
    execFileSync("git", ["clone", "--no-checkout", source.repository, directory], { stdio: "inherit" });
    execFileSync("git", ["-C", directory, "checkout", "--detach", source.commit], { stdio: "inherit" });
  }
  const git = (...args) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
  if (git("rev-parse", "HEAD") !== source.commit || git("status", "--porcelain", "--untracked-files=no")) {
    throw new Error(`Pinned source is modified: ${source.directory}. Preserve it and restore a clean checkout separately.`);
  }
}
if (!selected || selected === "video") installCreativeDeps(resolve(root, sources.video.directory));
