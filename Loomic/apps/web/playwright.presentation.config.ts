import { defineConfig } from "@playwright/test";
const evidence=process.env.HELT_TEST_CANDIDATE_PATH?"presentation-desktop":"presentation-flow";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "website-presentation.spec.ts",
  workers: 1,
  timeout: 120000,
  outputDir: `../../.creative-test-results/${evidence}`,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: `../../.creative-test-results/${evidence}.json` },
    ],
  ],
  webServer: {
    command: process.env.HELT_WORKFLOW_STATIC_ROOT ? "node ../../scripts/serve-workflow-candidate.mjs" :
      "node node_modules/next/dist/bin/next dev -p 3228 --hostname 127.0.0.1",
    url: "http://localhost:3228/login/",
    env: { NEXT_PUBLIC_SERVER_BASE_URL: "http://localhost:3315" },
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: "http://localhost:3228",
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15000,
    screenshot:"only-on-failure",
  },
});
