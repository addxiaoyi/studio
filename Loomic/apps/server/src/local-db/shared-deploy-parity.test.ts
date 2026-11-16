import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const built = path.join(repoRoot, "packages/shared/dist");
const shippedOverride = process.env.HELT_SHARED_SHIPPED_DIR;
const shipped =
  shippedOverride === undefined
    ? path.join(repoRoot, "deploy/server-runtime/packages/shared/dist")
    : path.resolve(shippedOverride);

function runtimeFiles(directory: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error(`Shared runtime contains a symbolic link: ${relative}`);
    if (entry.isDirectory())
      files.push(...runtimeFiles(path.join(directory, entry.name), relative));
    else if (
      entry.isFile() &&
      (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))
    )
      files.push(relative);
  }
  return files.sort();
}

function assertRuntimeParity(current: string, packaged: string): void {
  if (!hasDist(current) || !hasDist(packaged))
    throw new Error("Both Shared runtimes must contain contracts.js.");
  const currentFiles = runtimeFiles(current);
  const packagedFiles = runtimeFiles(packaged);
  expect(
    packagedFiles,
    "Packaged Shared runtime file list differs from the build",
  ).toEqual(currentFiles);
  const drifted = currentFiles.filter(
    (file) =>
      !readFileSync(path.join(current, file)).equals(
        readFileSync(path.join(packaged, file)),
      ),
  );
  expect(
    drifted,
    "Packaged Shared runtime is stale; rebuild the candidate from the current Shared output",
  ).toEqual([]);
}

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
 * An explicit HELT_SHARED_SHIPPED_DIR can point at a verified candidate extraction.
 * Missing explicit inputs fail instead of silently skipping the release check.
 */
describe("deploy/server-runtime shared copy", () => {
  it.skipIf(
    shippedOverride === undefined && (!hasDist(built) || !hasDist(shipped)),
  )("matches the freshly built @helstera/shared", () => {
    assertRuntimeParity(built, shipped);
  });
});

describe("Shared runtime parity boundaries", () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const directory of fixtures.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), "helstera-shared-parity-"));
    fixtures.push(root);
    const current = path.join(root, "built");
    const packaged = path.join(root, "shipped");
    for (const directory of [current, packaged]) {
      mkdirSync(path.join(directory, "ecom"), { recursive: true });
      writeFileSync(
        path.join(directory, "contracts.js"),
        "export const schema = {};\n",
      );
      writeFileSync(
        path.join(directory, "ecom/contract.js"),
        "export const mode = 'current';\n",
      );
      writeFileSync(
        path.join(directory, "ecom/contract.d.ts"),
        "export declare const mode: 'current';\n",
      );
    }
    return { current, packaged };
  }

  it.each(["ecom/contract.js", "ecom/contract.d.ts"])(
    "rejects nested contract drift in %s",
    (file) => {
      const { current, packaged } = fixture();
      writeFileSync(
        path.join(packaged, file),
        "export const mode = 'stale';\n",
      );
      expect(() => assertRuntimeParity(current, packaged)).toThrow(/stale/);
    },
  );

  it("rejects missing and unexpected nested runtime files", () => {
    const { current, packaged } = fixture();
    rmSync(path.join(packaged, "ecom/contract.js"));
    expect(() => assertRuntimeParity(current, packaged)).toThrow(
      /file list differs/,
    );
    writeFileSync(
      path.join(packaged, "ecom/contract.js"),
      readFileSync(path.join(current, "ecom/contract.js")),
    );
    writeFileSync(
      path.join(packaged, "ecom/extra.js"),
      "export const extra = true;\n",
    );
    expect(() => assertRuntimeParity(current, packaged)).toThrow(
      /file list differs/,
    );
  });

  it("compares the complete nested runtime without requiring source map equality", () => {
    const { current, packaged } = fixture();
    writeFileSync(path.join(packaged, "ecom/contract.js.map"), "{}");
    expect(() => assertRuntimeParity(current, packaged)).not.toThrow();
  });

  it("rejects a missing runtime instead of treating an explicit release check as passed", () => {
    const { current, packaged } = fixture();
    rmSync(path.join(packaged, "contracts.js"));
    expect(() => assertRuntimeParity(current, packaged)).toThrow(
      /must contain contracts/,
    );
  });
});
