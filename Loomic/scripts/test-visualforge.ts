import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerPinnedSourceResolver } from "./visualforge/source-resolver";

const root = resolve(import.meta.dir, "..");
const directory = await mkdtemp(join(tmpdir(), "loomic-visualforge-test-"));
try {
  const bundle = await Bun.build({
    entrypoints: [join(root, "scripts/visualforge/ai-mutation.test.ts")],
    outdir: directory,
    naming: "ai-mutation.test.js",
    target: "bun",
    external: ["bun:test"],
    plugins: [{
      name: "pinned-test-dependencies",
      setup(build) {
        registerPinnedSourceResolver(build, join(root, "vendor/visualforge"));
      },
    }],
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, "VisualForge test bundle failed");
  const test = Bun.spawn([process.execPath, "test", join(directory, "ai-mutation.test.js"), join(root, "scripts/visualforge/studio-source.test.ts")], { cwd: root, stdout: "inherit", stderr: "inherit" });
  process.exitCode = await test.exited;
} finally {
  await rm(directory, { recursive: true, force: true });
}
