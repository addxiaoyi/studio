import { defineConfig } from "@playwright/test";
const evidence = process.env.HELT_TEST_CANDIDATE_PATH
  ? "agent-browser-electron"
  : "agent-browser";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "agent-browser.spec.ts",
  workers: 1,
  timeout: 120_000,
  outputDir: `../../.creative-test-results/${evidence}`,
  reporter: [
    ["list"],
    ["json", { outputFile: `../../.creative-test-results/${evidence}.json` }],
  ],
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev -p 3226 --hostname 127.0.0.1",
    url: "http://localhost:3226/login/",
    env: { NEXT_PUBLIC_SERVER_BASE_URL: "http://localhost:3313" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:3226",
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
  },
});
