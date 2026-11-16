import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export function loadOptionalTestEnv() {
  const path = fileURLToPath(new URL("../../../.env.local", import.meta.url));
  // CI supplies its environment directly; listing tests must not require a local secrets file.
  if (existsSync(path)) loadEnvFile(path);
}
