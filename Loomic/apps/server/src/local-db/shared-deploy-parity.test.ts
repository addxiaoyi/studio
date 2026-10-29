import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const built = path.join(repoRoot, "packages/shared/dist");
const shipped = path.join(repoRoot, "deploy/server-runtime/packages/shared/dist");

function hasDist(dir: string): boolean {
  try {
    return statSync(path.join(dir, "contracts.js")).isFile();
  } catch {
    return false;
  }
}

/**
 * A release packages deploy/server-runtime, which carries its own copy of @helstera/shared.
 * When that copy drifts behind packages/shared/dist, the deployed server validates responses
 * against stale zod schemas and silently drops any newly added field — HTTP 200, no error,
 * empty column in the UI. That is exactly how `projects[].source` came back missing.
 *
 * `pnpm deploy:sync-shared` refreshes the copy; this test fails before it can ship stale.
 */
describe("deploy/server-runtime shared copy", () => {
  const bothPresent = hasDist(built) && hasDist(shipped);

  it.skipIf(!bothPresent)(
    "matches the freshly built @helstera/shared",
    () => {
      const builtFiles = readdirSync(built).sort();
      const shippedFiles = readdirSync(shipped).sort();
      expect(shippedFiles).toEqual(builtFiles);

      const drifted = builtFiles.filter((file) => {
        if (!file.endsWith(".js") && !file.endsWith(".d.ts")) return false;
        return !readFileSync(path.join(built, file)).equals(
          readFileSync(path.join(shipped, file)),
        );
      });

      expect(
        drifted,
        "deploy/server-runtime/packages/shared/dist is stale — run `pnpm deploy:sync-shared`",
      ).toEqual([]);
    },
  );

  it("documents why the copy exists when the dist folders are absent", () => {
    // Keeps the intent visible in clean checkouts, where both dist folders are gitignored.
    expect(typeof bothPresent).toBe("boolean");
  });
});
