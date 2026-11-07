import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
  await readFile(resolve(root, "scripts/agent-browser-sources.json"), "utf8"),
).chromix;
const platform = process.argv[2] || `${process.platform}-${process.arch}`;
const spec = lock.platforms[platform];
if (!spec)
  throw new Error(`No verified Chromix release is pinned for ${platform}.`);
const destination = resolve(
  root,
  "runtime/chromix",
  `${platform}-${spec.version}`,
);
const archive = resolve(destination, spec.archive);
await mkdir(destination, { recursive: true });
try {
  await access(archive);
} catch {
  const response = await fetch(
    `${lock.repository}/releases/download/${spec.version}/${spec.archive}`,
    { signal: AbortSignal.timeout(15 * 60_000) },
  );
  if (!response.ok || !response.body)
    throw new Error(`Chromix download failed: HTTP ${response.status}`);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(archive, { flags: "wx" }),
  );
}
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
const checksum = hash.digest("hex");
if (checksum !== spec.sha256)
  throw new Error(
    "Chromix archive checksum mismatch; the downloaded archive was retained for inspection.",
  );
execFileSync("tar", ["-xf", archive, "-C", destination], {
  stdio: "inherit",
  windowsHide: true,
});
const executable = resolve(destination, spec.executable);
await access(executable);
await writeFile(
  resolve(destination, "LOOMIC-SOURCE.json"),
  JSON.stringify(
    {
      repository: lock.repository,
      commit: lock.commit,
      version: spec.version,
      sha256: checksum,
      license: lock.license,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    platform,
    version: spec.version,
    sha256: checksum,
    executable,
  }),
);
