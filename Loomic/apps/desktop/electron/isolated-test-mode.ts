import { isAbsolute } from "node:path";

export function isolatedTestDirectory(env: NodeJS.ProcessEnv): string | null {
  if (env.HELSTERA_ISOLATED_TEST !== "1") return null;
  const directory = env.HELSTERA_TEST_USER_DATA;
  if (!directory || !isAbsolute(directory)) {
    throw new Error("Isolated desktop testing requires an absolute user data directory.");
  }
  return directory;
}
